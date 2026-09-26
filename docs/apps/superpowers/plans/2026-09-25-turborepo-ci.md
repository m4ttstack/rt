# Turborepo CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every gate in this repo run through Turborepo, cached and in parallel, with PRs running only the packages they affect.

**Architecture:** `turbo.json` declares per-package tasks (`build`, `build:binary`, `typecheck`, `lint`, `test`, `serve-check`, `gates`, `browsers`) and registered root tasks; `scripts/turbo.sh` is the one entry point, pointing turbo's cache at the repo's common git dir and expanding a `check` mode that runs the two codegen gates alone, then the package gates, then the root gates. `ci.yml` calls `check --affected` on PRs and `check` on main. Root scripts become turbo-backed; the `<app>:<task>` aliases stay.

**Tech Stack:** Bun 1.4.2 workspaces, Turborepo 2.11.4, vitest 4, bun test, GitHub Actions (`actions/cache@v4`).

**Spec:** `docs/superpowers/specs/2026-09-25-turborepo-ci-design.md`

## Global Constraints

- Turbo is a root devDependency pinned to `2.11.4`; never `bunx turbo@latest`.
- `setup-bun` stays pinned to `1.4.2` in both CI jobs.
- Env mode is turbo's strict default; only `CI` passes through globally.
- The cache directory is `$(git rev-parse --path-format=absolute --git-common-dir)/turbo-cache`, nowhere else.
- Package scripts named `test` must exit (no watch mode): `vitest run`, never bare `vitest`.
- Every `serve-check` server runs under `env -i HOME=<scratch dir> PATH=$PATH PORT=<port>`; nothing in this plan touches the developer's real `~/.mattstack`.
- A package with no script for a task still runs that task's same-package `dependsOn`, so a generic task definition never carries a `dependsOn` that only some packages should pay for.
- `$TURBO_ROOT$` input globs ignore `.gitignore`; every task that uses one carries the negations `!$TURBO_ROOT$/**/node_modules/**`, `!$TURBO_ROOT$/**/.turbo/**`, `!$TURBO_ROOT$/**/dist/**`, `!$TURBO_ROOT$/**/dist-bin/**`. `$TURBO_ROOT$/**` is never used.
- Comments in code state only what the code cannot show. No ticket ids, no process history, no narration.
- No em dashes or en dashes anywhere (code, docs, commits, PR body), and none of the phrases the global writing rules ban.
- Commit messages: lowercase imperative subject, ending with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Prettier formats `turbo.json` and every new `.ts` file; run `bun run format` before each commit.

## Review Focus

1. A test that reads files outside its own package but declares no `$TURBO_ROOT$` inputs: turbo would serve a stale cache hit after the other package changes. Task 3 adds `scripts/__tests__/turbo-inputs.test.ts`, which fails for any test file resolving three levels up without a matching `inputs` entry.
2. A PR that touches only a root config (`eslint.config.js`, `.prettierrc`, `tsconfig.tools.json`, `bunfig.toml`): every package task must miss its cache. Task 3's graph test asserts those files sit in `globalCacheInputs.files`.
3. A PR touching only `apps/board`: `--affected` must still run the root gates (purity, format) and the tokens suite, which turbo's package graph does not consider affected. Task 4's `check` mode runs them in a third invocation with `--filter=//` and `--filter=@mattstack/tokens`, and its test pins that.
4. `check` on a Linux runner must never schedule `deck#test` (macOS-only `plutil`/`launchd`), while a Mac keeps running it. Task 4's test drives `scripts/turbo.sh` with a fake `uname` on PATH.
5. The two codegen gates (`@mattstack/tui-kit#gates`, `//#tokens:fresh`) rewrite files that tokens' and tui-kit's tests read. Task 4 runs them in their own serial invocation before anything else; its test pins that ordering.

---

### Task 1: Turbo dependency and the package task graph

**Files:**
- Modify: `package.json` (root): add `packageManager`, `turbo` devDependency, `scripts:test` script
- Create: `turbo.json`
- Modify: `.gitignore`: add `.turbo`
- Create: `scripts/__tests__/helpers.ts`, `scripts/__tests__/turbo-graph.test.ts`

**Interfaces:**
- Produces: `turbo.json` tasks `build`, `build:binary`, `typecheck`, `lint`, `test`; the root script `scripts:test` (`bun test ./scripts`, the `./` matters: a bare `scripts` is a substring filter that also matches `apps/board/skills/*/scripts/`); the helper module `scripts/__tests__/helpers.ts` exporting `ROOT`, `TURBO`, `DryRun`, `dryRun(args, env?)` and `realIds(run)`. Every later test file imports from it; a test file must never import another test file, or bun registers its tests twice.

- [ ] **Step 1: Install turbo and declare the package manager**

```bash
bun add -d turbo@2.11.4
```

Then in root `package.json`, next to `"private": true`, add:

```json
"packageManager": "bun@1.4.2",
```

and in `scripts` add:

```json
"scripts:test": "bun test ./scripts",
```

Append to `.gitignore`:

```
.turbo
```

- [ ] **Step 2: Write the helper module and the failing graph test**

Create `scripts/__tests__/helpers.ts`:

```ts
import { join } from 'path';

export const ROOT = join(import.meta.dirname, '..', '..');
export const TURBO = join(ROOT, 'node_modules', '.bin', 'turbo');

export type DryRun = {
  packages: string[];
  globalCacheInputs: { files: Record<string, string> };
  tasks: Array<{
    taskId: string;
    package: string;
    task: string;
    command: string;
    dependencies: string[];
    inputs?: Record<string, string>;
    cache: { status: string };
    resolvedTaskDefinition?: { cache?: boolean };
  }>;
};

export function dryRun(args: string[], env: Record<string, string> = {}): DryRun {
  const proc = Bun.spawnSync([TURBO, 'run', ...args, '--dry=json'], {
    cwd: ROOT,
    env: { ...process.env, ...env, TURBO_TELEMETRY_DISABLED: '1' },
  });
  const out = proc.stdout.toString();
  if (proc.exitCode !== 0) throw new Error(`turbo failed: ${proc.stderr.toString()}\n${out}`);
  return JSON.parse(out.slice(out.indexOf('{'))) as DryRun;
}

// A package with no script for a requested task is still listed, with the
// command `<NONEXISTENT>`; only the tasks that will actually execute count.
export function realIds(run: DryRun): string[] {
  return run.tasks
    .filter((t) => t.command !== '<NONEXISTENT>')
    .map((t) => t.taskId)
    .sort();
}
```

Create `scripts/__tests__/turbo-graph.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT, dryRun, type DryRun } from './helpers.ts';

const byId = (run: DryRun) => new Map(run.tasks.map((t) => [t.taskId, t]));

describe('turbo task graph', () => {
  test('board and deck tests build tui-kit first', () => {
    const tasks = byId(dryRun(['test', '--filter=board', '--filter=deck']));
    expect(tasks.get('board#test')?.dependencies).toContain('@mattstack/tui-kit#build');
    expect(tasks.get('deck#test')?.dependencies).toContain('@mattstack/tui-kit#build');
  });

  test('typecheck depends on dependency builds', () => {
    const tasks = byId(dryRun(['typecheck', '--filter=board']));
    expect(tasks.get('board#typecheck')?.dependencies).toContain('@mattstack/tui-kit#build');
  });

  test('build:binary runs after the package build', () => {
    const tasks = byId(dryRun(['build:binary', '--filter=mattstack-console']));
    expect(tasks.get('mattstack-console#build:binary')?.dependencies).toContain(
      'mattstack-console#build'
    );
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `bun test ./scripts/__tests__/turbo-graph.test.ts`
Expected: FAIL. turbo exits non-zero with "Could not find turbo.json".

- [ ] **Step 4: Write `turbo.json`**

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalDependencies": [
    "tsconfig.tools.json",
    ".prettierrc",
    "bunfig.toml",
    "eslint.config.js"
  ],
  "globalPassThroughEnv": ["CI"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "build:binary": {
      "dependsOn": ["build"],
      "outputs": ["dist/**", "dist-bin/**", "src/server/embedded/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

`build:binary` depends on the package's own `build` (not just `^build`) because both write `dist/`; serialising them is what stops a race between them.

- [ ] **Step 5: Run the test to see it pass**

Run: `bun test ./scripts/__tests__/turbo-graph.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Prove the graph resolves for every package**

Run: `node_modules/.bin/turbo run test typecheck lint build --dry=json | jq -r '.tasks[] | select(.command != "<NONEXISTENT>") | .taskId' | sort`
Expected: about 30 task ids, including `@mattstack/tui-kit#build`, `board#test`, `deck#test`, `workshop#build`, and no error.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add package.json bun.lock turbo.json .gitignore scripts/__tests__
git commit -m "turbo: add task graph and pin turbo 2.11.4

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Package scripts that mean the same thing locally and in CI

**Files:**
- Modify: `packages/ui/package.json`, `packages/server/package.json`, `apps/chat/package.json`, `apps/console/package.json` (`test` and `test:watch`)
- Modify: `packages/tui-kit/package.json` (`test`, `test:oracles`, `browsers`)
- Modify: `apps/chat/package.json`, `apps/console/package.json`, `apps/boxscore/package.json` (`serve-check`)
- Create: `apps/chat/scripts/serve-check.sh`, `apps/console/scripts/serve-check.sh`
- Modify: `turbo.json` (per-package overrides: `serve-check`, `browsers`, `gates`)
- Modify: `scripts/__tests__/turbo-graph.test.ts` (new cases)

**Interfaces:**
- Consumes: `dryRun`, `realIds` from Task 1.
- Produces: package tasks `serve-check` (chat, mattstack-console, boxscore), `browsers` and `gates` (`@mattstack/tui-kit`). `serve-check` scripts honour `GATE_PORT` and default to 11123 (chat), 11099 (console), 11097 (boxscore).

- [ ] **Step 1: Write the failing graph tests**

Append to `scripts/__tests__/turbo-graph.test.ts` inside the `describe` (and add `realIds` to the helpers import):

```ts
  test('serve-check waits for the artifact it serves, and only where the script exists', () => {
    const run = dryRun(['serve-check']);
    const tasks = byId(run);
    expect(realIds(run)).toEqual([
      'boxscore#build', 'boxscore#build:binary', 'boxscore#serve-check',
      'chat#build', 'chat#serve-check',
      'mattstack-console#build', 'mattstack-console#build:binary', 'mattstack-console#serve-check',
    ]);
    expect(tasks.get('chat#serve-check')?.dependencies).toContain('chat#build');
    expect(tasks.get('mattstack-console#serve-check')?.dependencies).toContain(
      'mattstack-console#build:binary'
    );
    expect(tasks.get('boxscore#serve-check')?.dependencies).toContain('boxscore#build:binary');
  });

  test('tui-kit tests install browsers first, and the install is never cached', () => {
    const tasks = byId(dryRun(['test', '--filter=@mattstack/tui-kit']));
    expect(tasks.get('@mattstack/tui-kit#test')?.dependencies).toContain(
      '@mattstack/tui-kit#browsers'
    );
    expect(tasks.get('@mattstack/tui-kit#browsers')?.resolvedTaskDefinition?.cache).toBe(false);
  });

  test('every vitest test script runs once and exits', () => {
    const glob = new Bun.Glob('{apps,packages}/*/package.json');
    for (const file of glob.scanSync(ROOT)) {
      const pkg = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
      const script: string | undefined = pkg.scripts?.test;
      if (!script || !script.includes('vitest')) continue;
      expect(script, `${file} test script`).toMatch(/vitest run\b/);
    }
  });
```

The first case's exact list is the point: nothing but the three packages that own a `serve-check` script may build when the task is requested.

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test ./scripts/__tests__/turbo-graph.test.ts`
Expected: FAIL. `realIds` is empty (no package has a `serve-check` script yet), `@mattstack/tui-kit#browsers` is absent, and `packages/ui/package.json test script` does not match `vitest run`.

- [ ] **Step 3: Fix the `test` scripts**

In `packages/ui/package.json`, `packages/server/package.json`, `apps/chat/package.json` and `apps/console/package.json`, change:

```json
"test": "vitest",
```

to:

```json
"test": "vitest run",
"test:watch": "vitest",
```

In `packages/tui-kit/package.json`, replace `"test": "vitest run",` with:

```json
"test": "vitest run --project node && vitest run --project browser --exclude '**/*.visual.test.tsx' --exclude '**/*.parity.test.tsx'",
"test:oracles": "vitest run --project browser .visual.test.tsx .parity.test.tsx",
"browsers": "bunx playwright install chromium",
```

The visual and parity suites are recorded against one local Chrome, so they stay out of `test` until CI-recorded baselines exist; `test:oracles` is the local way to run them. Its filters are substrings, not globs: vitest's positional file filters do substring matching, so a `**/*.visual.test.tsx` glob would match nothing.

- [ ] **Step 4: Write chat's serve-check script**

Create `apps/chat/scripts/serve-check.sh` (make it executable with `chmod +x`):

```bash
#!/usr/bin/env bash
# Serves the built client and proves /api is not swallowed by the SPA
# fallback: an unmatched /api route must stay a JSON 404, since an RPC
# client checks res.ok and would otherwise throw parsing HTML.
set -euo pipefail

app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
port=${GATE_PORT:-11123}
base="http://127.0.0.1:$port"

say() { echo "serve-check: $*" >&2; }

[ -d "$app_dir/dist" ] || { say "$app_dir/dist is missing; run bun run build first"; exit 1; }
if curl -s -m 1 -o /dev/null "$base/"; then
  say "port $port already answers; set GATE_PORT to a free port"
  exit 1
fi

work=$(mktemp -d)
mkdir -p "$work/home"
server=""
cleanup() {
  if [ -n "$server" ]; then
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  say "$*"
  if [ -f "$work/server.log" ]; then sed 's/^/  server: /' "$work/server.log" >&2; fi
  exit 1
}

# env -i: the server reads and writes the settings store under HOME.
(cd "$app_dir" && exec env -i HOME="$work/home" PATH="$PATH" PORT="$port" bun src/server/index.ts) > "$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 30); do
  curl -fsS -m 1 -o /dev/null "$base/api/health" 2>/dev/null && break
  kill -0 "$server" 2>/dev/null || fail "server exited before answering /api/health"
  sleep 1
done
curl -fsS -m 5 -o /dev/null "$base/api/health" || fail "never answered /api/health"

code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$base$1"; }
ctype() { curl -s -m 5 -o /dev/null -w '%{content_type}' "$base$1"; }

[ "$(code /)" = 200 ] || fail "/ answered $(code /)"
[ "$(ctype /)" = "text/html; charset=utf-8" ] || fail "/ is $(ctype /), not the built index"
index=$(curl -fsS -m 5 "$base/")
re_js='(/assets/[^"]+\.js)'
[[ $index =~ $re_js ]] || fail "index.html references no /assets/*.js"
[ "$(code "${BASH_REMATCH[1]}")" = 200 ] || fail "${BASH_REMATCH[1]} answered $(code "${BASH_REMATCH[1]}")"
[ "$(code /api/does-not-exist)" = 404 ] || fail "/api/does-not-exist was swallowed by the SPA fallback"
[ "$(ctype /api/does-not-exist)" = "application/json" ] || fail "the /api 404 is $(ctype /api/does-not-exist), not JSON"

say "chat serves the built client and keeps /api out of the SPA fallback"
```

- [ ] **Step 5: Write console's serve-check script**

Create `apps/console/scripts/serve-check.sh` (executable):

```bash
#!/usr/bin/env bash
# console ships a self-contained binary; the only honest test is to run it
# where dist/ is not: a binary built without the codegen step falls back to
# disk mode and 404s every page, which passes silently anywhere the source
# tree happens to sit next to it.
set -euo pipefail

app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin="$app_dir/dist-bin/console"
port=${GATE_PORT:-11099}
base="http://127.0.0.1:$port"
hidden="$app_dir/dist-bin/dist-hidden"

say() { echo "serve-check: $*" >&2; }

[ -x "$bin" ] || { say "$bin is missing; run bun run build:binary first"; exit 1; }
[ ! -e "$hidden" ] || { say "$hidden is left from an interrupted run; move it back to $app_dir/dist"; exit 1; }
if curl -s -m 1 -o /dev/null "$base/"; then
  say "port $port already answers; set GATE_PORT to a free port"
  exit 1
fi

work=$(mktemp -d)
mkdir -p "$work/home"
moved=0
server=""
cleanup() {
  if [ -n "$server" ]; then
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
  fi
  if [ "$moved" = 1 ]; then mv "$hidden" "$app_dir/dist"; fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  say "$*"
  if [ -f "$work/server.log" ]; then sed 's/^/  server: /' "$work/server.log" >&2; fi
  exit 1
}

cp "$bin" "$work/console"
if [ -d "$app_dir/dist" ]; then
  mv "$app_dir/dist" "$hidden"
  moved=1
fi

# env -i: on boot the binary writes rt.notify.eventBridges to the user
# settings store under HOME.
(cd "$work" && exec env -i HOME="$work/home" PATH="$PATH" PORT="$port" ./console) > "$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 30); do
  curl -fsS -m 1 -o /dev/null "$base/api/health" 2>/dev/null && break
  kill -0 "$server" 2>/dev/null || fail "binary exited before answering /api/health"
  sleep 1
done
curl -fsS -m 5 -o /dev/null "$base/api/health" || fail "never answered /api/health"

code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$base$1"; }
ctype() { curl -s -m 5 -o /dev/null -w '%{content_type}' "$base$1"; }

[ "$(code /)" = 200 ] || fail "/ answered $(code /); the embedded index is missing"
[ "$(code /search)" = 200 ] || fail "/search answered $(code /search)"
index=$(curl -fsS -m 5 "$base/")
re_js='(/assets/[^"]+\.js)'
re_css='(/assets/[^"]+\.css)'
re_font='(/assets/[^)"]+\.woff2)'
[[ $index =~ $re_js ]] || fail "index.html references no /assets/*.js"
[ "$(code "${BASH_REMATCH[1]}")" = 200 ] || fail "${BASH_REMATCH[1]} answered $(code "${BASH_REMATCH[1]}")"
[[ $index =~ $re_css ]] || fail "index.html references no /assets/*.css"
css=$(curl -fsS -m 5 "$base${BASH_REMATCH[1]}") || fail "the stylesheet did not load"
# The font ships inside @mattstack/mantine-tokyo, so Vite emits it as a
# content-hashed /assets/ URL; assert the content type, not just the status,
# because a catch-all can answer any path with 200.
[[ $css =~ $re_font ]] || fail "the stylesheet references no /assets/*.woff2"
font=${BASH_REMATCH[1]}
[ "$(code "$font")" = 200 ] || fail "$font answered $(code "$font")"
[ "$(ctype "$font")" = "font/woff2" ] || fail "$font is $(ctype "$font"), not font/woff2"

say "console's binary serves its own assets with no source tree"
```

`dist-hidden` lives under `dist-bin/`, which is gitignored, so an interrupted run cannot leave minified files where prettier or turbo's input hashing would see them.

- [ ] **Step 6: Wire the `serve-check` scripts**

`apps/chat/package.json` scripts, add:

```json
"serve-check": "bash scripts/serve-check.sh",
```

`apps/console/package.json` scripts, add the same line.

`apps/boxscore/package.json` scripts, add:

```json
"serve-check": "bash scripts/binary-gate.sh",
```

(`binary-gate.sh` keeps its name and already runs the binary under `env -i HOME=...`.)

- [ ] **Step 7: Add the per-package overrides to `turbo.json`**

Inside `"tasks"`, after `"test"`:

```json
    "serve-check": {},
    "chat#serve-check": {
      "dependsOn": ["build"]
    },
    "mattstack-console#serve-check": {
      "dependsOn": ["build:binary"]
    },
    "boxscore#serve-check": {
      "dependsOn": ["build:binary"]
    },
    "@mattstack/tui-kit#browsers": {
      "cache": false
    },
    "@mattstack/tui-kit#test": {
      "dependsOn": ["^build", "browsers"]
    },
    "@mattstack/tui-kit#gates": {
      "dependsOn": ["^build"]
    }
```

The generic `serve-check` has no `dependsOn` on purpose: a package with no `serve-check` script would still run a generic `dependsOn: ["build"]`, so every package (board's compile, workshop's vite build, deck's compile) would build on every `check`.

- [ ] **Step 8: Run the graph tests**

Run: `bun test ./scripts/__tests__/turbo-graph.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Run the three serve-checks for real**

```bash
node_modules/.bin/turbo run serve-check --output-logs=new-only
```

Expected: exactly the eight tasks from Step 1's list run (chat build; console build and build:binary; boxscore build and build:binary; three serve-checks), ending in three `serves ...` lines. Then verify the two refusals by hand:

```bash
mkdir -p apps/console/dist-bin/dist-hidden && bash apps/console/scripts/serve-check.sh; echo "exit=$?"; rmdir apps/console/dist-bin/dist-hidden
```

Expected: `serve-check: .../dist-bin/dist-hidden is left from an interrupted run ...` and `exit=1`, and `apps/console/dist` still present.

```bash
bun -e 'Bun.serve({ port: 11123, fetch: () => new Response("") }); setTimeout(() => {}, 60000)' &
sleep 1; bash apps/chat/scripts/serve-check.sh; echo "exit=$?"; kill $!
```

Expected: `serve-check: port 11123 already answers ...` and `exit=1`. Any listener will do for this check; starting chat itself from source would run it under the real HOME, which the constraints forbid.

- [ ] **Step 10: Run tui-kit's split test once**

Run: `node_modules/.bin/turbo run test --filter=@mattstack/tui-kit --output-logs=new-only`
Expected: `browsers` runs (fast when Chromium is present), then the node project and the browser project pass with the visual and parity files excluded (the log lists the files it ran; none end in `.visual.test.tsx` or `.parity.test.tsx`).

- [ ] **Step 11: Format and commit**

```bash
bun run format
git add turbo.json packages/ui/package.json packages/server/package.json packages/tui-kit/package.json apps/chat apps/console apps/boxscore/package.json scripts/__tests__/turbo-graph.test.ts
git commit -m "turbo: serve-check tasks, browser install task, non-watch test scripts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Root tasks and cross-package inputs

**Files:**
- Modify: `package.json` (root): `lint:root`, `tokens:fresh`, `purity` scripts
- Modify: `turbo.json`: root tasks and `@mattstack/tokens#test` inputs
- Modify: `scripts/__tests__/turbo-graph.test.ts` (new cases)
- Create: `scripts/__tests__/turbo-inputs.test.ts`

**Interfaces:**
- Consumes: `dryRun`, `realIds`, `ROOT` from Task 1.
- Produces: root tasks `//#lint:root`, `//#format:check`, `//#tokens:fresh`, `//#build-storybook`, `//#treeshake`, `//#purity`, `//#scripts:test`; the tokens inputs list. The root eslint script is renamed `lint:root` here (the root `lint` script becomes turbo-backed in Task 4 and would otherwise recurse into itself).

- [ ] **Step 1: Write the failing graph tests**

Append to the `describe` in `scripts/__tests__/turbo-graph.test.ts`:

```ts
  test('root gates are registered root tasks', () => {
    const run = dryRun([
      'lint:root', 'format:check', 'tokens:fresh', 'build-storybook', 'treeshake', 'purity',
      'scripts:test', '--filter=//',
    ]);
    expect(realIds(run)).toEqual([
      '//#build-storybook', '//#format:check', '//#lint:root', '//#purity', '//#scripts:test',
      '//#tokens:fresh', '//#treeshake', '@mattstack/tui-kit#build',
    ]);
  });

  test('root configs are global cache inputs', () => {
    const files = Object.keys(dryRun(['lint:root', '--filter=//']).globalCacheInputs.files);
    for (const f of ['tsconfig.tools.json', '.prettierrc', 'bunfig.toml', 'eslint.config.js']) {
      expect(files).toContain(f);
    }
  });

  test('the tokens suite hashes the trees it reads from disk', () => {
    // Dry-run input keys are relative to the package, so packages/ui/src
    // appears as ../ui/src from packages/tokens.
    const task = byId(dryRun(['test', '--filter=@mattstack/tokens'])).get('@mattstack/tokens#test');
    const inputs = Object.keys(task?.inputs ?? {});
    expect(inputs.some((f) => f.startsWith('../ui/src/'))).toBe(true);
    expect(inputs.some((f) => f.startsWith('../tokyo/src/'))).toBe(true);
    expect(inputs.some((f) => f.startsWith('../tui-kit/src/'))).toBe(true);
  });

  test('no root task hashes ignored build output', () => {
    const run = dryRun([
      'lint:root', 'tokens:fresh', 'build-storybook', 'treeshake', 'scripts:test', '--filter=//',
    ]);
    for (const t of run.tasks) {
      const bad = Object.keys(t.inputs ?? {}).filter((f) => /(^|\/)(node_modules|\.turbo|dist|dist-bin|storybook-static)\//.test(f));
      expect(bad, t.taskId).toEqual([]);
    }
  });
```

- [ ] **Step 2: Write the failing inputs guard**

Create `scripts/__tests__/turbo-inputs.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { ROOT } from './helpers.ts';

// A test that resolves the repo root reads other packages from disk, which
// turbo's per-package hash cannot see; it must declare $TURBO_ROOT$ inputs.
const REACHES_ROOT = /import\.meta\.dirname,\s*(['"])\.\.\1,\s*\1\.\.\1,\s*\1\.\.\1/;

function packageOf(file: string): string {
  const [kind, name] = relative(ROOT, file).split(sep);
  const pkg = JSON.parse(readFileSync(join(ROOT, kind, name, 'package.json'), 'utf8'));
  return pkg.name as string;
}

test('every test that reads outside its package declares $TURBO_ROOT$ inputs', () => {
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  const glob = new Bun.Glob('{apps,packages}/*/**/*.test.{ts,tsx}');
  const offenders: string[] = [];
  for (const rel of glob.scanSync(ROOT)) {
    if (rel.includes('/node_modules/')) continue;
    const file = join(ROOT, rel);
    if (!REACHES_ROOT.test(readFileSync(file, 'utf8'))) continue;
    const inputs: string[] = turbo.tasks[`${packageOf(file)}#test`]?.inputs ?? [];
    if (!inputs.some((i) => i.startsWith('$TURBO_ROOT$/'))) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 3: Run both files to see them fail**

Run: `bun test ./scripts`
Expected: FAIL. The root-task test throws from `dryRun` (turbo exits with "could not find task" until Step 5 registers them), the tokens inputs test finds no `../ui/src/` input, and the guard names `packages/tokens/test/consumption.test.ts`, `font-identity.test.ts`, `fragment-sync.test.ts`.

- [ ] **Step 4: Add the root scripts**

Root `package.json` scripts: rename the eslint line from `lint` to `lint:root` (its value is unchanged), and add:

```json
"tokens:fresh": "bun run tokens:radix && bun run tokens:codegen && bun run tokens:ramps && git diff --exit-code packages/tokens/src/radix.ts packages/tui-kit/src/generated packages/tui-kit/assets packages/tokyo/src",
"purity": "scripts/repo-purity.sh",
```

Until Task 4 rewires it, `bun run lint` does not exist at the root; that gap lasts one task.

- [ ] **Step 5: Register the root tasks and the tokens inputs in `turbo.json`**

Inside `"tasks"`, add:

```json
    "@mattstack/tokens#test": {
      "dependsOn": ["^build"],
      "inputs": [
        "$TURBO_DEFAULT$",
        "$TURBO_ROOT$/packages/ui/src/**",
        "$TURBO_ROOT$/packages/tokyo/src/**",
        "$TURBO_ROOT$/packages/tui-kit/src/**"
      ]
    },
    "//#lint:root": {
      "inputs": [
        "eslint.config.js",
        ".storybook/**",
        "stories/**",
        "$TURBO_ROOT$/packages/**",
        "$TURBO_ROOT$/apps/board/src/**/*.css",
        "!$TURBO_ROOT$/**/node_modules/**",
        "!$TURBO_ROOT$/**/.turbo/**",
        "!$TURBO_ROOT$/**/dist/**",
        "!$TURBO_ROOT$/**/dist-bin/**",
        "!$TURBO_ROOT$/**/.vitest-attachments/**"
      ]
    },
    "//#format:check": {
      "inputs": ["$TURBO_DEFAULT$"]
    },
    "//#tokens:fresh": {
      "inputs": [
        "$TURBO_ROOT$/packages/tokens/**",
        "$TURBO_ROOT$/packages/tui-kit/src/generated/**",
        "$TURBO_ROOT$/packages/tui-kit/assets/**",
        "$TURBO_ROOT$/packages/tokyo/src/**",
        "!$TURBO_ROOT$/**/node_modules/**",
        "!$TURBO_ROOT$/**/.turbo/**",
        "!$TURBO_ROOT$/**/dist/**",
        "!$TURBO_ROOT$/**/dist-bin/**"
      ]
    },
    "//#build-storybook": {
      "dependsOn": ["@mattstack/tui-kit#build"],
      "inputs": [
        ".storybook/**",
        "stories/**",
        "$TURBO_ROOT$/packages/ui/**",
        "$TURBO_ROOT$/packages/tokyo/**",
        "$TURBO_ROOT$/packages/gate-kit/src/**",
        "$TURBO_ROOT$/apps/console/src/**",
        "$TURBO_ROOT$/apps/board/src/**",
        "!$TURBO_ROOT$/**/node_modules/**",
        "!$TURBO_ROOT$/**/.turbo/**",
        "!$TURBO_ROOT$/**/dist/**",
        "!$TURBO_ROOT$/**/dist-bin/**",
        "!$TURBO_ROOT$/**/src/server/embedded/**"
      ],
      "outputs": ["storybook-static/**"]
    },
    "//#treeshake": {
      "inputs": [
        "$TURBO_ROOT$/packages/ui/**",
        "!$TURBO_ROOT$/**/node_modules/**",
        "!$TURBO_ROOT$/**/.turbo/**",
        "!$TURBO_ROOT$/**/dist/**",
        "!$TURBO_ROOT$/**/dist-bin/**"
      ]
    },
    "//#purity": {
      "inputs": ["$TURBO_DEFAULT$"]
    },
    "//#scripts:test": {
      "inputs": ["$TURBO_DEFAULT$"]
    }
```

Also add the four negations to the `@mattstack/tokens#test` inputs written above, after its three `$TURBO_ROOT$` globs, so every `$TURBO_ROOT$` list in the file has the same shape.

Three facts drive this shape. For the root package, `$TURBO_DEFAULT$` is every tracked file in the repo and respects `.gitignore`, so it is right for the whole-repo gates (`format:check`, `purity`, and `scripts:test`, whose inputs guard must rerun whenever any test file changes) and wrong for anything meant to be narrower. `$TURBO_ROOT$` globs ignore `.gitignore`, so every scoped list carries the four negations; without them a task's own `.turbo` logs and build output change its hash on every run. And storybook imports `@mattstack/tui-kit/provider` and `/theme`, which resolve to tui-kit's gitignored `dist/`, so `//#build-storybook` depends on `@mattstack/tui-kit#build` (turbo pulls a package task in past `--filter=//`), and its inputs cover every tree `.storybook/main.ts` collects stories from (board's stories import board components and `@mattstack/gate-kit`). The `src/server/embedded` negation keeps console's generated manifest, which `build:binary` writes, out of the hash.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test ./scripts`
Expected: PASS, 11 tests across 2 files.

- [ ] **Step 7: Run the root tasks once, then again**

```bash
node_modules/.bin/turbo run lint:root format:check tokens:fresh build-storybook treeshake purity scripts:test --filter=// --output-logs=errors-only
node_modules/.bin/turbo run lint:root format:check tokens:fresh build-storybook treeshake purity scripts:test --filter=// --output-logs=errors-only
```

Expected: first run ends `Tasks: 8 successful, 8 total` (the seven root tasks plus `@mattstack/tui-kit#build`, which storybook pulls in), `Cached: 0 cached`; second run ends `Cached: 8 cached, 8 total` and `>>> FULL TURBO`. A task that misses on the second run has an input that the first run wrote; find it with `--dry=json` and add the negation.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add package.json turbo.json scripts/__tests__
git commit -m "turbo: register root gates and the tokens suite's cross-package inputs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: `scripts/turbo.sh` and turbo-backed root scripts

**Files:**
- Create: `scripts/turbo.sh`
- Create: `scripts/__tests__/turbo-sh.test.ts`
- Modify: `package.json` (root scripts)

**Interfaces:**
- Consumes: the task names from Tasks 1 to 3.
- Produces: `scripts/turbo.sh <task>... [flags]` and `scripts/turbo.sh check [flags]`. `check` runs three turbo invocations in order: the two codegen gates serially; the package gates (with `--affected` and, off macOS, `--filter=!deck`); the root gates plus the tokens suite with `--affected` stripped. Every root script and `<app>:<task>` alias goes through it.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/turbo-sh.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ROOT, realIds, type DryRun } from './helpers.ts';

const SCRIPT = join(ROOT, 'scripts', 'turbo.sh');

function run(args: string[], opts: { uname?: string; env?: Record<string, string> } = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...opts.env,
    TURBO_TELEMETRY_DISABLED: '1',
  };
  if (opts.uname) {
    const bin = mkdtempSync(join(tmpdir(), 'fake-uname-'));
    writeFileSync(join(bin, 'uname'), `#!/bin/sh\necho ${opts.uname}\n`);
    chmodSync(join(bin, 'uname'), 0o755);
    env.PATH = `${bin}:${process.env.PATH}`;
  }
  const proc = Bun.spawnSync(['bash', SCRIPT, ...args], { cwd: ROOT, env });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

// `check --dry=json` prints one JSON document per turbo invocation; each
// ends with a closing brace followed by a blank line.
function documents(out: string): DryRun[] {
  return out
    .split(/\n}\s*\n(?=\{)/)
    .map((chunk, i, all) => (i < all.length - 1 ? `${chunk}\n}` : chunk))
    .map((chunk) => JSON.parse(chunk.slice(chunk.indexOf('{'))) as DryRun);
}

const commonDir = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
  cwd: ROOT,
}).stdout.toString().trim();

describe('scripts/turbo.sh', () => {
  test('caches under the repo common git dir', () => {
    const r = run(['typecheck', '--filter=@mattstack/tokens', '--output-logs=none']);
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(commonDir, 'turbo-cache'))).toBe(true);
  });

  test('check runs codegen gates, then package gates, then root gates and the tokens suite', () => {
    const r = run(['check', '--dry=json']);
    expect(r.code, r.err).toBe(0);
    const docs = documents(r.out);
    expect(docs).toHaveLength(3);
    const [codegen, pkgs, roots] = docs;
    expect(realIds(codegen)).toEqual(['//#tokens:fresh', '@mattstack/tui-kit#gates']);
    const pkgIds = realIds(pkgs);
    expect(pkgIds).toContain('board#test');
    expect(pkgIds).toContain('chat#serve-check');
    expect(pkgIds).not.toContain('@mattstack/tui-kit#gates');
    expect(realIds(roots)).toEqual([
      '//#build-storybook', '//#format:check', '//#lint:root', '//#purity', '//#scripts:test',
      '//#treeshake', '@mattstack/tokens#test', '@mattstack/tui-kit#build',
    ]);
  });

  test('check keeps deck on macOS and drops it elsewhere', () => {
    const mac = documents(run(['check', '--dry=json'], { uname: 'Darwin' }).out)[1];
    const linux = documents(run(['check', '--dry=json'], { uname: 'Linux' }).out)[1];
    expect(realIds(mac)).toContain('deck#test');
    expect(realIds(linux)).not.toContain('deck#test');
  });

  test('check --affected still runs the codegen and root gates', () => {
    const r = run(['check', '--affected', '--dry=json'], { env: { TURBO_SCM_BASE: 'HEAD' } });
    expect(r.code, r.err).toBe(0);
    const [codegen, , roots] = documents(r.out);
    expect(realIds(codegen)).toEqual(['//#tokens:fresh', '@mattstack/tui-kit#gates']);
    expect(realIds(roots)).toContain('//#purity');
    expect(realIds(roots)).toContain('@mattstack/tokens#test');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `bun test ./scripts/__tests__/turbo-sh.test.ts`
Expected: FAIL, `bash: scripts/turbo.sh: No such file or directory` (exit code 127) in every case.

- [ ] **Step 3: Write `scripts/turbo.sh`**

Create it executable (`chmod +x scripts/turbo.sh`):

```bash
#!/usr/bin/env bash
# The one entry point for turbo.
#   scripts/turbo.sh <task>... [turbo flags]
#   scripts/turbo.sh check [turbo flags]     every gate ci.yml runs
# The cache lives in the repo's common git dir so every worktree of this
# checkout shares it, and CI restores the same path.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
turbo="$root/node_modules/.bin/turbo"
cache="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)/turbo-cache"

if [ "${1:-}" != check ]; then
  exec "$turbo" run "$@" --cache-dir="$cache"
fi
shift

# --affected walks the package graph, not task inputs. The codegen gates,
# the root gates and the tokens suite read trees the graph does not connect
# them to, so they run on every check and let their declared inputs decide
# the cache hit.
always_flags=()
for flag in "$@"; do
  if [ "$flag" != --affected ]; then always_flags+=("$flag"); fi
done

# The two codegen gates rewrite files the package tests read, so they run
# alone and one at a time before anything else.
"$turbo" run gates tokens:fresh --filter=@mattstack/tui-kit --filter=// --concurrency=1 \
  ${always_flags[@]+"${always_flags[@]}"} --cache-dir="$cache"

pkg_flags=("$@")
if [ "$(uname)" != Darwin ]; then
  pkg_flags+=('--filter=!deck')
fi
"$turbo" run typecheck lint test serve-check \
  ${pkg_flags[@]+"${pkg_flags[@]}"} --cache-dir="$cache"

"$turbo" run lint:root format:check build-storybook treeshake purity scripts:test test \
  --filter=// --filter=@mattstack/tokens \
  ${always_flags[@]+"${always_flags[@]}"} --cache-dir="$cache"
```

`${arr[@]+"${arr[@]}"}` is the bash 3.2 spelling of "expand an array that may be empty" under `set -u`; macOS ships bash 3.2 at `/bin/bash`.

- [ ] **Step 4: Run the test to see it pass**

Run: `bun test ./scripts/__tests__/turbo-sh.test.ts`
Expected: PASS, 4 tests. (The first test runs a real tokens typecheck; a few seconds.)

- [ ] **Step 5: Rewire the root scripts**

In root `package.json`, replace these scripts (leave `format`, `format:check`, `lint:root`, `storybook`, `build-storybook`, `treeshake`, `tokens:*`, `purity`, `scripts:test`, `deck:test-dom` as they are):

```json
"typecheck": "scripts/turbo.sh typecheck",
"lint": "scripts/turbo.sh lint lint:root",
"test": "scripts/turbo.sh test",
"build": "scripts/turbo.sh build",
"check": "scripts/turbo.sh check",
"tui-kit:build": "scripts/turbo.sh build --filter=@mattstack/tui-kit",
"tui-kit:test": "scripts/turbo.sh test --filter=@mattstack/tui-kit",
"tui-kit:gates": "scripts/turbo.sh gates --filter=@mattstack/tui-kit",
"tokens:test": "scripts/turbo.sh test --filter=@mattstack/tokens",
"gate-kit:test": "scripts/turbo.sh test --filter=@mattstack/gate-kit",
"chat:typecheck": "scripts/turbo.sh typecheck --filter=chat",
"chat:lint": "scripts/turbo.sh lint --filter=chat",
"chat:test": "scripts/turbo.sh test --filter=chat",
"chat:build": "scripts/turbo.sh build --filter=chat",
"console:typecheck": "scripts/turbo.sh typecheck --filter=mattstack-console",
"console:lint": "scripts/turbo.sh lint --filter=mattstack-console",
"console:test": "scripts/turbo.sh test --filter=mattstack-console",
"console:build": "scripts/turbo.sh build --filter=mattstack-console",
"boxscore:typecheck": "scripts/turbo.sh typecheck --filter=boxscore",
"boxscore:lint": "scripts/turbo.sh lint --filter=boxscore",
"boxscore:test": "scripts/turbo.sh test --filter=boxscore",
"board:typecheck": "scripts/turbo.sh typecheck --filter=board",
"board:test": "scripts/turbo.sh test --filter=board",
"board:build": "scripts/turbo.sh build --filter=board",
"deck:test": "scripts/turbo.sh test --filter=deck",
```

`lint` runs `lint lint:root` so it covers the package lints and the root eslint run; `format:check` stays plain prettier because `//#format:check` invokes it.

- [ ] **Step 6: Re-run every scripts test, then the whole check**

Run: `bun test ./scripts`
Expected: PASS, 15 tests across 3 files.

Run: `bun run check`
Expected: exits 0. Invocation 1 reports 2 tasks; invocation 2 includes deck (this is a Mac) and the three serve-checks; invocation 3 reports the 8 root-side tasks (seven root tasks, the tokens suite, and tui-kit's build, already cached from invocation 2). Run `bun run check` again: invocations 1 and 3 report `>>> FULL TURBO`; invocation 2 reports every task cached except `@mattstack/tui-kit#browsers` (`cache: false`), so no `FULL TURBO` banner there.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add scripts/turbo.sh scripts/__tests__ package.json
git commit -m "turbo: scripts/turbo.sh entry point, turbo-backed root scripts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: `ci.yml`

**Files:**
- Modify: `.github/workflows/ci.yml` (rewrite)

**Interfaces:**
- Consumes: `scripts/turbo.sh check` from Task 4.

- [ ] **Step 1: Rebase onto main**

`main` has moved since this branch was cut (#158 changed `ci.yml`'s trigger and concurrency blocks; #159 changed a ui test). Rebase now so the rewrite starts from the current file:

```bash
git fetch origin && git rebase origin/main
bun install --frozen-lockfile
bun test ./scripts
```

Expected: rebase clean, 15 tests pass.

- [ ] **Step 2: Rewrite `.github/workflows/ci.yml`**

Keep the `on:` and `concurrency:` blocks exactly as they are after the rebase. Replace everything from `jobs:` down with:

```yaml
env:
  TURBO_TELEMETRY_DISABLED: '1'

jobs:
  checks:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          # --affected diffs the PR head against its base sha.
          fetch-depth: 0
      # Pinned: deck's core/generated-fresh.test.ts and tui-kit's codegen gate
      # byte-compare committed artifacts against a live rebuild, and bun's
      # bundler/minifier output is not stable across bun versions. Bump this
      # pin only together with the local bun upgrade that regenerates those
      # committed files.
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.4.2'
      - run: bun install --frozen-lockfile
      # --frozen-lockfile passes a stale workspace package version, which every
      # worktree's ready-step install then rewrites and leaves as dirt.
      - run: bun install && git diff --exit-code -- bun.lock
      # A PR restores main's newest cache; main restores its own previous one
      # (a PR's cache is never visible to main). Every run saves, so entries
      # older than a week are dropped first or compiled binaries pile up.
      - uses: actions/cache@v4
        with:
          path: .git/turbo-cache
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-
      - run: find .git/turbo-cache -type f -mtime +7 -delete 2>/dev/null || true
      - if: github.event_name == 'pull_request'
        run: scripts/turbo.sh check --affected --output-logs=errors-only
        env:
          TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
      - if: github.event_name != 'pull_request'
        run: scripts/turbo.sh check --output-logs=errors-only

  # deck supervises launchd and shells to plutil, both macOS-only, so its
  # suite runs here and nowhere else (scripts/turbo.sh drops it off macOS).
  deck-macos:
    runs-on: macos-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.4.2'
      - run: bun install --frozen-lockfile
      - uses: actions/cache@v4
        with:
          path: .git/turbo-cache
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-
      - run: find .git/turbo-cache -type f -mtime +7 -delete 2>/dev/null || true
      - if: github.event_name == 'pull_request'
        run: scripts/turbo.sh test --filter=deck --affected --output-logs=errors-only
        env:
          TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
      - if: github.event_name != 'pull_request'
        run: scripts/turbo.sh test --filter=deck --output-logs=errors-only
```

Every gate the old file ran maps to a task; keep this table for the PR body:

| old step | new task |
| --- | --- |
| tokens codegen byte-compare | `//#tokens:fresh` |
| `typecheck` | `typecheck` (all packages) |
| `lint` | `//#lint:root` plus `lint` (chat, console, boxscore) |
| `format:check` | `//#format:check` |
| `test -- --run` | `@mattstack/app-kit#test`, `@mattstack/app-server#test` |
| `tokens:test` | `@mattstack/tokens#test` (always, with cross-package inputs) |
| `gate-kit:test` | `@mattstack/gate-kit#test` |
| `tui-kit:build` | `@mattstack/tui-kit#build` (via `^build`) |
| `build-storybook`, `treeshake` | `//#build-storybook`, `//#treeshake` |
| `tui-kit:gates` | `@mattstack/tui-kit#gates` |
| tui-kit node + browser runs, playwright install | `@mattstack/tui-kit#test`, `#browsers` |
| chat typecheck/lint/test/build, served-client gate | `chat#typecheck`, `#lint`, `#test`, `#build`, `#serve-check` |
| console typecheck/lint/test/build, build:binary, binary gate | `mattstack-console#...`, `#build:binary`, `#serve-check` |
| boxscore typecheck/lint/test, build:binary, binary gate | `boxscore#...`, `#build:binary`, `#serve-check` |
| board typecheck/test | `board#typecheck`, `board#test` |
| repo purity | `//#purity` |
| deck-macos: tui-kit build, deck test | `deck#test` (pulls `@mattstack/tui-kit#build`) |

- [ ] **Step 3: Lint the workflow**

Run: `actionlint .github/workflows/ci.yml`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run every gate through turbo, affected-only on PRs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `AGENTS.md` ("CI shape", "Per-app root scripts", the tui-kit build paragraph)
- Modify: `README.md` (lines 84 to 85 and the two command lists near lines 150 to 172)

- [ ] **Step 1: Rewrite AGENTS.md "CI shape"**

Replace the three paragraphs under `### CI shape` with:

```markdown
### CI shape

Every gate runs through Turborepo (`turbo.json`, entry point
`scripts/turbo.sh`). `bun run check` is exactly what CI runs:
`.github/workflows/ci.yml`'s `checks` job (ubuntu) calls
`scripts/turbo.sh check --affected` on PRs and `check` on main; `deck-macos`
runs `test --filter=deck` because deck shells to `plutil`/`launchd`, both
macOS-only, and `scripts/turbo.sh` drops deck off macOS.

`check` is three turbo invocations in order: the two codegen gates
(`@mattstack/tui-kit#gates`, `//#tokens:fresh`) alone and serially, since
they rewrite files the package tests read; the package gates (`typecheck`,
`lint`, `test`, `serve-check`); then the root gates (`lint:root`,
`format:check`, `build-storybook`, `treeshake`, `purity`, `scripts:test`)
plus `@mattstack/tokens#test`. The first and last groups run on every PR
whatever changed, because `--affected` walks the package graph and those
tasks read trees the graph does not connect them to; their declared
`inputs` decide the cache hit.

The cache is `<common git dir>/turbo-cache`, shared by every worktree of
the checkout; CI restores the same path from the Actions cache. `--force`
bypasses it. A test that reads files outside its own package must declare
them as `$TURBO_ROOT$` inputs on its package's `test` task
(`scripts/__tests__/turbo-inputs.test.ts` fails otherwise), and every
`$TURBO_ROOT$` glob carries the `node_modules`/`.turbo`/`dist`/`dist-bin`
negations because those globs ignore `.gitignore`.

`setup-bun` is pinned to `1.4.2` in both jobs. The pin exists because
CI byte-compares generated/committed artifacts (deck's
`core/generated-fresh.test.ts`, tui-kit's codegen gate) against a live
rebuild, and bun's bundler/minifier output is not stable across bun
versions. Bump the pin only together with the local bun upgrade that
regenerates those committed files -- never on its own.

`packages/tui-kit` exports `dist/`, not source. Its `build` runs before any
board or deck task through turbo's `^build` dependency, so nothing has to
be built by hand first.
```

- [ ] **Step 2: Rewrite AGENTS.md "Per-app root scripts"**

Replace the paragraph under `### Per-app root scripts` with:

```markdown
### Per-app root scripts

Each app gets `<app>:typecheck`, `<app>:test`, `<app>:lint`, and
`<app>:build` root scripts in `package.json` where that gate applies to
the app (e.g. board has no `:lint` script). Each is
`scripts/turbo.sh <task> --filter=<package>`, so it builds what the app
depends on and caches the result. Run an app's own gates with these rather
than `cd`-ing into `apps/<name>` by hand; they match what CI runs.
```

- [ ] **Step 3: Update README.md**

Line 84 to 85: replace "so workspace consumers run `bun run tui-kit:build` before any board or deck work" with "which turbo builds before any board or deck task (`^build`)".

The clone block: replace `$ bun run test                # vitest across packages/ui + packages/server` with `$ bun run check               # every gate CI runs, cached and parallel`, and the sentence after it with: "`bun run test`, `bun run typecheck` and `bun run lint` run those tasks across every package through turbo; `bun run chat:test` and friends scope one app."

Contributing bullet: replace the long command list with "`bun run check` is exactly what CI runs (`.github/workflows/ci.yml`); run it before opening a pull request."

- [ ] **Step 4: Run the gates that read these files, then commit**

Run: `bun run format && scripts/turbo.sh format:check purity --filter=//`
Expected: both tasks succeed.

```bash
git add AGENTS.md README.md
git commit -m "docs: describe the turbo-backed gates and cache

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: PR and acceptance measurements

**Files:** none (GitHub only).

- [ ] **Step 1: Final rebase and full check**

```bash
git fetch origin && git rebase origin/main
bun install && git diff --exit-code -- bun.lock
bun run check
```

Expected: rebase clean, lockfile unchanged, `check` green.

- [ ] **Step 2: Open the PR**

Push `turbo-ci` and open a PR against `main` titled `MANKIT-4: run every gate through turbo, affected-only on PRs`. Body: two framing sentences, a `What changed` list of one-clause bullets, the old-step-to-task table from Task 5, and a `Verification` line quoting the two `check` runs from Task 4 step 6. End with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Record the cold full run**

The PR's first `checks` run has no cache and touches the root, so `--affected` selects everything: this is the cold measurement. Record the job's wall time from `gh run view <id> --json jobs`. Expected: under 4 min.

- [ ] **Step 4: Merge, then record the warm main run**

After review and a green run, merge (with Matt's confirmation). The first push to `main` starts cold (a PR's cache is never visible to main) and seeds main's cache. Record the `Cached: N cached, M total` lines from the *second* main push (any merge after this one; if nothing lands within a day, an empty commit pushed to main with Matt's confirmation, since that is a direct push). Expected: at least 80% cached.

- [ ] **Step 5: Record a board-only PR**

Open a throwaway PR from a branch with one whitespace change under `apps/board/src/`, wait for `checks`, record its wall time, then close it. Expected: under 2 min, and the log shows only board's tasks in invocation 2 plus the always-run groups.

- [ ] **Step 6: Close the ticket**

Paste the three numbers into MANKIT-4 and mark it Done. If any target is missed, leave the ticket open with the number and the likely cause (cache restore size, an undeclared input forcing a miss, serve-check time, or the storybook rebuild that every board-only PR now pays because board's `src` is a storybook input).
