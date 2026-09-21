# Golden worktree: hydrate on-deck members by APFS clone

**Date:** 2026-09-21
**Status:** Design, pre-implementation

## Problem

An on-deck member of a pooled repo is built by a cold create: `git worktree
add`, then the ready ladder (`pnpm install` and whatever the team declares
after it). On assured-dev that is 4 to 7 minutes per tree, serialized per
repo behind `withCreateLock`. When an agent fires several provisions at once
the pool drains after `onDeck` hits and every later caller waits its turn
behind a full install.

Measured on 2026-09-21, one assured-dev tree, machine at load 20 to 44 on 18
cores (so these are upper bounds; idle numbers should be 2x to 4x better):

| Phase | Time |
|---|---|
| `git worktree add` (42k tracked files) | 10s |
| `pnpm install`, fresh, link phase only (580k inodes, all from the store) | 210s |
| pnpm lifecycle scripts (root genTypes, backend prisma generate, two package builds) | ~185s |
| `deploy-db`, nothing pending | 9s |
| **Cold create** | **~7 min** |

Almost none of that is bytes. pnpm already links from a content-addressable
store, so a second tree's `node_modules` is the same files as the first
tree's. The cost is the per-inode walk (580k of them) plus rerunning
generators and builds whose output is identical for the same commit.

The same measurement also showed that `pnpm install` on a tree that is
already up to date still takes 193s, because pnpm reruns every root and
workspace lifecycle script on every invocation. `--ignore-scripts` on the
same up-to-date tree is 8s.

## Design

### The golden tree

Every repo with `onDeck > 0` gets one extra tree, the golden. It is a normal
git worktree of the repo, built by the same `createTree` a cold create uses,
freshened by the same freshen pass, and never claimable.

| | |
|---|---|
| `kind` | `"golden"` (new `TreeKind` member) |
| `name` | `golden` (fixed; not drawn from `namePool`) |
| `branch` | `golden/<name>` (same shape as `on-deck/<name>`) |
| `path` | `goldenRoot(identity)`, a new `rt-paths.ts` helper beside `worktreePoolRoot`, resolving under `~/.mattstack/rt/golden/<pool segment>/` |
| `state` | `creating` while building, `on-deck` once ready (reusing the existing readiness meaning; nothing reads it as claimable because `kind !== "ephemeral"`) |

The golden lives outside the pool root so it is never mistaken for a member
by anything listing that directory. It must stay on the same APFS volume as
the pool root: `clonefile(2)` fails across volumes with `EXDEV`. Both default
locations are under `~/.mattstack/rt`, so that holds unless a user override
moves `root` elsewhere, in which case hydration is skipped (see fallbacks).

`isClaimable`, `selectOnDeck`, and `provision` all already require
`kind === "ephemeral"`, so the golden is unclaimable with no new guard. The
reconciler's adopt step (`reconcile.ts` step b) checks `known` paths first,
so a registered golden is never re-adopted as `unmanaged`.

Because the golden only ever runs the ready ladder, its git-ignored paths are
exactly the post-install artifact set for its commit: `node_modules` at the
root and in every workspace package, generated sources, package `build/`
dirs, tool caches. Nothing else ever writes into it.

### Lifecycle

**Create.** The replenish pass (`replenish.ts`) ensures the golden exists
before it tops up on-deck members: if no `kind: "golden"` row exists for a
repo with `onDeck > 0`, it runs one `createTree` for the golden under the
repo's create lock, with the same backoff a member create gets. Member top-up
in the same pass proceeds regardless (cold create until the golden is ready).

**Freshen.** `freshenCandidate` admits `kind === "golden"` with the same
`state === "on-deck"` rule as members. `freshenRepo` visits the golden first
in each pass, so a master bump reaches the donor before any member that
might be hydrated from it. Members freshen exactly as today.

**Never provisioned, never disposed by provision.** No handler path ever
transitions the golden to `claimed` or `disposable`. `rt worktree dispose`
by name refuses it with `golden-not-disposable`; the only way to remove it is
to set `onDeck` to 0, at which point the reconciler scraps it along with the
members it already scraps today.

### Hydration

Replenish's member create becomes: hydrate if a ready golden exists,
otherwise cold create. Hydration runs inside the same `withCreateLock` and
`withTreeLock` a cold create takes, writes its `creating` row registry-first
exactly like `runCreate`, and on any failure scraps through the same
`scrapTree`.

1. **Worktree at the golden's commit.** `git worktree add -b on-deck/<name>
   <path> <golden.readyStamp>`. Not `origin/<default>`: the new tree is born
   identical to the golden, and the existing freshen pass moves it forward
   on its next visit, running `changed:` steps only if the lockfile or
   migrations moved between the golden's stamp and master. This removes any
   "is the golden current" check from the hot path.

2. **Enumerate the donor's artifacts.** `git -C <golden> status --ignored
   --porcelain` lines prefixed `!!`, minus `*.log` and anything under
   `.git`. Each entry is a top-level ignored path (a directory like
   `node_modules/` or `apps/backend/generated/`, or a file like
   `packages/collision-iq/tsconfig.tsbuildinfo`).

3. **Clone each path with one `clonefile(2)` call.** Through the child
   process `rt worktree hydrate-clone <src> <dst>` (below), invoked via
   `runCapture` like every ready step. The source is the golden's path
   joined with the entry, the destination the new tree's. Parent directories
   are created first; an existing destination is a failure, not a merge.

4. **Inherit readiness.** The new row gets the golden's `readyStamp` and
   `readyAt`, flips to `state: "on-deck"`, and emits `worktree:created`. No
   ready step runs. `pnpm install` is never invoked on a hydrated tree; the
   next freshen decides whether anything changed.

`clonefile` is copy-on-write: the clone shares physical blocks with the
donor and consumes only metadata until a side is written. Verified in the
spike by `fcntl(F_LOG2PHYS)` returning identical device offsets for the
donor file and its clone.

pnpm's `node_modules/.modules.yaml` carries one absolute path, the global
`storeDir`, which is the same on every tree on the machine. `virtualStoreDir`
and every symlink pnpm writes are relative, so the clone needs no rewriting.

### The `hydrate-clone` verb

`rt worktree hydrate-clone <src> <dst>`, hidden in the command tree (same
pattern as `intercept run`), registered in `lib/module-registry.ts`, exempt
from `omitBehavior` as agent-facing by contract.

It calls `clonefile(2)` once, on the directory or file at `src`, through
`bun:ffi` against `libSystem.B.dylib`:

```
clonefile(const char *src, const char *dst, uint32_t flags) -> int
```

Exit codes: `0` cloned; `2` usage; `3` `EXDEV` (cross-volume); `4`
`ENOTSUP` (filesystem does not support clones); `5` `EEXIST`; `1` any other
errno. Stderr carries `clonefile: <strerror>`. The daemon maps 3 and 4 to
"hydration unavailable for this repo" and everything else to a failed
create.

Why a child process and not an in-daemon call: `clonefile` on 580k inodes is
a single synchronous syscall that took 68s under load. On the daemon thread
that is a 68s event-loop stall, the exact degraded state this work started
from. A Bun `Worker` would move the block off the loop but keep an FFI fault
inside the daemon process. A Go helper is a spawn anyway plus a new build
target and bundle entry. The process boundary is the isolation unit the
daemon already uses for every ready step.

`bun:ffi` generates its trampolines at runtime. rt ships signed; Bun's own
JIT already requires the JIT entitlement so this is expected to pass, but it
is unverified. The first implementation task is to call `clonefile` through
`bun:ffi` from a compiled, signed `rt` under an isolated HOME. If that fails,
the verb's body becomes a small Go helper using `x/sys/unix.Clonefile`; the
daemon-side contract (argv, exit codes, stderr) does not change.

### Fallbacks

Hydration is an optimization over cold create, never a replacement for it.
Replenish cold-creates when:

- no `kind: "golden"` row exists, or it is `creating`, or it carries a
  `nextRetryAt` in the future;
- the golden has no `readyStamp` (a held team ladder never stamped it);
- `cfg.root` and the golden root resolve to different `st_dev` values
  (checked once per replenish pass with `statSync`);
- a `hydrate-clone` call exits 3 or 4.

A `hydrate-clone` exit of 1 or 5, or a `git worktree add` failure, scraps
the half-built tree through `scrapTree` and counts against the member's
create backoff, exactly as a failed ready step does today. The next attempt
re-evaluates the conditions above; it does not disable hydration for the
repo.

Golden create or freshen failures follow today's create-backoff path on the
golden's own row. They never block member replenish, which cold-creates in
the meantime.

### What does not change

- `ReadyStep` shape, `resolveReadySteps`, the team ladder approval hash.
  The team's `ready` array is untouched; a hydrated tree simply inherits a
  stamp that makes every `changed:` step a no-op until master moves.
- The provision handler. It selects from on-deck members as before; the
  golden is invisible to it.
- Member freshen. A lockfile bump still costs each existing member one
  install, as today. Scrapping and re-hydrating members instead is a
  possible follow-up, deliberately out of scope.
- Disposal, trash, stale-claim sweeps.

## Expected result

On-deck top-up on assured-dev goes from ~7 minutes to the sum of `git
worktree add` (10s) plus one `clonefile` per ignored path (68s for the root
`node_modules`, 7s for the other 172 entries, all at load 20 to 40). Under
30s is plausible on an idle machine. A lockfile bump costs one install (the
golden) plus per-member freshens as before.

## Testing

- `replenish`: golden ensured before member top-up; member path chooses
  hydrate vs cold for each fallback condition above; hydrate runs under both
  locks; failure scraps and backs off.
- `freshen`: golden is a candidate and visits first.
- `handlers/worktree`: golden is not selectable, not claimable, not
  disposable.
- `reconcile`: a registered golden is not re-adopted; `onDeck: 0` scraps it.
- Hydration unit: ignored-path enumeration from porcelain output (drops
  `*.log`, keeps files and dirs), `readyStamp`/`readyAt` inheritance,
  exit-code mapping.
- `hydrate-clone` real-FS test on a temp dir under the test HOME: clones a
  nested tree, asserts `F_LOG2PHYS` offsets match for a file in each, asserts
  the exit codes for `EEXIST` and a missing source.
- e2e: the hidden verb's usage exit code and stderr on bad argv.
- Signed-binary `bun:ffi` check as the first implementation task, recorded
  in the plan with its outcome.

## Source

Spike run 2026-09-21 on `lupin` (assured-dev), scratch clones only; numbers
above. Design decisions ratified in session: inherit `readyStamp` rather than
add step scoping; child process for the clone call; members freshen as today
with hydration only on create; every `onDeck > 0` repo gets a golden.
