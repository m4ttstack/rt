# Turborepo for this repo: cached, parallel, affected-only gates

Date: 2026-09-25. Status: approved in chat; not yet implemented.

## Problem

`ci.yml` is one ubuntu job of about 35 serial steps (about 6.5 min) plus
a macOS deck job. Every PR commit ran it twice until #158 and every
release-tag push ran it too. Locally there is no single command that
runs what CI runs, and nothing is cached: a second run costs what the
first did.

Measured on a spike branch (2026-09-25, one busy 18-core Mac):

| run                                  | wall | notes                          |
| ------------------------------------ | ---- | ------------------------------ |
| turbo, serial, no cache              | 105s | matches today's CI shape       |
| turbo, parallel, no cache            | 42s  | one flaky test (MANKIT-3)      |
| turbo, everything cached             | 1s   | 24 of 24 tasks from cache      |
| turbo `--affected`, board-only diff  | 26s  | 3 tasks ran                    |

45 of the last 60 merged PRs touched a single app, so affected-only runs
are the common case, not the exception.

## Decided in chat

- Turborepo (2.11.x) becomes the task runner for this repo. Bun
  workspaces and the root `bun.lock` need no change; turbo reads them.
- Cache: GitHub Actions cache in CI, and one filesystem cache shared by
  every worktree locally. No Vercel remote cache.
- Local root scripts become turbo-backed; `<app>:<task>` aliases stay.
- CI is one ubuntu turbo job (layout A) plus the filtered deck-macos job.
  A per-app matrix is a later split only if cold full runs hurt.
- Lands after MANKIT-3 (`TimedRingProgress` runs on real timers and
  fails under the parallel load turbo produces).

## 1. Task graph (`turbo.json`)

Per-package tasks, run by every workspace member that declares the
script:

- `build`: `dependsOn: ["^build"]`, `outputs: ["dist/**"]`.
- `build:binary` (console, boxscore): `dependsOn: ["build"]` (both
  write `dist/`, so they serialise), `outputs: ["dist/**", "dist-bin/**",
  "src/server/embedded/**"]`.
- `typecheck`: `dependsOn: ["^build"]`.
- `lint`.
- `test`: `dependsOn: ["^build"]`.
- `serve-check` (chat, console, boxscore): see section 3.

A package with no script for a task still resolves that task's
same-package `dependsOn` (turbo lists it as `<NONEXISTENT>` and runs
what it depends on). So the generic `serve-check` carries no
`dependsOn`; only the three packages that have the script get one
(`chat#serve-check` on `build`, console's and boxscore's on
`build:binary`). Otherwise every package would build on every `check`.
For the same reason there is no `ci` aggregate: the "everything CI
gates" list is spelled out once, in `scripts/turbo.sh`'s `check` mode
(section 2).

`^build` is what makes `packages/tui-kit` build before board and deck
touch it; the footgun in AGENTS.md ("run `tui-kit:build` first") stops
being a rule anyone has to remember.

Root tasks (`//#<name>`), each with declared `inputs` so they cache:

- `//#format:check`, `//#purity`, `//#scripts:test`: inputs
  `["$TURBO_DEFAULT$"]`, which for the root package is every tracked
  file in the repo and respects `.gitignore`.
- `//#lint:root`: the root eslint run over `packages`, `.storybook`,
  `stories` and board's CSS. It is not named `lint` because the root
  `lint` script is turbo-backed and would recurse; `bun run lint` runs
  `lint lint:root`, so it covers both.
- `//#tokens:fresh`: the tokens codegen byte-compare
  (`tokens:radix`, `tokens:codegen`, `tokens:ramps`, then
  `git diff --exit-code` over the committed outputs).
- `//#build-storybook` and `//#treeshake` (the existing scripts).
  Storybook imports `@mattstack/tui-kit/provider` and `/theme`, which
  resolve to tui-kit's gitignored `dist/`, so `//#build-storybook`
  depends on `@mattstack/tui-kit#build`; its inputs cover every tree
  `.storybook/main.ts` collects stories from, board's included.
- `@mattstack/tui-kit#gates` is a package task, not a root one.

Scoped root tasks use explicit `$TURBO_ROOT$/...` globs. Those globs
ignore `.gitignore`, so every one carries the negations
`!$TURBO_ROOT$/**/node_modules/**`, `!$TURBO_ROOT$/**/.turbo/**`,
`!$TURBO_ROOT$/**/dist/**` and `!$TURBO_ROOT$/**/dist-bin/**`; without
them a task's own logs and build output change its hash on every run.
`$TURBO_ROOT$/**` is never used (it would hash `.git`).

Cross-package inputs. `@mattstack/tokens#test` walks
`packages/{ui,tokyo,tui-kit}/src` from disk
(`test/consumption.test.ts`, `font-identity.test.ts`,
`fragment-sync.test.ts`). It declares those trees as `inputs`
(`$TURBO_ROOT$/packages/ui/src/**` and so on) so a ui change reruns it.
Any other test that reads outside its package does the same; the spike
found only these three.

Env: strict mode (turbo 2's default). `globalPassThroughEnv: ["CI"]`.
A test that needs another variable declares it in that task's `env`;
an undeclared variable is invisible to the task, which is the point.

`globalDependencies`: `tsconfig.tools.json`, `.prettierrc`,
`bunfig.toml`, `eslint.config.js`.

## 2. Scripts

Root `package.json`:

- `test`, `typecheck`, `build`: `scripts/turbo.sh <task>` (the script
  prepends `run`); `lint`: `scripts/turbo.sh lint lint:root`.
- `check`: `scripts/turbo.sh check`, three turbo invocations in order:
  1. `gates tokens:fresh --filter=@mattstack/tui-kit --filter=//
     --concurrency=1`: the two codegen gates rewrite
     `packages/tui-kit/src/generated/theme.css`, `packages/tokens/src`
     and `packages/tokyo/src` in place, and tokens' and tui-kit's tests
     read those files, so they run alone and first.
  2. `typecheck lint test serve-check` (the package gates; dependency
     builds arrive through `^build`, app builds through `serve-check`),
     with `--affected` when given, and `--filter=!deck` off macOS.
  3. `lint:root format:check build-storybook treeshake purity
     scripts:test test --filter=// --filter=@mattstack/tokens`, with
     `--affected` stripped (see section 3).
  This list is the one definition of "what CI gates"; `ci.yml` calls
  the same mode.
- `<app>:<task>` (board, chat, console, boxscore, deck): kept as
  `scripts/turbo.sh <task> --filter=<app>`, so `apps/<name>/AGENTS.md`
  and habits keep working.
- `tui-kit:build`, `tui-kit:test`, `tokens:test`, `gate-kit:test`: same
  shape, `--filter=@mattstack/<pkg>`.
- Turbo pinned as a root devDependency (`turbo`), not `bunx`, so the
  version is the lockfile's.

`scripts/turbo.sh` is the one entry point. It resolves
`$(git rev-parse --git-common-dir)/turbo-cache` and passes it as
`--cache-dir`, so every worktree of this repo shares one cache with no
per-user setup and CI uses the same path. Two things it must not do:
create the directory outside the git dir, or run when `git rev-parse`
fails (a plain checkout outside git is not a supported way to run this
repo).

Package scripts whose CI meaning differs from their local one get an
explicit variant, and `test` becomes the CI one:

- `packages/tui-kit`: `test` runs the node project and the browser
  project excluding `*.visual.test.tsx` and `*.parity.test.tsx`.
  `test:oracles` runs those two suites; they stay local until CI-recorded
  baselines exist (vitest's positional filters are substring matches,
  so the script names `.visual.test.tsx .parity.test.tsx`, not globs).
  `bunx playwright install chromium` becomes its own task,
  `@mattstack/tui-kit#browsers`, with `cache: false`, and `test`
  depends on it (`bun run` does not fire `pretest`, and a cached
  no-output task would skip the install on a fresh runner). Playwright
  itself is a no-op when the browser is already present.
- The three `serve-check` scripts start their server under
  `env -i HOME=<scratch> PATH=$PATH PORT=<port>`: console's binary
  writes `rt.notify.eventBridges` to the user settings store on boot,
  so a gate run under the real HOME would edit the developer's live
  `~/.mattstack`.
- `apps/chat`, `apps/console`, `packages/ui`, `packages/server`:
  `test` becomes `vitest run`; `test:watch` is `vitest`. Today's root
  `test` script passed `-- --run` to get the same effect.
- `apps/deck`: `test` stays `bun test core src` (macOS only; see CI).

## 3. CI (`ci.yml`)

Job `checks` (ubuntu):

1. `actions/checkout@v4` with `fetch-depth: 0` (`--affected` diffs
   against `main`).
2. `oven-sh/setup-bun@v2` pinned to `1.4.2` (unchanged reason: the
   byte-compare gates).
3. `bun install --frozen-lockfile`, then the lockfile-sync check
   (unchanged).
4. `actions/cache@v4` on `.git/turbo-cache`, key
   `turbo-${{ runner.os }}-${{ github.sha }}`, restore-keys
   `turbo-${{ runner.os }}-`. Every run saves. Actions cache scoping
   means a PR restores main's most recent cache, and main restores its
   own previous one; a PR's cache is never visible to main, so the
   first main push after a merge starts cold. Before turbo runs, a
   step deletes cache entries older than seven days
   (`find .git/turbo-cache -type f -mtime +7 -delete`), so compiled
   binaries do not pile up across restores.
5. On `pull_request`: `scripts/turbo.sh check --affected
   --output-logs=errors-only` with `TURBO_SCM_BASE` set to the PR's
   base sha. On `push` to main: the same without `--affected`.
   `check`'s three invocations are listed in section 2. The last one
   strips `--affected` because `--affected` walks the package graph and
   would skip the root and tokens when only an app changed; their
   declared `inputs` decide the cache hit.

The three served gates become package tasks so they skip with their
app:

- `chat#serve-check`: `dependsOn: ["build"]`.
- `mattstack-console#serve-check`, `boxscore#serve-check`:
  `dependsOn: ["build:binary"]`.
- Each runs the shell that is inline in `ci.yml` today, moved to
  `apps/<name>/scripts/serve-check.sh` (boxscore already has
  `scripts/binary-gate.sh`, which keeps its name; its `serve-check`
  script points at it).

Job `deck-macos` (macos-latest): same setup and cache, then
`scripts/turbo.sh test --filter=deck`, with `--affected` added on PRs
(`--affected` and `--filter` intersect), so a deck-untouched PR skips
the macOS job's work (the job still runs and passes in seconds).

Turbo prints a per-task summary; `--output-logs=errors-only` keeps the
log readable, and a failed task still prints its full output.

## 4. Rollout

- One PR on branch `turbo-ci`, after MANKIT-3 merges.
- AGENTS.md: rewrite "CI shape" and "Per-app root scripts" for the new
  scripts; replace the tui-kit build-order paragraph with the `^build`
  fact; add a short "Turbo" note (where the cache is, how to bypass it
  with `--force`, that `inputs` must be declared for any test reading
  outside its package).
- Acceptance, measured on the PR's own CI runs and the main pushes
  after merge:
  - a board-only PR finishes `checks` in under 2 min;
  - a cold full run (`--force`) finishes in under 4 min;
  - the second main push after merge (the first one seeds main's
    cache) reports at least 80% cache hits;
  - every gate in today's `ci.yml` runs somewhere (a checklist in the
    PR body maps old step to new task).
- Rollback is `git revert` of the one PR; no state outside the repo
  changes except the Actions cache, which expires on its own.

## Not in scope

- Vercel remote cache.
- Per-app CI matrix (revisit only with numbers).
- Splitting deck's macOS-only tests so deck can run on ubuntu.
- rt (`m4ttstack/rt`): its time sits in one root-package test run, so it
  gets `bun test --shard` and `--changed` instead; separate design.
