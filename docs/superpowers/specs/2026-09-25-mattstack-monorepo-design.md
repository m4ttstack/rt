# mattstack monorepo: rt absorbs apps, glance and gitq

Date: 2026-09-25. Status: design approved in chat; spec awaiting review.

## Problem

Four repos ship one product and talk to each other through npm. Since
2026-08-25, `@mattstack/rt-client` was published 35 times,
`@mattstack/glance` 10 times and `@mattstack/settings-kit` 7 times, each
publish needing Matt's OTP, and the apps repo took 18 commits that exist
only to bump those pins. Where nobody bumps, consumers rot: gitq and the
VS Code extension pin rt-client `^0.14.0` against a current 0.32.0. No
consumer of any of these packages exists outside the org's own repos; the
registry download counts are our own CI.

The release adds a second layer: every app ships as a tarball cut by
`bundle-apps.yml` from a clone of the apps repo, pinned in
`rt-tray/deps.lock`, and re-pinned by a bot PR. v2.9.0 shipped a ten-day
stale app layer this way with nothing in the process saying so.

## Decided in chat

- `m4ttstack/rt` is the root and absorbs `m4ttstack/apps`,
  `m4ttstack/glance` and `m4ttstack/gitq`. The Sparkle feed URL baked into
  every installed app, the mattstack.dev download links and all twelve
  release secrets live on rt; apps has one secret.
- The repo keeps the name `rt`. A rename is a later step with nothing
  else in flight.
- fast-browser, skills, flock, herdr-chat, mattstack.dev and the
  marketplace stay separate: no package dependency on rt, or a different
  toolchain, or a generated artifact.
- rt-client and settings-kit become private workspace packages. glance,
  glance-react and gitq keep an on-demand `bun publish` for anyone
  outside; inside the tree everything is `workspace:*`.
- One version for everything: the mattstack.app tag is the version of
  every app and of gitq, built from that commit. Nothing at runtime reads
  an app's version.
- History comes across in full for each repo's `main`; the apps repo's 62
  `archive/*` refs (about 350 MB of pre-fold-in history) stay in the
  archived repo.
- Three PRs, apps then glance then gitq, each leaving main releasable,
  with a mattstack.app release cut between them.
- The deck standalone update channel (`deck update`, `scripts/install.sh`)
  is dropped. It only served a standalone deck install that nothing
  publishes; under mattstack.app it already refuses.
- The four apps platform packages were marked `private` on apps main on
  2026-09-25 (a7d9c4a2) ahead of this work.

## Layout

rt stays the root package. `cli.ts`, `lib/`, `commands/`, `scripts/`,
`rt-tray/`, `ui/`, `extensions/` and `website/` do not move.

```
apps/
  board  boxscore  chat  console  deck      (from apps, paths unchanged)
  gitq                                      (from gitq)
packages/
  rt-client  settings-kit  git-core         (rt, unchanged)
  gate-kit  server  tokens  tokyo  tui-kit  ui   (from apps, unchanged)
  glance  glance-react  typescript-config   (from glance/packages/*)
docs/
  apps/           (apps' docs/, including docs/design)
```

glance's and gitq's root docs move under their own directories
(`packages/glance/docs/`, `apps/gitq/docs/`, `apps/gitq/website/`).
glance's live-test credentials file moves to
`packages/glance/harness_credentials.json`; the two constants that find
it four and five directories up (`tests/live/credentials.ts`,
`tests/live/probe/githubEventsProbe.ts`) become package-relative.

No package name collides. apps' root files (`package.json`, `bun.lock`,
`turbo.json`, `AGENTS.md`, `README.md`, configs, `scripts/`, `.github/`)
are merged by hand into rt's, not kept.

## Workspace

One root `bun.lock`. rt's `package.json` gains apps' workspace globs
(`packages/*`, `packages/tui-kit/workshop`, `apps/*`) and apps' catalog,
extended with glance's entries. `@mattstack/rt-client`,
`@mattstack/settings-kit` and `@mattstack/glance` leave the catalog and
become `workspace:*` in every consumer, the VS Code extension included.
The subpath exports apps rely on (`rt-client/gate`, `rt-client/identity`,
`settings-kit/react`, `/server`, `/shapes`) are preserved by the packages'
existing `exports` maps; a workspace link resolves them the same way a
registry install did.

TypeScript: the catalog stays `~6`. tui-kit and board keep their
documented `^7`; glance and gitq keep `5.9.3` as a third documented
exception until bumped in their own PRs.

Root `bunfig.toml` keeps rt's `test-setup.ts` preload (HOME isolation).
apps' root guard (`scripts/bun-test-guard.ts`, which repoints HOME and
`BOARD_APP_ROOT` so a bare root `bun test` cannot walk app tests against
the real home) folds into `test-setup.ts`. rt's `test` script names its
own packages explicitly, `packages/rt-client packages/settings-kit
packages/git-core`, instead of `packages`, so `bun test` never walks apps'
vitest packages; `scripts/ci/test-scope.ts` reads that list unchanged.

Publishing: `@mattstack/glance`, `@mattstack/glance-react` and
`@mattstack/gitq` keep `name` and `version`. Publish is `bun publish`
from the package directory, never `npm publish`, because glance-react
depends on glance as `workspace:*` and npm ships that string verbatim.
gitq's `scripts/release.ts` release guard (refuses `file:` deps) stays and
also accepts `workspace:` deps. rt-client's `postinstall` build stays.

## Tasks and CI

Turbo moves to the rt root: `turbo.json`, `scripts/turbo.sh`, the cache
at `<git-common-dir>/turbo-cache`. rt's own checks become root tasks
next to apps' existing ones: `//#test` (the sharded unit suite),
`//#typecheck`, `//#picker:check`, `//#docs:check`, `//#ui:test` (Go),
`//#purity`. Both purity scripts merge into one word list under
`scripts/repo-purity.sh`.

One `checks.yml`:

- `scope` (ubuntu) runs `scripts/ci/test-scope.ts` as today and also
  emits whether the affected set includes the root package or any of
  `packages/rt-client`, `packages/settings-kit`, `packages/git-core`
  (turbo `--affected` against the PR base).
- `static` (ubuntu) runs `turbo check --affected`, which covers every app
  and package plus rt's root static tasks.
- `go` (ubuntu) as today.
- `unit` (macOS, three shards) runs only when `scope` says rt is
  affected; the shard command is unchanged.
- `deck-macos` (macOS) runs deck's tests when deck is affected, as apps'
  CI does today.
- `checks` aggregates; the required check names stay `checks`, `e2e`,
  `purity`, so branch protection does not change.

`e2e.yml` keeps its path filter, extended with `apps/**` paths that touch
the socket setup. `timings.yml` is unchanged. Renovate's repo list
(`.github/renovate-global.json5`) drops `m4ttstack/apps` and
`m4ttstack/gitq`. The bare `bun test` footgun in AGENTS.md gains the
line that apps' packages are vitest and never in the unit dirs.

## Release

### What ships and how it is built

`release.yml` gains a `build-apps` job on macOS that runs before
`build-app`: `bun install --frozen-lockfile`, then `turbo build:binary`
for board, boxscore, chat, console, deck and gitq at the release SHA,
producing the same per-app artifact each app's `mattstack.deck.json`
recipe produces today. The job holds no signing certificate. Its output
lands in `rt-tray/deps/arm64/<name>/`, exactly where `fetch-deps.sh`
places a downloaded row, so `rt-tray/build.sh` and `check-bundle.sh` see
no difference. build.sh's `sign_helper_tree` keeps signing each helper as
`com.mattstack.helper.<app>`, so TCC grants survive updates as they do
today. The rule from bundle-apps stands: the job that imports the
Developer ID key never runs app code; app code runs in `build-apps`, the
key is imported in the existing sign step.

`rt-tray/deps.lock` keeps the app rows, because deck's `bundle-catalog.ts`
reads the running bundle's deps.lock as the served-app catalog (name,
status, serve port) and build.sh and check-bundle.sh iterate its rows.
Those rows lose `url`, `version`, `sha256`, `repo` and `subdir` and gain
`source: "tree"`. `fetch-deps.sh` skips tree rows; `check-bundle.sh`
asserts each tree row's helper exists and reports the tag as its
version. gitq's row is the same shape. Tool rows and the fast-browser row
are unchanged.

Deleted: `bundle-apps.yml`, `scripts/bundle-ci/`, the cross-repo dispatch,
bot-PR wait and merge in `lib/release/release-app.ts`, `deck update`
(`apps/deck/src/cli/update.ts` and its test), `apps/deck/scripts/install.sh`,
and gitq's own `release.yml`.

### The one-app fast path

Today `rt release app <name>` and preflight's gate classify a release by
which deps.lock rows moved. With no rows, the gate classifies by path.
`checkGate` in `lib/release/preflight.ts` diffs `<last-tag>..HEAD` and
answers `fast` when every changed file is under `apps/board/`,
`apps/boxscore/`, `apps/chat/`, `apps/console/`, `apps/gitq/`,
`RELEASE_NOTES.md` or `website/`, and `full` otherwise. `apps/deck/`,
`packages/*`, `lib/`, `rt-tray/` and tool rows are full-gate for the same
reasons they are today: they take part in setup, which the clean-room
walkthrough exercises.

`rt release app <name>` shrinks to: preflight's gate must be `fast` and
the diff must touch that app; write the notes with a section per app
whose directory moved; commit; tag the exercised SHA; `rt release
verify`. No version bump, no dispatch, no bot PR. Held apps no longer
exist: everything ships at HEAD, which is the content-lockstep policy
step 2b of the release skill enforces by hand today.

### Preflight rows

Dropped: the per-app pin-freshness rows, the standalone gitq row and the
rt-client npm parity row. Kept: git state, picker conformance, schema
lock, the fast-browser row, tool rows, plugin catalog, Chrome extension,
and the gate.

### Update-machine

The dev-bundle leg runs `turbo build:binary` for the served apps and deck
in the scratch tree before `rt-tray/build.sh dev`, since `deps/` no
longer arrives by download; the AGENTS.md "dev app rebuild" recipe says
the same. The served-suite leg pulls the rt checkout, the one the daemon
leg already syncs, re-registers each served app and deck with `deck
register --dir <rt>/apps/<name>` when a registry row still points at
the old checkout, restarts, and checks `deck --version` against the tag
instead of a deps.lock pin. `commands/release.ts` drops
`appsCheckoutPath`; `lib/setup/steps/deck.ts` writes board's working
directory under the rt checkout's `apps/`.

### Skill

`skills/rt-release/SKILL.md` is rewritten in the apps PR: the fast path
is described by paths, steps 2b and 2c lose the app and gitq rows and
the rt-client parity row, step 8's pin-only fast path becomes the path
gate, and step 12's served leg names the rt checkout.

## Dev machine

Dev mode is unchanged in kind. Deck and the four served apps run from
source at the absolute `dev.workingDirectory` each registry row carries;
the deck shim in mattstack-dev.app runs that directory's `src/main.ts`
under bun and falls back to `deck-pinned`. Manifests are read live from
the linked directory and move with the apps. The cutover is the five
`deck register --dir` calls above, run by update-machine's served leg.
`bun run deploy` from an app installs the monorepo root, once.

One shared checkout, `~/Documents/GitHub/repo-tools`, serves the dev
daemon and deck's from-source apps. The existing rule that its branch
must be `main` before syncing now covers both. The `mattstack-apps`,
`glance` and `gitq` checkouts are removed after their PRs land, and their
three bindings leave `~/.mattstack/rt/repos.json`. Their rt worktree
pools are disposed before the repos are archived, since a repo's identity
derives from its origin remote and the old identities orphan on archive.

Prod mode is unchanged: `deck-pinned` serves the explicit bundled list
from deps.lock's served rows; the helpers are in-tree builds instead of
downloads.

## Migration

Each PR follows the same shape, on a worktree branch:

1. Prepare the incoming repo in a scratch clone with `git filter-repo`:
   rename root docs and config to their new homes (or drop them), leave
   `apps/*` and `packages/*` (apps), move `packages/*` (glance) and
   everything (gitq, `--to-subdirectory-filter apps/gitq`).
2. `git merge --allow-unrelated-histories` the rewritten `main` into the
   branch. History and blame survive; `git log --follow` crosses the move.
3. Wire the workspace: globs, catalog, `workspace:*` deps, `private`
   flags, turbo tasks, CI, deps.lock rows, release changes, skill,
   AGENTS.md, renovate list.
4. Green CI, a full `release.yml` rehearsal, the local clean-room
   walkthrough, then merge.
5. Cut a mattstack.app release from the merged tree.
6. Archive the old repo. Fix the two README links that name it
   (`mattstack-skills/README.md`, `fast-browser/README.md`). Remove the
   local checkout and its rt binding; dispose its worktree pool.

Order: apps (proves the release path and removes the most churn), glance,
gitq. Rollback before step 6 is a revert of the merge commit; after it,
the archived repo is still readable and re-openable.

## Non-goals

- Renaming the repository or the local folder.
- A per-app update channel. One version now; a path-filtered per-app
  release plus a deck-side updater can be added later from the same tree.
- Sharing gitq's git engine with `packages/git-core`.
- Folding skills, fast-browser, flock, herdr-chat, mattstack.dev or the
  marketplace.
- Aligning glance and gitq on TypeScript 6.

## Risks

- **Release length.** In-tree app builds add their build time to every
  release run and rehearsal (today 25 to 50 min). The turbo cache in CI
  offsets repeat builds; the first release measures it.
- **Worktree weight.** A tree carries the union of node_modules (rt 254
  MB, apps 601 MB, glance 453 MB, gitq 52 MB before dedupe). Golden
  clonefile hydration keeps local trees cheap; CI installs get slower.
- **Turbo affected set.** A root-config change (catalog, tsconfig,
  bunfig) affects every package and runs the macOS shards; that is
  correct and matches today's full-suite rule for the same files.
- **Orphaned identities.** A machine that skips the dispose step keeps
  dead pools under `gh-m4ttstack-app-kit`, `gh-m4ttstack-gitq`,
  `gh-m4ttstack-glance`; `rt worktree list` shows them and dispose
  removes them.
