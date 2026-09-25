# rt CI: shard the unit suite, run only changed tests on PRs

Date: 2026-09-25. Status: design approved in chat (RT-305); spec not yet
approved.

## Problem

`checks.yml` is one macOS job. Its serial unit suite (664 files in one
process) takes 340 to 510 s of a 7 to 11 min run, and every PR pays the
whole suite even when it touches only Swift or docs. The steps around it
(lockfile sync, typecheck, actionlint, the Go helper's tests, `docs:check`,
`picker:check`) do not need a Mac, but they wait in the same macOS queue.

Measured on the CI speed spike (2026-09-25, one busy 18-core Mac):

| run                                   | wall  |
| ------------------------------------- | ----- |
| serial unit suite                     | 542 s |
| six concurrent `--shard=i/6` runs     | 219 s |
| `--changed` on a one-file TS diff     | 15 of 665 files |

Turbo was considered and rejected for rt: the time sits inside one
root-package test run, which no task graph can split.

## Decided in chat

- `checks.yml` becomes three jobs: `static` on ubuntu, `unit` as three
  macOS shards, and `checks`, which needs both. The required check stays
  named `checks`, so branch protection (`checks`, `e2e`, `purity`) does not
  change.
- Shards balance on a committed timings file; a `test:timings` script
  refreshes it.
- PR scope comes from one script, `scripts/ci/test-scope.ts`: the full
  suite on main and on any PR that changes something `--changed` cannot
  see; `--changed` on TypeScript-only PRs; no unit job on docs-only or
  Swift-only PRs.
- Three shards plus `e2e` plus `glitter-pty` is exactly the org's five
  concurrent macOS jobs on the free plan, so the shard count is three.
- Lands after RT-302, RT-303 and RT-309 (tests that only pass by file
  order, and one that leaves `process.exitCode` set).

## 1. Jobs

`checks.yml` keeps its `on:` and `concurrency:` blocks (rt#457 merged
them; superseded PR runs cancel, main runs never).

`scope` (ubuntu, seconds): checkout with `fetch-depth: 0`, then
`bun scripts/ci/test-scope.ts` writes `mode` (`full`, `changed` or `skip`),
`base` (the merge base sha, only for `changed`) and `dirs` (the unit
suite's directory list) to `$GITHUB_OUTPUT`. Section 2 has the rules.

`static` (ubuntu): checkout, `setup-bun` pinned `1.4.2`, `setup-go` from
`ui/go.mod`, `bun install --frozen-lockfile`, then, unchanged from today:
lockfile sync (`bun install && git diff --exit-code -- bun.lock`),
`bunx tsc --noEmit`, workflow lint, `bun run ui:test`, `bun run docs:check`,
`bun run picker:check`. `actionlint` arrives through its release download
script pinned to one version (no brew on ubuntu); the lint list gains
nothing and still grandfathers `release.yml`. A step that turns out to
need macOS moves into the `unit` job's shard 1 with a comment saying
why; the plan's first task runs each one on ubuntu before anything else
is written.

`unit` (macOS, `strategy.matrix.shard: [1, 2, 3]`, `fail-fast: false`,
`if: needs.scope.outputs.mode != 'skip'`): checkout with `fetch-depth: 0`
(`--changed` diffs against the merge base), `setup-bun` `1.4.2`,
`brew install age zstd git-lfs` (the state-backup tests spawn them),
`bun install --frozen-lockfile`, then one `bun test` over
`needs.scope.outputs.dirs` with `--shard=${{ matrix.shard }}/3
--timings=test-timings.json`, plus `--changed=<base>` when `mode` is
`changed`. Each shard prints its wall time at the end so an unbalanced
timings file is visible in the log.

`checks` (ubuntu, `needs: [scope, static, unit]`, `if: always()`): passes
when `static` succeeded and `unit` succeeded or was skipped; fails
otherwise, including when either was cancelled. This is the job branch
protection requires.

`e2e.yml` and `purity.yml` do not change.

## 2. Test scope (`scripts/ci/test-scope.ts`)

One script decides, from the PR's changed files, what the unit shards run.
It reads the directory list from `package.json`'s `test` script so the
shards and the local `bun run test` can never drift apart, and it prints
its decision and the reason on stdout as well as to `$GITHUB_OUTPUT`.

Inputs: the event name, and for a PR the base and head shas. The changed
file list is `git diff --name-only <merge-base> <head>`, where the merge
base is `git merge-base <base> <head>` (the PR base branch may have moved
since the PR was opened; diffing against the tip would drag in unrelated
changes, and diffing against the merge base is what `--changed` itself
does).

Rules, in order; the first that matches wins:

1. Not a `pull_request` event: `full`. Main is what releases cut from, and
   a scope rule that is wrong should fail there rather than ship.
2. Every changed file is docs or Swift: `skip`. Docs are `docs/**`,
   `*.md` and `skills/**`; Swift is anything under
   `rt-tray/` except `rt-tray/Tests/stub-rt/**` and
   `rt-tray/vm/run/helpers/**`, which are TypeScript test trees the unit
   suite runs.
3. Any changed file `--changed` cannot see: `full`. That is every file
   that is not `.ts`, plus these TypeScript files: `test-setup.ts` (the
   preload), anything under a `fixtures/` or `__fixtures__/` directory
   (tests spawn or read them; nothing imports them), `scripts/ci/**`,
   and `bunfig.toml`, `package.json`, `bun.lock`, `tsconfig*.json`,
   `test-timings.json` and `.github/workflows/checks.yml` by name.
   Shell scripts and JSON fixtures were the blind spots the spike found;
   the rule is written as "not `.ts`" so a new kind of non-TS input is
   full by default, not missed by default.
4. Otherwise (TypeScript only): `changed`, with `base` set to the merge
   base.

`--changed=<base>` runs every test file whose import graph reaches a file
changed since `<base>`; combined with `--shard`, each shard takes its
slice of that selection. The spike ran the two flags apart; the plan's
first task runs them together on a one-file diff and asserts the union
of the three shards' file lists equals the unsharded `--changed` list.

The script has a unit test (`scripts/ci/__tests__/test-scope.test.ts`)
that feeds it file lists and asserts the mode, one case per rule and one
per named exception (a `rt-tray/Tests/stub-rt` change is not Swift; a
`fixtures/` change is full; a `.md` next to a `.ts` is full).

## 3. Shards and timings

`test-timings.json` is committed at the repo root: bun's own format,
per-file durations in milliseconds that `--timings=<file>` reads to give
each shard equal wall time. A file the timings do not know gets bun's
default weight, so a stale file only unbalances, never breaks. `bun run
test:timings` (`bun test <dirs> --timings=test-timings.json
--update-timings`, which rewrites the first `--timings` file after an
unsharded run) refreshes it; run it when the unit job's per-shard wall
times drift more than a minute apart, and the plan's task that adds the
file records the three shard times it produced.

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
- Acceptance, measured on the PR's own runs and the first main push:
  - the full run (main push) finishes `checks` in about 3 min;
  - a TypeScript-only PR finishes in under 2 min;
  - a tray-only PR skips `unit` and `checks` still passes;
  - every `static` step is green on ubuntu, or moved back with a reason;
  - `--changed` and `--shard` combine (the first task's assertion);
  - branch protection still requires `checks`, `e2e`, `purity`, and the
    PR's own `checks` is the aggregator job.
- Rollback is `git revert` of the PR; nothing outside the repo changes.

## Not in scope

- Sharding `e2e` or `glitter-pty` (they are already their own jobs).
- Caching `brew install age zstd git-lfs` or `bun install` on macOS.
- Running the unit suite on ubuntu (launchd, TCC and `~/Library` paths).
- RT-310 (cli-logger picks the wrong log file) and any other test bug the
  shards surface; each gets its own ticket.
