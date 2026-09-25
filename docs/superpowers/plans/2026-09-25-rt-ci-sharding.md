# rt CI Sharding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split rt's `checks.yml` into an ubuntu `static` job, three macOS unit shards scoped by one script, and a `checks` aggregator, so a full run takes about 3 min and a TypeScript-only PR under 2.

**Architecture:** `scripts/ci/test-scope.ts` turns a PR's diff into `mode` (`full`, `changed`, `skip`), the unit directory list from `package.json`, and the always-run guard list. `checks.yml` runs it first (`scope`), runs the non-Mac gates on ubuntu (`static`), runs `bun test --shard=i/3 --timings=test-timings.json` on three macOS jobs (`unit`, skipped when `mode` is `skip`, with `--changed=HEAD^1` when it is `changed`), and gates branch protection on an aggregator (`checks`) that reads all three results. A committed `test-timings.json` balances the shards; `bun run test:timings` refreshes it.

**Tech Stack:** Bun 1.4.2 (`bun test --shard`, `--changed`, `--timings`, `--update-timings`), GitHub Actions (matrix jobs, `needs` outputs, `if: always()`), actionlint 1.7.12.

**Spec:** `docs/superpowers/specs/2026-09-25-rt-ci-sharding-design.md`

## Global Constraints

- The required check stays named `checks`; branch protection (`checks`, `e2e`, `purity`) is not edited.
- `setup-bun` is pinned to `1.4.2` in every job.
- Every PR job checks out the default `refs/pull/N/merge` ref with `fetch-depth: 2`; the PR's diff is `HEAD^1..HEAD` and `--changed` takes `HEAD^1`. No job computes a merge base.
- The unit directory list has one source, `package.json`'s `test` script; `test-scope.ts` parses it and nothing in `checks.yml` repeats it.
- Rule order in `test-scope.ts` is fixed: not a PR is `full`; unread docs or Swift only is `skip`; anything `--changed` cannot see is `full`; otherwise `changed`. The read set is path-or-basename string presence in the unit test sources, `test-setup.ts` and the transitive imports of both. The invisible set is every non-`.ts` file plus `test-setup.ts` and its transitive imports, anything under `fixtures/` or `__fixtures__/`, and `scripts/ci/**`. `skills/**` is never docs.
- The always-run list is the glob `lib/__tests__/no-*.test.ts`, run by shard 1 as a second `bun test` call in `changed` mode only.
- `checks` passes only when `scope` and `static` succeeded and `unit` succeeded or was skipped with `mode == 'skip'`.
- Three shards, `fail-fast: false`, `timeout-minutes: 15`, `HOMEBREW_NO_AUTO_UPDATE=1`, `brew install age zstd git-lfs`, no `setup-go` on `unit`.
- rt code style: double quotes, semicolons, 2-space indent, `.ts` extensions in relative imports (see `scripts/check-docs.ts`). No em or en dashes anywhere. Comments state only what the code cannot show; no ticket ids or process history in code.
- Commit messages: `RT-305: <lowercase imperative subject>`, ending with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never start a daemon, never run a built `rt` binary, never touch the real `~/.mattstack`; `bun test` from the repo root is isolated by the preload.
- RT-309 (rt#473) must be merged before Task 2; Task 2 checks and stops otherwise.
- The static steps are proven on ubuntu by the PR's first run (Task 5, Step 3), not by a separate probe; a step that fails for a platform reason moves to a `static-macos` job that runs on every PR.
- Long commands (the serial suite, three sequential shards) run in the background with output redirected to a file; multi-line shell goes in a script under the scratch directory and runs as `bash <path>`.

## Review Focus

1. A PR that touches a Swift file a parity test reads (`rt-tray/Sources-core/Flavor/FlavorLaunch.swift`): it must be `full`, never `skip`. Task 1's test pins it with a synthetic source that names the file.
2. A PR that adds a Markdown file under `lib/__tests__/fixtures/`: `full`. Task 1's test pins it.
3. A PR that only changes `packages/rt-client/src/test-isolation.ts` (imported by the preload): `full`, because `--changed` selects nothing for it. Task 1's test pins it through the preload-import set.
4. A `scope` job that fails: `checks` must fail, not pass through a skipped `unit`. Task 3's aggregator step handles every result combination and Task 3 lists the truth table it was checked against.
5. Shard 1 in `changed` mode with an always-run list that resolves to a file that has been renamed: `bun test <missing path>` runs zero tests and exits 0, so the guard silently stops running. Task 1's test asserts every file the glob resolves to exists, and the glob is read from disk at run time, so a rename cannot leave a stale name.

---

### Task 1: `scripts/ci/test-scope.ts`

**Files:**
- Create: `scripts/ci/test-scope.ts`
- Create: `scripts/ci/__tests__/test-scope.test.ts`

**Interfaces:**
- Produces: `decide(input: ScopeInput): Decision` where `ScopeInput = { event: string; changed: string[]; sources: Map<string, string>; preloadImports: Set<string> }` and `Decision = { mode: "full" | "changed" | "skip"; reason: string }`; `unitDirs(pkg?): string[]`; `alwaysRun(): string[]`; `collectSources(): { sources: Map<string, string>; preloadImports: Set<string> }`. Run as a script it writes `mode=`, `dirs=` and `always=` lines to `$GITHUB_OUTPUT` (when set) and prints the decision and reason on stdout; `--explain` prints only.

- [ ] **Step 1: Write the failing tests**

Create `scripts/ci/__tests__/test-scope.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { alwaysRun, collectSources, decide, ROOT, unitDirs, type ScopeInput } from "../test-scope.ts";

// Synthetic unit test sources: one parity test that reads a Swift file and a
// tray shell script by path, and one plain test.
const sources = new Map<string, string>([
  [
    "lib/__tests__/dev-mode.test.ts",
    `const swift = readFileSync(join(ROOT, "rt-tray/Sources-core/Flavor/FlavorLaunch.swift"), "utf8");
     const build = readFileSync(join(ROOT, "rt-tray", "build.sh"), "utf8");`,
  ],
  ["lib/__tests__/plain.test.ts", `expect(add(1, 2)).toBe(3);`],
]);
const preloadImports = new Set(["packages/rt-client/src/test-isolation.ts", "lib/__tests__/home-env.ts"]);

function pr(changed: string[]): ScopeInput {
  return { event: "pull_request", changed, sources, preloadImports };
}

describe("decide", () => {
  test("a push is always full", () => {
    expect(decide({ ...pr(["docs/a.md"]), event: "push" }).mode).toBe("full");
  });

  test("docs nothing reads skip", () => {
    expect(decide(pr(["docs/architecture.md", "AGENTS.md"])).mode).toBe("skip");
  });

  test("swift nothing reads skips", () => {
    expect(decide(pr(["rt-tray/Sources-core/Tray/Menu.swift"])).mode).toBe("skip");
  });

  test("a swift file a parity test reads by path is full", () => {
    expect(decide(pr(["rt-tray/Sources-core/Flavor/FlavorLaunch.swift"])).mode).toBe("full");
  });

  test("a tray file a test reads by basename is full", () => {
    expect(decide(pr(["rt-tray/build.sh"])).mode).toBe("full");
  });

  test("a markdown fixture is full even when nothing names it", () => {
    expect(decide(pr(["lib/__tests__/fixtures/compile-native/pack/notes.md"])).mode).toBe("full");
  });

  test("a markdown file next to a typescript change is full", () => {
    expect(decide(pr(["README.md", "lib/x.ts"])).mode).toBe("full");
  });

  test("skills are never docs", () => {
    expect(decide(pr(["skills/rt-chat/notes.md"])).mode).toBe("full");
  });

  test("the stub-rt tree is typescript, not swift", () => {
    expect(decide(pr(["rt-tray/Tests/stub-rt/stub.ts"])).mode).toBe("changed");
  });

  test("a preload import is full", () => {
    expect(decide(pr(["packages/rt-client/src/test-isolation.ts"])).mode).toBe("full");
  });

  test("the preload itself and the scope script are full", () => {
    expect(decide(pr(["test-setup.ts"])).mode).toBe("full");
    expect(decide(pr(["scripts/ci/test-scope.ts"])).mode).toBe("full");
  });

  test("a shell script or json anywhere is full", () => {
    expect(decide(pr(["scripts/repo-purity.sh"])).mode).toBe("full");
    expect(decide(pr(["lib/__tests__/example.json", "lib/x.ts"])).mode).toBe("full");
  });

  test("typescript the import graph can see is changed", () => {
    expect(decide(pr(["lib/x.ts", "commands/y.ts"])).mode).toBe("changed");
  });

  test("every decision carries a reason", () => {
    for (const changed of [["docs/a.md"], ["lib/x.ts"], ["rt-tray/build.sh"]]) {
      expect(decide(pr(changed)).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("unitDirs", () => {
  test("parses the directory list from the test script", () => {
    expect(unitDirs({ scripts: { test: "bun test lib commands scripts" } })).toEqual(["lib", "commands", "scripts"]);
  });

  test("refuses a test script that is not a bare bun test run", () => {
    expect(() => unitDirs({ scripts: { test: "vitest run" } })).toThrow(/bare bun test/);
  });

  test("the real script parses and test:timings names the same directories", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const dirs = unitDirs(pkg);
    expect(dirs).toContain("lib");
    expect(dirs).toContain("commands");
    for (const dir of dirs) expect(pkg.scripts["test:timings"]).toContain(` ${dir}`);
  });
});

describe("alwaysRun", () => {
  test("resolves the scanner guards and every file exists", () => {
    const files = alwaysRun();
    for (const name of ["no-ui-in-cli", "no-eager-tui", "no-url-pathname", "no-top-level-await", "no-daemon-sync-exec"]) {
      expect(files).toContain(`lib/__tests__/${name}.test.ts`);
    }
    for (const f of files) expect(existsSync(join(ROOT, f))).toBe(true);
  });
});

describe("collectSources", () => {
  test("reaches the preload's imports and the tray parity reads, and leaves itself out", () => {
    const { sources, preloadImports } = collectSources();
    expect(preloadImports.has("packages/rt-client/src/test-isolation.ts")).toBe(true);
    expect(preloadImports.has("lib/__tests__/home-env.ts")).toBe(true);
    expect(sources.get("lib/__tests__/dev-mode.test.ts")).toContain("FlavorLaunch.swift");
    expect(sources.has("scripts/ci/__tests__/test-scope.test.ts")).toBe(false);
    expect(sources.has("commands/worktree.ts")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test scripts/ci/__tests__/test-scope.test.ts`
Expected: FAIL, `Cannot find module "../test-scope.ts"`.

- [ ] **Step 3: Write `scripts/ci/test-scope.ts`**

```ts
/**
 * Decides what the unit shards run for one CI event and prints the answer
 * for checks.yml. Usage:
 *   bun scripts/ci/test-scope.ts             writes mode=, dirs=, always= to $GITHUB_OUTPUT
 *   bun scripts/ci/test-scope.ts --explain   prints the decision and its reason only
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { basename, dirname, extname, join, relative, resolve } from "path";

export const ROOT = resolve(import.meta.dirname, "..", "..");

export type Mode = "full" | "changed" | "skip";
export type Decision = { mode: Mode; reason: string };
export type ScopeInput = {
  event: string;
  changed: string[];
  sources: Map<string, string>;
  preloadImports: Set<string>;
};

const PRELOAD = "test-setup.ts";

export function unitDirs(pkg: { scripts: Record<string, string> } = readPackage()): string[] {
  const script = pkg.scripts.test ?? "";
  const dirs = /^bun test ((?:[\w./-]+\s*)+)$/.exec(script)?.[1]?.trim();
  if (!dirs) throw new Error(`package.json test script is not a bare bun test run over directories: ${script}`);
  return dirs.split(/\s+/);
}

export function alwaysRun(): string[] {
  const dir = join(ROOT, "lib", "__tests__");
  return readdirSync(dir)
    .filter((f) => /^no-.*\.test\.ts$/.test(f))
    .map((f) => `lib/__tests__/${f}`)
    .sort();
}

function readPackage() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

function isDocs(f: string): boolean {
  return f.startsWith("docs/") || (f.endsWith(".md") && !f.startsWith("skills/"));
}

function isSwift(f: string): boolean {
  return (
    f.startsWith("rt-tray/") &&
    !f.startsWith("rt-tray/Tests/stub-rt/") &&
    !f.startsWith("rt-tray/vm/run/helpers/")
  );
}

function isFixture(f: string): boolean {
  return /(^|\/)(fixtures|__fixtures__)\//.test(f);
}

function readBy(sources: Map<string, string>, f: string): string | undefined {
  const name = basename(f);
  for (const [source, text] of sources) {
    if (text.includes(f) || text.includes(name)) return source;
  }
  return undefined;
}

function invisible(input: ScopeInput, f: string): string | undefined {
  if (extname(f) !== ".ts") return "not typescript";
  if (f === PRELOAD) return "the preload";
  if (input.preloadImports.has(f)) return "imported by the preload";
  if (isFixture(f)) return "a fixture";
  if (f.startsWith("scripts/ci/")) return "the scope script";
  return undefined;
}

export function decide(input: ScopeInput): Decision {
  if (input.event !== "pull_request") return { mode: "full", reason: `${input.event} is not a pull request` };

  const skippable = input.changed.every((f) => (isDocs(f) || isSwift(f)) && !isFixture(f));
  if (skippable) {
    const read = input.changed.map((f) => [f, readBy(input.sources, f)] as const).find(([, by]) => by);
    if (!read) return { mode: "skip", reason: "only docs or swift, none of it read by a unit test" };
    return { mode: "full", reason: `${read[0]} is read by ${read[1]}` };
  }

  for (const f of input.changed) {
    const why = invisible(input, f);
    if (why) return { mode: "full", reason: `${f} is ${why}, which --changed cannot see` };
  }
  return { mode: "changed", reason: "typescript only; --changed selects the importers" };
}

// The unit test sources: every test file under the unit directories plus
// the preload, and the relative imports both reach. String presence in
// this text is what "a test reads this file" means. scripts/ci is left
// out so this script's own test, which names files on purpose, never
// widens the read set.
export function collectSources(): { sources: Map<string, string>; preloadImports: Set<string> } {
  const preloadImports = walk([PRELOAD]);
  preloadImports.delete(PRELOAD);
  const roots = [PRELOAD];
  for (const dir of unitDirs()) roots.push(...testFiles(join(ROOT, dir)));
  const sources = new Map<string, string>();
  for (const rel of walk(roots)) sources.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  return { sources, preloadImports };
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

// Every file the roots reach through relative imports, roots included.
// Only TypeScript is scanned; a JSON or shell file that a test imports is
// kept as text but has no imports of its own. The shebang some command
// modules start with is not syntax the transpiler accepts.
function walk(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    seen.add(rel);
    if (!/\.tsx?$/.test(rel)) continue;
    const text = readFileSync(abs, "utf8").replace(/^#!.*/, "");
    const transpiler = rel.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const imp of transpiler.scanImports(text)) {
      if (!imp.path.startsWith(".")) continue;
      const target = relative(ROOT, resolve(dirname(abs), imp.path));
      const file = existsSync(join(ROOT, target)) && statSync(join(ROOT, target)).isFile() ? target : `${target}.ts`;
      if (existsSync(join(ROOT, file))) queue.push(file);
    }
  }
  return seen;
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const abs = join(dir, entry);
    if (relative(ROOT, abs) === "scripts/ci") continue;
    if (statSync(abs).isDirectory()) out.push(...testFiles(abs));
    else if (/\.test\.tsx?$/.test(entry)) out.push(relative(ROOT, abs));
  }
  return out;
}

function changedFiles(): string[] {
  const diff = spawnSync("git", ["diff", "--name-only", "HEAD^1", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
  return diff.stdout.split("\n").filter(Boolean);
}

if (import.meta.main) {
  const event = process.env.EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? "push";
  const changed = event === "pull_request" ? changedFiles() : [];
  const decision = decide({ event, changed, ...collectSources() });
  const dirs = unitDirs().join(" ");
  const always = alwaysRun().join(" ");
  console.log(`mode=${decision.mode} (${decision.reason})`);
  console.log(`dirs=${dirs}`);
  console.log(`always=${always}`);
  if (!process.argv.includes("--explain") && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${decision.mode}\ndirs=${dirs}\nalways=${always}\n`);
  }
}
```

- [ ] **Step 4: Add the `test:timings` script so the unitDirs test can compare against it**

In root `package.json` scripts, after `test:watch`, add (the directory list is the `test` script's, verbatim):

```json
"test:timings": "rm -f test-timings.json && bun test lib commands packages scripts rt-tray/Tests/stub-rt rt-tray/vm/run/helpers --timings=test-timings.json --update-timings",
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test scripts/ci/__tests__/test-scope.test.ts`
Expected: PASS, 19 tests. `collectSources` walks about 1,200 files in well under a second; say so in the report if it takes longer.

- [ ] **Step 6: Run the script against a real diff and prove `--changed` and `--shard` combine**

```bash
EVENT_NAME=pull_request bun scripts/ci/test-scope.ts --explain
```

Expected: `mode=skip (only docs or swift, none of it read by a unit test)`, because `HEAD^1..HEAD` is still the plan's docs commit at this point, followed by the `dirs=` and `always=` lines.

Then the combination check the spec asks for. Save this as a script in your scratch directory and run it with `bash <path>` (a worktree session's shell guard refuses compound commands typed inline), from the worktree root:

```bash
#!/usr/bin/env bash
set -u
repo=$(pwd)
tmp=$(mktemp -d)
git clone -q --shared "$repo" "$tmp/rt"
cd "$tmp/rt" || exit 1
ln -s "$repo/node_modules" node_modules
printf '\n' >> lib/worktree/hydrate.ts
git -c user.name=probe -c user.email=probe@example.invalid commit -qam probe
for i in 1 2 3; do
  bun test lib commands packages scripts --changed=HEAD^1 --shard="$i/3" > "$tmp/shard$i.log" 2>&1
  echo "shard $i exit=$? $(grep -E '^Ran ' "$tmp/shard$i.log")"
done
bun test lib commands packages scripts --changed=HEAD^1 > "$tmp/all.log" 2>&1
echo "unsharded exit=$? $(grep -E '^Ran ' "$tmp/all.log")"
cd "$repo" && rm -rf "$tmp"
```

Expected: the three sharded runs' file counts sum to the unsharded run's, and every `exit=` is 0. Paste the four lines into the report. If the harness refuses the commit inside the clone, report NEEDS_CONTEXT with the refusal text.

- [ ] **Step 7: Typecheck and commit**

```bash
bunx tsc --noEmit
git add scripts/ci package.json
git commit -m "RT-305: decide the unit test scope from the PR diff

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `test-timings.json`

**Files:**
- Create: `test-timings.json` (generated)

- [ ] **Step 0: Confirm RT-309 is in and rebase**

RT-309 (rt#473, the `process.exitCode` guard) must be merged before this task: without it a shard exits 1 with no failing test. Run `gh pr view 473 -R m4ttstack/rt --json state -q .state`; if it is not `MERGED`, stop and report BLOCKED. Then, as three separate commands: `git fetch origin`, `git rebase origin/main`, `bun install --frozen-lockfile`.

- [ ] **Step 1: Generate the file**

Run `bun run test:timings` in the background with its output redirected to a file in your scratch directory (the serial suite takes about 9 min, past the shell tool's limit), and read the file when it finishes. Expected: exit 0 (RT-302, RT-303 and RT-309 are merged, so the suite should be green; a failure in a file unrelated to this branch is a pre-existing bug to report, not to fix here). `test-timings.json` appears with `"version": 1` and one entry per test file.

- [ ] **Step 2: Record the shard balance**

Save as a script in your scratch directory and run it from the worktree root in the background with output to a file; `$SCRATCH` is your scratch directory, so the per-shard logs never land in the worktree:

```bash
#!/usr/bin/env bash
for i in 1 2 3; do
  start=$(date +%s)
  bun test lib commands packages scripts rt-tray/Tests/stub-rt rt-tray/vm/run/helpers --shard="$i/3" --timings=test-timings.json > "$SCRATCH/shard$i.log" 2>&1
  echo "shard $i exit=$? $(( $(date +%s) - start ))s $(grep -E '^Ran ' "$SCRATCH/shard$i.log")"
done
```

Expected: three times within about a minute of each other, every exit 0. Paste the three lines into the report; they are the baseline the spec's "refresh when they drift more than a minute apart" rule compares against.

- [ ] **Step 3: Commit**

```bash
git add test-timings.json
git commit -m "RT-305: commit the per-file timings the shards balance on

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `checks.yml`

**Files:**
- Modify: `.github/workflows/checks.yml` (rewrite below the `concurrency:` block)

**Interfaces:**
- Consumes: `scripts/ci/test-scope.ts` outputs `mode`, `dirs`, `always`; `test-timings.json`.

- [ ] **Step 1: Rewrite the jobs**

Keep `name:`, `on:` and `concurrency:` exactly as they are. Replace everything from the `# macos-latest, matching e2e.yml` comment down with:

```yaml
jobs:
  # What this event's unit shards run: full, changed (--changed=HEAD^1) or
  # skip. On a pull request every job checks out refs/pull/N/merge, whose
  # first parent is the base tip, so HEAD^1..HEAD is exactly the PR's diff.
  scope:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      mode: ${{ steps.scope.outputs.mode }}
      dirs: ${{ steps.scope.outputs.dirs }}
      always: ${{ steps.scope.outputs.always }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - id: scope
        env:
          EVENT_NAME: ${{ github.event_name }}
        run: bun scripts/ci/test-scope.ts

  # Everything that does not need a Mac. A step that turns out to need one
  # moves to a static-macos job that runs on every PR, never into unit.
  static:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - uses: actions/setup-go@v5
        with:
          go-version-file: ui/go.mod
          cache-dependency-path: ui/go.sum

      - name: Install dependencies
        run: bun install --frozen-lockfile

      # --frozen-lockfile passes a stale workspace package version, which every
      # worktree's ready-step install then rewrites and leaves as dirt.
      - name: Lockfile in sync
        run: bun install && git diff --exit-code -- bun.lock

      - name: Typecheck
        run: bunx tsc --noEmit

      # release.yml is grandfathered out of the lint: it carries pre-existing
      # shellcheck findings whose quoting is tangled with the release flow.
      # Lint it the day it is next edited, not from this gate.
      - name: Workflow lint
        run: |
          bash <(curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/v1.7.12/scripts/download-actionlint.bash) 1.7.12 "$RUNNER_TEMP"
          "$RUNNER_TEMP/actionlint" .github/workflows/bundle-apps.yml .github/workflows/checks.yml .github/workflows/e2e.yml .github/workflows/purity.yml .github/workflows/renovate.yml

      # The Go helper's own vet + tests, plus the shared protocol fixtures
      # both languages golden-test (lib/ui/__tests__/protocol.test.ts runs
      # in the unit shards).
      - name: rt-ui vet and tests
        run: bun run ui:test

      # Drift here is invisible until someone runs it by hand, which is how
      # two commands reached main with no reference page.
      - name: Command reference is in sync
        run: bun run docs:check

      # Every leaf that requires a positional must declare how it behaves when
      # the arg is omitted (picker/list/prompt or an explicit exempt). A new
      # command that just errors on a missing arg fails here, not in review.
      - name: Picker convention is enforced
        run: bun run picker:check

  # macos-latest, matching e2e.yml: much of the tree is macOS-specific (launchd
  # labels, TCC, codesign, ~/Library paths) and the bunfig preload that isolates
  # HOME for tests is exercised the same way developers run it locally.
  unit:
    needs: scope
    if: needs.scope.outputs.mode != 'skip'
    runs-on: macos-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    env:
      HOMEBREW_NO_AUTO_UPDATE: "1"
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2

      - name: Install backup dependencies
        run: brew install age zstd git-lfs

      - name: Install dependencies
        run: bun install --frozen-lockfile

      # The always-run guards read source as text, so --changed never selects
      # them; path arguments intersect with --changed, so they need their own
      # call, and one shard is enough.
      - name: Unit tests, shard ${{ matrix.shard }} of 3
        env:
          MODE: ${{ needs.scope.outputs.mode }}
          DIRS: ${{ needs.scope.outputs.dirs }}
          ALWAYS: ${{ needs.scope.outputs.always }}
          SHARD: ${{ matrix.shard }}
        run: |
          # An empty list would make bun test run every file in the repo,
          # e2e included; fail loudly instead.
          [ -n "$DIRS" ] || { echo "scope produced no unit directories"; exit 1; }
          start=$(date +%s)
          changed=""
          if [ "$MODE" = changed ]; then changed="--changed=HEAD^1"; fi
          # shellcheck disable=SC2086
          bun test $DIRS --shard="$SHARD/3" --timings=test-timings.json $changed
          if [ "$MODE" = changed ] && [ "$SHARD" = 1 ]; then
            [ -n "$ALWAYS" ] || { echo "scope produced no always-run guards"; exit 1; }
            # shellcheck disable=SC2086
            bun test $ALWAYS
          fi
          echo "shard $SHARD: $(( $(date +%s) - start ))s ($MODE)"

  # The job branch protection requires. always() is what lets a skipped unit
  # count: a required check that never runs reads as passing.
  checks:
    needs: [scope, static, unit]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Every gate passed
        env:
          SCOPE: ${{ needs.scope.result }}
          STATIC: ${{ needs.static.result }}
          UNIT: ${{ needs.unit.result }}
          MODE: ${{ needs.scope.outputs.mode }}
        run: |
          echo "scope=$SCOPE static=$STATIC unit=$UNIT mode=$MODE"
          [ "$SCOPE" = success ] || { echo "scope did not succeed"; exit 1; }
          [ "$STATIC" = success ] || { echo "static did not succeed"; exit 1; }
          [ "$UNIT" = success ] && exit 0
          [ "$UNIT" = skipped ] && [ "$MODE" = skip ] && exit 0
          echo "unit was $UNIT with mode $MODE"
          exit 1
```

Truth table the aggregator was written against (result of `checks`):

| scope | static | unit | mode | checks |
| --- | --- | --- | --- | --- |
| success | success | success | any | pass |
| success | success | skipped | skip | pass |
| success | success | skipped | full or changed | fail (unit was skipped for another reason) |
| success | success | failure or cancelled | any | fail |
| success | failure | any | any | fail |
| failure or cancelled | any | skipped | none | fail |

- [ ] **Step 2: Lint**

Run: `actionlint .github/workflows/checks.yml` (installed locally at `/opt/homebrew/bin/actionlint`).
Expected: no output. The `# shellcheck disable=SC2086` comments cover the intentional word splitting of `$DIRS`, `$ALWAYS` and `$changed`.

- [ ] **Step 3: Check the required check name**

Run: `gh api repos/m4ttstack/rt/branches/main/protection/required_status_checks -q '.contexts[]'`
Expected: `checks`, `e2e`, `purity`, unchanged. The aggregator job is named `checks`, so nothing needs editing there.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/checks.yml
git commit -m "RT-305: split checks into static, three unit shards and an aggregator

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Docs

**Files:**
- Modify: `AGENTS.md` (the "`bun run test` is one of three suites, and CI runs all three" footgun)

- [ ] **Step 1: Add the CI shape to the footgun**

After the paragraph that ends "and the difference is invisible in the output.", add:

```markdown
CI runs the unit suite as three macOS shards (`bun test --shard=i/3
--timings=test-timings.json`, balanced by the committed timings file;
`bun run test:timings` refreshes it) and runs the non-Mac gates on ubuntu.
`scripts/ci/test-scope.ts` decides a PR's scope from its diff: only docs or
Swift that no unit test reads skips the shards; a TypeScript-only diff runs
`--changed=HEAD^1` plus the `lib/__tests__/no-*.test.ts` guards; a change to
anything else a test reads (a shell script, a fixture, the preload or its
imports) runs the full suite. A test that spawns `cli.ts` or reads source as
text is not selected by `--changed`; it runs on main, so a TypeScript-only PR
can go green and break main there.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "RT-305: describe the sharded, scoped unit suite in the footgun

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: PR and acceptance measurements

**Files:** none (GitHub only).

- [ ] **Step 1: Rebase, full local run, push**

Run these one at a time (a worktree session's shell guard refuses chained commands):

```bash
git fetch origin
git rebase origin/main
bun install --frozen-lockfile
bun install
git diff --exit-code -- bun.lock
bun test scripts/ci/__tests__/test-scope.test.ts
git push -u origin rt-305-ci-shards
```

- [ ] **Step 2: Open the PR**

Title `RT-305: shard the unit suite, run only changed tests on PRs`. Body in lowercase sparse prose: two framing sentences, a `what changed` list (scope script and its rules, the timings file, the four jobs, the aggregator, the AGENTS.md note), a `verification` line with Task 1's four `Ran` lines and Task 2's three shard times, and the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Static on ubuntu, first run**

The PR's own diff touches `.github/workflows/checks.yml` and `scripts/ci/**`, so `scope` says `full`. Watch the first run: every `static` step must be green on ubuntu. A step that fails for a platform reason (not a real finding) moves to a new `static-macos` job that runs on every PR, with a comment naming the reason, and `checks` gains it in `needs:` and in its pass condition. Record which, if any.

- [ ] **Step 4: Record the full run**

From `gh run view <id> --json jobs`, record `checks`' wall time from the earliest job start to the aggregator's end, and each shard's printed `shard N: Ns` line. Expected: about 3 min end to end; shards within a minute of each other.

- [ ] **Step 5: Record a TypeScript-only PR**

Both throwaway PRs branch from `rt-305-ci-shards` and target it (`gh pr create --base rt-305-ci-shards`): a PR against `main` would run the old workflow, and one carrying the feature diff would always be `full`. `on: pull_request` has no branch filter, so the new workflow runs on them.

Open a throwaway PR with one trailing-newline change in `lib/worktree/hydrate.ts`, wait for `checks`, record its wall time and shard 1's second `bun test` line (the guards), then close it and delete the branch. Expected: under 2 min; `scope` prints `mode=changed`.

- [ ] **Step 6: Record a tray-only PR**

Open a throwaway PR, base `rt-305-ci-shards`, with one comment change in a Swift file no test reads (pick one `EVENT_NAME=pull_request bun scripts/ci/test-scope.ts --explain` reports as `skip` after committing the change locally), wait for `checks`, confirm `unit` shows as skipped and `checks` passed, then close it and delete the branch.

- [ ] **Step 7: Merge and close the ticket**

After review and a green run, merge with Matt's confirmation. Paste the three measurements and the static-on-ubuntu result into RT-305 and mark it Done. If a target is missed, leave the ticket open with the number and the likely cause (an unbalanced timings file, brew install time, or a slow `bun install` on macOS).
