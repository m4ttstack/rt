# rt CI: shard the unit suite, run only changed tests on PRs

Date: 2026-09-25. Status: design approved in chat (RT-305); spec not yet
approved.

## Problem

`checks.yml` is one macOS job. Its serial unit suite (about 665 files in
one process) takes 340 to 510 s of a 7 to 11 min run, and every PR pays
the whole suite even when it touches only Swift or docs. The steps around
it (lockfile sync, typecheck, actionlint, the Go helper's tests,
`docs:check`, `picker:check`) do not need a Mac, but they wait in the
same macOS queue.

Measured on the CI speed spike (2026-09-25, one busy 18-core Mac):

| run                                | result                    |
| ---------------------------------- | ------------------------- |
| serial unit suite                  | 542 s                     |
| six concurrent `--shard=i/6` runs  | 219 s                     |
| `--changed` on a one-file TS diff  | 15 of 665 files selected  |

Turbo was considered and rejected for rt: the time sits inside one
root-package test run, which no task graph can split.

## Decided in chat

- `checks.yml` becomes `scope` and `static` on ubuntu, `unit` as three
  macOS shards, and `checks`, which needs them all. The required check
  stays named `checks`, so branch protection (`checks`, `e2e`, `purity`)
  does not change.
- Shards balance on a committed timings file; a `test:timings` script
  refreshes it.
- PR scope comes from one script, `scripts/ci/test-scope.ts`: the full
  suite on main and on any PR that changes something `--changed` cannot
  see; `--changed` on TypeScript-only PRs; no unit job on a PR that
  touches nothing the unit suite reads.
- Three shards plus `e2e` plus `glitter-pty` is exactly the org's five
  concurrent macOS jobs on the free plan, so the shard count is three.
  The ceiling holds per run; overlapping runs (a main push during a PR
  push, or another m4ttstack repo's macOS jobs) queue behind it.
- `--changed` trades coverage for time on TypeScript-only PRs, and the
  trade is stated in section 2: what a `changed` run can miss breaks on
  the main push, which always runs the full suite, never silently.
- Lands after RT-302, RT-303 and RT-309 (tests that only pass by file
  order, and one that leaves `process.exitCode` set).

## 1. Jobs

`checks.yml` keeps its `on:` and `concurrency:` blocks (rt#457 merged
them; superseded PR runs cancel, main runs never).

On a `pull_request` event every job checks out the default ref,
`refs/pull/N/merge`, the PR merged onto its base at run time. That commit's
first parent is the base tip, so `HEAD^1..HEAD` is exactly the PR's diff
and `--changed=HEAD^1` selects exactly the PR's files (bun diffs against
the ref it is given, not a merge base; the spike measured
`--changed=<merge-base>` on the merge ref and it dragged in main's drift).
Checkouts use `fetch-depth: 2`, enough for `HEAD^1`.

`scope` (ubuntu, seconds): checkout, `setup-bun` pinned `1.4.2`, then
`bun scripts/ci/test-scope.ts` (no install; the script imports nothing
from `node_modules`) writes `mode` (`full`, `changed` or `skip`) and
`dirs` (the unit suite's directory list) to `$GITHUB_OUTPUT`. Section 2
has the rules.

`static` (ubuntu): checkout, `setup-bun` `1.4.2`, `setup-go` from
`ui/go.mod`, `bun install --frozen-lockfile`, then, unchanged from today:
lockfile sync (`bun install && git diff --exit-code -- bun.lock`),
`bunx tsc --noEmit`, workflow lint, `bun run ui:test`, `bun run docs:check`,
`bun run picker:check`. `actionlint` arrives through its release download
script pinned to one version (no brew on ubuntu); the lint list gains
nothing and still grandfathers `release.yml`. The plan's first task runs
each step on ubuntu before anything else is written. A step that turns
out to need macOS goes into a fourth job, `static-macos`, that runs on
every PR (never into `unit`, which skips on some PRs; `docs:check` on a
docs-only PR is the case that rules that out). No such step is expected:
no unit test or static script reaches the Go toolchain or a macOS-only
call, and `ui/internal/tty` has a non-Darwin fallback.

`unit` (macOS, `strategy.matrix.shard: [1, 2, 3]`, `fail-fast: false`,
`if: needs.scope.outputs.mode != 'skip'`): checkout, `setup-bun` `1.4.2`,
`brew install age zstd git-lfs` under `HOMEBREW_NO_AUTO_UPDATE=1` (the
state-backup tests spawn them), `bun install --frozen-lockfile`, then one
`bun test` over `needs.scope.outputs.dirs` with
`--shard=${{ matrix.shard }}/3 --timings=test-timings.json`, plus
`--changed=HEAD^1` when `mode` is `changed`. In `changed` mode shard 1
also runs the always-run list from section 2 as a second `bun test` call
(path arguments intersect with `--changed`, so they cannot share one).
Each shard prints its wall time at the end so an unbalanced timings file
is visible in the log. No `setup-go`: nothing in the unit suite runs Go.

The directory list comes from `package.json`'s `test` script, which
today includes `rt-tray/Tests/stub-rt`; `checks.yml` does not run that
tree at present, so CI gains it, and the first task confirms it passes
on a runner.

`checks` (ubuntu, `needs: [scope, static, unit]`, `if: always()`): passes
only when `scope` and `static` succeeded and `unit` either succeeded or
was skipped with `needs.scope.outputs.mode == 'skip'`. Anything else
(a failed or cancelled `scope`, which also skips `unit`; a cancelled
shard) fails. This is the job branch protection requires. `if: always()`
is what makes a skipped `unit` count: a required check that never runs
reads as passing.

`e2e.yml` and `purity.yml` do not change.

## 2. Test scope (`scripts/ci/test-scope.ts`)

One script decides, from the PR's changed files, what the unit shards run.
It reads the directory list from `package.json`'s `test` script so the
shards and the local `bun run test` can never drift apart, and it prints
its decision and the reason on stdout as well as to `$GITHUB_OUTPUT`.

Inputs: the event name and the checkout. The changed file list is
`git diff --name-only HEAD^1 HEAD` on the merge ref.

Two derived sets the rules use:

- The unit suite's read set: every path or basename that appears as a
  string in the unit test sources (the test files under the `dirs` list,
  `test-setup.ts`, and the transitive imports of both). A changed file is
  "read" when its repo path or its basename occurs in any of them. Basename
  matching is deliberately loose: `README.md` matches somewhere and
  forces a run, which is the safe direction. The spike found parity tests
  reading `rt-tray/Sources-core/**/*.swift`, `rt-tray/build.sh`,
  `project.yml`, `deps.lock`, `rt-tray/vm/run/guest/**` and Markdown
  fixtures under `__tests__/fixtures/`, none of which `--changed` can see.
- The invisible-to-`--changed` set: every changed file that is not `.ts`,
  plus these TypeScript files: `test-setup.ts` and its transitive imports
  (a change to `packages/rt-client/src/test-isolation.ts` selected zero
  tests in the spike), anything under a `fixtures/` or `__fixtures__/`
  directory (tests spawn or read them; nothing imports them), and
  `scripts/ci/**`. Shell scripts, JSON and YAML fixtures, `bunfig.toml`,
  `package.json`, `bun.lock`, `test-timings.json` and `checks.yml` all
  land here through "not `.ts`"; the rule is written that way so a new
  kind of non-TS input is full by default, not missed by default.

Rules, in order; the first that matches wins:

1. Not a `pull_request` event: `full`. Main is what releases cut from, and
   a scope rule that is wrong should fail there rather than ship.
2. No changed file is in the read set, and every changed file is docs
   (`docs/**`, `*.md`, `skills/**`) or Swift (under `rt-tray/`, outside
   `rt-tray/Tests/stub-rt/**` and `rt-tray/vm/run/helpers/**`, which are
   TypeScript test trees the unit suite runs): `skip`.
3. Any changed file is in the invisible set: `full`.
4. Otherwise (TypeScript the import graph can see): `changed`.

`--changed=HEAD^1` runs every test file whose import graph reaches a file
in the diff; combined with `--shard`, each shard takes its slice of that
selection. The spike ran the two flags together on a three-file diff:
each shard took one file and the union matched the unsharded run; a
shard or a `--changed` run that selects nothing exits 0.

What `changed` mode cannot see, and the always-run list. A test that
depends on TypeScript without importing it (it spawns `cli.ts` or
`rt-tray/Tests/stub-rt/stub.ts`, or reads a source file as text) is not
selected when that source changes. The guards AGENTS.md names as
enforcement are all of this kind (`lib/__tests__/no-ui-in-cli.test.ts`,
`no-url-pathname`, `no-eager-tui`, `no-top-level-await`), so
`test-scope.ts` carries them as an always-run list that shard 1 runs in
`changed` mode; the script's test asserts every listed file exists. The
spawn-based tests (about ten spawn `cli.ts`) are not in the list: they
run on `full` PRs and on every main push, and a TypeScript-only PR that
breaks one is caught there, after merge. That is the trade `--changed`
makes and the reason main never runs `changed`.

The script has a unit test (`scripts/ci/__tests__/test-scope.test.ts`)
that feeds it file lists and asserts the mode, one case per rule and one
per named edge: a `rt-tray/Tests/stub-rt` change is not Swift; a Swift
file a parity test reads is `full`, not `skip`; a Markdown fixture under
`__tests__/fixtures/` is `full`; a `.md` next to a `.ts` is `full`; a
preload import is `full`; a plain `lib/*.ts` change is `changed`.

## 3. Shards and timings

`test-timings.json` is committed at the repo root: bun's own format,
per-file durations in milliseconds with repo-relative paths, which
`--timings=<file>` reads to give each shard equal wall time. A file the
timings do not know gets bun's default weight, so a stale file only
unbalances, never breaks. `bun run test:timings` deletes the file and
runs `bun test <dirs> --timings=test-timings.json --update-timings`
(bun merges into an existing file, so a deleted test would otherwise
linger); run it when the unit job's per-shard wall times drift more than
a minute apart, and the plan's task that adds the file records the three
shard times it produced.

Locally nothing changes: `bun run test` is still the serial suite. A
developer who wants a slice runs `bun test <dirs> --shard=1/3
--timings=test-timings.json` by hand; no root script wraps it.

## 4. Rollout

- One PR on branch `rt-305-ci-shards`, after RT-309 merges (RT-302 and
  RT-303 merged 2026-09-25).
- AGENTS.md's "`bun run test` is one of three suites" footgun gains two
  sentences: CI runs the unit suite as three shards scoped by
  `scripts/ci/test-scope.ts`, and a change to a non-TypeScript input a
  test reads is what forces the full suite on a PR.
- Acceptance, measured on the PR's own runs and the first main push,
  for the `Checks` workflow alone (`e2e` runs on every PR in its own
  workflow):
  - the full run (main push) finishes `checks` in about 3 min;
  - a TypeScript-only PR finishes in under 2 min;
  - a tray PR that touches none of the files the unit suite reads skips
    `unit` and `checks` still passes;
  - every `static` step is green on ubuntu, or has a `static-macos` home
    with a reason;
  - `--changed` and `--shard` combine (the first task's assertion);
  - branch protection still requires `checks`, `e2e`, `purity`, and the
    PR's own `checks` is the aggregator job.
- Rollback is `git revert` of the PR; nothing outside the repo changes.

## Not in scope

- Sharding `e2e` or `glitter-pty` (they are already their own jobs).
- Caching `brew install age zstd git-lfs` or `bun install` on macOS.
- Running the unit suite on ubuntu (launchd, TCC and `~/Library` paths).
- Selecting spawn-based tests in `changed` mode (they run on main).
- RT-310 (cli-logger picks the wrong log file) and any other test bug the
  shards surface; each gets its own ticket.
