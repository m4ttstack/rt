# Unit A: deps.lock `serve` field (the served-app catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt-tray/deps.lock` helper rows can carry an optional `serve: { port, args }` that marks them as bundled apps; every repo-tools parser validates it, the live lock marks board, chat and console as served apps and adds boxscore's pending stub row carrying `serve` (so the release's bundle-apps dispatch can flip it to bundled with no hand edit), and a byte-identical fixture pins deck's future parser to rt's.

**Architecture:** `parseDepsLock` (`lib/bundle-layout.ts`) is the one validating parser; `scripts/lib/deps-lock.ts`, `scripts/bundle-ci/plan-matrix.ts` and `scripts/bundle-ci/update-lock.ts` all call it, so validation lands once. A new pure `servedAppCatalog(lock)` selects bundled helper rows with `serve`, which is exactly what deck's `readBundleCatalog` (unit B) must return; the shared fixture proves it. `update-lock.ts` text-patches rows, so its row finder is made safe around a nested `serve` object. The release preflight reads the lock with bare `JSON.parse`, so it learns to treat a `serve` diff as a full-gate change. The bundle already ships the lock at `Contents/Resources/deps.lock` (`rt-tray/build.sh:273`, asserted by `rt-tray/check-bundle.sh:315`); this unit pins that with a guard test instead of changing the build.

**Tech Stack:** Bun + TypeScript, `bun:test`, JSON, bash (read only here).

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section A)

---

## Global Constraints

- **Worktree.** Work in a fresh rt worktree, never in `~/Documents/GitHub/repo-tools` (shared checkout, read only). Branch: `rt-2-13-a-deps-lock-serve` from `origin/main`. Task 0 sets it up.
- **Worktree Bash guard.** An EnterWorktree session refuses heredocs, `&&` chains, `git -C` and shell loops. Run one plain command per Bash call. Commit with repeated `-m` flags, never a heredoc.
- **TDD.** Every code task: failing test first, run it and see the named failure, then the code, then green. Two tests in this plan pin behavior that already exists; those steps say so and show how to prove the test can fail.
- **Targeted verification only.** Run the touched test files and `bunx tsc --noEmit`. Never run `bun run test`, `test:e2e`, `test:pty` or `test:all` locally; CI runs them. No Swift, no `build.sh`, no `check-bundle.sh` runs in this unit (nothing under `rt-tray/Sources*` changes, so no `rt-tray/deps` copy is needed either).
- **Never run a built binary** (rt, deck, any app) except under `env -i HOME=<tmp> ...`. This unit has no reason to run one. Never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app`.
- **Comments.** Clean-code only: a comment states a constraint the code cannot show. No narration, no ticket ids, no decision history in source. No em or en dashes anywhere (code, comments, commits, PR body).
- **Commits.** One commit per task, message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as the last `-m`).
- **Forward compatibility.** Unknown keys on a row and inside `serve` stay tolerated: an older rt (dev from source) reads the installed bundle's newer lock through `readDepsLock` (`lib/bundle-layout.ts:207-227`), and a lock that fails to parse there makes every bundled tool lookup fall back to PATH.

## Review Focus

Five input classes the spec implies that no current test covers. Each is pinned by a test in the task named.

1. **A live app row whose `serve` is misspelled or dropped** (`"serv": {...}`, or a bundle-apps PR that rewrites the row without it). Tolerated unknown keys mean the row silently becomes a tool and prod stops serving that app. Pinned by the exact serve-rows test on the live lock (Task 3), which names every row carrying `serve` whatever its status, so it holds unchanged when the bot flips boxscore from pending to bundled.
2. **A `serve` row deck cannot run as `Contents/Helpers/<name>`** (an npm-shaped row whose exec is `node script.mjs`, a bundlePath under another name, or a buildtool). Deck serves `Contents/Helpers/<name> <args>` by contract, so such a row would launch the wrong file. Pinned by parse rejections (Task 1).
3. **A pending row carrying `serve`** (boxscore's row before its first release). The binary is absent from the bundle (`check-bundle.sh:328` asserts it), so if it entered the catalog deck would install a plist for a missing binary. Pinned by `servedAppCatalog` excluding it and by the shared fixture that holds deck to the same rule (Task 2).
4. **The bundle-apps pin bump rewriting a served row.** `update-lock.ts` text-patches rows; a `serve` object that precedes `"name"` makes today's `rowSpan` (`scripts/bundle-ci/update-lock.ts:12-34`) pick the nested object as the row and throw `no "version" field to rewrite`. Pinned by the serve-preserving and serve-first tests (Task 4).
5. **A port or args change riding a fast-path release.** `checkGate` (`lib/release/preflight.ts:184-209`) compares only versions, so a serve-only row whose version moved and whose `serve` changed skips the full gate. Pinned by the checkGate serve tests (Task 5).

Also pinned along the way: two rows claiming one port (Task 1), args carrying whitespace (Task 1), the TSV column count that `scripts/fetch-deps.sh:254` and `rt-tray/build.sh` index by position (Task 3), and the bundle still shipping the lock (Task 6).

## Files

| Path | Change | Task |
|---|---|---|
| `lib/bundle-layout.ts` | `DepsLockServe` type, `serve?` on `DepsLockTool`, validation in `parseDepsLock`, new `servedAppCatalog` | 1, 2 |
| `lib/__tests__/bundle-layout.test.ts` | `serve` parse tests | 1 |
| `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json` | new parity fixture (byte-identical twin in mattstack-apps) | 2 |
| `scripts/lib/__tests__/deps-lock-serve-parity.test.ts` | new parity test | 2 |
| `rt-tray/deps.lock` | `serve` on board, console, chat; new pending boxscore row carrying `serve` | 3 |
| `lib/__tests__/deps-lock-file.test.ts` | exact serve-rows and live catalog test | 3 |
| `scripts/__tests__/deps-lock.test.ts` | serve row keeps 11 TSV fields | 3 |
| `scripts/lib/__tests__/deps-lock-cli.test.ts` | live lock rows keep 11 TSV fields | 3 |
| `scripts/bundle-ci/update-lock.ts` | `rowSpan` finds the enclosing row object | 4 |
| `scripts/bundle-ci/__tests__/update-lock.test.ts` | serve tests | 4 |
| `lib/release/preflight.ts` | `serve?` on `DepsRow`, serve diff forces full gate | 5 |
| `lib/release/__tests__/preflight.test.ts` | checkGate serve tests | 5 |
| `lib/__tests__/bundle-ships-deps-lock.test.ts` | new guard test for build.sh / check-bundle.sh | 6 |
| `docs/release-and-distribution.md` | document `serve` | 6 |

---

### Task 0: Worktree

**Files:** none.

- [ ] **Step 1: Provision the tree.** Use EnterWorktree in name mode with the name `rt-2-13-a-deps-lock-serve` (the rt hook provisions it through `rt worktree provision`). Do not hand-roll `git worktree add`.
- [ ] **Step 2: Put it on the right branch.**

Run: `git branch --show-current`
If it prints anything other than `rt-2-13-a-deps-lock-serve`, run `git fetch origin main` and then `git switch -c rt-2-13-a-deps-lock-serve origin/main`.

- [ ] **Step 3: Confirm the base.**

Run: `git log --oneline -1`
Expected: the current `origin/main` head (at planning time `a85d65e2e`, a later main is fine).

Run: `bun test lib/__tests__/bundle-layout.test.ts scripts/bundle-ci/__tests__/update-lock.test.ts`
Expected: all pass (baseline).

---

### Task 1: `parseDepsLock` validates `serve`

**Files:**
- Modify: `lib/bundle-layout.ts` (interface at `:17-45`, parse loop at `:66-138`)
- Test: `lib/__tests__/bundle-layout.test.ts` (new `describe` after the `parseDepsLock` block that ends at `:93`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface DepsLockServe { port: number; args: string[] }`
  - `DepsLockTool.serve?: DepsLockServe`
  - `parseDepsLock(text: string): DepsLock` now throws on an invalid `serve` with messages matching: `/serve must be an object/`, `/serve\.port must be an integer from 1024 to 65535/`, `/serve\.args must be an array/`, `/serve\.args\[\d+\] must be a non-empty string with no whitespace/`, `/serve is only valid on a helper row/`, `/serve needs bundlePath and exec to be exactly Contents\/Helpers\/<name>/`, `/serve\.port \d+ is already served by <name>/`. `serve` and `serve.args` come back frozen.

- [ ] **Step 1: Write the failing tests.** Add after the closing `});` of `describe("parseDepsLock", ...)` (currently line 93):

```ts
describe("parseDepsLock serve", () => {
  const withServe = (serve: unknown, index = 0, extra: object[] = []) =>
    JSON.stringify({ ...LOCK, tools: [...LOCK.tools.map((t, j) => (j === index ? { ...t, serve } : t)), ...extra] });

  test("keeps a valid serve and leaves rows without one as tools", () => {
    const lock = parseDepsLock(withServe({ port: 11006, args: ["serve", "--quiet"] }));
    expect(lock.tools[0]!.serve).toEqual({ port: 11006, args: ["serve", "--quiet"] });
    expect(lock.tools[1]!.serve).toBeUndefined();
  });
  test("rejects a serve that is not an object", () => {
    for (const bad of [null, [], 11006, "11006"]) {
      expect(() => parseDepsLock(withServe(bad)), JSON.stringify(bad)).toThrow(/serve must be an object/);
    }
  });
  test("rejects a port that is not an integer from 1024 to 65535", () => {
    for (const port of [undefined, "11006", 11006.5, 80, 0, 70000]) {
      expect(() => parseDepsLock(withServe({ port, args: [] })), String(port)).toThrow(/serve\.port must be an integer from 1024 to 65535/);
    }
  });
  test("rejects missing or non-array args", () => {
    for (const args of [undefined, "serve", {}]) {
      expect(() => parseDepsLock(withServe({ port: 11006, args })), String(args)).toThrow(/serve\.args must be an array/);
    }
  });
  test("rejects an empty arg or one carrying whitespace", () => {
    for (const arg of ["", "two words", "tab\there", "line\nbreak", 7]) {
      expect(() => parseDepsLock(withServe({ port: 11006, args: [arg] })), JSON.stringify(arg)).toThrow(/serve\.args\[0\] must be a non-empty string with no whitespace/);
    }
  });
  test("rejects serve on a buildtool row", () => {
    expect(() => parseDepsLock(withServe({ port: 11006, args: [] }, 3))).toThrow(/serve is only valid on a helper row/);
  });
  test("rejects serve on a row deck cannot run as Contents/Helpers/<name>", () => {
    expect(() => parseDepsLock(withServe({ port: 11006, args: [] }, 1))).toThrow(/serve needs bundlePath and exec to be exactly Contents\/Helpers\/fast-browser/);
    const renamed = { ...LOCK, tools: [{ ...LOCK.tools[0], bundlePath: `${HELPERS_DIR}/other`, exec: [`${HELPERS_DIR}/other`], serve: { port: 11006, args: [] } }] };
    expect(() => parseDepsLock(JSON.stringify(renamed))).toThrow(/serve needs bundlePath and exec to be exactly Contents\/Helpers\/fzf/);
  });
  test("rejects two rows serving one port", () => {
    const text = JSON.stringify({ ...LOCK, tools: [{ ...LOCK.tools[0], serve: { port: 11006, args: [] } }, { ...LOCK.tools[2], serve: { port: 11006, args: [] } }] });
    expect(() => parseDepsLock(text)).toThrow(/serve\.port 11006 is already served by fzf/);
  });
  test("accepts serve on a pending row", () => {
    const lock = parseDepsLock(withServe({ port: 11005, args: [] }, 2));
    expect(lock.tools[2]!.serve).toEqual({ port: 11005, args: [] });
  });
  test("tolerates unknown keys inside serve", () => {
    expect(() => parseDepsLock(withServe({ port: 11006, args: [], futureServeField: 1 }))).not.toThrow();
  });
  test("freezes serve and its args", () => {
    const serve = parseDepsLock(withServe({ port: 11006, args: ["serve"] })).tools[0]!.serve!;
    expect(Object.isFrozen(serve)).toBe(true);
    expect(Object.isFrozen(serve.args)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `bun test lib/__tests__/bundle-layout.test.ts`
Expected: the rejection tests fail with `Received function did not throw`, the freeze test fails with `expect(received).toBe(expected)` (false), and `tsc` would also flag `.serve` as unknown on `DepsLockTool`. The keep and pending and unknown-key tests pass already (the parser passes raw rows through).

- [ ] **Step 3: Implement.** In `lib/bundle-layout.ts`, add the type above `DepsLockTool` (before line 17):

```ts
export interface DepsLockServe {
  port: number;
  args: string[];
}
```

Add to `DepsLockTool` after `subdir?` (line 44):

```ts
  /**
   * Marks a bundled app deck serves as `Contents/Helpers/<name>` followed by
   * args, on port. A row without it is a tool.
   */
  serve?: DepsLockServe;
```

Add below `REQUIRED_STRING_FIELDS` (line 59):

```ts
const SERVE_ARG = /^\S+$/;
const MIN_SERVE_PORT = 1024;
const MAX_SERVE_PORT = 65535;

// Unknown keys inside serve stay tolerated for the same reason unknown row
// keys do: an older rt or deck reads a newer bundle's lock.
function validateServe(t: DepsLockTool, servedPorts: Map<number, string>): void {
  const name = t.name;
  const serve = t.serve as unknown;
  if (typeof serve !== "object" || serve === null || Array.isArray(serve)) {
    throw new Error(`deps.lock: ${name} serve must be an object`);
  }
  const { port, args } = serve as Record<string, unknown>;
  if (typeof port !== "number" || !Number.isInteger(port) || port < MIN_SERVE_PORT || port > MAX_SERVE_PORT) {
    throw new Error(`deps.lock: ${name} serve.port must be an integer from ${MIN_SERVE_PORT} to ${MAX_SERVE_PORT}, got ${String(port)}`);
  }
  if (!Array.isArray(args)) throw new Error(`deps.lock: ${name} serve.args must be an array`);
  // Whitespace would split an arg wherever the argv is carried as one string.
  args.forEach((a, j) => {
    if (typeof a !== "string" || !SERVE_ARG.test(a)) {
      throw new Error(`deps.lock: ${name} serve.args[${j}] must be a non-empty string with no whitespace`);
    }
  });
  if (t.kind !== "helper") throw new Error(`deps.lock: ${name} serve is only valid on a helper row`);
  const binary = `${HELPERS_DIR}/${name}`;
  if (t.bundlePath !== binary || t.exec.length !== 1 || t.exec[0] !== binary) {
    throw new Error(`deps.lock: ${name} serve needs bundlePath and exec to be exactly ${binary}`);
  }
  const holder = servedPorts.get(port);
  if (holder !== undefined) throw new Error(`deps.lock: ${name} serve.port ${port} is already served by ${holder}`);
  servedPorts.set(port, name);
  Object.freeze(args);
  Object.freeze(serve);
}
```

In `parseDepsLock`, declare the port map next to `seen` (line 72):

```ts
  const servedPorts = new Map<number, string>();
```

and call the validator after the `t.exec.forEach(...)` block closes (after line 121, before `if (t.status === "bundled")`):

```ts
    if (t.serve !== undefined) validateServe(t, servedPorts);
```

- [ ] **Step 4: Run to green.**

Run: `bun test lib/__tests__/bundle-layout.test.ts`
Expected: all pass.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit.**

```
git add lib/bundle-layout.ts lib/__tests__/bundle-layout.test.ts
git commit -m "bundle-layout: validate the optional serve field on deps.lock rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `servedAppCatalog` and the parity fixture

**Files:**
- Modify: `lib/bundle-layout.ts` (new export after `readDepsLock`, around line 227)
- Create: `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`
- Create: `scripts/lib/__tests__/deps-lock-serve-parity.test.ts`

**Interfaces:**
- Consumes: `parseDepsLock`, `DepsLockServe` (Task 1).
- Produces: `export function servedAppCatalog(lock: DepsLock): Map<string, DepsLockServe>`: rows with `serve`, `kind === "helper"` and `status === "bundled"`, in lock order, each value a fresh `{ port, args }` with no other keys. This is the rt twin of deck's `readBundleCatalog(resourcesDir)` (unit B), minus the file read.

- [ ] **Step 1: Create the fixture.** Write these exact bytes (ASCII only, 2-space indent, the file ends with one newline after the final `}`). Its sha256 is `95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230`; if your write produces a different digest, fix the bytes, never the digest.

```json
{
  "lock": {
    "schema": 1,
    "arch": "arm64",
    "tools": [
      { "name": "deck", "version": "1.1.0", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/deck",
        "url": "https://github.com/m4ttstack/apps/releases/download/deck-v1.1.0/deck-darwin-arm64.tgz",
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "archive": "tar.gz", "extract": "deck", "bundlePath": "Contents/Helpers/deck", "exec": ["Contents/Helpers/deck"],
        "exposeByDefault": true, "entitlements": "jit", "status": "bundled", "kind": "helper" },
      { "name": "board", "version": "0.1.5", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/board",
        "url": "https://github.com/m4ttstack/apps/releases/download/board-v0.1.5/board-darwin-arm64.tgz",
        "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "archive": "tar.gz", "extract": "board", "bundlePath": "Contents/Helpers/board", "exec": ["Contents/Helpers/board"],
        "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
        "serve": { "port": 11006, "args": [] } },
      { "name": "gitq", "version": "0.2.1", "license": "MIT", "repo": "m4ttstack/gitq",
        "url": "https://github.com/m4ttstack/gitq/releases/download/v0.2.1/gitq-darwin-arm64",
        "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "archive": "raw", "extract": "", "bundlePath": "Contents/Helpers/gitq", "exec": ["Contents/Helpers/gitq"],
        "exposeByDefault": true, "entitlements": "jit", "status": "bundled", "kind": "helper",
        "futureRowField": "tolerated" },
      { "name": "console", "version": "0.1.2", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/console",
        "url": "https://github.com/m4ttstack/apps/releases/download/console-v0.1.2/console-darwin-arm64.tgz",
        "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "archive": "tar.gz", "extract": "console", "bundlePath": "Contents/Helpers/console", "exec": ["Contents/Helpers/console"],
        "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
        "serve": { "port": 11001, "args": [] } },
      { "name": "chat", "version": "0.1.2", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/chat",
        "url": "https://github.com/m4ttstack/apps/releases/download/chat-v0.1.2/chat-darwin-arm64.tgz",
        "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "archive": "tar.gz", "extract": "chat", "bundlePath": "Contents/Helpers/chat", "exec": ["Contents/Helpers/chat"],
        "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
        "serve": { "port": 11002, "args": [] } },
      { "name": "argsdemo", "version": "9.9.9", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/argsdemo",
        "url": "https://github.com/m4ttstack/apps/releases/download/argsdemo-v9.9.9/argsdemo-darwin-arm64.tgz",
        "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "archive": "tar.gz", "extract": "argsdemo", "bundlePath": "Contents/Helpers/argsdemo", "exec": ["Contents/Helpers/argsdemo"],
        "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
        "serve": { "port": 11090, "args": ["serve", "--no-open"], "futureServeField": 1 } },
      { "name": "boxscore", "version": "", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/boxscore",
        "url": "", "sha256": "",
        "archive": "tar.gz", "extract": "boxscore", "bundlePath": "Contents/Helpers/boxscore", "exec": ["Contents/Helpers/boxscore"],
        "exposeByDefault": false, "entitlements": "jit", "status": "pending", "kind": "helper",
        "serve": { "port": 11005, "args": [] } },
      { "name": "sparkle", "version": "2.10.0", "license": "MIT",
        "url": "https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-2.10.0.tar.xz",
        "sha256": "1111111111111111111111111111111111111111111111111111111111111111",
        "archive": "tar.xz", "extract": "", "bundlePath": "tools/sparkle", "exec": ["tools/sparkle/bin/generate_appcast"],
        "exposeByDefault": false, "entitlements": "none", "status": "bundled", "kind": "buildtool" }
    ]
  },
  "expectedCatalog": [
    { "name": "board", "port": 11006, "args": [] },
    { "name": "console", "port": 11001, "args": [] },
    { "name": "chat", "port": 11002, "args": [] },
    { "name": "argsdemo", "port": 11090, "args": ["serve", "--no-open"] }
  ]
}
```

Run: `shasum -a 256 scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`
Expected: `95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230`.

- [ ] **Step 2: Write the failing test** at `scripts/lib/__tests__/deps-lock-serve-parity.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock, servedAppCatalog } from "../../../lib/bundle-layout.ts";

// Parity anchor: byte-identical twin at mattstack-apps
// apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json, read by
// deck's readBundleCatalog test. Change both files together and move this
// digest in both tests, or the two parsers drift apart silently.
const FIXTURE_SHA256 = "95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230";

interface Fixture {
  lock: unknown;
  expectedCatalog: { name: string; port: number; args: string[] }[];
}

const bytes = readFileSync(join(import.meta.dir, "fixtures", "deps-lock-serve.fixture.json"));
const fixture = JSON.parse(bytes.toString("utf8")) as Fixture;

describe("deps-lock-serve parity fixture", () => {
  test("bytes match the digest its twin pins", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA256);
  });

  test("servedAppCatalog yields the expected catalog in lock order", () => {
    const catalog = servedAppCatalog(parseDepsLock(JSON.stringify(fixture.lock)));
    expect([...catalog].map(([name, serve]) => ({ name, ...serve }))).toEqual(fixture.expectedCatalog);
  });
});
```

- [ ] **Step 3: Run it and watch it fail.**

Run: `bun test scripts/lib/__tests__/deps-lock-serve-parity.test.ts`
Expected: FAIL with `SyntaxError: Export named 'servedAppCatalog' not found in module` (the digest test cannot run until the import resolves).

- [ ] **Step 4: Implement.** In `lib/bundle-layout.ts`, after `readDepsLock` (ends line 227):

```ts
/** A pending row may carry serve ahead of its first release; it is not in the bundle, so it is not served. */
export function servedAppCatalog(lock: DepsLock): Map<string, DepsLockServe> {
  const catalog = new Map<string, DepsLockServe>();
  for (const t of lock.tools) {
    if (t.serve === undefined || t.kind !== "helper" || t.status !== "bundled") continue;
    catalog.set(t.name, { port: t.serve.port, args: [...t.serve.args] });
  }
  return catalog;
}
```

- [ ] **Step 5: Run to green.**

Run: `bun test scripts/lib/__tests__/deps-lock-serve-parity.test.ts lib/__tests__/bundle-layout.test.ts`
Expected: all pass.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit.**

```
git add lib/bundle-layout.ts scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json scripts/lib/__tests__/deps-lock-serve-parity.test.ts
git commit -m "bundle-layout: servedAppCatalog plus the deck parity fixture" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: board, console and chat become served apps in the live lock; boxscore gets its pending row

**Files:**
- Modify: `rt-tray/deps.lock` (board row, console row, chat row; new boxscore row after chat)
- Test: `lib/__tests__/deps-lock-file.test.ts`, `scripts/__tests__/deps-lock.test.ts`, `scripts/lib/__tests__/deps-lock-cli.test.ts`

**Interfaces:**
- Consumes: `servedAppCatalog`, `parseDepsLock`, `DepsLockTool.serve`.
- Produces: rows carrying `serve` are exactly `{ board: 11006 [], console: 11001 [], chat: 11002 [], boxscore: 11005 [] }`; the live catalog (`servedAppCatalog`, bundled rows only) is `{ board, console, chat }` until the release's bundle-apps run flips boxscore to bundled, and gains boxscore then with no hand edit. gitq, deck and every third-party row carry no `serve`. boxscore's row ships `status: "pending"` with `repo`, `subdir` and `serve`, so the bundle-apps dispatch plans it (`plan-matrix.ts` fails an unknown name) and `update-lock.ts` has a row to rewrite (`update-lock.ts:15` throws `deps.lock has no row named boxscore` otherwise).

Serve args are all empty, verified against how the apps run today: rt setup registers board with `command: [boardBin]` (`lib/setup/steps/deck.ts:93`) and chat and console with no serve args (`deck.ts:182-183`); board's compiled entry falls through to the server when no subcommand matches (mattstack-apps `apps/board/src/compiled.ts:27-31`), and chat and console compile `src/server/index.ts` directly (their `build:binary` scripts); boxscore's server takes no argv beyond `--version` (unit D, contract note 2). Ports match each app's `mattstack.deck.json` (board 11006, chat 11002, console 11001, boxscore 11005).

A pending row stops every release until the bot flips it: `checkAppPins` (`lib/release/preflight.ts:215-216`) errors on its empty url. That is the intended gate (README merge order, "no release or rehearsal" between this merge and the bot deps.lock PR), and the PR body says so.

- [ ] **Step 1: Write the failing test.** In `lib/__tests__/deps-lock-file.test.ts`, change the import on line 4 to:

```ts
import { parseDepsLock, servedAppCatalog } from "../bundle-layout.ts";
```

and add inside `describe("rt-tray/deps.lock", ...)`:

```ts
  // An unknown row key is tolerated, so a misspelled serve would quietly turn
  // an app into a tool; only an exact list catches that. It names serve rows
  // whatever their status, so bundle-apps flipping a pending row to bundled
  // needs no edit here.
  const SERVE_ROWS: Record<string, { port: number; args: string[] }> = {
    board: { port: 11006, args: [] },
    console: { port: 11001, args: [] },
    chat: { port: 11002, args: [] },
    boxscore: { port: 11005, args: [] },
  };

  test("the rows carrying serve are exactly board, console, chat and boxscore; gitq and deck stay tools", () => {
    const withServe = lock.tools.filter((t) => t.serve !== undefined);
    expect(Object.fromEntries(withServe.map((t) => [t.name, t.serve]))).toEqual(SERVE_ROWS);
    const by = Object.fromEntries(lock.tools.map((t) => [t.name, t]));
    expect(by["gitq"]?.serve).toBeUndefined();
    expect(by["deck"]?.serve).toBeUndefined();
  });

  test("the served catalog is the serve rows whose status is bundled", () => {
    const bundled = new Set(lock.tools.filter((t) => t.status === "bundled").map((t) => t.name));
    const expected = Object.fromEntries(Object.entries(SERVE_ROWS).filter(([name]) => bundled.has(name)));
    expect(Object.keys(expected)).toEqual(expect.arrayContaining(["board", "console", "chat"]));
    expect(Object.fromEntries(servedAppCatalog(lock))).toEqual(expected);
  });
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `bun test lib/__tests__/deps-lock-file.test.ts`
Expected: both new tests FAIL with `expect(received).toEqual(expected)`: the first receives `{}` for the serve rows, the second receives `{}` for the catalog while expecting board, console and chat.

- [ ] **Step 3: Edit `rt-tray/deps.lock`.** Four edits, the first three anchored on the row's unique `extract`/`bundlePath` line. For board, replace

```
      "archive": "tar.gz", "extract": "board", "bundlePath": "Contents/Helpers/board", "exec": ["Contents/Helpers/board"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper" },
```

with

```
      "archive": "tar.gz", "extract": "board", "bundlePath": "Contents/Helpers/board", "exec": ["Contents/Helpers/board"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11006, "args": [] } },
```

For console, replace

```
      "archive": "tar.gz", "extract": "console", "bundlePath": "Contents/Helpers/console", "exec": ["Contents/Helpers/console"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper" },
```

with

```
      "archive": "tar.gz", "extract": "console", "bundlePath": "Contents/Helpers/console", "exec": ["Contents/Helpers/console"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11001, "args": [] } },
```

For chat, replace

```
      "archive": "tar.gz", "extract": "chat", "bundlePath": "Contents/Helpers/chat", "exec": ["Contents/Helpers/chat"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper" },
```

with

```
      "archive": "tar.gz", "extract": "chat", "bundlePath": "Contents/Helpers/chat", "exec": ["Contents/Helpers/chat"],
      "exposeByDefault": false, "entitlements": "jit", "status": "bundled", "kind": "helper",
      "serve": { "port": 11002, "args": [] } },
```

Fourth, insert boxscore's pending stub directly after the chat row just edited (before the `cloudflared` row), with the same six-space indent:

```
    { "name": "boxscore", "version": "", "license": "MIT", "repo": "m4ttstack/apps", "subdir": "apps/boxscore", "url": "", "sha256": "",
      "archive": "tar.gz", "extract": "boxscore", "bundlePath": "Contents/Helpers/boxscore", "exec": ["Contents/Helpers/boxscore"],
      "exposeByDefault": false, "entitlements": "jit", "status": "pending", "kind": "helper",
      "serve": { "port": 11005, "args": [] } },
```

`lib/__tests__/deps-lock-live.test.ts`'s "fully pinned or explicitly pending" rule already accepts it (a non-bundled repo row needs `url: ""`), `build.sh` skips pending rows and `check-bundle.sh` asserts the binary is absent. The bundle-apps bot later rewrites `version`, `url`, `sha256` and `status` in place and never touches `serve`.

`serve` goes last in each row on purpose: `update-lock.ts` and hand edits both read rows top down, and Task 4 makes either placement safe anyway.

- [ ] **Step 4: Pin the TSV shape** (these pass once Task 1 exists; they guard `scripts/fetch-deps.sh:254`, which rejects any row that is not exactly 11 fields, and `rt-tray/build.sh`, which indexes fields by position). In `scripts/__tests__/deps-lock.test.ts`, inside the `describe`:

```ts
  test("a served app row still emits 11 fields and serve never reaches the TSV", () => {
    const cols = toTsvRow(tool({
      name: "board", bundlePath: "Contents/Helpers/board", exec: ["Contents/Helpers/board"],
      serve: { port: 11006, args: ["serve"] },
    })).split("\t");
    expect(cols).toHaveLength(11);
    expect(cols).not.toContain("11006");
  });
```

In `scripts/lib/__tests__/deps-lock-cli.test.ts`, at the end:

```ts
test("every helper row of the repo lock emits exactly 11 fields", async () => {
  const proc = Bun.spawn(["bun", CLI, "--kind", "helper"], { stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  const rows = out.trim().split("\n");
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.split("\t"), r.split("\t")[0]).toHaveLength(11);
});
```

To prove the CLI pin can fail, temporarily append `, "extra"` to the array in `toTsvRow` (`scripts/lib/deps-lock.ts:20-32`), run the file, see `expected length 11, received 12`, then `git checkout scripts/lib/deps-lock.ts`.

- [ ] **Step 5: Run to green.**

Run: `bun test lib/__tests__/deps-lock-file.test.ts lib/__tests__/deps-lock-live.test.ts scripts/__tests__/deps-lock.test.ts scripts/lib/__tests__/deps-lock-cli.test.ts scripts/bundle-ci/__tests__/plan-matrix.test.ts`
Expected: all pass (`deps-lock-live` and `plan-matrix` parse the live lock and must still accept it, pending boxscore row included).

Run: `bun scripts/bundle-ci/plan-matrix.ts boxscore`
Expected: one matrix leg naming `boxscore`, `m4ttstack/apps`, `apps/boxscore` (before this task it failed with `unknown app "boxscore"`).

To prove both tests hold across the bot's flip, temporarily edit boxscore's row the way the bundle-apps bot will: `"version": "0.1.0"`, `"url": "https://github.com/m4ttstack/apps/releases/download/boxscore-v0.1.0/boxscore-darwin-arm64.tgz"`, `"sha256"` set to 64 `a` characters, `"status": "bundled"`. Run `bun test lib/__tests__/deps-lock-file.test.ts`: both new tests pass, the catalog now including boxscore. Restore those four fields by hand (not with `git checkout`, which would also drop this task's uncommitted edits) and rerun the file.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit.**

```
git add rt-tray/deps.lock lib/__tests__/deps-lock-file.test.ts scripts/__tests__/deps-lock.test.ts scripts/lib/__tests__/deps-lock-cli.test.ts
git commit -m "deps.lock: serve board, console and chat; add boxscore's pending row" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `update-lock` keeps `serve` and finds the row around it

**Files:**
- Modify: `scripts/bundle-ci/update-lock.ts` (`rowSpan`, lines 12-34)
- Test: `scripts/bundle-ci/__tests__/update-lock.test.ts`

**Interfaces:**
- Consumes: `parseDepsLock` with `serve` (Task 1).
- Produces: `applyBuildResults(lockText: string, results: BuildResult[]): string` unchanged in signature; a row's `serve` object survives byte for byte, and the row is located as the innermost object enclosing its `"name"` key wherever `serve` sits.

- [ ] **Step 1: Write the failing tests.** Append to `scripts/bundle-ci/__tests__/update-lock.test.ts`:

```ts
test("a pin bump keeps the row's serve object byte for byte", () => {
  const served = LOCK.replace(
    `"status": "pending", "kind": "helper" },`,
    `"status": "pending", "kind": "helper",\n      "serve": { "port": 11020, "args": ["serve"] } },`,
  );
  const out = applyBuildResults(served, [RESULT]);
  expect(out).toContain(`"serve": { "port": 11020, "args": ["serve"] } },`);
  expect(parseDepsLock(out).tools.find((t) => t.name === "deck")!.serve).toEqual({ port: 11020, args: ["serve"] });
});

test("a serve object placed before name is not mistaken for the row", () => {
  const leading = LOCK.replace(`{ "name": "deck",`, `{ "serve": { "port": 11020, "args": [] }, "name": "deck",`);
  const out = applyBuildResults(leading, [RESULT]);
  const deck = parseDepsLock(out).tools.find((t) => t.name === "deck")!;
  expect(deck.version).toBe("0.5.0");
  expect(deck.status).toBe("bundled");
  expect(deck.serve).toEqual({ port: 11020, args: [] });
});
```

- [ ] **Step 2: Run them and watch the second fail.**

Run: `bun test scripts/bundle-ci/__tests__/update-lock.test.ts`
Expected: `a serve object placed before name is not mistaken for the row` FAILS with `row deck has no "version" field to rewrite` (today `lastIndexOf("{")` lands on the serve object). The byte-for-byte test passes already; it pins the common placement.

- [ ] **Step 3: Implement.** Replace `rowSpan` in `scripts/bundle-ci/update-lock.ts` with:

```ts
function rowSpan(lockText: string, name: string): { start: number; end: number } {
  const marker = `"name": "${name}"`;
  const idx = lockText.indexOf(marker);
  if (idx < 0) throw new Error(`deps.lock has no row named ${name}`);
  // The row is the innermost object still open at the name key, found by a
  // forward scan: a nested object before the key (a serve block) opens and
  // closes before it, so the nearest preceding "{" is not always the row.
  const open: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < idx; i++) {
    const ch = lockText[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') inString = !inString;
    else if (!inString && ch === "{") open.push(i);
    else if (!inString && ch === "}") open.pop();
  }
  const start = open.at(-1);
  if (start === undefined) throw new Error(`row ${name} is not inside an object`);
  let depth = 0;
  inString = false;
  escaped = false;
  // Braces inside a quoted value (a url or license may carry one) must not
  // move the depth, or the row span silently truncates or overruns.
  for (let i = start; i < lockText.length; i++) {
    const ch = lockText[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') inString = !inString;
    else if (!inString && ch === "{") depth++;
    else if (!inString && ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error(`unterminated row object for ${name}`);
}
```

- [ ] **Step 4: Run to green.**

Run: `bun test scripts/bundle-ci/__tests__/update-lock.test.ts`
Expected: all pass, including the existing brace-in-value and untouched-rows tests.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit.**

```
git add scripts/bundle-ci/update-lock.ts scripts/bundle-ci/__tests__/update-lock.test.ts
git commit -m "update-lock: find the row object around a nested serve block" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: a `serve` change forces the full release gate

**Files:**
- Modify: `lib/release/preflight.ts` (`DepsRow` at `:15-21`, `checkGate` at `:184-209`)
- Test: `lib/release/__tests__/preflight.test.ts` (`describe("checkGate")`, `:146-212`)

**Interfaces:**
- Consumes: nothing from earlier tasks (preflight reads the lock with `JSON.parse`, not `parseDepsLock`; it only compares).
- Produces: `DepsRow.serve?: unknown`; `checkGate(seams, tag): Promise<GateImplication>` returns `{ path: "full", reason: "serve changed on row(s): <names>" }` when any row present in both locks has a different `serve` (added, removed or edited).

- [ ] **Step 1: Write the failing tests.** Inside `describe("checkGate", ...)`, after the last test:

```ts
  const servedLock = (ver: string, serve?: { port: number; args: string[] }) => JSON.stringify({
    schema: 1, arch: "arm64", tools: [
      { ...APP_ROW, version: ver, url: `https://github.com/m4ttstack/apps/releases/download/board-v${ver}/board-darwin-arm64.tgz`, ...(serve ? { serve } : {}) },
    ],
  });

  test("a serve edit forces the full gate even on a serve-only row", async () => {
    const s = seams({
      exec: gateExec(["rt-tray/deps.lock"], servedLock("0.1.3", { port: 11006, args: [] })),
      readFile: () => servedLock("0.1.4", { port: 11016, args: [] }),
    });
    const g = await checkGate(s, "v2.10.2");
    expect(g.path).toBe("full");
    expect(g.reason).toBe("serve changed on row(s): board");
  });

  test("adding serve to an existing row forces the full gate", async () => {
    const s = seams({
      exec: gateExec(["rt-tray/deps.lock"], servedLock("0.1.3")),
      readFile: () => servedLock("0.1.4", { port: 11006, args: [] }),
    });
    const g = await checkGate(s, "v2.10.2");
    expect(g.path).toBe("full");
    expect(g.reason).toContain("serve");
  });

  test("an unchanged serve keeps a serve-only pin bump on the fast path", async () => {
    const s = seams({
      exec: gateExec(["rt-tray/deps.lock"], servedLock("0.1.3", { port: 11006, args: [] })),
      readFile: () => servedLock("0.1.4", { port: 11006, args: [] }),
    });
    const g = await checkGate(s, "v2.10.2");
    expect(g.path).toBe("fast");
  });
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `bun test lib/release/__tests__/preflight.test.ts`
Expected: the first two FAIL with `expect(received).toBe(expected)`, received `"fast"`. The third passes (it pins the path that must stay fast).

- [ ] **Step 3: Implement.** Add to `DepsRow` (after `subdir?`, line 20):

```ts
  serve?: unknown;
```

Add above `checkGate` (next to `FAST_PATH_FILES`, line 182):

```ts
/** Compared, never validated: any difference in what deck is told to run leaves the fast path. */
function serveKey(row: DepsRow | undefined): string {
  return JSON.stringify(row?.serve ?? null);
}
```

Replace lines 193-199 of `checkGate` (from `const oldRaw` through the `added` return) with:

```ts
    const oldRaw = await git(seams, ["show", `${tag}:rt-tray/deps.lock`]);
    const oldRows = new Map((JSON.parse(oldRaw) as { tools: DepsRow[] }).tools.map((r) => [r.name, r]));
    const rows = readDepsRows(seams);
    const changed = rows.filter((r) => oldRows.get(r.name)?.version !== r.version).map((r) => r.name);
    // A row absent from the old lock is a first-ever ship of that app, which is
    // beyond "pin-only" no matter how the row is served.
    const added = changed.filter((name) => !oldRows.has(name));
    if (added.length > 0) return { path: "full", reason: `new row(s) in deps.lock: ${added.join(", ")}` };
    const reserved = rows.filter((r) => oldRows.has(r.name) && serveKey(oldRows.get(r.name)) !== serveKey(r)).map((r) => r.name);
    if (reserved.length > 0) return { path: "full", reason: `serve changed on row(s): ${reserved.join(", ")}` };
```

Leave the `gated`, `changed.length === 0` and fast returns that follow untouched.

- [ ] **Step 4: Run to green.**

Run: `bun test lib/release/__tests__/preflight.test.ts commands/__tests__/release-preflight.test.ts`
Expected: all pass.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit.**

```
git add lib/release/preflight.ts lib/release/__tests__/preflight.test.ts
git commit -m "release preflight: a serve change takes the full gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: pin the bundle's `Contents/Resources/deps.lock` and document `serve`

**Files:**
- Create: `lib/__tests__/bundle-ships-deps-lock.test.ts`
- Modify: `docs/release-and-distribution.md` (the declarations list at `:256-258`, the checklist step 3 at `:287-288`)

**Interfaces:**
- Consumes: `DEPS_LOCK_BUNDLE_PATH` (`lib/bundle-layout.ts:53`).
- Produces: a guard that fails if `rt-tray/build.sh` stops copying the lock into the bundle or `rt-tray/check-bundle.sh` stops comparing it. Deck (unit B) reads its catalog from exactly that path.

This task pins behavior that already exists (`rt-tray/build.sh:273` copies, `rt-tray/check-bundle.sh:315` compares), so there is no red run against unchanged code; Step 2 proves the test can fail.

- [ ] **Step 1: Write the test** at `lib/__tests__/bundle-ships-deps-lock.test.ts`:

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { DEPS_LOCK_BUNDLE_PATH } from "../bundle-layout.ts";

const RT_TRAY = join(import.meta.dir, "..", "..", "rt-tray");

// Deck reads the served-app catalog from this exact bundle path, and
// check-bundle.sh is the only gate that sees the built bundle.
test("build.sh ships deps.lock where deck and rt read it, and check-bundle.sh compares it", () => {
  expect(DEPS_LOCK_BUNDLE_PATH).toBe("Contents/Resources/deps.lock");
  const build = readFileSync(join(RT_TRAY, "build.sh"), "utf8");
  expect(build).toContain(`cp "$SCRIPT_DIR/deps.lock" "$CONTENTS/Resources/deps.lock"`);
  const check = readFileSync(join(RT_TRAY, "check-bundle.sh"), "utf8");
  expect(check).toContain(`cmp -s "$SCRIPT_DIR/deps.lock" "$app/Contents/Resources/deps.lock"`);
});
```

- [ ] **Step 2: Prove it can fail, then restore.**

Temporarily change line 273 of `rt-tray/build.sh` to copy to `"$CONTENTS/Resources/deps.lock.bak"`.
Run: `bun test lib/__tests__/bundle-ships-deps-lock.test.ts`
Expected: FAIL on the `build` `toContain`.
Run: `git checkout rt-tray/build.sh`
Run: `bun test lib/__tests__/bundle-ships-deps-lock.test.ts`
Expected: PASS.

- [ ] **Step 3: Document `serve`.** In `docs/release-and-distribution.md`, replace

```
- `repo` on the deps.lock row (`"m4ttstack/<repo>"`) marks the app
  buildable. Rows without it (jq, node, cloudflared...) are third-party
  pins the pipeline never touches.
```

with

```
- `repo` on the deps.lock row (`"m4ttstack/<repo>"`) marks the app
  buildable. Rows without it (jq, node, cloudflared...) are third-party
  pins the pipeline never touches.
- `serve: { port, args }` on a helper row marks it a bundled app: prod
  deck serves `Contents/Helpers/<name>` followed by `args` on `port`, and
  a row without it is a tool (the gitq CLI). `parseDepsLock` requires
  the row's bundlePath and exec to be exactly `Contents/Helpers/<name>`,
  a port from 1024 to 65535 used by no other row, and args with no
  whitespace. A pending row may carry it; only bundled rows are served.
  The bundle ships the lock at `Contents/Resources/deps.lock`, where deck
  reads it, and `update-lock.ts` never touches `serve`, so a new app's
  `serve` is added by hand on its pending stub row, before its first
  bundle-apps run.
```

and replace

```
3. **Declare the pair**: `bundle: { build, artifact }` in the app's
   `mattstack.deck.json`, and the `repo` field on its deps.lock row.
```

with

```
3. **Declare the pair**: `bundle: { build, artifact }` in the app's
   `mattstack.deck.json`, and the `repo` field on its deps.lock row.
   A served app also gets `serve` on the row, with the manifest's `port`
   and `args` only when the binary's default argv is not its server. A
   new app lands its row by hand first, as a `pending` stub carrying
   `repo`, `subdir` and `serve`, so the dispatch can plan it and the bot
   has a row to flip; no release can be cut while it is pending.
```

- [ ] **Step 4: Run.**

Run: `bun test lib/__tests__/bundle-ships-deps-lock.test.ts`
Expected: PASS.

Read the two edited blocks back and confirm they contain no em or en dash (older text elsewhere in that doc predates the rule; leave it alone).

- [ ] **Step 5: Commit.**

```
git add lib/__tests__/bundle-ships-deps-lock.test.ts docs/release-and-distribution.md
git commit -m "pin the bundle's deps.lock copy and document serve" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: push and open the PR

**Files:** a PR body file in the scratchpad (not committed).

- [ ] **Step 1: Final targeted run.**

Run: `bun test lib/__tests__/bundle-layout.test.ts lib/__tests__/deps-lock-file.test.ts lib/__tests__/deps-lock-live.test.ts lib/__tests__/bundle-ships-deps-lock.test.ts scripts/__tests__/deps-lock.test.ts scripts/lib/__tests__/deps-lock-cli.test.ts scripts/lib/__tests__/deps-lock-serve-parity.test.ts scripts/bundle-ci/__tests__/update-lock.test.ts scripts/bundle-ci/__tests__/plan-matrix.test.ts lib/release/__tests__/preflight.test.ts commands/__tests__/release-preflight.test.ts`
Expected: all pass.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Push.**

Run: `git push -u origin rt-2-13-a-deps-lock-serve`

- [ ] **Step 3: Write the PR body** with the Write tool to `<scratchpad>/pr-body-a.md`:

```markdown
## deps.lock: the served-app catalog

Helper rows in `rt-tray/deps.lock` can now carry `serve: { port, args }`. A row with it is a bundled app deck serves in prod; a row without it is a tool. Part of the 2.13.0 prod-readiness release (spec section A; RT-281, RT-284).

### What changed

**Schema** (`lib/bundle-layout.ts`)

- `parseDepsLock` validates `serve`: helper rows only, bundlePath and exec exactly `Contents/Helpers/<name>`, an unshared port from 1024 to 65535, args with no whitespace
- Unknown keys stay tolerated so older rt and deck read newer locks
- Adds `servedAppCatalog(lock)`: bundled helper rows with `serve`, in lock order

**Lock**

- board (11006), console (11001) and chat (11002) get `serve` with no args; gitq and deck stay tools
- Adds boxscore's pending stub row with `serve` (11005), so the release's bundle-apps dispatch can plan it and its bot PR flips it to bundled with no hand edit
- No release or rehearsal may be cut until that bot PR merges: `checkAppPins` errors on the pending row's empty url

**Parity**

- `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json` is canonical; deck's twin copies it byte for byte (sha256 pinned in both tests)

**Also**

- `update-lock.ts` finds the row object around a nested `serve` block
- Release preflight sends any `serve` change through the full gate
- A guard test pins `Contents/Resources/deps.lock` in `build.sh` and `check-bundle.sh`; docs describe `serve`

### Verification

Targeted suites green: bundle-layout, deps-lock-file, deps-lock-live, bundle-ships-deps-lock, deps-lock TSV and CLI, parity, update-lock, plan-matrix, preflight. `bunx tsc --noEmit` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Open the PR.**

Run: `gh pr create --base main --head rt-2-13-a-deps-lock-serve --title "deps.lock: serve field for bundled apps" --body-file <scratchpad>/pr-body-a.md`
Expected: a PR URL. Report it. Review (CodeRabbit or the stand-in) and merge belong to the orchestrator.

---

## Contract notes

1. **Contract 1 (`serve` shape) is refined, not changed.** Name and shape are as given: optional `"serve": { "port": <integer>, "args": [<string>...] }` on a helper row. Validation rules deck's parser (unit B) must agree with, or at least never be stricter than:
   - `port` is an integer from 1024 to 65535 and unique across all `serve` rows, pending ones included.
   - `args` is required (may be `[]`); each arg is a non-empty string with no whitespace, because an argv carried as one string anywhere (rt setup's `deck add --cmd` splits on whitespace today, `lib/setup/steps/deck.ts:135-139`) would split it.
   - `serve` is valid only on `kind: "helper"` rows whose `bundlePath` and `exec` are exactly `["Contents/Helpers/<name>"]`, which is what makes "args are appended after `Contents/Helpers/<name>`" safe.
   - Unknown keys on rows and inside `serve` are tolerated in both parsers (forward compatibility between flavors running different rt and deck versions). The fixture carries `futureRowField` and `futureServeField` to hold deck to this.
   - Real serve args for all three live apps are `[]` (see Task 3 for the evidence).
2. **The catalog is bundled rows only.** `serve` is allowed on a `pending` row so boxscore's row can be prepared ahead, but a pending row is never in the catalog. Deck's `readBundleCatalog` must skip pending rows and buildtool rows; the fixture's boxscore and sparkle rows pin that.
3. **Contract 2 already holds.** `rt-tray/build.sh:273` copies `rt-tray/deps.lock` to `Contents/Resources/deps.lock` and `rt-tray/check-bundle.sh:315` fails a bundle whose copy is missing or stale. No build change; Task 6 adds a guard test. `lib/bundle-layout.ts:53` already names the path (`DEPS_LOCK_BUNDLE_PATH`). Note the copy lives inside `bundle_helpers`, so a `RT_REQUIRE_DEPS=0` build (no helpers, so no deck either) ships no lock; deck then sees `null`, which is correct.
4. **Contract 5 (fixture): this file is canonical.** The fixture is a wrapper `{ "lock": <deps.lock object>, "expectedCatalog": [{ "name", "port", "args" }...] }`, not a bare deps.lock, so each test carries its expected answer in the shared bytes. A merges first; unit B copies these bytes from `main` into `apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json`, keeps that path in mattstack-apps' `.prettierignore`, pins the same sha256 `95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230`, and parses `JSON.stringify(fixture.lock)`. Unit H's parity test unwraps `.lock` the same way. A later change to the fixture moves both files and both digests together.
5. **Contract 6 twin in rt.** rt's side of the parity is `servedAppCatalog(lock: DepsLock): Map<string, DepsLockServe>` in `lib/bundle-layout.ts` (the file read is `readDepsLock(root)`, already present). It lists board, console and chat while boxscore's row is pending, and boxscore too once the bot flips it.
6. **boxscore's row lands here, pending, carrying `serve`.** The bot's flip needs no hand edit: `update-lock.ts` rewrites `version`, `url`, `sha256`, `status` and leaves `serve` alone, and the deps-lock-file tests name serve rows whatever their status and compute the bundled catalog from the lock, so the bot's deps.lock PR goes green as is. From this merge until that bot PR merges, `checkAppPins` errors on the empty url, so no release or rehearsal is cut in that window.
7. **Other deps.lock readers checked.** `scripts/lib/deps-lock.ts` and `scripts/bundle-ci/plan-matrix.ts` inherit validation through `parseDepsLock`; `lib/release/preflight.ts` and `lib/release/update-machine.ts:206-213` use bare `JSON.parse` and read only name/version/url (preflight now also compares `serve`); `.github/workflows/release.yml:173` reads only `.tools[].sha256`. No Swift code parses the lock. The currently pinned deck 1.0.7 does not read deps.lock at all, so shipping `serve` before unit B's deck lands is inert.

## Depends on

None. Unit A branches from `origin/main` and merges first (README merge order step 1). Unit B copies this plan's fixture from `main` (contract note 4), unit C-rt reads `t.serve` directly, unit H consumes the fixture and the live `serve` rows, and the release runbook's bundle-apps dispatch needs boxscore's pending row.
