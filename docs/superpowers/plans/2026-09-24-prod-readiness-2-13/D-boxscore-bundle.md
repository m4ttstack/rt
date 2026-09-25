# Unit D: boxscore Becomes Bundle-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/boxscore` in m4ttstack/apps ships a self-contained compiled binary exactly the way `apps/console` does (embedded assets, `includeInBundle` plus a `bundle` recipe, MIT license, a CI gate that serves the compiled binary under an isolated HOME and opens its SQLite store), so the release runbook's single `bundle-apps` dispatch can publish `boxscore-v0.1.0` and flip its deps.lock row (landed pending by unit A) to bundled.

**Architecture:** All code lives in mattstack-apps under `apps/boxscore`, plus one CI step in `.github/workflows/ci.yml`. A vitest contract test (`apps/boxscore/test/bundle-ready.test.ts`) pins the recipe, identity and wiring that other units and the repo-tools pipeline consume. A bash gate (`apps/boxscore/scripts/binary-gate.sh`) runs the compiled binary from `$HOME/.mattstack/boxscore` under a fresh HOME with no source tree, which is how deck will run it in prod; CI runs it after `build:binary`, and the release runbook reruns it against the released macOS binary. No hand-written repo-tools code here: unit A lands the pending boxscore row carrying `serve`, and the dispatch, the bot's deps.lock PR and the released-binary gate belong to `I-release-runbook.md`, since that dispatch spans units B, C and D. This plan is Tasks 1 to 5.

**Tech Stack:** Bun 1.4.2 (`bun build --compile`), Vite, Hono via `@mattstack/app-server` 0.4.0, `bun:sqlite`, vitest 4 (`bun --bun vitest run`), bash, GitHub Actions, `gh`.

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section D, "Order" step 2, "Risks"). Read it before Task 1.

## Global Constraints

- **Worktree only.** All edits happen in `/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-d-boxscore-bundle` on branch `apps-2-13-d-boxscore-bundle` from `origin/main`. Never edit, commit on, pull or switch branches in the shared checkout `/Users/matt/Documents/GitHub/mattstack-apps` or `/Users/matt/Documents/GitHub/repo-tools`; reading files and running read-only scripts from them is fine. Remove the worktree once the PR merges; the release runbook reruns the gate from `main`'s copy of the script.
- **Session.** This unit runs from a Claude session rooted in mattstack-apps (an `rt pane spawn` there, or `/cd /Users/matt/Documents/GitHub/mattstack-apps` then EnterWorktree in path mode on the worktree), never as a subagent of a repo-tools worktree session: EnterWorktree cannot cross repos, and a subagent inherits its parent's Bash guard, which refuses `cd <dir> && ...`, `&&` chains, `git -C`, `$(...)` and heredocs.
- Below, `WT=/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-d-boxscore-bundle` and `BX=$WT/apps/boxscore` in prose. Every bash block is one plain command per line, each its own Bash call, run from `$WT`: boxscore's scripts run as `bun run --cwd apps/boxscore <script>`, which gives them `$BX` as cwd the way vitest's `server` project expects.
- **TDD.** Every code step is preceded by a failing test and a run that shows the failure named in the step.
- **Targeted verification only.** Run the touched test file (`bun run --cwd apps/boxscore test test/bundle-ready.test.ts`), `bun run --cwd apps/boxscore typecheck`, `bun run --cwd apps/boxscore lint`, `bunx prettier --check` on touched files from `$WT`, and the gate script. Never run the full repo suites locally (`bun run test` at the root, `test:all`); CI runs them.
- **Isolated HOME for every binary run.** A compiled `dist-bin/boxscore` (or the released binary) only ever runs as `env -i HOME=<temp dir> ...`, which the gate script does itself. Never run it bare: it reads `$HOME/.mattstack` and would open Matt's real store and settings.
- Never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app`. Nothing in this unit builds a tray.
- **Clean-code comments.** Comments only state constraints the code cannot show. No narration, no ticket ids, no decision history in source. No em dashes or en dashes anywhere (code, comments, commit messages, PR body); use "...", parens, or rephrase.
- **Formatting.** mattstack-apps CI runs `prettier --check .` at the root (singleQuote, arrowParens avoid, trailingComma es5, sorted imports; `/Users/matt/Documents/GitHub/mattstack-apps/.prettierrc`). Run `bunx prettier --write` on every touched `.ts`, `.json`, `.yml` and `.md` file before committing.
- **Commits.** One commit per task, from `$WT`, with the message as the first `-m` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` as the last `-m` (no heredoc).
- **Version stays 0.1.0.** `apps/boxscore/package.json:4` already reads `0.1.0` and no `boxscore-v*` tag exists on m4ttstack/apps. Do not bump it.
- **No new dependencies.** `typescript` is already a boxscore devDependency; `bun.lock` must not change (CI line 23 diffs it).

## Review Focus

These are the failure modes section D implies that nothing in the existing pipeline catches. Each one is pinned by a test in the task named.

1. **A binary that answers `--version` but cannot serve.** `serveMattstackApp` prints the version and exits before any app code loads (`packages/server/src/serve.ts:43-46`), and that is all `bundle-apps.yml:146` and `check-bundle.sh` ever run. A binary compiled without the embedded manifest dies with the FATAL at `serve.ts:59-62`, and one that silently reads `./dist` from disk (`packages/server/src/static.ts:43`) 404s every page on a user's machine. Pinned by Task 2's wiring test and Task 3's gate (serves `/`, `/favicon.svg`, a hashed JS asset and the woff2 font from a directory with no `dist`, with the app's own `dist` moved aside).
2. **`bun:sqlite` missing from the compiled binary.** The store loads it with a lazy `require` inside a function (`apps/boxscore/src/server/store/db.ts:24-33`), unlike board's static import, and nothing has ever exercised that inside `bun build --compile` output. Pinned by Task 3's gate: `GET /api/cache/stats` (`src/server/routes.ts:122-131`) must return the empty-store JSON and create `$HOME/.mattstack/boxscore/boxscore.sqlite`.
3. **A hostile working directory.** Deck runs the bundled binary with cwd `~/.mattstack/boxscore` (the same dir the store lives in, `db.ts:8-18`), and a compiled Bun binary autoloads `.env` and `bunfig.toml` from its cwd unless compiled with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (repo-tools compiles rt with both, `.github/workflows/release.yml:124`). A stray `.env` there would redirect the store; a `bunfig.toml` preload would run arbitrary code. Pinned by Task 3's unit test on the flags and the gate's poisoned `.env` and `bunfig.toml`.
4. **Recipe drift caught only on a macOS runner at dispatch time.** `validate-manifest.ts:33-45` needs `bundle.build` and `bundle.artifact`, and `bundle-apps.yml:145` needs the artifact to exist and be executable after the recipe runs; a mismatch between `bundle.artifact` and `build:binary`'s `--outfile` only fails mid-dispatch. Pinned by Task 1's test.
5. **Identity other units read from this app drifting.** Unit C ships `mattstack.deck.json` plus the file its `icon` names at the same relative path under `Contents/Resources/apps/boxscore/`; unit A's catalog serves boxscore on port 11005 with no args; the tag and `check-bundle.sh` both depend on `--version` printing the bare package version. Pinned by Task 1's test (icon resolves inside the app dir, manifest port and server default both 11005) and Task 3's gate (`--version` equals `package.json` version, `/api/health` names `boxscore` and that version).

A sixth, cheaper guard: Task 4's ratchet test fails if the CI step that builds the binary or runs the gate is ever dropped.

---

## Files

| File (all under `$WT`) | Change | Responsibility |
| --- | --- | --- |
| `apps/boxscore/mattstack.deck.json` | Modify | `includeInBundle: true` and `bundle { build, artifact }`, console's shape (`apps/console/mattstack.deck.json:7-12`) |
| `apps/boxscore/package.json` | Modify | `license: "MIT"`, `build:binary` script (console's recipe, `apps/console/package.json:14`, plus the two autoload flags) |
| `apps/boxscore/LICENSE` | Create | Byte copy of `apps/console/LICENSE` |
| `apps/boxscore/src/server/index.ts` | Modify | Pass `embedded: () => import('./embedded/manifest' as string)` (console: `apps/console/src/server/index.ts:18-20`) |
| `apps/boxscore/tsconfig.json` | Modify | `exclude` the generated manifest (console: `apps/console/tsconfig.json:7-13`) |
| `apps/boxscore/.gitignore` | Modify | Ignore `dist-bin/` and `src/server/embedded/manifest.ts` (console: `apps/console/.gitignore:13-18`) |
| `apps/boxscore/test/bundle-ready.test.ts` | Create | Contract test: recipe, license, icon, port, embedded wiring, ignore rules, compile flags, CI gate ratchet |
| `apps/boxscore/scripts/binary-gate.sh` | Create | Serves the compiled binary under a fresh HOME from `$HOME/.mattstack/boxscore` with no source tree and asserts assets, health, 404 floor and the store |
| `.github/workflows/ci.yml` | Modify | After `boxscore:test` (line 118): build the binary, run the gate |
| `apps/boxscore/README.md` | Modify | Scripts table row for `build:binary` |
| `docs/bundle-cutover-brief.md` | Modify | Line 46-48 claims boxscore does not ship in the bundle; add that it does now |

repo-tools: no hand edits in this unit. Unit A lands boxscore's pending row with `serve`; the release runbook's `bundle-apps` run opens the bot PR that flips it to bundled.

---

### Task 1: Worktree, bundle recipe, license and identity contract

**Files:**
- Create: `apps/boxscore/test/bundle-ready.test.ts`
- Modify: `apps/boxscore/mattstack.deck.json` (today: lines 1-12, no `includeInBundle`, no `bundle`)
- Modify: `apps/boxscore/package.json` (today: `version` at :4, `build` at :12, no `license`, no `build:binary`)
- Create: `apps/boxscore/LICENSE`

**Interfaces:**
- Consumes: `readBundleRecipe(manifestPath: string): BundleRecipe` where `BundleRecipe = { name: string; build: string; artifact: string }` (repo-tools `scripts/bundle-ci/validate-manifest.ts:7-13`); `readDeckManifest(dir: string): ParseResult` (mattstack-apps `apps/deck/src/registry/deck-manifest.ts:34`), which already parses `includeInBundle` (:92-96).
- Produces: `apps/boxscore/mattstack.deck.json` with `"includeInBundle": true` and `"bundle": { "build": "bun install --frozen-lockfile && bun run build:binary", "artifact": "dist-bin/boxscore" }`; `package.json` script `build:binary` whose `bun build --compile ... --outfile` is `dist-bin/boxscore`; `"license": "MIT"`; `LICENSE`. Icon stays `"./public/favicon.svg"` and port stays `11005` (consumed by units A and C).

- [ ] **Step 1: Create the worktree and install**

Start from a session rooted in `/Users/matt/Documents/GitHub/mattstack-apps` (see Global Constraints, "Session"). From the shared checkout's root (these two commands write only its git metadata):

```bash
git fetch origin main
git worktree add -b apps-2-13-d-boxscore-bundle .claude/worktrees/apps-2-13-d-boxscore-bundle origin/main
```

`.claude/worktrees/` is already excluded (`**/.claude/worktrees/` in `.git/info/exclude`), so nothing else is written to the shared checkout. Enter the tree with EnterWorktree in path mode on `/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-d-boxscore-bundle`. Then, from `$WT`:

```bash
bun install --frozen-lockfile
bun run tui-kit:build
git status --porcelain
```

Expected: install finishes with no lockfile change (`git status --porcelain` prints nothing); tui-kit builds (bundle-apps.yml:80-86 does the same before a recipe runs).

- [ ] **Step 2: Write the failing contract test**

Create `apps/boxscore/test/bundle-ready.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

interface DeckManifest {
  name: string;
  icon?: string;
  port?: number;
  includeInBundle?: boolean;
  bundle?: { build?: string; artifact?: string };
}

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  scripts: Record<string, string | undefined>;
}

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, 'utf8')) as T;

const manifest = readJson<DeckManifest>('mattstack.deck.json');
const pkg = readJson<PackageJson>('package.json');

function compileOutfile(script: string): string | undefined {
  return /bun build --compile\b[^&]*--outfile\s+(\S+)/.exec(script)?.[1];
}

describe('bundle recipe', () => {
  it('opts boxscore into the bundle with a recipe bundle-apps can run', () => {
    expect(manifest.name).toBe('boxscore');
    expect(pkg.name).toBe('boxscore');
    expect(manifest.includeInBundle).toBe(true);
    expect(manifest.bundle?.build).toBe(
      'bun install --frozen-lockfile && bun run build:binary'
    );
    expect(manifest.bundle?.artifact).toBe('dist-bin/boxscore');
  });

  it('compiles to exactly the artifact the manifest names', () => {
    const script = pkg.scripts['build:binary'] ?? '';
    expect(script).toMatch(
      /^vite build && mattstack-embed-assets && bun build --compile /
    );
    expect(compileOutfile(script)).toBe(manifest.bundle?.artifact);
    expect(script).toMatch(/ src\/server\/index\.ts$/);
  });
});

describe('release identity', () => {
  it('ships under the MIT license like the other bundled apps', () => {
    expect(pkg.license).toBe('MIT');
    expect(existsSync('LICENSE')).toBe(true);
    expect(readFileSync('LICENSE', 'utf8')).toMatch(/^MIT License\n/);
  });

  it('names an icon that resolves inside the app dir', () => {
    const icon = normalize(manifest.icon ?? '');
    expect(icon).not.toBe('.');
    expect(isAbsolute(icon) || icon.split('/').includes('..')).toBe(false);
    expect(existsSync(icon)).toBe(true);
  });

  it('serves on the manifest port by default', () => {
    expect(manifest.port).toBe(11005);
    expect(readFileSync('src/server/index.ts', 'utf8')).toMatch(
      /\bport: 11005\b/
    );
  });
});
```

The existing `test/layering.test.ts` reads repo files by cwd-relative paths the same way; vitest's `server` project runs with cwd `apps/boxscore` (`apps/boxscore/vitest.config.ts:17-24`).

- [ ] **Step 3: Run it and watch it fail**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
```

Expected: 3 failures, 2 passes. `opts boxscore into the bundle` fails with `expected undefined to be true`; `compiles to exactly the artifact` fails because `''` does not match the `vite build && ...` pattern; `ships under the MIT license` fails with `expected undefined to be 'MIT'`. `names an icon` and `serves on the manifest port` pass already (they guard invariants other units consume). If either of those two fails, stop: the manifest drifted since this plan was written.

- [ ] **Step 4: Add the recipe, script, license field and LICENSE**

Replace `apps/boxscore/mattstack.deck.json` with:

```json
{
  "name": "boxscore",
  "displayName": "boxscore",
  "description": "Ranks a hand-picked set of GitLab users on a live leaderboard.",
  "icon": "./public/favicon.svg",
  "port": 11005,
  "includeInBundle": true,
  "bundle": {
    "build": "bun install --frozen-lockfile && bun run build:binary",
    "artifact": "dist-bin/boxscore"
  },
  "dev": {
    "start": "bun src/server/index.ts",
    "build": "bun run build",
    "deploy": "bun run build && deck restart boxscore"
  }
}
```

In `apps/boxscore/package.json`, add `"license": "MIT",` directly after `"version": "0.1.0",` and add this script directly after `"build"`:

```json
    "build:binary": "vite build && mattstack-embed-assets && bun build --compile --outfile dist-bin/boxscore src/server/index.ts",
```

Create the license as a byte copy of console's:

```bash
cp apps/console/LICENSE apps/boxscore/LICENSE
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Cross-check against both real parsers (read-only)**

`validate-manifest.ts` imports only node builtins, so copy repo-tools' `main` version into the scratchpad rather than reaching into the shared repo-tools checkout from this worktree:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/rt/contents/scripts/bundle-ci/validate-manifest.ts > <scratchpad>/validate-manifest.ts
bun <scratchpad>/validate-manifest.ts apps/boxscore/mattstack.deck.json
```

Expected stdout of the second command: `{"name":"boxscore","build":"bun install --frozen-lockfile && bun run build:binary","artifact":"dist-bin/boxscore"}` and exit 0. (This only reads; it is the same parser the dispatch's build leg runs at bundle-apps.yml:93.)

```bash
bun -e "import { readDeckManifest } from './apps/deck/src/registry/deck-manifest.ts'; const r = readDeckManifest('apps/boxscore'); console.log(JSON.stringify({ ok: r?.ok, bundled: r?.ok ? r.manifest.includeInBundle : null }))"
```

Expected: `{"ok":true,"bundled":true}`.

- [ ] **Step 7: Format, typecheck, commit**

```bash
bunx prettier --write apps/boxscore/test/bundle-ready.test.ts apps/boxscore/mattstack.deck.json apps/boxscore/package.json
bun run --cwd apps/boxscore typecheck
git add apps/boxscore/test/bundle-ready.test.ts apps/boxscore/mattstack.deck.json apps/boxscore/package.json apps/boxscore/LICENSE
git commit -m "boxscore: bundle recipe, build:binary, MIT license" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: typecheck exits 0 (the test dir is in `tsconfig.json` `include`); one commit.

---

### Task 2: Embedded assets wiring

**Files:**
- Modify: `apps/boxscore/test/bundle-ready.test.ts`
- Modify: `apps/boxscore/src/server/index.ts` (today :5-10, no `embedded`)
- Modify: `apps/boxscore/tsconfig.json` (today :1-11, no `exclude`)
- Modify: `apps/boxscore/.gitignore` (today :1-18, no `dist-bin`, no manifest)

**Interfaces:**
- Consumes: `serveMattstackApp(opts: ServeOptions): Promise<Server<BunWebSocketData>>` with `embedded?: () => Promise<EmbeddedManifestModule | null>` (`packages/server/src/serve.ts:19-39`); the `mattstack-embed-assets` bin (`packages/server/bin/mattstack-embed-assets.ts:5-7`, reads `./dist` relative to cwd and writes `src/server/embedded/manifest.ts`), already linked at `apps/boxscore/node_modules/.bin/mattstack-embed-assets`.
- Produces: the generated `apps/boxscore/src/server/embedded/manifest.ts` exporting `manifest: EmbeddedManifest` (gitignored, excluded from tsc); `dist-bin/boxscore`, a binary whose `--version` prints `0.1.0`.

- [ ] **Step 1: Add the failing wiring tests**

Change the import block at the top of `apps/boxscore/test/bundle-ready.test.ts` to:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
```

Append:

```ts
describe('embedded assets wiring', () => {
  it('hands serveMattstackApp the generated manifest loader', () => {
    expect(readFileSync('src/server/index.ts', 'utf8')).toMatch(
      /embedded: \(\) => import\('\.\/embedded\/manifest' as string\)/
    );
  });

  it('keeps the generated manifest out of the type-check', () => {
    const { config, error } = ts.readConfigFile(
      'tsconfig.json',
      ts.sys.readFile
    );
    expect(error).toBeUndefined();
    expect(config.exclude).toContain('src/server/embedded/manifest.ts');
  });

  it('never tracks build output', () => {
    for (const path of [
      'dist-bin/boxscore',
      'src/server/embedded/manifest.ts',
    ]) {
      expect(
        () => execFileSync('git', ['check-ignore', '-q', '--no-index', path]),
        path
      ).not.toThrow();
    }
  });
});
```

`ts.readConfigFile` is used because `tsconfig.json` carries a `//` comment (line 7) that `JSON.parse` rejects.

- [ ] **Step 2: Run it and watch it fail**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
```

Expected: 3 new failures (loader regex does not match; `expected undefined to contain 'src/server/embedded/manifest.ts'` or a TypeError reading `includes` of undefined; `check-ignore` throws `Command failed` for `dist-bin/boxscore`), 5 passes.

- [ ] **Step 3: Wire the loader, the exclude and the ignore rules**

`apps/boxscore/src/server/index.ts` becomes:

```ts
import { serveMattstackApp } from '@mattstack/app-server';
import pkg from '../../package.json' with { type: 'json' };
import { routes } from './routes.js';

await serveMattstackApp({
  name: 'boxscore',
  version: pkg.version,
  routes,
  port: 11005,
  // `as string` keeps TS from resolving the gitignored, build-time-only
  // manifest; `bun build --compile` still sees the literal and embeds it.
  embedded: () => import('./embedded/manifest' as string),
});
```

`apps/boxscore/tsconfig.json` becomes:

```jsonc
{
  "extends": "@mattstack/app-kit/tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/app/*"]
    },
    // src/server's parameter properties need emission; this task cannot rewrite server logic to drop them.
    "erasableSyntaxOnly": false
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"],
  // Generated by build:binary; never hand-written or type-checked.
  "exclude": ["src/server/embedded/manifest.ts"]
}
```

In `apps/boxscore/.gitignore`, directly after the `dist/` line (:2), add:

```gitignore
dist-bin/
src/server/embedded/manifest.ts
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Build the binary and smoke `--version` under an isolated HOME**

```bash
bun run --cwd apps/boxscore build:binary
```

Expected: `vite build` output, then `Generated src/server/embedded/manifest.ts for N embedded files.` (N is about 10: index.html, favicons, four js chunks, one css, one woff2), then bun's compile summary; `dist-bin/boxscore` exists. If the compile step reports an unresolved import (for example from `@mattstack/glance` or `bun:sqlite`), stop and report it: that is the bundling risk the spec names, not something to paper over.

The binary must run with a fresh HOME and from an empty cwd (a cwd `.env` or `bunfig.toml` would be autoloaded until Task 3 adds the flags), which is more than one plain command can say. Write this script with the Write tool to `<scratchpad>/boxscore-version.sh`:

```bash
#!/bin/bash
set -u
bin=/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-d-boxscore-bundle/apps/boxscore/dist-bin/boxscore
home=$(mktemp -d)
cd "$home" || exit 1
env -i HOME="$home" "$bin" --version
status=$?
rm -rf "$home"
echo "exit=$status"
```

```bash
bash <scratchpad>/boxscore-version.sh
```

Expected: `0.1.0` then `exit=0`.

- [ ] **Step 6: Typecheck and lint with the generated manifest present, then confirm nothing generated is tracked**

```bash
bun run --cwd apps/boxscore typecheck
bun run --cwd apps/boxscore lint
git status --porcelain
```

Expected: typecheck and lint exit 0 while `src/server/embedded/manifest.ts` exists; `git status` lists only `apps/boxscore/.gitignore`, `apps/boxscore/src/server/index.ts`, `apps/boxscore/test/bundle-ready.test.ts`, `apps/boxscore/tsconfig.json` (no `dist-bin`, no `embedded/manifest.ts`).

- [ ] **Step 7: Format and commit**

```bash
bunx prettier --write apps/boxscore/test/bundle-ready.test.ts apps/boxscore/src/server/index.ts apps/boxscore/tsconfig.json
git add apps/boxscore/test/bundle-ready.test.ts apps/boxscore/src/server/index.ts apps/boxscore/tsconfig.json apps/boxscore/.gitignore
git commit -m "boxscore: embed built assets in the compiled binary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Binary gate and working-directory hardening

**Files:**
- Modify: `apps/boxscore/test/bundle-ready.test.ts`
- Create: `apps/boxscore/scripts/binary-gate.sh` (the dir already holds `import-legacy-settings.ts`)
- Modify: `apps/boxscore/package.json` (`build:binary`)

**Interfaces:**
- Consumes: `dist-bin/boxscore` from Task 2; app-server routes `/api/health` returning `{"ok":true,"name":"boxscore","version":"<v>"}` (`packages/server/src/app.ts:36`), the JSON 404 floor for `/api/*` (`static.ts:63-67`, `app.ts:42`), embedded index served as `text/html; charset=utf-8` (`packages/server/src/embedded/serve.ts:29-36`), embedded `/assets/*` and `/favicon.svg` (`embedded/mount.ts:32-34`); boxscore's `GET /api/cache/stats` returning `CacheStatsResponse` (`src/shared/types.ts:194-198`) from `getStore()` (`src/server/store/index.ts:542`), whose db path is `$BOXSCORE_DB` or `$HOME/.mattstack/boxscore/boxscore.sqlite` (`db.ts:8-18`).
- Produces: `apps/boxscore/scripts/binary-gate.sh`. Contract: env `BINARY` (default `<app>/dist-bin/boxscore`), env `GATE_PORT` (default `11097`); exit 0 printing `binary-gate: boxscore <version> serves its embedded assets and opens its store` on stderr; exit 1 with `binary-gate: <reason>` plus the server log otherwise. Needs `bun` and `curl` on PATH; the binary itself runs under `env -i`.

- [ ] **Step 1: Add the failing hardening test**

Append to `apps/boxscore/test/bundle-ready.test.ts`:

```ts
describe('compiled binary hardening', () => {
  it('ignores a .env or bunfig.toml in the directory deck launches it from', () => {
    const script = pkg.scripts['build:binary'] ?? '';
    expect(script).toContain('--no-compile-autoload-dotenv');
    expect(script).toContain('--no-compile-autoload-bunfig');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
```

Expected: 1 failure (`expected 'vite build && ...' to contain '--no-compile-autoload-dotenv'`), 8 passes.

- [ ] **Step 3: Write the gate**

Create `apps/boxscore/scripts/binary-gate.sh`:

```bash
#!/usr/bin/env bash
# Serves the compiled boxscore the way deck runs it in prod: from
# $HOME/.mattstack/boxscore under a fresh HOME, with no source tree to fall
# back on, and with a hostile .env and bunfig.toml in that working directory.
# bundle-apps and check-bundle only run --version, which exits before any
# boxscore code loads, so this is the one proof the binary serves and opens
# its SQLite store.
set -euo pipefail

app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin=${BINARY:-$app_dir/dist-bin/boxscore}
port=${GATE_PORT:-11097}
base="http://127.0.0.1:$port"
hidden="$app_dir/dist-bin/dist-hidden"

say() { echo "binary-gate: $*" >&2; }

[ -x "$bin" ] || { say "$bin is missing; run bun run build:binary first"; exit 1; }
[ ! -e "$hidden" ] || { say "$hidden is left from an interrupted run; move it back to $app_dir/dist"; exit 1; }
if curl -s -m 1 -o /dev/null "$base/"; then
  say "port $port already answers; set GATE_PORT to a free port"
  exit 1
fi
expected=$(bun -p "require('$app_dir/package.json').version")

work=$(mktemp -d)
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

home="$work/home"
run_dir="$home/.mattstack/boxscore"
mkdir -p "$run_dir"
cp "$bin" "$run_dir/boxscore"
printf 'BOXSCORE_DB=%s\n' "$work/dotenv.sqlite" > "$run_dir/.env"
printf 'preload = ["./poison.ts"]\n' > "$run_dir/bunfig.toml"
printf 'require("node:fs").writeFileSync("%s", "ran");\n' "$work/preloaded" > "$run_dir/poison.ts"

if [ -d "$app_dir/dist" ]; then
  mkdir -p "$app_dir/dist-bin"
  mv "$app_dir/dist" "$hidden"
  moved=1
fi

version=$(cd "$run_dir" && env -i HOME="$home" ./boxscore --version) || fail "--version exited non-zero"
[ "$version" = "$expected" ] || fail "--version printed '$version', expected bare '$expected'"

(cd "$run_dir" && exec env -i HOME="$home" PORT="$port" ./boxscore) > "$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 30); do
  curl -fsS -m 1 -o /dev/null "$base/api/health" 2>/dev/null && break
  kill -0 "$server" 2>/dev/null || fail "binary exited before answering /api/health"
  sleep 1
done
health=$(curl -fsS -m 5 "$base/api/health") || fail "never answered /api/health"
[ "$health" = "{\"ok\":true,\"name\":\"boxscore\",\"version\":\"$expected\"}" ] || fail "/api/health said $health"

code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$base$1"; }
ctype() { curl -s -m 5 -o /dev/null -w '%{content_type}' "$base$1"; }

[ "$(code /)" = 200 ] || fail "/ answered $(code /); the embedded index is missing"
[ "$(ctype /)" = "text/html; charset=utf-8" ] || fail "/ is $(ctype /), not the embedded index"
[ "$(code /favicon.svg)" = 200 ] || fail "/favicon.svg answered $(code /favicon.svg)"
[ "$(ctype /favicon.svg)" = "image/svg+xml" ] || fail "/favicon.svg is $(ctype /favicon.svg)"

index=$(curl -fsS -m 5 "$base/")
re_js='(/assets/[^"]+\.js)'
re_css='(/assets/[^"]+\.css)'
re_font='(/assets/[^)"]+\.woff2)'
[[ $index =~ $re_js ]] || fail "index.html references no /assets/*.js"
js=${BASH_REMATCH[1]}
[ "$(code "$js")" = 200 ] || fail "$js answered $(code "$js")"
[[ $index =~ $re_css ]] || fail "index.html references no /assets/*.css"
css=$(curl -fsS -m 5 "$base${BASH_REMATCH[1]}") || fail "the stylesheet did not load"
[[ $css =~ $re_font ]] || fail "the stylesheet references no /assets/*.woff2"
font=${BASH_REMATCH[1]}
[ "$(code "$font")" = 200 ] || fail "$font answered $(code "$font")"
[ "$(ctype "$font")" = "font/woff2" ] || fail "$font is $(ctype "$font"), not font/woff2"

[ "$(code /api/does-not-exist)" = 404 ] || fail "/api/does-not-exist was swallowed by the SPA fallback"
[ "$(ctype /api/does-not-exist)" = "application/json" ] || fail "the /api 404 is not JSON"

stats=$(curl -fsS -m 10 "$base/api/cache/stats") || fail "/api/cache/stats failed; the store did not open"
[ "$stats" = '{"mrDetails":0,"mrList":0,"linearIds":{"valid":0,"invalid":0}}' ] || fail "/api/cache/stats said $stats"
if [ -e "$work/dotenv.sqlite" ] || [ -e "$work/preloaded" ]; then
  fail "a .env or bunfig.toml in the working directory was honored"
fi
[ -f "$run_dir/boxscore.sqlite" ] || fail "the store is not at \$HOME/.mattstack/boxscore/boxscore.sqlite"

say "boxscore $expected serves its embedded assets and opens its store"
```

```bash
chmod +x apps/boxscore/scripts/binary-gate.sh
```

Notes for the implementer: the bash `[[ =~ ]]` matches avoid `grep | head` under `pipefail` (a SIGPIPE there fails the guard exactly when the match exists). `dist` is renamed inside the gitignored `dist-bin/` so an interrupted run never leaves an untracked directory, and the trap restores it. The script must stay bash 3.2 compatible (macOS `/bin/bash`): no associative arrays, no `mapfile`.

- [ ] **Step 4: Run the gate against the flagless binary and watch it fail**

`dist-bin/boxscore` from Task 2 was compiled without the autoload flags. Rebuild it to be sure it matches the current script, then run the gate:

```bash
bun run --cwd apps/boxscore build:binary
bash apps/boxscore/scripts/binary-gate.sh
```

Expected: `binary-gate: a .env or bunfig.toml in the working directory was honored` and the gate exits 1 (every earlier assertion passes: this is the first proof that the embedded assets and the lazy `bun:sqlite` require work inside the compiled binary). Acceptable variant: if the poisoned preload breaks boot, the failure is `binary exited before answering /api/health` or `never answered /api/health` with the preload visible in the server log. If instead the gate passes here, Bun no longer autoloads either file by default; keep going (the flags stay, as an explicit guarantee) and say so in the PR body. Either way confirm `ls apps/boxscore/dist/index.html` still exists afterwards (the trap restored `dist`).

- [ ] **Step 5: Add the flags**

In `apps/boxscore/package.json`, `build:binary` becomes:

```json
    "build:binary": "vite build && mattstack-embed-assets && bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig --outfile dist-bin/boxscore src/server/index.ts",
```

- [ ] **Step 6: Run the test and the gate and watch both pass**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
bun run --cwd apps/boxscore build:binary
bash apps/boxscore/scripts/binary-gate.sh
```

Expected: 9 passed; then `binary-gate: boxscore 0.1.0 serves its embedded assets and opens its store` and the gate exits 0. If `shellcheck` is installed (`command -v shellcheck`), also run `shellcheck apps/boxscore/scripts/binary-gate.sh` from `$WT` and fix any finding.

- [ ] **Step 7: Format and commit**

```bash
bunx prettier --write apps/boxscore/test/bundle-ready.test.ts apps/boxscore/package.json
git add apps/boxscore/test/bundle-ready.test.ts apps/boxscore/package.json apps/boxscore/scripts/binary-gate.sh
git commit -m "boxscore: binary gate; ignore cwd .env and bunfig in the compiled binary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CI binary gate, ratchet and docs

**Files:**
- Modify: `apps/boxscore/test/bundle-ready.test.ts`
- Modify: `.github/workflows/ci.yml` (insert after line 118, `- run: bun run boxscore:test`)
- Modify: `apps/boxscore/README.md` (scripts table, :147-157)
- Modify: `docs/bundle-cutover-brief.md` (:46-48)

**Interfaces:**
- Consumes: `apps/boxscore/scripts/binary-gate.sh` (Task 3); the `checks` job's existing order (`bun install --frozen-lockfile` at :20 and `tui-kit:build` at :34 run before boxscore's steps).
- Produces: two CI steps in the `checks` job: `cd apps/boxscore && bun run build:binary`, then `bash apps/boxscore/scripts/binary-gate.sh`.

- [ ] **Step 1: Add the failing ratchet**

Append to `apps/boxscore/test/bundle-ready.test.ts`:

```ts
describe('CI binary gate', () => {
  it('builds the binary and then runs the gate in the checks job', () => {
    const ci = readFileSync('../../.github/workflows/ci.yml', 'utf8');
    const build = ci.indexOf('cd apps/boxscore && bun run build:binary');
    const gate = ci.indexOf('bash apps/boxscore/scripts/binary-gate.sh');
    expect(build).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(build);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
```

Expected: 1 failure (`expected -1 to be greater than -1`), 9 passes.

- [ ] **Step 3: Add the CI steps**

In `.github/workflows/ci.yml`, directly after `      - run: bun run boxscore:test` (line 118) and before `      - run: bun run board:typecheck`, insert:

```yaml
      - run: cd apps/boxscore && bun run build:binary
      # --version exits before any boxscore code loads, and that is all the
      # bundle pipeline runs; this is the one check that the compiled binary
      # serves its embedded assets and opens its SQLite store.
      - name: boxscore's binary serves its own assets and opens its store
        run: bash apps/boxscore/scripts/binary-gate.sh
```

The job runs on ubuntu-latest, so the gate exercises a linux binary; the release runbook reruns the same script against the released darwin-arm64 binary.

- [ ] **Step 4: Update the docs**

In `apps/boxscore/README.md`'s scripts table, add after the `bun run build` row:

```markdown
| `bun run build:binary` | Compile a self-contained binary to `dist-bin/boxscore` with the built client embedded; `bash scripts/binary-gate.sh` serves it under a fresh HOME. |
```

In `docs/bundle-cutover-brief.md`, directly after the sentence ending "can archive as soon as its fold-in merges." (line 48), add:

```markdown
Since 2026-09-24 boxscore is bundle-ready (`includeInBundle` and a `bundle` recipe in `apps/boxscore/mattstack.deck.json`) and ships from its own deps.lock row.
```

- [ ] **Step 5: Run the test and check the formatting**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts
bunx prettier --write apps/boxscore/test/bundle-ready.test.ts apps/boxscore/README.md docs/bundle-cutover-brief.md .github/workflows/ci.yml
bunx prettier --check apps/boxscore .github/workflows/ci.yml docs/bundle-cutover-brief.md
```

Expected: 10 passed; prettier check reports all files formatted. If `actionlint` is installed (`command -v actionlint`), run `actionlint .github/workflows/ci.yml` from `$WT` and expect no findings.

- [ ] **Step 6: Commit**

```bash
git add apps/boxscore/test/bundle-ready.test.ts .github/workflows/ci.yml apps/boxscore/README.md docs/bundle-cutover-brief.md
git commit -m "ci: gate boxscore's compiled binary; docs for build:binary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification, push, PR

**Files:** none new.

**Interfaces:**
- Produces: PR on m4ttstack/apps from `apps-2-13-d-boxscore-bundle` into `main`. Its merge is a precondition for the release runbook's bundle-apps dispatch, because `bundle-apps.yml:63-70` clones m4ttstack/apps at `main`.

- [ ] **Step 1: Targeted verification, all from a clean build**

```bash
bun run --cwd apps/boxscore test test/bundle-ready.test.ts test/layering.test.ts test/store.test.ts
bun run --cwd apps/boxscore typecheck
bun run --cwd apps/boxscore lint
bun run --cwd apps/boxscore build:binary
bash apps/boxscore/scripts/binary-gate.sh
git status --porcelain
git diff --exit-code origin/main -- bun.lock
```

Expected: all three test files pass (`store.test.ts` proves the `db.ts` path is untouched); typecheck and lint exit 0; the gate prints the success line and exits 0; `git status` prints nothing; `bun.lock` has no diff. Then check the diff for dashes, one command per call: `git diff origin/main > <scratch>/d-diff.txt`, then `perl -CSD -ne 'print if /^\+.*[\x{2013}\x{2014}]/' <scratch>/d-diff.txt` must print nothing.

- [ ] **Step 2: Push and open the PR**

Write the body to a scratch file first (the file must end with the robot line):

```markdown
## boxscore: bundle-ready (RT-282)

Makes `apps/boxscore` ship a compiled binary the way console does, so `bundle-apps` can publish `boxscore-v0.1.0`.

### What changed

**Bundle recipe**

- `includeInBundle` plus `bundle { build, artifact }` in `mattstack.deck.json`
- `build:binary`: vite build, `mattstack-embed-assets`, `bun build --compile` to `dist-bin/boxscore`
- Server passes the embedded manifest loader; tsconfig excludes and `.gitignore` covers the generated files
- MIT `LICENSE` and `license` field

**Hardening**

- The binary is compiled with `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`, because deck runs it with cwd `~/.mattstack/boxscore`

**CI**

- `scripts/binary-gate.sh` runs the compiled binary under a fresh HOME with no source tree: health, embedded index, favicon, js, woff2, JSON 404 floor, and the SQLite store via `/api/cache/stats`
- `test/bundle-ready.test.ts` pins the recipe, identity, wiring, flags and the CI step

Version stays 0.1.0 (no `boxscore-v*` tag exists yet).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
git push -u origin apps-2-13-d-boxscore-bundle
gh pr create --repo m4ttstack/apps --base main --head apps-2-13-d-boxscore-bundle --title "boxscore: bundle-ready (build:binary, recipe, license, binary gate)" --body-file <scratch>/d-pr-body.md
```

If the Task 3 red run passed (Bun no longer autoloads by default), add one line under **Hardening** saying so before creating the PR.

- [ ] **Step 3: Review and CI**

Wait for CodeRabbit's review and address every actionable finding (commit per fix, push). If CodeRabbit is rate-limited, request an Opus stand-in review of the PR diff per the house rule. Wait for both CI jobs (`checks`, `deck-macos`) to go green; the new gate step runs in `checks`. Merge per the spec's Authority section once both conditions hold, then report the merge sha to the release controller. Once merged, the worktree can go: ExitWorktree with remove, or `git worktree remove .claude/worktrees/apps-2-13-d-boxscore-bundle` from the shared checkout's root.

---

### Task 6: moved to the release runbook

Publishing `boxscore-v0.1.0` is no longer part of this unit. The dispatch has to list `deck,boxscore,board,chat,console` in one run (unit C's check-bundle gate needs identity on every served row, and two real runs back to back conflict on the deps.lock PR), so it can only run once units A, B, C-apps, C-rt and D have all merged. It lives in `I-release-runbook.md` (Tasks 2 to 5 there: preconditions, dry run, real run, the bot deps.lock PR, and the released darwin binary gated with this unit's `binary-gate.sh` from `main`).

What this unit hands that runbook:

- `apps/boxscore/mattstack.deck.json` with `includeInBundle` and the `bundle` recipe on `main`, so `bundle-apps.yml:63-70` can build it.
- `apps/boxscore/scripts/binary-gate.sh` on `main`, which takes `BINARY=<path>` for the released binary.
- The version `0.1.0` and a free `boxscore-v0.1.0` tag (the tag guard refuses an existing one, and a botched real run costs a `0.1.1`).

---

## Contract notes

1. **`/healthz` is not an app route.** Apps on `@mattstack/app-server` answer `GET /api/health` with `{"ok":true,"name","version"}` (`packages/server/src/app.ts:36`); `/healthz` is deck's own endpoint (`apps/deck/src/api/server.ts:338`). The gate and CI step hit `/api/health`, like console's (`ci.yml:94-97`) and chat's (`ci.yml:64-67`). Unit H's VM assertion should do the same for app health, or read deck's `/api/v1/status`.
2. **Contract 1 (serve args), boxscore row confirmed:** `"serve": { "port": 11005, "args": [] }`. The server takes no argv beyond `--version` (`src/server/index.ts`), defaults to port 11005 (`index.ts:9`) and honors `PORT` (`serve.ts:75`), which deck's `specFor` sets. The manifest port is also 11005; Task 1's test pins both.
3. **Contract 3 (identity path) for boxscore:** the manifest's `icon` is `"./public/favicon.svg"`, so unit C ships `Contents/Resources/apps/boxscore/mattstack.deck.json` and `Contents/Resources/apps/boxscore/public/favicon.svg`. `displayName` is lowercase `"boxscore"` today; this unit leaves it alone. Task 1's test pins that the icon path resolves inside the app dir.
4. **Contract 8:** version stays `0.1.0` (already in `package.json:4`); no bump in this unit.
5. **The pending boxscore row is unit A's.** Section D says "mattstack-apps, then repo-tools"; the repo-tools half is the release runbook's dispatch and the bot PR, not hand-written code in this unit, so two units never edit the same deps.lock row. Unit A Task 3 lands the stub (`repo`, `subdir`, `url: ""`, `sha256: ""`, `status: "pending"`, `bundlePath` and `exec` `Contents/Helpers/boxscore`, `entitlements: "jit"`, `kind: "helper"`, `serve: { "port": 11005, "args": [] }`), modeled on the chat stub from repo-tools PR #143. `update-lock.ts` only rewrites six string fields inside the row's span, so the `serve` object survives the flip, and unit A's forward-scanning `rowSpan` finds the row wherever `serve` sits.
6. **Refinement beyond "same shape as console":** `build:binary` adds `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`. Deck runs the binary with cwd `~/.mattstack/<name>`, and rt already compiles with both flags for the same reason (repo-tools `release.yml:124`). console and chat carry the same exposure today; the release runbook files that follow-up ticket.
7. **Sequencing with unit C:** unit C ships identity by staging it in `bundle-apps.yml` (the per-app tarball), so boxscore's dispatch waits for both C PRs; the release runbook's preconditions check that. Releases are immutable, so getting this wrong costs a version.

## Known risks

- The first compile may surface a bundling problem in a dependency (glance, settings-kit, rt-client) that only appears in `bun build --compile` output. Task 2 Step 5 stops on it rather than working around it.
- CI builds and gates a linux binary; the darwin binary is only served by the release runbook's local rerun of the gate (bundle-apps and `check-bundle.sh` run `--version` alone).
- Setting `includeInBundle: true` makes deck's `migrateManagedDevShape` (`apps/deck/src/registry/migrate-dev-shape.ts:45-73`) willing to slim a non-platform boxscore row whose `workingDirectory` is the checkout into a dev-linked row. That row still serves source through `dev.start`, and rows already `managedBy: "rt"` (Matt's) skip that branch, so no machine loses boxscore.
- CodeRabbit may be rate-limited overnight; the Opus stand-in review covers Task 5.

**Depends on:** nothing for Tasks 1 to 5 (README merge order step 4 lands it after C-apps only to keep `bun.lock` rebases simple). Publishing boxscore is the release runbook's job, after A, B, C-apps, C-rt and D have all merged.
