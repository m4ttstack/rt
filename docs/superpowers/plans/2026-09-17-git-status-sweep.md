# Git Status Sweep + Badge Cache + Tree Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mission-control data layer: a daemon sweep that snapshots every registered repo via git-core into a badge cache, `rt repos status --json` as the rail feed, and `rt git status|diff|log|branches --json` tree verbs plus coarse human verbs `rt git amend|undo|stash|tag`.

**Architecture:** The daemon gains a `git-status-sweep` (scheduleSweep pattern, project-mrs store model): it enumerates the repo index, snapshots each non-bare worktree through `packages/git-core`, upserts badges into a new state.db table (`git_badges`, schema v13), and emits a non-journaled `git-status` event when badges change. `rt repos status` reads that cache over a new `repos:status` daemon verb. The `rt git` read verbs call git-core in-process (no daemon); the coarse mutation verbs wire chunk 2's mutation surface (`undoLastCommit`, stash, tags, `commitStaged`/amend) plus `checkBranchGuard` into the tree. Micro-mutations (stage/discard selections) stay library-level: no tree leaves for them.

**Tech Stack:** Bun + TypeScript, `packages/git-core` (first in-repo consumer), bun:sqlite state.db, rt daemon (scheduleSweep, events bus fanOut), rt command tree.

**Spec:** No separate spec doc. The binding authority is the Linear ticket "Chunk 3: daemon status sweep, badge cache, and rt tree JSON verbs" plus the project description "Headless git client + mission control" (Linear project 70ecfa35-fd06-4a01-87ee-595300bfb983). Their operative text is reproduced in Global Constraints and the task briefs below; conflicts resolve against the ticket text.

## Global Constraints

- Public repo. Run `scripts/repo-purity.sh` before any push. NO Linear ticket ids (RT-*, SKILLS-*) in code, comments, tests, or commit messages (older files contain them; do not imitate). No em dashes or en dashes anywhere, including strings and docs.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Clean-code comments: a comment states only a constraint the code cannot show. No narration, no review-facing justifications, no decision history.
- **SCHEMA_VERSION 13 is claimed by this branch.** `lib/state/db.ts` moves 12 -> 13. Announce the claim to other sessions (rt chat) before merge; if another lane merged a 13 first, renumber to 14. `V13_SCHEMA` may contain nothing but `CREATE TABLE IF NOT EXISTS` statements (the runner replays all blocks on every open).
- Every new command module referenced by the tree MUST get a thunked literal entry in `lib/module-registry.ts` (`"./commands/x.ts": () => import("../commands/x.ts")`). No static imports of command modules there.
- Every visible leaf with a required positional must declare `omitBehavior` (`bun run picker:check` gates CI). Every leaf picker must be gated `process.stdin.isTTY && !json && !process.env.RT_BATCH`, and the non-TTY/--json path keeps the exact usage message, exit code, and JSON it would have without the picker. An empty candidate set falls through to the error, never an empty picker.
- JSON convention for all new verbs (ruling): plain daemon-RPC style. Success prints `JSON.stringify({ ok: true, ...data })` exit 0; failure with `--json` prints `JSON.stringify({ ok: false, error })` exit 1, without `--json` prints `rt <verb>: <message>` to stderr exit 1. Do NOT use the setup-contract envelope (`contract: 2`, exit 2) for these verbs.
- Daemon payloads and state.db keys use the SERIALIZED repo identity (the repo-index key, e.g. `remote:github.com%2Fm4ttstack%2Frt`). Settings `repoIdentity` uses the RAW `host/path` form (`parseIdentity(serialized)?.id`). See docs/repo-identity.md.
- The daemon thread never runs sync process execs. All git work in the sweep goes through git-core (async simple-git spawns) or `listWorktreesAsync`.
- Never use `@{u}` anywhere.
- After touching anything under `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (dist-freshness test fails otherwise).
- `bun run test` does not run e2e. Any verb whose `--json` shape is pinned end to end needs `bun run test:e2e` (or `test:all`) before claiming verification.
- Merged daemon code is NOT live until the shared main checkout syncs AND the daemon restarts. Do not test against the live daemon; unit tests use injected deps.
- Worktree Bash guard is active in this session: one plain command per Bash call; no `&&`, heredocs, loops, `git -C`, or `bun run --cwd`. Multi-step shell goes into a scratchpad `.sh` file run as `bash <path>`.

## Known-limits inputs from chunk 2 (consumers must respect)

- Unborn-repo `undoLastCommit`/`stashPush` throw git's own error text, not typed refusals. Catch and surface the message.
- `stagingDiff` on a mid-merge conflicted path throws; irrelevant here (no staging leaves), but `diffFile` on conflicted paths returns a normal FileDiff.
- `FetchState.lastFetchedAt` is an ISO string or null (safe across the daemon JSON boundary).

## File Structure

| File | Role |
|---|---|
| `packages/rt-client/src/commands.ts` (modify) | Wire types `GitWorktreeBadge`, `RepoStatusRow`; `"repos:status"` Commands entry + COMMAND_NAMES row |
| `packages/rt-client/src/settings/registry-defs.ts` (modify) | New `rt.gitStatus` key (repoScoped object: sweep gate + cadence) |
| `lib/state/db.ts` (modify) | `V13_SCHEMA` (`git_badges` table), `SCHEMA_VERSION = 13`, SCHEMAS array |
| `lib/daemon/git-badges-store.ts` (create) | Badge cache store: in-memory mirror + persistOrWarn upserts (project-mrs model) |
| `lib/daemon/git-status-sweep.ts` (create) | Sweep core: enumerate index, snapshot via git-core, replaceRepo, emit `git-status` |
| `lib/daemon/handlers/git-status.ts` (create) | `repos:status` handler |
| `lib/daemon/command-router.ts` (modify) | Spread `createGitStatusHandlers` |
| `lib/daemon.ts` (modify) | Construct store + sweep, `scheduleSweep("git-status-sweep", ...)` |
| `commands/repos.ts` (modify) | `reposStatus` verb |
| `lib/commit-ops.ts` (modify) | `amendStaged` (amend with optional message) |
| `commands/git/inspect.ts` (create) | `statusCommand`, `diffCommand`, `logCommand`, `branchesCommand` |
| `commands/git/mutate.ts` (create) | `amendCommand`, `undoCommand`, stash verbs, tag verbs |
| `lib/command-tree-def.ts` (modify) | New leaves under `git` and `repos` |
| `lib/module-registry.ts` (modify) | Thunks for `commands/git/inspect.ts`, `commands/git/mutate.ts` |
| Tests | `lib/daemon/__tests__/git-badges-store.test.ts`, `lib/daemon/__tests__/git-status-sweep.test.ts`, `lib/daemon/__tests__/git-status-handlers.test.ts`, additions to `lib/__tests__/commit-ops.test.ts`, `lib/__tests__/repos-status.test.ts`, `e2e/tests/git-verbs.test.ts` |

The wire types live in rt-client's `commands.ts` because daemon handlers already import their payload/data types from there (see `lib/daemon/handlers/reconciler.ts`); the store and sweep import the badge type from rt-client, never the reverse.

---

### Task 1: Wire types, `repos:status` command entry, and the `rt.gitStatus` settings key

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (Commands map around the existing `"repos:locate"` entry at ~line 686; COMMAND_NAMES array around ~line 877)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (append near the `rt.logRetentionDays` row at ~line 217)
- Test: `packages/rt-client` existing suites (registry conformance + command-name tests already exist and must stay green; `lib/daemon/__tests__/rt-client-commands.test.ts` covers name/entry agreement)

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks import these exact names from `packages/rt-client/src/commands.ts`):
  - `export interface GitWorktreeBadge { worktree: string; branch: string | null; detached: boolean; staged: number; unstaged: number; untracked: number; conflicted: number; clean: boolean; ahead: number | null; behind: number | null; upstream: string | null; lastFetchedAt: string | null; updatedAt: string; }`
  - `export interface RepoStatusRow { repo: string; worktrees: GitWorktreeBadge[]; error: string | null; }`
  - Commands entry: `"repos:status": { payload: { refresh?: boolean }; data: { repos: RepoStatusRow[]; sweptAt: string | null } };`
  - Settings key `rt.gitStatus` with default `{ sweep: true, sweepIntervalSec: 300 }`.

- [ ] **Step 1: Add the wire types and Commands entry**

In `packages/rt-client/src/commands.ts`, immediately above the `"repos:locate"` entry, add the two interfaces (top-level, near the other exported data interfaces) and the map entry:

```ts
/** One worktree's git badge as the daemon sweep computed it. All timestamps ISO 8601. */
export interface GitWorktreeBadge {
  worktree: string;
  branch: string | null;
  detached: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  clean: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  lastFetchedAt: string | null;
  updatedAt: string;
}

/** repo is the serialized identity (the repo-index key). error is set when the last sweep could not read the repo; stale worktrees may accompany it. */
export interface RepoStatusRow {
  repo: string;
  worktrees: GitWorktreeBadge[];
  error: string | null;
}
```

Map entry (next to `"repos:locate"`):

```ts
"repos:status": { payload: { refresh?: boolean }; data: { repos: RepoStatusRow[]; sweptAt: string | null } };
```

Add `"repos:status",` to the COMMAND_NAMES array right after `"repos:locate",`.

- [ ] **Step 2: Add the settings key**

In `packages/rt-client/src/settings/registry-defs.ts`, after the `rt.logRetentionDays` row, add:

```ts
{
  key: "rt.gitStatus",
  type: "object",
  scopes: ALL_SCOPES,
  default: { sweep: true, sweepIntervalSec: 300 },
  merge: "deep",
  repoScoped: true,
  migrated: true,
  description: "Mission-control git badge sweep. sweep gates the daemon sweep (a per-repo override of { sweep: false } opts that repo out); sweepIntervalSec is the minimum seconds between sweeps, read fresh each tick.",
},
```

Use the exact `ALL_SCOPES` constant the `rt.worktrees` row uses (registry-defs.ts:37-46). If the registry has a conformance test asserting key counts or sorted order, update it to include `rt.gitStatus`.

- [ ] **Step 3: Rebuild rt-client**

Run from `packages/rt-client`: `bun run build`
Expected: dist regenerated; `packages/rt-client/test/dist-freshness.test.ts` passes afterward.

- [ ] **Step 4: Run the affected suites**

Run: `bun test packages/rt-client lib/daemon/__tests__/rt-client-commands.test.ts`
Expected: PASS (if a registry or command-names test fails, it names the missing row; fix by completing steps 1-2, never by weakening the test).

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/commands.ts packages/rt-client/src/settings/registry-defs.ts
git commit -m "rt-client: repos:status wire types and rt.gitStatus settings key"
```

(Include any updated conformance test files in the add. dist/ is gitignored; do not add it.)

---

### Task 2: state.db v13 `git_badges` table + badge store

**Files:**
- Modify: `lib/state/db.ts` (SCHEMA_VERSION at line 25; V13_SCHEMA after V12_SCHEMA at ~line 322; SCHEMAS array at line 333)
- Create: `lib/daemon/git-badges-store.ts`
- Test: `lib/daemon/__tests__/git-badges-store.test.ts`

**Interfaces:**
- Consumes: `GitWorktreeBadge` from `packages/rt-client/src/commands.ts` (Task 1); `persistOrWarn` from `lib/state/busy.ts` (match `lib/daemon/project-mrs-store.ts`'s exact usage); `Database` from `bun:sqlite`.
- Produces:
  - `export interface GitBadgesStore { readAll(): Map<string, GitWorktreeBadge[]>; replaceRepo(repo: string, badges: GitWorktreeBadge[]): { changed: boolean }; dropRepos(live: Set<string>): string[]; }`
  - `export function createGitBadges(db: Database): GitBadgesStore`

- [ ] **Step 1: Write the failing store test**

`lib/daemon/__tests__/git-badges-store.test.ts` (model the setup on `lib/daemon/__tests__/project-mrs-store.test.ts`, which opens a temp state.db via `openStateDb`):

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../state/db.ts";
import { createGitBadges } from "../git-badges-store.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";

function badge(overrides: Partial<GitWorktreeBadge> = {}): GitWorktreeBadge {
  return {
    worktree: "/tmp/a", branch: "main", detached: false,
    staged: 0, unstaged: 1, untracked: 0, conflicted: 0, clean: false,
    ahead: 2, behind: 0, upstream: "origin/main",
    lastFetchedAt: null, updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

function freshDb() {
  return openStateDb(join(mkdtempSync(join(tmpdir(), "badges-")), "state.db"), "daemon");
}

describe("git badges store", () => {
  test("replaceRepo persists and readAll round-trips across a reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "badges-")), "state.db");
    const store = createGitBadges(openStateDb(path, "daemon"));
    const changed = store.replaceRepo("remote:example.com%2Fa%2Fb", [badge()]);
    expect(changed.changed).toBe(true);
    const reopened = createGitBadges(openStateDb(path, "daemon"));
    expect(reopened.readAll().get("remote:example.com%2Fa%2Fb")).toEqual([badge()]);
  });

  test("identical badges except updatedAt report changed: false", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("remote:example.com%2Fa%2Fb", [badge()]);
    const second = store.replaceRepo("remote:example.com%2Fa%2Fb", [
      badge({ updatedAt: "2026-09-17T00:05:00.000Z" }),
    ]);
    expect(second.changed).toBe(false);
  });

  test("a badge field change reports changed: true", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("remote:example.com%2Fa%2Fb", [badge()]);
    const second = store.replaceRepo("remote:example.com%2Fa%2Fb", [badge({ ahead: 3 })]);
    expect(second.changed).toBe(true);
  });

  test("a removed worktree's row is deleted by replaceRepo", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("r", [badge({ worktree: "/tmp/a" }), badge({ worktree: "/tmp/b" })]);
    store.replaceRepo("r", [badge({ worktree: "/tmp/a" })]);
    expect(store.readAll().get("r")!.map((b) => b.worktree)).toEqual(["/tmp/a"]);
  });

  test("dropRepos removes repos absent from the live set and returns them", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("keep", [badge()]);
    store.replaceRepo("gone", [badge()]);
    expect(store.dropRepos(new Set(["keep"]))).toEqual(["gone"]);
    expect([...store.readAll().keys()]).toEqual(["keep"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/daemon/__tests__/git-badges-store.test.ts`
Expected: FAIL, cannot resolve `../git-badges-store.ts`.

- [ ] **Step 3: Add V13 schema**

In `lib/state/db.ts`:
- Line 25 becomes `export const SCHEMA_VERSION = 13;` and the doc comment above it gains `+ v13`.
- After V12_SCHEMA add:

```ts
// Tables (v13): git badge cache written by the daemon's git-status sweep,
// one row per (repo identity, worktree path); badge is the GitWorktreeBadge JSON.
const V13_SCHEMA = `
CREATE TABLE IF NOT EXISTS git_badges (
  repo       TEXT NOT NULL,
  worktree   TEXT NOT NULL,
  badge      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repo, worktree)
);
`;
```

- Append `V13_SCHEMA` to the SCHEMAS array.

- [ ] **Step 4: Implement the store**

`lib/daemon/git-badges-store.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import { persistOrWarn } from "../state/busy.ts";

export interface GitBadgesStore {
  readAll(): Map<string, GitWorktreeBadge[]>;
  replaceRepo(repo: string, badges: GitWorktreeBadge[]): { changed: boolean };
  dropRepos(live: Set<string>): string[];
}

/** updatedAt is a sweep timestamp, not repo state; it never counts as a change. */
function fingerprint(badges: GitWorktreeBadge[]): string {
  return JSON.stringify(
    [...badges]
      .sort((a, b) => a.worktree.localeCompare(b.worktree))
      .map(({ updatedAt: _updatedAt, ...rest }) => rest),
  );
}

export function createGitBadges(db: Database): GitBadgesStore {
  const data = new Map<string, GitWorktreeBadge[]>();
  const rows = db.query("SELECT repo, badge FROM git_badges ORDER BY repo, worktree").all() as
    { repo: string; badge: string }[];
  for (const row of rows) {
    const parsed = JSON.parse(row.badge) as GitWorktreeBadge;
    const list = data.get(row.repo) ?? [];
    list.push(parsed);
    data.set(row.repo, list);
  }

  const upsert = db.prepare(
    `INSERT INTO git_badges (repo, worktree, badge, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, worktree) DO UPDATE SET badge = excluded.badge, updated_at = excluded.updated_at`,
  );
  const deleteWorktree = db.prepare("DELETE FROM git_badges WHERE repo = ? AND worktree = ?");
  const deleteRepo = db.prepare("DELETE FROM git_badges WHERE repo = ?");

  return {
    readAll() {
      return new Map([...data.entries()].map(([repo, badges]) => [repo, [...badges]]));
    },

    replaceRepo(repo, badges) {
      const previous = data.get(repo) ?? [];
      const changed = fingerprint(previous) !== fingerprint(badges);
      const goneWorktrees = previous
        .map((b) => b.worktree)
        .filter((w) => !badges.some((b) => b.worktree === w));
      data.set(repo, [...badges]);
      persistOrWarn("git-badges", () => {
        db.transaction(() => {
          for (const w of goneWorktrees) deleteWorktree.run(repo, w);
          for (const b of badges) upsert.run(repo, b.worktree, JSON.stringify(b), Date.now());
        })();
      }, { repo, op: "replace" });
      return { changed };
    },

    dropRepos(live) {
      const gone = [...data.keys()].filter((repo) => !live.has(repo));
      for (const repo of gone) {
        data.delete(repo);
        persistOrWarn("git-badges", () => { deleteRepo.run(repo); }, { repo, op: "drop" });
      }
      return gone;
    },
  };
}
```

If `persistOrWarn`'s actual signature in `lib/state/busy.ts` differs (check `lib/daemon/project-mrs-store.ts:159-196` for the live call shape), match the live shape and keep the semantics: SQLITE_BUSY warns and defers, never throws.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/daemon/__tests__/git-badges-store.test.ts`
Expected: PASS. Also run `bun test lib/state` (schema convergence test must see V13 in SCHEMAS).

- [ ] **Step 6: Commit**

```bash
git add lib/state/db.ts lib/daemon/git-badges-store.ts lib/daemon/__tests__/git-badges-store.test.ts
git commit -m "daemon: git_badges table (schema v13) and badge store"
```

---

### Task 3: Sweep core (`git-status-sweep.ts`)

**Files:**
- Create: `lib/daemon/git-status-sweep.ts`
- Test: `lib/daemon/__tests__/git-status-sweep.test.ts`

**Interfaces:**
- Consumes: `GitBadgesStore` (Task 2); `GitWorktreeBadge` (Task 1); `createGitClient` + `RepoSnapshot`/`FetchState` types from `packages/git-core/src/index.ts`; `listWorktreesAsync` from `lib/worktree/git-async.ts` (`(repoPath, signal?) => Promise<WorktreeEntry[] | null>`, `WorktreeEntry = { path; branch; headSha; isBare }`); `getSetting` from the same module `lib/daemon/doppler-sync.ts` imports it from; `parseIdentity` from `lib/settings/identity.ts`; `RepoIndex` from `lib/repo-index.ts`; `Logger` type as other daemon modules import it.
- Produces:
  - `export interface GitStatusSweep { tick(): Promise<void>; sweepNow(): Promise<{ changed: string[] }>; lastSweepAt(): string | null; errors(): Map<string, string>; }`
  - `export function createGitStatusSweep(deps: GitStatusSweepDeps): GitStatusSweep`
  - `export function toBadge(worktree: string, snap: RepoSnapshot, fetch: FetchState, updatedAt: string): GitWorktreeBadge` (exported for tests)

**Behavior contract:**
- `tick()` is the scheduleSweep entry: returns immediately if a sweep is in flight, if the global `rt.gitStatus.sweep` is false, or if less than `sweepIntervalSec` has elapsed since the last completed sweep. Settings are read fresh inside every tick (the `logRetentionDays` idiom, lib/daemon.ts:799-800).
- `sweepNow()` runs one full pass regardless of cadence; if a pass is already in flight it awaits that pass instead of starting a second (single-flight promise).
- Per repo: parse the raw identity for the per-repo settings override; skip when `sweep === false` for that repo. `listWorktrees(mainPath)` returning `null` records `errors().set(repo, "git worktree list failed")` and keeps prior badges. Each non-bare worktree gets `snapshot()` + `fetchState()` through a fresh `makeClient(path)`. A throw anywhere in one repo's pass logs `warn` with `{ err, repo }`, records the message in `errors()`, keeps prior badges, and continues with the next repo.
- Counts derive from `snapshot.files`: `staged` = files with `staged === true`; `unstaged` = files with `unstaged === true` and `kind !== "untracked"`; `untracked` = files with `kind === "untracked"`; `conflicted` = files with `kind === "conflicted"`.
- After the pass: `store.dropRepos(liveSet)`; when `changed.length + dropped.length > 0`, one `emit("git-status", { repos: [...changed, ...dropped] })`. A successful repo pass clears its `errors()` entry.

- [ ] **Step 1: Write the failing tests**

`lib/daemon/__tests__/git-status-sweep.test.ts`. Everything is injected; no real daemon, no settings file (inject `readConfig`). Use `makeSandbox` from `packages/git-core/test-support/sandbox.ts` for one integration-flavored case and pure fakes for the rest:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../state/db.ts";
import { createGitBadges } from "../git-badges-store.ts";
import { createGitStatusSweep, toBadge } from "../git-status-sweep.ts";
import { makeSandbox } from "../../../packages/git-core/test-support/sandbox.ts";
import { createGitClient } from "../../../packages/git-core/src/index.ts";

function freshStore() {
  return createGitBadges(openStateDb(join(mkdtempSync(join(tmpdir(), "sweep-")), "state.db"), "daemon"));
}

const silentLog = { info() {}, warn() {}, debug() {}, error() {} } as any;

function sweepWith(overrides: Partial<Parameters<typeof createGitStatusSweep>[0]>) {
  return createGitStatusSweep({
    repoIndex: () => ({}),
    store: freshStore(),
    log: silentLog,
    emit: () => {},
    readConfig: () => ({ sweep: true, sweepIntervalSec: 300 }),
    ...overrides,
  });
}

describe("git status sweep", () => {
  test("sweeps a real repo into badges and emits git-status on change", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "one\n");
      await sb.commitAll("init");
      await sb.write("a.txt", "two\n");
      const store = freshStore();
      const events: Array<{ type: string; data: any }> = [];
      const sweep = sweepWith({
        repoIndex: () => ({ "path:repo": sb.dir }),
        store,
        emit: (type, data) => events.push({ type, data }),
        listWorktrees: async () => [{ path: sb.dir, branch: "main", headSha: null, isBare: false }],
      });
      const { changed } = await sweep.sweepNow();
      expect(changed).toEqual(["path:repo"]);
      expect(events).toEqual([{ type: "git-status", data: { repos: ["path:repo"] } }]);
      const badge = store.readAll().get("path:repo")![0]!;
      expect(badge.branch).toBe("main");
      expect(badge.unstaged).toBe(1);
      expect(badge.clean).toBe(false);
      expect(sweep.lastSweepAt()).not.toBeNull();
    } finally {
      await sb.cleanup();
    }
  });

  test("an unchanged second sweep emits nothing", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "one\n");
      await sb.commitAll("init");
      const events: string[] = [];
      const sweep = sweepWith({
        repoIndex: () => ({ "path:repo": sb.dir }),
        emit: (type) => events.push(type),
        listWorktrees: async () => [{ path: sb.dir, branch: "main", headSha: null, isBare: false }],
      });
      await sweep.sweepNow();
      const before = events.length;
      await sweep.sweepNow();
      expect(events.length).toBe(before);
    } finally {
      await sb.cleanup();
    }
  });

  test("per-repo opt-out skips the repo", async () => {
    const store = freshStore();
    let listed = 0;
    const sweep = sweepWith({
      repoIndex: () => ({ "remote:example.com%2Fa%2Fb": "/nope" }),
      store,
      readConfig: (repoIdentity) =>
        repoIdentity === "example.com/a/b"
          ? { sweep: false, sweepIntervalSec: 300 }
          : { sweep: true, sweepIntervalSec: 300 },
      listWorktrees: async () => { listed++; return []; },
    });
    await sweep.sweepNow();
    expect(listed).toBe(0);
  });

  test("a failing repo records an error, keeps prior badges, and does not kill the pass", async () => {
    const store = freshStore();
    store.replaceRepo("bad", [toBadge("/w", { branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }, { lastFetchedAt: null }, "2026-09-17T00:00:00.000Z")]);
    const sweep = sweepWith({
      repoIndex: () => ({ bad: "/definitely/missing" }),
      store,
      listWorktrees: async () => null,
    });
    await sweep.sweepNow();
    expect(sweep.errors().get("bad")).toBeTruthy();
    expect(store.readAll().get("bad")!.length).toBe(1);
  });

  test("tick respects the cadence floor and the global gate", async () => {
    let passes = 0;
    const config = { sweep: true, sweepIntervalSec: 3600 };
    const sweep = sweepWith({
      repoIndex: () => { passes++; return {}; },
      readConfig: () => config,
    });
    await sweep.tick();
    await sweep.tick();
    expect(passes).toBe(1);
    config.sweep = false;
    await sweep.tick();
    expect(passes).toBe(1);
  });

  test("a repo removed from the index is dropped and announced", async () => {
    const store = freshStore();
    store.replaceRepo("gone", [toBadge("/w", { branch: "x", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }, { lastFetchedAt: null }, "2026-09-17T00:00:00.000Z")]);
    const events: any[] = [];
    const sweep = sweepWith({ store, emit: (t, d) => events.push({ t, d }) });
    await sweep.sweepNow();
    expect(events).toEqual([{ t: "git-status", d: { repos: ["gone"] } }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/git-status-sweep.test.ts`
Expected: FAIL, cannot resolve `../git-status-sweep.ts`.

- [ ] **Step 3: Implement**

`lib/daemon/git-status-sweep.ts`:

```ts
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import type { FetchState, RepoSnapshot } from "../../packages/git-core/src/index.ts";
import { createGitClient } from "../../packages/git-core/src/index.ts";
import { listWorktreesAsync } from "../worktree/git-async.ts";
import { parseIdentity } from "../settings/identity.ts";
import type { RepoIndex } from "../repo-index.ts";
import type { GitBadgesStore } from "./git-badges-store.ts";

export interface GitStatusConfig {
  sweep: boolean;
  sweepIntervalSec: number;
}

export interface GitStatusSweepDeps {
  repoIndex: () => RepoIndex;
  store: GitBadgesStore;
  log: { info: Function; warn: Function; debug: Function; error: Function };
  emit: (type: string, data: unknown) => void;
  /** repoIdentity is the RAW host/path form, or null for the global read. */
  readConfig: (repoIdentity: string | null) => GitStatusConfig;
  listWorktrees?: typeof listWorktreesAsync;
  makeClient?: typeof createGitClient;
  now?: () => Date;
}

export interface GitStatusSweep {
  tick(): Promise<void>;
  sweepNow(): Promise<{ changed: string[] }>;
  lastSweepAt(): string | null;
  errors(): Map<string, string>;
}

export function toBadge(
  worktree: string,
  snap: RepoSnapshot,
  fetch: FetchState,
  updatedAt: string,
): GitWorktreeBadge {
  const files = snap.files;
  return {
    worktree,
    branch: snap.branch,
    detached: snap.detached,
    staged: files.filter((f) => f.staged).length,
    unstaged: files.filter((f) => f.unstaged && f.kind !== "untracked").length,
    untracked: files.filter((f) => f.kind === "untracked").length,
    conflicted: files.filter((f) => f.kind === "conflicted").length,
    clean: snap.clean,
    ahead: snap.ahead,
    behind: snap.behind,
    upstream: snap.upstream,
    lastFetchedAt: fetch.lastFetchedAt,
    updatedAt,
  };
}

export function createGitStatusSweep(deps: GitStatusSweepDeps): GitStatusSweep {
  const listWorktrees = deps.listWorktrees ?? listWorktreesAsync;
  const makeClient = deps.makeClient ?? createGitClient;
  const now = deps.now ?? (() => new Date());
  const repoErrors = new Map<string, string>();
  let inFlight: Promise<{ changed: string[] }> | null = null;
  let lastCompletedAt: number | null = null;

  async function pass(): Promise<{ changed: string[] }> {
    const index = deps.repoIndex();
    const live = new Set(Object.keys(index));
    const changed: string[] = [];
    for (const [repo, mainPath] of Object.entries(index)) {
      const raw = parseIdentity(repo)?.id ?? null;
      if (!deps.readConfig(raw).sweep) continue;
      try {
        const trees = await listWorktrees(mainPath);
        if (trees === null) {
          repoErrors.set(repo, "git worktree list failed");
          continue;
        }
        const badges: GitWorktreeBadge[] = [];
        for (const tree of trees.filter((t) => !t.isBare)) {
          const client = makeClient(tree.path);
          const [snap, fetch] = await Promise.all([client.snapshot(), client.fetchState()]);
          badges.push(toBadge(tree.path, snap, fetch, now().toISOString()));
        }
        if (deps.store.replaceRepo(repo, badges).changed) changed.push(repo);
        repoErrors.delete(repo);
      } catch (err) {
        repoErrors.set(repo, err instanceof Error ? err.message : String(err));
        deps.log.warn({ err, repo }, "git status sweep failed for repo");
      }
    }
    const dropped = deps.store.dropRepos(live);
    for (const repo of dropped) repoErrors.delete(repo);
    const announce = [...changed, ...dropped];
    if (announce.length > 0) deps.emit("git-status", { repos: announce });
    lastCompletedAt = now().getTime();
    return { changed };
  }

  function sweepNow(): Promise<{ changed: string[] }> {
    if (inFlight) return inFlight;
    inFlight = pass().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    sweepNow,
    async tick() {
      if (inFlight) return;
      const cfg = deps.readConfig(null);
      if (!cfg.sweep) return;
      if (lastCompletedAt !== null && now().getTime() - lastCompletedAt < cfg.sweepIntervalSec * 1000) return;
      await sweepNow();
    },
    lastSweepAt() {
      return lastCompletedAt === null ? null : new Date(lastCompletedAt).toISOString();
    },
    errors() {
      return new Map(repoErrors);
    },
  };
}
```

Note the deliberate seam: `readConfig` is a dep, so the sweep never imports the settings resolver directly and tests never touch real settings. Task 4 supplies the real reader.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/git-status-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/git-status-sweep.ts lib/daemon/__tests__/git-status-sweep.test.ts
git commit -m "daemon: git status sweep core over git-core"
```

---

### Task 4: Daemon wiring: handler, router, scheduleSweep

**Files:**
- Create: `lib/daemon/handlers/git-status.ts`
- Modify: `lib/daemon/command-router.ts` (spread the new factory where `createProjectMRsHandlers` is spread, ~lines 212-244)
- Modify: `lib/daemon.ts` (construct store + sweep near the other store constructions; register the sweep in the `"background-subsystems"` unit next to the `scheduleSweep` block at lines 760-815; pass the handler deps into `buildRoutedHandlers`)
- Test: `lib/daemon/__tests__/git-status-handlers.test.ts`

**Interfaces:**
- Consumes: `GitBadgesStore` (Task 2), `GitStatusSweep`, `GitStatusConfig` (Task 3), `Commands` from rt-client (Task 1), `CommandResult` from `lib/daemon/handlers/types.ts`, `getSetting` (imported the way `lib/daemon/doppler-sync.ts` imports it), `getStateDb("daemon")`, `scheduleSweep` from `lib/daemon/safe-timers.ts`, the daemon's `emit` helper (lib/daemon.ts:437-442).
- Produces: `export function createGitStatusHandlers(deps: { store: GitBadgesStore; sweep: GitStatusSweep }): ...` returning a map with the single key `"repos:status"`. The real settings reader is a module-scope const in `lib/daemon.ts` (Step 5), not an export.

- [ ] **Step 1: Write the failing handler test**

`lib/daemon/__tests__/git-status-handlers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createGitStatusHandlers } from "../handlers/git-status.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";

const badge: GitWorktreeBadge = {
  worktree: "/w", branch: "main", detached: false,
  staged: 1, unstaged: 0, untracked: 0, conflicted: 0, clean: false,
  ahead: 0, behind: 2, upstream: "origin/main",
  lastFetchedAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:01:00.000Z",
};

function fakes(overrides: { refreshCalls?: string[] } = {}) {
  const refreshCalls = overrides.refreshCalls ?? [];
  return {
    refreshCalls,
    store: { readAll: () => new Map([["repoB", [badge]], ["repoA", [badge]]]) } as any,
    sweep: {
      sweepNow: async () => { refreshCalls.push("sweep"); return { changed: [] }; },
      lastSweepAt: () => "2026-09-17T00:01:00.000Z",
      errors: () => new Map([["repoC", "git worktree list failed"]]),
      tick: async () => {},
    } as any,
  };
}

describe("repos:status handler", () => {
  test("returns rows sorted by repo, unions error-only repos, includes sweptAt", async () => {
    const f = fakes();
    const handlers = createGitStatusHandlers({ store: f.store, sweep: f.sweep });
    const res = await handlers["repos:status"]({});
    expect(res.ok).toBe(true);
    const data = (res as any).data;
    expect(data.repos.map((r: any) => r.repo)).toEqual(["repoA", "repoB", "repoC"]);
    expect(data.repos[2]).toEqual({ repo: "repoC", worktrees: [], error: "git worktree list failed" });
    expect(data.repos[0].error).toBeNull();
    expect(data.sweptAt).toBe("2026-09-17T00:01:00.000Z");
    expect(f.refreshCalls).toEqual([]);
  });

  test("refresh: true runs a sweep before reading", async () => {
    const f = fakes();
    const handlers = createGitStatusHandlers({ store: f.store, sweep: f.sweep });
    await handlers["repos:status"]({ refresh: true });
    expect(f.refreshCalls).toEqual(["sweep"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/git-status-handlers.test.ts`
Expected: FAIL, cannot resolve `../handlers/git-status.ts`.

- [ ] **Step 3: Implement the handler**

`lib/daemon/handlers/git-status.ts` (shape and typing per `lib/daemon/handlers/reconciler.ts`):

```ts
import type { Commands, RepoStatusRow } from "../../../packages/rt-client/src/commands.ts";
import type { CommandResult } from "./types.ts";
import type { GitBadgesStore } from "../git-badges-store.ts";
import type { GitStatusSweep } from "../git-status-sweep.ts";

export function createGitStatusHandlers(
  deps: { store: GitBadgesStore; sweep: GitStatusSweep },
): { "repos:status": (payload: unknown) => Promise<CommandResult<"repos:status">> } {
  return {
    "repos:status": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["repos:status"]["payload"] | undefined;
      if (payload?.refresh) await deps.sweep.sweepNow();
      const badges = deps.store.readAll();
      const errors = deps.sweep.errors();
      const names = new Set([...badges.keys(), ...errors.keys()]);
      const repos: RepoStatusRow[] = [...names]
        .sort((a, b) => a.localeCompare(b))
        .map((repo) => ({
          repo,
          worktrees: badges.get(repo) ?? [],
          error: errors.get(repo) ?? null,
        }));
      return { ok: true as const, data: { repos, sweptAt: deps.sweep.lastSweepAt() } };
    },
  };
}
```

- [ ] **Step 4: Run the handler test**

Run: `bun test lib/daemon/__tests__/git-status-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the daemon**

- Real settings reader (put beside `createGitStatusSweep`'s deps consumer in daemon.ts, following the `logRetentionDays` try/catch idiom at lib/daemon.ts:521-529 and doppler-sync's repo-scoped read):

```ts
const gitStatusConfig = (repoIdentity: string | null): GitStatusConfig => {
  try {
    const v = getSetting<Record<string, unknown>>(
      "rt.gitStatus",
      repoIdentity ? { repoIdentity } : undefined,
    ).value ?? {};
    const interval = Number((v as any).sweepIntervalSec);
    return {
      sweep: (v as any).sweep !== false,
      sweepIntervalSec: Number.isFinite(interval) && interval > 0 ? interval : 300,
    };
  } catch {
    return { sweep: true, sweepIntervalSec: 300 };
  }
};
```

- Construction (near the other store constructions, after the state db and events bus exist, before `buildRoutedHandlers`):

```ts
const gitBadges = createGitBadges(getStateDb("daemon"));
const gitStatusSweep = createGitStatusSweep({
  repoIndex: () => loadRepoIndex(),
  store: gitBadges,
  log,
  emit,
  readConfig: gitStatusConfig,
});
```

Use the exact repo-index accessor the daemon already holds for `ctx.repoIndex` (grep `repoIndex:` in lib/daemon.ts and pass the same function; do not invent a second loader).

- Sweep registration in the `"background-subsystems"` unit, after the `state-backup` block:

```ts
// Cadence lives in rt.gitStatus (read fresh each tick inside the sweep), so the
// timer interval here is only the polling floor, not the sweep rate.
sweepHandles.push(scheduleSweep(
  "git-status-sweep",
  async () => { await gitStatusSweep.tick(); },
  { bootDelayMs: 45_000, intervalMs: 60_000 },
  log,
));
```

- Router: in `lib/daemon/command-router.ts`, add to the spread list:

```ts
...createGitStatusHandlers({ store: opts.gitBadges, sweep: opts.gitStatusSweep }),
```

and thread `gitBadges` + `gitStatusSweep` through `buildRoutedHandlers`' opts the same way `eventsBus` and the other subsystems arrive.

- [ ] **Step 6: Run the daemon suites and typecheck**

Run: `bun test lib/daemon`
Expected: PASS (router construction tests and rt-client-commands agreement test now see `repos:status`; if `unknown-command` or router tests enumerate handlers, they pick the new one up automatically).
Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/handlers/git-status.ts lib/daemon/command-router.ts lib/daemon.ts lib/daemon/__tests__/git-status-handlers.test.ts
git commit -m "daemon: repos:status handler and git-status-sweep registration"
```

---

### Task 5: `rt repos status` CLI verb

**Files:**
- Modify: `commands/repos.ts` (new exported fn)
- Modify: `lib/command-tree-def.ts` (`repos` node, lines ~1821-1858: add `status` leaf)
- Test: `lib/__tests__/repos-status.test.ts`

**Interfaces:**
- Consumes: `daemonQuery` from `lib/daemon-client.ts` (`(cmd, payload?, timeoutMs?) => Promise<DaemonResponse | null>`; null = daemon unavailable after auto-restart attempt); `RepoStatusRow`/`GitWorktreeBadge` types (Task 1); `repoLabelQualified` from `lib/repo-label.ts`.
- Produces: `export async function reposStatus(args: string[], deps?: { query?: typeof daemonQuery }): Promise<void>` printing, with `--json`, exactly `JSON.stringify({ ok: true, repos, sweptAt })`.

**Ruling recorded here:** `commands/repos.ts`'s other verbs use the setup-contract envelope (exit 2). `reposStatus` deliberately uses the plain daemon-RPC convention (`rt mr map` precedent, commands/mr.ts:19-23): it is a daemon-cache read, and the mission-control TUI consumes the `{ ok, repos, sweptAt }` shape. Do not "fix" the inconsistency in either direction.

- [ ] **Step 1: Write the failing test**

`lib/__tests__/repos-status.test.ts` (unit test through the deps seam; capture stdout the way existing command tests in `lib/__tests__` do, or assert via a captured `console.log` spy):

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { reposStatus } from "../../commands/repos.ts";

const logs: string[] = [];
const origLog = console.log;
const origErr = console.error;
const origExit = process.exit;

function capture() {
  logs.length = 0;
  console.log = (line: string) => { logs.push(String(line)); };
  console.error = (line: string) => { logs.push(`ERR:${String(line)}`); };
  (process as any).exit = (code: number) => { throw new Error(`exit ${code}`); };
}

afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  (process as any).exit = origExit;
});

const row = {
  repo: "remote:github.com%2Fm4ttstack%2Frt",
  worktrees: [{
    worktree: "/Users/x/rt", branch: "main", detached: false,
    staged: 0, unstaged: 3, untracked: 1, conflicted: 0, clean: false,
    ahead: 1, behind: 0, upstream: "origin/main",
    lastFetchedAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:01:00.000Z",
  }],
  error: null,
};

describe("rt repos status", () => {
  test("--json prints the daemon data verbatim in the plain envelope", async () => {
    capture();
    await reposStatus(["--json"], {
      query: async () => ({ ok: true, data: { repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" } }) as any,
    });
    expect(JSON.parse(logs[0]!)).toEqual({ ok: true, repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" });
  });

  test("--refresh forwards refresh: true", async () => {
    capture();
    let sent: any = null;
    await reposStatus(["--json", "--refresh"], {
      query: async (_cmd, payload) => { sent = payload; return { ok: true, data: { repos: [], sweptAt: null } } as any; },
    });
    expect(sent).toEqual({ refresh: true });
  });

  test("daemon down fails with the plain JSON error and exit 1", async () => {
    capture();
    await expect(reposStatus(["--json"], { query: async () => null })).rejects.toThrow("exit 1");
    expect(JSON.parse(logs[0]!)).toEqual({
      ok: false,
      error: "daemon unavailable, the rt daemon must be running for repo status",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/__tests__/repos-status.test.ts`
Expected: FAIL, `reposStatus` is not exported.

- [ ] **Step 3: Implement**

In `commands/repos.ts` add (imports at top, function at the end; keep the file's existing verbs untouched):

```ts
import { daemonQuery } from "../lib/daemon-client.ts";
import { repoLabelQualified } from "../lib/repo-label.ts";
import type { RepoStatusRow } from "../packages/rt-client/src/commands.ts";

function failPlain(json: boolean, verb: string, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt ${verb}: ${message}`);
  process.exit(1);
}

export async function reposStatus(
  args: string[],
  deps: { query?: typeof daemonQuery } = {},
): Promise<void> {
  const json = args.includes("--json");
  const refresh = args.includes("--refresh");
  const query = deps.query ?? daemonQuery;
  const res = await query("repos:status", refresh ? { refresh: true } : {});
  if (res === null) failPlain(json, "repos status", "daemon unavailable, the rt daemon must be running for repo status");
  if (!res.ok) failPlain(json, "repos status", res.error ?? "repos:status failed");
  const data = res.data as { repos: RepoStatusRow[]; sweptAt: string | null };
  if (json) {
    console.log(JSON.stringify({ ok: true, repos: data.repos, sweptAt: data.sweptAt }));
    return;
  }
  if (data.repos.length === 0) {
    console.log("no repo badges yet (the sweep runs shortly after daemon boot; try --refresh)");
    return;
  }
  for (const row of data.repos) {
    console.log(repoLabelQualified(row.repo));
    if (row.error) console.log(`  sweep error: ${row.error}`);
    for (const w of row.worktrees) {
      const dirt = w.clean
        ? "clean"
        : [
            w.staged ? `${w.staged} staged` : "",
            w.unstaged ? `${w.unstaged} unstaged` : "",
            w.untracked ? `${w.untracked} untracked` : "",
            w.conflicted ? `${w.conflicted} conflicted` : "",
          ].filter(Boolean).join(", ");
      const pos = [
        w.ahead ? `ahead ${w.ahead}` : "",
        w.behind ? `behind ${w.behind}` : "",
      ].filter(Boolean).join(", ");
      console.log(`  ${w.branch ?? "(detached)"}  ${dirt}${pos ? `  [${pos}]` : ""}  ${w.worktree}`);
    }
  }
}
```

- [ ] **Step 4: Add the tree leaf**

In `lib/command-tree-def.ts`, inside `repos.subcommands`, after `locate`:

```ts
status: {
  description: "All registered repos with git badges from the daemon sweep",
  module: "./commands/repos.ts",
  fn: "reposStatus",
  args: [
    { name: "Refresh", flag: "--refresh", type: "boolean", default: false, hint: "Run a sweep now instead of reading the cache" },
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable rows (the mission-control rail feed)" },
  ],
},
```

No positional, so no `omitBehavior`. `commands/repos.ts` is already in the module registry; no registry change.

- [ ] **Step 5: Run tests**

Run: `bun test lib/__tests__/repos-status.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/repos.ts lib/command-tree-def.ts lib/__tests__/repos-status.test.ts
git commit -m "repos status: rail feed verb over the daemon badge cache"
```

---

### Task 6: `amendStaged` in commit-ops

**Files:**
- Modify: `lib/commit-ops.ts` (after `commitStaged`, lines ~157-172)
- Test: `lib/__tests__/commit-ops.test.ts` (append a describe block; the file already builds throwaway repos for `commitStaged`, reuse its helpers)

**Interfaces:**
- Consumes: the module-private `git(cwd, args)` helper already in `lib/commit-ops.ts`.
- Produces: `export function amendStaged(cwd: string, opts: { message?: string; noVerify?: boolean } = {}): string` returning git's summary line.

- [ ] **Step 1: Write the failing tests**

Append to `lib/__tests__/commit-ops.test.ts` (match the file's existing temp-repo helper; if it builds repos with a local helper like `makeRepo()`, use that same helper):

```ts
describe("amendStaged", () => {
  test("amend without a message keeps the original message", () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, "a.txt"), "one\n");
    execFileSync("git", ["add", "."], { cwd });
    commitStaged(cwd, "original message");
    writeFileSync(join(cwd, "a.txt"), "two\n");
    execFileSync("git", ["add", "."], { cwd });
    amendStaged(cwd);
    const msg = execFileSync("git", ["log", "-1", "--format=%s"], { cwd, encoding: "utf8" }).trim();
    expect(msg).toBe("original message");
    const count = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd, encoding: "utf8" }).trim();
    expect(count).toBe("1");
  });

  test("amend with a message replaces it", () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, "a.txt"), "one\n");
    execFileSync("git", ["add", "."], { cwd });
    commitStaged(cwd, "original message");
    amendStaged(cwd, { message: "rewritten" });
    const msg = execFileSync("git", ["log", "-1", "--format=%s"], { cwd, encoding: "utf8" }).trim();
    expect(msg).toBe("rewritten");
  });
});
```

(Adjust the repo-construction lines to the file's existing helper names; the assertions stay exactly as written.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/__tests__/commit-ops.test.ts`
Expected: FAIL, `amendStaged` not exported.

- [ ] **Step 3: Implement**

After `commitStaged` in `lib/commit-ops.ts`:

```ts
/**
 * Amend the last commit with whatever is staged. No message keeps the
 * existing one (--no-edit); a message replaces it via argv, never a shell.
 */
export function amendStaged(
  cwd: string,
  opts: { message?: string; noVerify?: boolean } = {},
): string {
  const args = ["commit", "--amend"];
  if (opts.message) args.push("-m", opts.message);
  else args.push("--no-edit");
  if (opts.noVerify) args.push("--no-verify");
  const out = git(cwd, args);
  return out.split("\n")[0] ?? "";
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test lib/__tests__/commit-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/commit-ops.ts lib/__tests__/commit-ops.test.ts
git commit -m "commit-ops: amendStaged with optional message"
```

---

### Task 7: `rt git status|log|branches` read verbs

**Files:**
- Create: `commands/git/inspect.ts`
- Modify: `lib/command-tree-def.ts` (new leaves in `git.subcommands`)
- Modify: `lib/module-registry.ts` (thunk for `./commands/git/inspect.ts`)
- Test: `e2e/tests/git-verbs.test.ts` (new file; this task adds the status/log/branches cases)

**Interfaces:**
- Consumes: `createGitClient` from `packages/git-core/src/index.ts`; `flagValue` from `lib/cli-args.ts` (same import commands/mr.ts uses).
- Produces: `statusCommand`, `logCommand`, `branchesCommand` exported from `commands/git/inspect.ts`; the module-level `failPlain(json, verb, message)` and `repoClient()` helpers that Task 8 extends with `diffCommand`.

**JSON shapes (pinned by e2e, exact):**
- `rt git status --json`: `{ ok: true, branch, detached, upstream, ahead, behind, clean, files }` (the RepoSnapshot fields spread).
- `rt git log --json`: `{ ok: true, entries }` where entries is `LogEntry[]` (default `maxCount` 20; `--max <n>`; `--file <path>`).
- `rt git branches --json`: `{ ok: true, branches }` where branches is `BranchInfo[]`.

- [ ] **Step 1: Write the failing e2e test**

`e2e/tests/git-verbs.test.ts`. Follow the harness idioms (e2e/harness.ts: `createTestHome`, `rt(args, opts)`), building a scratch repo inside the test home with explicit `-c user.email/-c user.name` on every commit (the isolated HOME has no gitconfig):

```ts
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createTestHome, rt } from "../harness.ts";

let home: { path: string; cleanup: () => void };
let repo: string;

const IDENT = ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false"];

function g(args: string[]): string {
  return execFileSync("git", [...IDENT, ...args], { cwd: repo, encoding: "utf8" });
}

beforeAll(() => {
  home = createTestHome();
  repo = join(home.path, "scratch-repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
  writeFileSync(join(repo, "a.txt"), "one\n");
  g(["add", "."]);
  g(["commit", "-m", "first commit"]);
  writeFileSync(join(repo, "a.txt"), "two\n");
  writeFileSync(join(repo, "new.txt"), "hello\n");
});

afterAll(() => home.cleanup());

async function rtJson(args: string[]): Promise<any> {
  const res = await rt(args, { cwd: repo, env: { HOME: home.path } });
  expect(res.exitCode).toBe(0);
  return JSON.parse(res.stdout);
}

describe("rt git read verbs", () => {
  test("status --json carries the snapshot", async () => {
    const out = await rtJson(["git", "status", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.branch).toBe("main");
    expect(out.detached).toBe(false);
    expect(out.clean).toBe(false);
    expect(out.files).toEqual([
      { path: "a.txt", kind: "modified", staged: false, unstaged: true },
      { path: "new.txt", kind: "untracked", staged: false, unstaged: true },
    ]);
  });

  test("log --json lists entries newest first", async () => {
    const out = await rtJson(["git", "log", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.entries.length).toBe(1);
    expect(out.entries[0].subject).toBe("first commit");
    expect(out.entries[0].parents).toEqual([]);
  });

  test("branches --json lists main as current", async () => {
    const out = await rtJson(["git", "branches", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.branches.length).toBe(1);
    expect(out.branches[0].name).toBe("main");
    expect(out.branches[0].current).toBe(true);
    expect(out.branches[0].upstream).toBeNull();
  });
});
```

Check `rt()`'s actual option names in e2e/harness.ts before running (`cwd` vs another key); adjust the call, not the assertions. If ChangedFile serializes `originalPath` as absent (it does; optional field), the `files` deep-equal above is correct as written.

- [ ] **Step 2: Run to verify failure**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: FAIL (unknown command `git status` usage output, non-zero exit).

- [ ] **Step 3: Implement the module**

`commands/git/inspect.ts`:

```ts
import { createGitClient } from "../../packages/git-core/src/index.ts";
import { flagValue } from "../../lib/cli-args.ts";

export function failPlain(json: boolean, verb: string, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt ${verb}: ${message}`);
  process.exit(1);
}

export function repoClient() {
  return createGitClient(process.cwd());
}

export async function statusCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const snap = await repoClient().snapshot();
    if (json) {
      console.log(JSON.stringify({ ok: true, ...snap }));
      return;
    }
    const head = snap.detached ? "(detached)" : snap.branch ?? "(unborn)";
    const pos = [
      snap.ahead ? `ahead ${snap.ahead}` : "",
      snap.behind ? `behind ${snap.behind}` : "",
    ].filter(Boolean).join(", ");
    console.log(`${head}${snap.upstream ? ` -> ${snap.upstream}` : ""}${pos ? `  [${pos}]` : ""}`);
    if (snap.clean) {
      console.log("clean");
      return;
    }
    for (const f of snap.files) {
      const marks = `${f.staged ? "S" : " "}${f.unstaged ? "W" : " "}`;
      console.log(`  ${marks} ${f.kind.padEnd(10)} ${f.path}${f.originalPath ? ` (from ${f.originalPath})` : ""}`);
    }
  } catch (err) {
    failPlain(json, "git status", err instanceof Error ? err.message : String(err));
  }
}

export async function logCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const max = Number(flagValue(args, "--max") ?? 20);
  const file = flagValue(args, "--file") ?? undefined;
  try {
    const entries = await repoClient().log({
      maxCount: Number.isFinite(max) && max > 0 ? max : 20,
      ...(file ? { file } : {}),
    });
    if (json) {
      console.log(JSON.stringify({ ok: true, entries }));
      return;
    }
    for (const e of entries) {
      console.log(`${e.sha.slice(0, 8)}  ${e.authorDate.slice(0, 10)}  ${e.subject}`);
    }
  } catch (err) {
    failPlain(json, "git log", err instanceof Error ? err.message : String(err));
  }
}

export async function branchesCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const branches = await repoClient().branches();
    if (json) {
      console.log(JSON.stringify({ ok: true, branches }));
      return;
    }
    for (const b of branches) {
      const pos = [
        b.ahead ? `ahead ${b.ahead}` : "",
        b.behind ? `behind ${b.behind}` : "",
        b.upstreamGone ? "upstream gone" : "",
      ].filter(Boolean).join(", ");
      console.log(`${b.current ? "*" : " "} ${b.name}${b.upstream ? ` -> ${b.upstream}` : ""}${pos ? `  [${pos}]` : ""}`);
    }
  } catch (err) {
    failPlain(json, "git branches", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Register tree leaves and module**

In `lib/command-tree-def.ts`, inside `git.subcommands` (after `upstream`), add:

```ts
status: {
  description: "Working tree status: branch, ahead/behind, changed files",
  module: "./commands/git/inspect.ts",
  fn: "statusCommand",
  context: "worktree",
  args: [
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable snapshot" },
  ],
},
log: {
  description: "Recent commits on the current branch",
  module: "./commands/git/inspect.ts",
  fn: "logCommand",
  context: "worktree",
  args: [
    { name: "Max", flag: "--max", type: "text", placeholder: "20", hint: "How many commits to list" },
    { name: "File", flag: "--file", type: "text", placeholder: "src/app.ts", hint: "Only commits touching this path" },
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable entries" },
  ],
},
branches: {
  description: "Local branches with upstream and ahead/behind state",
  module: "./commands/git/inspect.ts",
  fn: "branchesCommand",
  context: "worktree",
  args: [
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable branch list" },
  ],
},
```

Update the `git` node's `description` to `"Git operations (status, diff, log, rebase, commit, stash, tags)"`.

In `lib/module-registry.ts`, next to the other `./commands/git/*` thunks:

```ts
"./commands/git/inspect.ts": () => import("../commands/git/inspect.ts"),
```

- [ ] **Step 5: Run the e2e file and the gates**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: PASS (setup.ts recompiles the rt binary first; the first run is slow).
Run: `bun test lib/__tests__/no-eager-tui.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/git/inspect.ts lib/command-tree-def.ts lib/module-registry.ts e2e/tests/git-verbs.test.ts
git commit -m "rt git status/log/branches read verbs over git-core"
```

---

### Task 8: `rt git diff` with changed-file picker

**Files:**
- Modify: `commands/git/inspect.ts` (add `diffCommand`)
- Modify: `lib/command-tree-def.ts` (add `diff` leaf)
- Test: extend `e2e/tests/git-verbs.test.ts`

**Interfaces:**
- Consumes: `repoClient`/`failPlain` (Task 7); `GitClient.diffFile(path, opts?: { staged?: boolean; untracked?: boolean })` returning `FileDiff { path, kind: "text"|"binary"|"submodule", hunks }`; `filterableSelect` from `lib/pick-wrappers.ts` (`(opts: { message; options: SelectOption[] }, extras?) => Promise<string | null>`; `SelectOption = { label, value, hint? }` per its callers).
- Produces: `rt git diff <path> [--staged] [--json]`; JSON shape `{ ok: true, diff: FileDiff }`.

**Behavior contract:** the positional is required. When omitted: with a TTY and no `--json`/`RT_BATCH`, show a `filterableSelect` over `snapshot().files` (label = path, hint = kind; untracked files pass `untracked: true` to `diffFile`); cancel exits 0 silently. Otherwise print `usage: rt git diff <path> [--staged] [--json]` through `failPlain` (exit 1, JSON error under `--json`). An empty changed-file set falls through to the same usage error, never an empty picker.

- [ ] **Step 1: Extend the e2e test (failing)**

Append to `e2e/tests/git-verbs.test.ts`:

```ts
describe("rt git diff", () => {
  test("diff --json returns hunks for a modified file", async () => {
    const out = await rtJson(["git", "diff", "a.txt", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.diff.path).toBe("a.txt");
    expect(out.diff.kind).toBe("text");
    expect(out.diff.hunks.length).toBe(1);
    const lines = out.diff.hunks[0].lines.map((l: any) => [l.type, l.content]);
    expect(lines).toEqual([["del", "one"], ["add", "two"]]);
  });

  test("omitted path in non-TTY json mode is a usage error", async () => {
    const res = await rt(["git", "diff", "--json"], { cwd: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: "usage: rt git diff <path> [--staged] [--json]",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: the two new cases FAIL (unknown subcommand `diff`).

- [ ] **Step 3: Implement `diffCommand`**

Add to `commands/git/inspect.ts`:

```ts
const DIFF_USAGE = "usage: rt git diff <path> [--staged] [--json]";

function positional(args: string[]): string | undefined {
  const flagsWithValue = new Set(["--max", "--file"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flagsWithValue.has(a)) { i++; continue; }
    if (!a.startsWith("-")) return a;
  }
  return undefined;
}

export async function diffCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const staged = args.includes("--staged");
  const client = repoClient();
  let path = positional(args);
  let untracked = false;
  try {
    if (!path && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const files = (await client.snapshot()).files;
      if (files.length === 0) failPlain(json, "git diff", DIFF_USAGE);
      const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Diff which file?",
        options: files.map((f) => ({ label: f.path, value: f.path, hint: f.kind })),
      });
      if (picked === null) process.exit(0);
      path = picked;
      untracked = files.find((f) => f.path === picked)?.kind === "untracked";
    }
    if (!path) failPlain(json, "git diff", DIFF_USAGE);
    const diff = await client.diffFile(path, { staged, ...(untracked ? { untracked: true } : {}) });
    if (json) {
      console.log(JSON.stringify({ ok: true, diff }));
      return;
    }
    if (diff.kind !== "text") {
      console.log(`${diff.path}: ${diff.kind} (no line diff)`);
      return;
    }
    for (const hunk of diff.hunks) {
      console.log(hunk.header);
      for (const line of hunk.lines) {
        const mark = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
        console.log(`${mark}${line.content}`);
      }
    }
  } catch (err) {
    failPlain(json, "git diff", err instanceof Error ? err.message : String(err));
  }
}
```

The `failPlain` call for the usage message must print exactly `usage: rt git diff <path> [--staged] [--json]` as the error string (the e2e pins it). Note `failPlain` prefixes `rt git diff:` only on the non-JSON path, which is fine; the JSON error carries the bare usage string.

- [ ] **Step 4: Add the leaf**

In `git.subcommands`, after `status`:

```ts
diff: {
  description: "One file's diff (hunks and lines) from git-core",
  module: "./commands/git/inspect.ts",
  fn: "diffCommand",
  omitBehavior: "picker",
  context: "worktree",
  args: [
    { name: "Path", type: "text", placeholder: "src/app.ts", hint: "File to diff (picker over changed files when omitted)" },
    { name: "Staged", flag: "--staged", type: "boolean", default: false, hint: "Diff the index against HEAD instead of the working tree" },
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable hunks" },
  ],
},
```

- [ ] **Step 5: Run e2e + conformance**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: PASS.
Run: `bun run picker:check`
Expected: no violations.

- [ ] **Step 6: Commit**

```bash
git add commands/git/inspect.ts lib/command-tree-def.ts e2e/tests/git-verbs.test.ts
git commit -m "rt git diff with changed-file picker"
```

---

### Task 9: `rt git amend` and `rt git undo` with the branch guard

**Files:**
- Create: `commands/git/mutate.ts`
- Modify: `lib/command-tree-def.ts` (add `amend`, `undo` leaves)
- Modify: `lib/module-registry.ts` (thunk for `./commands/git/mutate.ts`)
- Test: extend `e2e/tests/git-verbs.test.ts`

**Interfaces:**
- Consumes: `amendStaged` (Task 6); `undoLastCommit(): Promise<UndoResult>` (`{ ok: true; undoneSha } | { ok: false; reason: "pushed" | "initial" | "merge" }`) via `createGitClient`; `checkBranchGuard` from `lib/branch-guard.ts` (`opts: { cwd; branch; defaultBranch; runners; listWorktrees? }` returning `{ verdict: "clear" } | { verdict: "refuse"; reason; detail } | { verdict: "unverified"; detail }`); `createStackGuardRunners` from `lib/stack-guard.ts` + `createRealProbes` from `lib/setup/probes.ts` (composition per commands/sync.ts:193); `getRemoteDefaultBranch` from `lib/git-ops.ts` (returns e.g. `"origin/main"` or null; strip the `origin/` prefix per commands/sync.ts:151-152).
- Produces: `amendCommand`, `undoCommand`, plus the module-level `guardHistoryRewrite(cwd, json, verb)` helper Tasks 10-11's file section reuses (stash/tag do NOT call it; it exists in this module for the two history-rewriting verbs).

**Behavior contract:**
- Both verbs run `guardHistoryRewrite` first: `refuse` fails with `refused: <detail>` (exit 1, JSON `{ ok: false, error }`); `unverified` prints a one-line stderr warning and proceeds; `clear` proceeds silently.
- `rt git amend [message] [--no-verify] [--json]`: message is all non-flag args joined with spaces; empty means keep-message (`--no-edit`). Success JSON: `{ ok: true, summary }`.
- `rt git undo [--json]`: success JSON `{ ok: true, undoneSha }`; a typed refusal fails with `refused: <reason>`; an unborn-repo throw surfaces git's own message (chunk 2 known limit).

- [ ] **Step 1: Extend the e2e test (failing)**

Append to `e2e/tests/git-verbs.test.ts` (the scratch repo has no remote, so `defaultBranch` is null and the stack guard's no-forge path yields `unverified` or `clear`; both proceed, which is what these cases assert. The `refuse` path is unit-covered by `lib/__tests__/branch-guard.test.ts` already):

```ts
describe("rt git amend and undo", () => {
  test("amend --json amends staged content and keeps the message", async () => {
    writeFileSync(join(repo, "amended.txt"), "x\n");
    g(["add", "amended.txt"]);
    const before = g(["rev-list", "--count", "HEAD"]).trim();
    const out = await rtJson(["git", "amend", "--json"]);
    expect(out.ok).toBe(true);
    expect(typeof out.summary).toBe("string");
    expect(g(["rev-list", "--count", "HEAD"]).trim()).toBe(before);
    expect(g(["log", "-1", "--format=%s"]).trim()).toBe("first commit");
  });

  test("undo --json on a single-commit repo refuses with initial", async () => {
    const res = await rt(["git", "undo", "--json"], { cwd: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: "refused: initial" });
  });

  test("undo --json removes the last commit and keeps its changes", async () => {
    writeFileSync(join(repo, "second.txt"), "y\n");
    g(["add", "second.txt"]);
    g(["commit", "-m", "second commit"]);
    const sha = g(["rev-parse", "HEAD"]).trim();
    const out = await rtJson(["git", "undo", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.undoneSha).toBe(sha);
    expect(g(["rev-list", "--count", "HEAD"]).trim()).toBe("1");
    expect(g(["status", "--porcelain"])).toContain("second.txt");
  });
});
```

(Ordering matters: this describe block runs after the diff block; `a.txt`'s unstaged edit from beforeAll is still present and rides along in the amend, which is fine because the amend case only asserts count and message.) Wait: `amendStaged` amends only what is staged; the unstaged `a.txt` edit stays unstaged. The assertions hold either way.

- [ ] **Step 2: Run to verify failure**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: new cases FAIL (unknown subcommand `amend`).

- [ ] **Step 3: Implement**

`commands/git/mutate.ts`:

```ts
import { createGitClient } from "../../packages/git-core/src/index.ts";
import { amendStaged } from "../../lib/commit-ops.ts";
import { checkBranchGuard } from "../../lib/branch-guard.ts";
import { createStackGuardRunners } from "../../lib/stack-guard.ts";
import { getRemoteDefaultBranch } from "../../lib/git-ops.ts";
import { execFileSync } from "node:child_process";

export function failPlain(json: boolean, verb: string, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt ${verb}: ${message}`);
  process.exit(1);
}

function currentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

async function guardHistoryRewrite(cwd: string, json: boolean, verb: string): Promise<void> {
  const branch = currentBranch(cwd);
  const remoteDefault = getRemoteDefaultBranch(cwd);
  const defaultBranch = remoteDefault ? remoteDefault.replace("origin/", "") : null;
  const runners = createStackGuardRunners(
    (await import("../../lib/setup/probes.ts")).createRealProbes(),
  );
  const verdict = await checkBranchGuard({ cwd, branch, defaultBranch, runners });
  if (verdict.verdict === "refuse") failPlain(json, verb, `refused: ${verdict.detail}`);
  if (verdict.verdict === "unverified") {
    console.error(`rt ${verb}: warning, could not verify branch ownership (${verdict.detail})`);
  }
}

export async function amendCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const noVerify = args.includes("--no-verify");
  const message = args.filter((a) => !a.startsWith("-")).join(" ") || undefined;
  const cwd = process.cwd();
  try {
    await guardHistoryRewrite(cwd, json, "git amend");
    const summary = amendStaged(cwd, { ...(message ? { message } : {}), noVerify });
    if (json) console.log(JSON.stringify({ ok: true, summary }));
    else console.log(summary);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("exit")) throw err;
    failPlain(json, "git amend", err instanceof Error ? err.message : String(err));
  }
}

export async function undoCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const cwd = process.cwd();
  try {
    await guardHistoryRewrite(cwd, json, "git undo");
    const result = await createGitClient(cwd).undoLastCommit();
    if (!result.ok) failPlain(json, "git undo", `refused: ${result.reason}`);
    if (json) console.log(JSON.stringify({ ok: true, undoneSha: result.undoneSha }));
    else console.log(`undid ${result.undoneSha.slice(0, 8)}; its changes are back in the working tree`);
  } catch (err) {
    failPlain(json, "git undo", err instanceof Error ? err.message : String(err));
  }
}
```

Careful with the catch-around-failPlain interaction: `failPlain` exits the process, so in production the catch never sees it; under tests that stub `process.exit` to throw, re-throwing is correct. Keep the structure above (guard first, one try/catch around the git work).

- [ ] **Step 4: Register leaves and module**

`git.subcommands` additions:

```ts
amend: {
  description: "Amend the last commit with what is staged (message optional)",
  module: "./commands/git/mutate.ts",
  fn: "amendCommand",
  context: "worktree",
  args: [
    { name: "Message", type: "text", optional: true, placeholder: "fix: adjust copy", hint: "New commit message; omitted keeps the current one" },
    { name: "No verify", flag: "--no-verify", type: "boolean", default: false, hint: "Skip commit hooks" },
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
  ],
},
undo: {
  description: "Undo the last commit, keeping its changes in the working tree",
  module: "./commands/git/mutate.ts",
  fn: "undoCommand",
  context: "worktree",
  args: [
    { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
  ],
},
```

`lib/module-registry.ts`:

```ts
"./commands/git/mutate.ts": () => import("../commands/git/mutate.ts"),
```

- [ ] **Step 5: Run e2e**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/git/mutate.ts lib/command-tree-def.ts lib/module-registry.ts e2e/tests/git-verbs.test.ts
git commit -m "rt git amend/undo with branch guard"
```

---

### Task 10: `rt git stash` verbs

**Files:**
- Modify: `commands/git/mutate.ts` (stash verbs)
- Modify: `lib/command-tree-def.ts` (`stash` branch node)
- Test: extend `e2e/tests/git-verbs.test.ts`

**Interfaces:**
- Consumes: git-core `stashes(): Promise<StashEntry[]>` (`{ index, branch, message }`), `stashPush(opts?: { message?; includeUntracked? }): Promise<{ created: boolean }>`, `stashApply(index)`, `stashPop(index)`, `stashDrop(index)`; `filterableSelect` (Task 8 pattern); `failPlain` (same module).
- Produces: `stashPushCommand`, `stashListCommand`, `stashPopCommand`, `stashApplyCommand`, `stashDropCommand`.

**Behavior contract:**
- `rt git stash push [--message <m>] [--include-untracked] [--json]`: JSON `{ ok: true, created }`; `created: false` (nothing to stash) is still exit 0.
- `rt git stash list [--json]`: JSON `{ ok: true, stashes }`.
- `pop [index]` / `apply [index]`: optional positional, defaults to `0`; a non-integer positional is a usage error (exit 1). JSON `{ ok: true, index }`.
- `drop <index>`: required positional, `omitBehavior: "picker"`; TTY-gated picker over `stashes()` (label `stash@{N}: <message>`, value the index); empty set falls through to `usage: rt git stash drop <index> [--json]`. JSON `{ ok: true, index }`.
- All git errors surface through `failPlain` with git's message.

- [ ] **Step 1: Extend the e2e test (failing)**

```ts
describe("rt git stash", () => {
  test("push, list, pop round-trip", async () => {
    writeFileSync(join(repo, "a.txt"), "stashme\n");
    const pushed = await rtJson(["git", "stash", "push", "--message", "wip test", "--json"]);
    expect(pushed).toEqual({ ok: true, created: true });
    const listed = await rtJson(["git", "stash", "list", "--json"]);
    expect(listed.ok).toBe(true);
    expect(listed.stashes.length).toBe(1);
    expect(listed.stashes[0].message).toContain("wip test");
    expect(listed.stashes[0].index).toBe(0);
    const popped = await rtJson(["git", "stash", "pop", "--json"]);
    expect(popped).toEqual({ ok: true, index: 0 });
    const after = await rtJson(["git", "stash", "list", "--json"]);
    expect(after.stashes).toEqual([]);
  });

  test("drop without an index in non-TTY json mode is a usage error", async () => {
    const res = await rt(["git", "stash", "drop", "--json"], { cwd: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: "usage: rt git stash drop <index> [--json]",
    });
  });
});
```

(Repo state note: earlier tasks leave `a.txt` modified and `new.txt` untracked; the push here stashes the tracked change only, so `created: true` holds. The pop restores it, leaving the repo as the block found it.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement**

Add to `commands/git/mutate.ts` (reusing `failPlain`; `flagValue` import from `../../lib/cli-args.ts`):

```ts
export async function stashPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const message = flagValue(args, "--message") ?? undefined;
  const includeUntracked = args.includes("--include-untracked");
  try {
    const { created } = await createGitClient(process.cwd()).stashPush({
      ...(message ? { message } : {}),
      ...(includeUntracked ? { includeUntracked: true } : {}),
    });
    if (json) console.log(JSON.stringify({ ok: true, created }));
    else console.log(created ? "stashed" : "nothing to stash");
  } catch (err) {
    failPlain(json, "git stash push", err instanceof Error ? err.message : String(err));
  }
}

export async function stashListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const stashes = await createGitClient(process.cwd()).stashes();
    if (json) console.log(JSON.stringify({ ok: true, stashes }));
    else if (stashes.length === 0) console.log("no stashes");
    else for (const s of stashes) console.log(`stash@{${s.index}}  ${s.branch ?? "(detached)"}  ${s.message}`);
  } catch (err) {
    failPlain(json, "git stash list", err instanceof Error ? err.message : String(err));
  }
}

function stashIndexArg(args: string[], json: boolean, usage: string): number {
  const raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) failPlain(json, "git stash", usage);
  return n;
}

export async function stashPopCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash pop [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashPop(index);
    if (json) console.log(JSON.stringify({ ok: true, index }));
    else console.log(`popped stash@{${index}}`);
  } catch (err) {
    failPlain(json, "git stash pop", err instanceof Error ? err.message : String(err));
  }
}

export async function stashApplyCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash apply [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashApply(index);
    if (json) console.log(JSON.stringify({ ok: true, index }));
    else console.log(`applied stash@{${index}}`);
  } catch (err) {
    failPlain(json, "git stash apply", err instanceof Error ? err.message : String(err));
  }
}

const STASH_DROP_USAGE = "usage: rt git stash drop <index> [--json]";

export async function stashDropCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const client = createGitClient(process.cwd());
  let raw = args.find((a) => !a.startsWith("-"));
  try {
    if (raw === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const stashes = await client.stashes();
      if (stashes.length === 0) failPlain(json, "git stash drop", STASH_DROP_USAGE);
      const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Drop which stash?",
        options: stashes.map((s) => ({ label: `stash@{${s.index}}: ${s.message}`, value: String(s.index) })),
      });
      if (picked === null) process.exit(0);
      raw = picked;
    }
    if (raw === undefined) failPlain(json, "git stash drop", STASH_DROP_USAGE);
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0) failPlain(json, "git stash drop", STASH_DROP_USAGE);
    await client.stashDrop(index);
    if (json) console.log(JSON.stringify({ ok: true, index }));
    else console.log(`dropped stash@{${index}}`);
  } catch (err) {
    failPlain(json, "git stash drop", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Add the `stash` branch node**

In `git.subcommands`:

```ts
stash: {
  description: "Stash the working tree and manage stashes",
  subcommands: {
    push: {
      description: "Stash tracked changes (optionally untracked too)",
      module: "./commands/git/mutate.ts",
      fn: "stashPushCommand",
      context: "worktree",
      args: [
        { name: "Message", flag: "--message", type: "text", placeholder: "wip", hint: "Stash message" },
        { name: "Include untracked", flag: "--include-untracked", type: "boolean", default: false, hint: "Also stash untracked files" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
    list: {
      description: "List stashes",
      module: "./commands/git/mutate.ts",
      fn: "stashListCommand",
      context: "worktree",
      args: [
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable stashes" },
      ],
    },
    pop: {
      description: "Apply a stash and drop it (default stash@{0})",
      module: "./commands/git/mutate.ts",
      fn: "stashPopCommand",
      context: "worktree",
      args: [
        { name: "Index", type: "text", optional: true, placeholder: "0", hint: "Stash index (default 0)" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
    apply: {
      description: "Apply a stash, keeping it (default stash@{0})",
      module: "./commands/git/mutate.ts",
      fn: "stashApplyCommand",
      context: "worktree",
      args: [
        { name: "Index", type: "text", optional: true, placeholder: "0", hint: "Stash index (default 0)" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
    drop: {
      description: "Delete a stash",
      module: "./commands/git/mutate.ts",
      fn: "stashDropCommand",
      omitBehavior: "picker",
      context: "worktree",
      args: [
        { name: "Index", type: "text", placeholder: "0", hint: "Stash index (picker when omitted)" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
  },
},
```

- [ ] **Step 5: Run e2e + conformance**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: PASS.
Run: `bun run picker:check`
Expected: no violations.

- [ ] **Step 6: Commit**

```bash
git add commands/git/mutate.ts lib/command-tree-def.ts e2e/tests/git-verbs.test.ts
git commit -m "rt git stash verbs"
```

---

### Task 11: `rt git tag` verbs

**Files:**
- Modify: `commands/git/mutate.ts` (tag verbs)
- Modify: `lib/command-tree-def.ts` (`tag` branch node)
- Test: extend `e2e/tests/git-verbs.test.ts`

**Interfaces:**
- Consumes: git-core `tags(): Promise<TagInfo[]>` (`{ name, sha, annotated, targetSha }`), `createTag(name, opts?: { message?; sha? })`, `deleteTag(name)`, `pushTag(name, remote?)`.
- Produces: `tagListCommand`, `tagCreateCommand`, `tagDeleteCommand`, `tagPushCommand`.

**Behavior contract:**
- `rt git tag list [--json]`: JSON `{ ok: true, tags }`.
- `rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]`: name required, `omitBehavior: { exempt: "a new tag name is free text; nothing to enumerate" }`; `--message` makes it annotated; `--at` tags a specific commit; `--push` pushes it to `origin` after creating. JSON `{ ok: true, name, pushed }`.
- `rt git tag delete <name> [--json]`: required, `omitBehavior: "picker"` over `tags()`; usage `usage: rt git tag delete <name> [--json]`. JSON `{ ok: true, name }`. Deletes locally only.
- `rt git tag push <name> [--remote <r>] [--json]`: required, `omitBehavior: "picker"` over `tags()`; usage `usage: rt git tag push <name> [--remote <remote>] [--json]`. JSON `{ ok: true, name, remote }`.

- [ ] **Step 1: Extend the e2e test (failing)**

```ts
describe("rt git tag", () => {
  test("create, list, delete round-trip", async () => {
    const created = await rtJson(["git", "tag", "create", "v0.0.1-test", "--message", "test tag", "--json"]);
    expect(created).toEqual({ ok: true, name: "v0.0.1-test", pushed: false });
    const listed = await rtJson(["git", "tag", "list", "--json"]);
    expect(listed.ok).toBe(true);
    const tag = listed.tags.find((t: any) => t.name === "v0.0.1-test");
    expect(tag.annotated).toBe(true);
    expect(tag.targetSha).toBe(g(["rev-parse", "HEAD"]).trim());
    const deleted = await rtJson(["git", "tag", "delete", "v0.0.1-test", "--json"]);
    expect(deleted).toEqual({ ok: true, name: "v0.0.1-test" });
    const after = await rtJson(["git", "tag", "list", "--json"]);
    expect(after.tags.find((t: any) => t.name === "v0.0.1-test")).toBeUndefined();
  });

  test("create with a flag-like name is rejected by git-core's ref guard", async () => {
    const res = await rt(["git", "tag", "create", "--", "-D", "--json"], { cwd: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.ok).toBe(false);
    expect(out.error.length).toBeGreaterThan(0);
  });
});
```

(If the dispatcher does not pass `--` through to handlers, drop the second case's `"--"` token and pass `-D` directly; the assertion is only that a flag-like name fails closed with `ok: false`, which git-core's `rejectFlagLike` guarantees. Verify which tokens actually reach the handler before finalizing.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement**

Add to `commands/git/mutate.ts`:

```ts
export async function tagListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const tags = await createGitClient(process.cwd()).tags();
    if (json) console.log(JSON.stringify({ ok: true, tags }));
    else if (tags.length === 0) console.log("no tags");
    else for (const t of tags) console.log(`${t.name}  ${t.targetSha.slice(0, 8)}${t.annotated ? "  (annotated)" : ""}`);
  } catch (err) {
    failPlain(json, "git tag list", err instanceof Error ? err.message : String(err));
  }
}

const TAG_CREATE_USAGE = "usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]";

export async function tagCreateCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const message = flagValue(args, "--message") ?? undefined;
  const at = flagValue(args, "--at") ?? undefined;
  const push = args.includes("--push");
  const name = args.filter((a) => a !== "--").find((a) => !a.startsWith("-") && a !== message && a !== at);
  if (!name) failPlain(json, "git tag create", TAG_CREATE_USAGE);
  try {
    const client = createGitClient(process.cwd());
    await client.createTag(name, { ...(message ? { message } : {}), ...(at ? { sha: at } : {}) });
    if (push) await client.pushTag(name);
    if (json) console.log(JSON.stringify({ ok: true, name, pushed: push }));
    else console.log(`created tag ${name}${push ? " and pushed to origin" : ""}`);
  } catch (err) {
    failPlain(json, "git tag create", err instanceof Error ? err.message : String(err));
  }
}

async function pickTagName(json: boolean, usage: string, verb: string): Promise<string> {
  const client = createGitClient(process.cwd());
  const tags = await client.tags();
  if (tags.length === 0) failPlain(json, verb, usage);
  const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: `${verb.replace("git tag ", "").replace(/^./, (c) => c.toUpperCase())} which tag?`,
    options: tags.map((t) => ({ label: t.name, value: t.name, hint: t.targetSha.slice(0, 8) })),
  });
  if (picked === null) process.exit(0);
  return picked;
}

const TAG_DELETE_USAGE = "usage: rt git tag delete <name> [--json]";

export async function tagDeleteCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = args.find((a) => !a.startsWith("-"));
  try {
    if (!name && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      name = await pickTagName(json, TAG_DELETE_USAGE, "git tag delete");
    }
    if (!name) failPlain(json, "git tag delete", TAG_DELETE_USAGE);
    await createGitClient(process.cwd()).deleteTag(name);
    if (json) console.log(JSON.stringify({ ok: true, name }));
    else console.log(`deleted tag ${name} (local only)`);
  } catch (err) {
    failPlain(json, "git tag delete", err instanceof Error ? err.message : String(err));
  }
}

const TAG_PUSH_USAGE = "usage: rt git tag push <name> [--remote <remote>] [--json]";

export async function tagPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const remote = flagValue(args, "--remote") ?? "origin";
  let name = args.find((a) => !a.startsWith("-") && a !== remote);
  try {
    if (!name && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      name = await pickTagName(json, TAG_PUSH_USAGE, "git tag push");
    }
    if (!name) failPlain(json, "git tag push", TAG_PUSH_USAGE);
    await createGitClient(process.cwd()).pushTag(name, remote);
    if (json) console.log(JSON.stringify({ ok: true, name, remote }));
    else console.log(`pushed tag ${name} to ${remote}`);
  } catch (err) {
    failPlain(json, "git tag push", err instanceof Error ? err.message : String(err));
  }
}
```

Positional extraction with value-flags in play is fiddly; if `lib/cli-args.ts` exports a positional helper that strips value-flag pairs, use it instead of the ad hoc `find` calls above (check its exports first).

- [ ] **Step 4: Add the `tag` branch node**

```ts
tag: {
  description: "Create, list, delete, and push tags",
  subcommands: {
    list: {
      description: "List tags with their target commits",
      module: "./commands/git/mutate.ts",
      fn: "tagListCommand",
      context: "worktree",
      args: [
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable tags" },
      ],
    },
    create: {
      description: "Create a tag (annotated when --message is given)",
      module: "./commands/git/mutate.ts",
      fn: "tagCreateCommand",
      omitBehavior: { exempt: "a new tag name is free text; nothing to enumerate" },
      context: "worktree",
      args: [
        { name: "Name", type: "text", placeholder: "v1.2.3", hint: "Tag name" },
        { name: "Message", flag: "--message", type: "text", placeholder: "release notes", hint: "Annotation message (makes the tag annotated)" },
        { name: "At", flag: "--at", type: "text", placeholder: "abc1234", hint: "Commit to tag (default HEAD)" },
        { name: "Push", flag: "--push", type: "boolean", default: false, hint: "Push the tag to origin after creating" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
    delete: {
      description: "Delete a local tag",
      module: "./commands/git/mutate.ts",
      fn: "tagDeleteCommand",
      omitBehavior: "picker",
      context: "worktree",
      args: [
        { name: "Name", type: "text", placeholder: "v1.2.3", hint: "Tag to delete (picker when omitted)" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
    push: {
      description: "Push one tag to a remote",
      module: "./commands/git/mutate.ts",
      fn: "tagPushCommand",
      omitBehavior: "picker",
      context: "worktree",
      args: [
        { name: "Name", type: "text", placeholder: "v1.2.3", hint: "Tag to push (picker when omitted)" },
        { name: "Remote", flag: "--remote", type: "text", placeholder: "origin", hint: "Remote to push to" },
        { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable result" },
      ],
    },
  },
},
```

- [ ] **Step 5: Run e2e + conformance**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/git-verbs.test.ts`
Expected: PASS.
Run: `bun run picker:check`
Expected: no violations.

- [ ] **Step 6: Commit**

```bash
git add commands/git/mutate.ts lib/command-tree-def.ts e2e/tests/git-verbs.test.ts
git commit -m "rt git tag verbs"
```

---

### Task 12: Full-suite verification and docs touch

**Files:**
- Modify: `packages/git-core/README.md` (one line in its consumers section, if it has one, noting the daemon sweep and `rt git` verbs are the first consumers)
- No other source changes; this task is the gate pass.

- [ ] **Step 1: Full unit suite**

Run: `bun run test`
Expected: 0 fail. (Known flake pattern: the root suite can rotate failures; a failure gets isolated and re-run on its own before being blamed on this branch. The clean-main baseline for this branch was fully green.)

- [ ] **Step 2: e2e suite**

Run: `bun run test:e2e`
Expected: 0 fail, including `e2e/tests/git-verbs.test.ts`.

- [ ] **Step 3: Typecheck + startup gates**

Run: `bunx tsc --noEmit`
Expected: clean.
Run: `bun run picker:check`
Expected: no violations.
Run: `bun test lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-ui-in-cli.test.ts`
Expected: PASS.

- [ ] **Step 4: rt-client dist freshness**

Run from `packages/rt-client`: `bun run build`
Run: `bun test packages/rt-client`
Expected: PASS.

- [ ] **Step 5: Purity gate**

Run: `bash scripts/repo-purity.sh`
Expected: clean. Also grep the branch diff for ticket ids and dash characters:
`git diff main...HEAD | grep -nE "RT-[0-9]|SKILLS-[0-9]"` expected: no output (excluding this plan file's own path if it matches nothing anyway).

- [ ] **Step 6: README touch + final commit**

If `packages/git-core/README.md` documents consumers, add the sweep + tree verbs line; otherwise skip the edit. Commit anything outstanding:

```bash
git add -A
git commit -m "chunk 3 gate pass: docs touch"
```

(Skip the commit if the tree is clean.)

---

### Task 13: Periodic fetch in the sweep (git-core `fetch()` + fetch cadence)

The ticket names "periodic fetch + git-core snapshot" as the sweep's job: without a background fetch, ahead/behind and last-fetched badges go stale forever on repos nothing else fetches. Tasks 3-4 landed the snapshot half; this task adds the fetch half as its own increment.

**Files:**
- Modify: `packages/git-core/src/types.ts` (add `fetch` to GitClient), `packages/git-core/src/client.ts` (wire it), plus whichever module holds `pushTag`'s rawGit call (`packages/git-core/src/refs.ts`)
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (`rt.gitStatus` default gains `fetchIntervalSec: 900`)
- Modify: `lib/daemon/git-status-sweep.ts` (fetch gate inside the per-repo pass)
- Test: new cases in `packages/git-core/src/__tests__/` (follow the naming of the existing mutation test files) and `lib/daemon/__tests__/git-status-sweep.test.ts`

**Interfaces:**
- Consumes: `rawGit` from `packages/git-core/src/exec.ts` and `assertSafeRemote` from `packages/git-core/src/ref-guard.ts`, exactly as `pushTag` in `refs.ts` composes them (fetch needs the same SSH/askpass env that made `pushTag` bypass simple-git's env sanitizing).
- Produces:
  - GitClient gains `fetch(remote?: string): Promise<void>` (default remote `"origin"`), running `git fetch --quiet <remote>` via rawGit after `assertSafeRemote`.
  - `GitStatusConfig` gains `fetchIntervalSec: number` (0 disables fetching; default 900).
  - Sweep behavior: per repo, before snapshotting, if `fetchIntervalSec > 0` and the repo's last sweep-fetch is older than that, run `client.fetch()` on the MAIN worktree only (worktrees share refs), bounded by a 60s `Promise.race` timeout; a fetch failure or timeout logs `warn` and the pass continues to snapshot with stale remote refs (offline is normal). Track last-fetch times in a module-level `Map<string, number>` inside the sweep (in-memory; a daemon restart just fetches once more).

- [ ] **Step 1: Write the failing git-core test**

New file `packages/git-core/src/__tests__/fetch.test.ts` (sandbox pattern per the existing tests):

```ts
import { describe, expect, test } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

describe("fetch", () => {
  test("fetch pulls new remote commits into remote-tracking refs and stamps lastFetchedAt", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "one\n");
      await sb.commitAll("init");
      const remoteDir = await sb.addBareRemote();
      await sb.git(["push", "origin", "main"]);
      const client = createGitClient(sb.dir);
      expect((await client.fetchState()).lastFetchedAt).toBeNull();
      await client.fetch();
      expect((await client.fetchState()).lastFetchedAt).not.toBeNull();
      void remoteDir;
    } finally {
      await sb.cleanup();
    }
  });

  test("a flag-like remote is rejected before any spawn", async () => {
    const sb = await makeSandbox();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.fetch("--upload-pack=touch /tmp/pwned")).rejects.toThrow();
    } finally {
      await sb.cleanup();
    }
  });
});
```

(If `fetchState`'s lastFetchedAt derives from FETCH_HEAD and a no-op fetch does not write it on this git version, assert on `git rev-parse origin/main` succeeding after a second commit is pushed from a clone instead; keep the injection case exactly as written.)

- [ ] **Step 2: Run to verify failure**

Run from `packages/git-core`: `bun test src/__tests__/fetch.test.ts`
Expected: FAIL, `client.fetch is not a function`.

- [ ] **Step 3: Implement `fetch` in git-core**

`types.ts`, after `fetchState()`:

```ts
fetch(remote?: string): Promise<void>;
```

In `refs.ts` (beside `pushTag`, same rawGit + guard composition):

```ts
export async function fetchRemote(ctx: ClientContext, remote = "origin"): Promise<void> {
  assertSafeRemote(remote);
  await rawGit(ctx.dir, ["fetch", "--quiet", remote]);
}
```

Wire it in `client.ts` next to the other refs wiring: `fetch: (remote) => fetchRemote(ctx, remote),`. Match the file's existing wiring style exactly.

- [ ] **Step 4: Run the git-core suite**

Run from `packages/git-core`: `bun test`
Expected: all pass (124 baseline + the new file). Run `bunx tsc --noEmit` from `packages/git-core` too (noUncheckedIndexedAccess stays on).

- [ ] **Step 5: Extend the settings default and rebuild rt-client**

In `registry-defs.ts`, the `rt.gitStatus` default becomes `{ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }` and the description gains "fetchIntervalSec is the per-repo background fetch cadence (0 disables fetching)." Then from `packages/rt-client`: `bun run build`.

Also extend the `gitStatusConfig` reader in `lib/daemon.ts` (Task 4 Step 5) to surface the new field with the same shape of guard: `fetchIntervalSec: Number.isFinite(f) && f >= 0 ? f : 900` where `f = Number((v as any).fetchIntervalSec)`.

- [ ] **Step 6: Write the failing sweep tests**

Add to `lib/daemon/__tests__/git-status-sweep.test.ts` (the `sweepWith` helper's `readConfig` now returns the three-field config; update the existing literals to add `fetchIntervalSec: 0` so prior cases stay fetch-free):

```ts
  test("fetch runs once per cadence on the main worktree only", async () => {
    const fetched: string[] = [];
    const fakeClient = (dir: string) => ({
      snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
      fetchState: async () => ({ lastFetchedAt: null }),
      fetch: async () => { fetched.push(dir); },
    }) as any;
    const sweep = sweepWith({
      repoIndex: () => ({ r: "/main" }),
      readConfig: () => ({ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }),
      makeClient: fakeClient,
      listWorktrees: async () => [
        { path: "/main", branch: "main", headSha: null, isBare: false },
        { path: "/wt2", branch: "b", headSha: null, isBare: false },
      ],
    });
    await sweep.sweepNow();
    await sweep.sweepNow();
    expect(fetched).toEqual(["/main"]);
  });

  test("a fetch failure does not stop the snapshot", async () => {
    const sweep = sweepWith({
      repoIndex: () => ({ r: "/main" }),
      readConfig: () => ({ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }),
      makeClient: ((dir: string) => ({
        snapshot: async () => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true }),
        fetchState: async () => ({ lastFetchedAt: null }),
        fetch: async () => { throw new Error("network down"); },
      })) as any,
      listWorktrees: async () => [{ path: "/main", branch: "main", headSha: null, isBare: false }],
    });
    const { changed } = await sweep.sweepNow();
    expect(changed).toEqual(["r"]);
    expect(sweep.errors().get("r")).toBeUndefined();
  });
```

- [ ] **Step 7: Run to verify the new cases fail, then implement the fetch gate**

In the sweep's per-repo pass, before the worktree loop:

```ts
const lastFetch = fetchTimes.get(repo) ?? 0;
if (cfg.fetchIntervalSec > 0 && now().getTime() - lastFetch >= cfg.fetchIntervalSec * 1000) {
  fetchTimes.set(repo, now().getTime());
  try {
    await Promise.race([
      makeClient(mainPath).fetch(),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("fetch timed out")), 60_000).unref?.()),
    ]);
  } catch (err) {
    deps.log.warn({ err, repo }, "background fetch failed; snapshotting with stale remote refs");
  }
}
```

where `cfg = deps.readConfig(raw)` is the per-repo config already read for the opt-out check (hoist it to one read per repo) and `fetchTimes` is a `Map<string, number>` in `createGitStatusSweep`'s closure. `mainPath` is the index value, not a listed worktree path. The fetch stamp is written before the attempt so a hanging remote cannot re-hang every pass.

- [ ] **Step 8: Run the sweep tests and the daemon suite**

Run: `bun test lib/daemon/__tests__/git-status-sweep.test.ts`
Expected: PASS.
Run: `bun test lib/daemon packages/git-core packages/rt-client`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/git-core lib/daemon/git-status-sweep.ts lib/daemon/__tests__/git-status-sweep.test.ts packages/rt-client/src/settings/registry-defs.ts
git commit -m "sweep: periodic background fetch via git-core fetch()"
```

(Task 12's gate pass runs AFTER this task; execute tasks in the order 1-11, 13, then 12.)

---

## Explicit non-goals (ticket text: honor them)

- No stage-lines/discard-lines tree leaves; `stageSelection`/`discardSelection` stay library-level for the TUI and daemon.
- No `rt git commit` changes (the existing interactive `commitFlow` stays as is).
- No journaled events for the sweep; `git-status` rides the broadcast/fanOut path like `project-mrs`.
- No Go TUI work (next chunk).
