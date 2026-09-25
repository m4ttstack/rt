# Unit B: deck's boot sweep serves the bundle catalog (deck 1.1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deck's boot sweep enforces the ratified flavor rule: in prod deck serves exactly the bundle's catalog (creating or adopting rows, owning each app's data dir, and not serving every other rt row), in dev it serves whatever is registered (plus a row for any catalog app that has none, so a dev-only machine still gets the bundled apps once rt setup stops registering them), and neither flavor deletes the other's rows.

**Architecture:** A new `src/registry/bundle-catalog.ts` reads `Contents/Resources/deps.lock` into a catalog (`name -> { port, args }`). `serve-shape.ts` uses it to build the bundle shape (`Helpers/<name> ...serve.args`, cwd `~/.mattstack/<name>`) and to answer `notServedHere(record)`. `register.ts` gets a spec builder that creates the data dir deck owns and refuses any other missing cwd, and `reresolveManagedApps` becomes the flavor sweep (create missing catalog rows in either flavor, adopt same-named user rows in prod, uninstall not-served rows, kickstart a job whose data dir it just created). Discovery hides not-served rows; `deck remove --managed <name>` removes one row; the refusal text names `deck remove <name> --force`.

**Tech Stack:** Bun + TypeScript (deck, `apps/deck` in the mattstack-apps monorepo), `bun:test`, launchd via the `ServiceManager` seam (tests use `FakeServiceManager`).

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section B, plus "The rule" and "Risks")

---

## Global Constraints

- Work only in the worktree `/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-b-deck-sweep` on branch `apps-2-13-b-deck-sweep`, created from `origin/main` after unit A (m4ttstack/rt `rt-2-13-a-deps-lock-serve`) has merged. The shared checkout `~/Documents/GitHub/mattstack-apps` is READ ONLY: never edit, switch branch, or commit there (Task 0 only adds a worktree to its git metadata). `~/Documents/GitHub/repo-tools` is READ ONLY too.
- **Session.** This unit runs from a Claude session rooted in mattstack-apps (an `rt pane spawn` there, or `/cd /Users/matt/Documents/GitHub/mattstack-apps` then EnterWorktree in path mode on the worktree), never as a subagent of a repo-tools worktree session: EnterWorktree cannot cross repos, and a subagent inherits its parent's Bash guard. Every bash block below is one plain command per line, run as its own Bash call from the worktree root, with no `cd`, no `&&` chain, no `git -C` and no heredoc, so the guard accepts each line as written.
- TDD for every code step: write the failing test, run it and see the named failure, then implement, then see it pass. No placeholders.
- Verification is targeted tests only, always with the deck dir as bun's cwd so its `bunfig.toml` preload isolates HOME: `bun test --cwd apps/deck <files>` from the worktree root (`--cwd` loads `apps/deck/bunfig.toml`). Never run `bun run test`, `bun run deck:test` or any full suite locally; CI runs them (the `deck-macos` job in `.github/workflows/ci.yml:125-141`).
- Typecheck with `bunx tsc --noEmit -p apps/deck > <scratchpad>/tsc-b.txt 2>&1`, then read the file, compared against the baseline count you record in Task 0 (deck has no CI typecheck, so pre-existing errors exist; you must add none, and none may name a file you touched).
- **Formatting.** The repo's `checks` job runs `bun run format:check` (`prettier --check .` at the root). Before every commit, run `bunx prettier --write <each touched .ts/.md/.json file>` and then `bunx prettier --check <the same paths>` from the worktree root; each task's commit step lists them. The parity fixture is the one exception: it is byte-compared by sha against repo-tools' twin, so Task 1 adds it to the root `.prettierignore` and it is never passed to prettier.
- Clean-code comments only: a comment states a constraint the code cannot show. No narration, no ticket ids, no review history in source. No em dashes or en dashes anywhere (code, comments, tests, commit messages, PR body). Where an existing line you replace contains one, the replacement must not.
- Never run a built deck, rt or app binary, and never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app`. This unit needs no binary build at all.
- Registry changes are additive: no new `AppRecord` field, no `version` bump, no new `SyncIssue.source`. Deck 1.0.7 (the pin in the other flavor) must read every row this code writes.
- Commit after each task. Pass the message as the first `-m` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` as the last `-m`.
- Deck is macOS-only (launchd, plutil); tests run on a Mac.

## Review Focus

Five input classes the spec implies that no test covered before this unit. Each is pinned by a named test in the task that owns it.

1. **A pre-catalog bundle.** A deck 1.1.0 running inside a bundle whose `deps.lock` has no `serve` rows (the dev app runs source HEAD deck against whatever lock its last build shipped) must keep today's serve rules and never read as "serve nothing", which would uninstall every rt app. Pinned by Task 1 `no catalog outside a bundle, without a lock, with a broken lock, or with no served rows` and Task 4 `prod with no catalog serves rt rows as before and marks none not-served`.
2. **`deck restart --managed` against a prod registry holding a not-served row.** The tray's version-change step, update-machine's served-suite leg and DevBuild all call it; a kickstart of the uninstalled label would fail the verb on every prod launch. Pinned by Task 4 `restartManagedApps skips a row prod does not serve`.
3. **A plist that is already correct but whose owned data dir is missing** (every machine stuck on exit 78 since 2.12.0). The sweep must recreate the dir and kickstart the job, not report "unchanged". Pinned by Task 4 `an unchanged plist whose owned data dir went missing gets the dir back and a kickstart`.
4. **Catalog creation colliding with existing state:** a catalog port already held by another record, or a route-only (`external`) user row carrying a catalog name. The sweep must report it and never write a second row on the port or convert a row's kind. Pinned by Task 5 `a catalog port held by another row, or a route-only row with a catalog name, is reported and never duplicated`.
5. **`deck remove --managed <name>` for an absent or user-owned name.** It must remove nothing else and answer in the vocabulary rt's uninstall already treats as "nothing to remove" (`/not managed|not found|unknown app|no such app/i`, repo-tools `lib/setup/uninstall.ts:132`). Pinned by Task 7 `removeManagedApps with an absent or user-owned name removes nothing and says so` and the CLI test `remove --managed <name> removes only that app`.

## Files

Paths are relative to `apps/deck/` in the worktree unless they start with the repo root.

| File | Change | Task |
|---|---|---|
| `src/services/bundle-layout.ts` | add `bundleResourcesDir(execPath?)` | 1 |
| `src/services/bundle-layout.test.ts` | test for it | 1 |
| `src/registry/bundle-catalog.ts` | NEW: `parseServeCatalog`, `readBundleCatalog`, `bundleCatalog`, `MATTSTACK_REGISTRAR`, types | 1 |
| `src/registry/bundle-catalog.test.ts` | NEW: parity fixture test and edge cases | 1 |
| `src/registry/__fixtures__/deps-lock-serve.fixture.json` | NEW: parity fixture, a byte-for-byte copy of unit A's canonical file on repo-tools `main` | 1 |
| repo-root `.prettierignore` | keep prettier off the parity fixture (its sha is pinned in both repos) | 1 |
| `src/registry/serve-shape.ts` | catalog-aware `bundleShape`, `resolveFlavor`, `notServedHere`, silent catalog override of bundle-path stored commands | 2 |
| `src/registry/serve-shape.test.ts` | catalog and `notServedHere` tests | 2 |
| `src/api/register.ts` | `buildSpec`/`ensureWorkingDirectory` (Task 3); sweep not-served, kickstart, gating (Task 4); `ensureCatalogRows` (Task 5); named `removeManagedApps` (Task 7) | 3, 4, 5, 7 |
| `src/api/register.test.ts` | fixture dirs, spec tests, sweep tests, flip test, named remove tests | 3, 4, 5, 7 |
| `src/registry/bootstrap.test.ts` | real dir for the `/tmp/stale` fixture | 3 |
| `src/boot-reresolve.ts` + `.test.ts` | log created, adopted, not-served | 4, 5 |
| `src/api/discovery.ts` + `.test.ts` | hide not-served rows | 6 |
| `src/api/server.ts` | pass flavor deps to discovery; named managed remove | 6, 7 |
| `src/cli/commands.ts` + `.test.ts` | `deck remove --managed <name>` | 7 |
| `src/registry/lifecycle.ts` + `.test.ts` | refusal text names `deck remove <name> --force` | 7 |
| `core/board/useBoardState.ts` (+ `core/generated/board.js` if the build changes it) | stale comment | 7 |
| `AGENTS.md` | replace the stale convert.ts paragraph (lines 76-82) | 8 |
| `package.json` (deck) and repo-root `bun.lock` | version 1.1.0 | 8 |

---

## Task 0: Workspace

No code; sets up the worktree and records baselines.

- [ ] **Step 1: Create the worktree from origin/main and enter it**

Start from a session rooted in `/Users/matt/Documents/GitHub/mattstack-apps` (see Global Constraints, "Session"). Confirm unit A is merged first, since Task 1 copies its fixture from repo-tools `main`:

```bash
gh pr list --repo m4ttstack/rt --head rt-2-13-a-deps-lock-serve --state merged --json number,mergedAt
```

Expected: one entry. If it prints `[]`, stop and report: A has not merged.

From the shared checkout's root (these two commands write only its git metadata):

```bash
git fetch origin main
git worktree add -b apps-2-13-b-deck-sweep .claude/worktrees/apps-2-13-b-deck-sweep origin/main
```

`.claude/worktrees/` is already excluded (`**/.claude/worktrees/` in `.git/info/exclude`), so the shared checkout's status stays clean with no further write. Then enter the tree with EnterWorktree in path mode on `/Users/matt/Documents/GitHub/mattstack-apps/.claude/worktrees/apps-2-13-b-deck-sweep`. Every later command runs from that worktree root.

- [ ] **Step 2: Install and build what deck's tests import**

```bash
bun install --frozen-lockfile
bun run tui-kit:build
```

- [ ] **Step 3: Record the typecheck baseline**

```bash
bunx tsc --noEmit -p apps/deck > <scratchpad>/tsc-b.txt 2>&1
grep -c "error TS" <scratchpad>/tsc-b.txt
```

Write the number down (in your task report, not in a repo file). Every later typecheck (the same two commands) must print a number no larger than this, and `grep -E "src/(registry/(bundle-catalog|serve-shape)|api/(register|discovery|server)|boot-reresolve|cli/commands|registry/lifecycle)\.ts" <scratchpad>/tsc-b.txt` must print nothing.

- [ ] **Step 4: Record the targeted-test baseline**

```bash
bun test --cwd apps/deck src/services/bundle-layout.test.ts src/registry/serve-shape.test.ts src/api/register.test.ts src/registry/bootstrap.test.ts src/boot-reresolve.test.ts src/api/discovery.test.ts src/api/server.test.ts src/api/status.test.ts src/api/register-manifest.test.ts src/registry/migrate-dev-shape.test.ts src/registry/lifecycle.test.ts src/cli/commands.test.ts core/generated-fresh.test.ts
```

Expected: all pass on origin/main. If any fail before you change anything, note them in your report as pre-existing and do not fix them in this unit.

---

## Task 1: The bundle catalog reader and the parity fixture

**Files:**
- Modify: `src/services/bundle-layout.ts` (append after `bundleHelpersDir`, line 48)
- Modify: `src/services/bundle-layout.test.ts`
- Create: `src/registry/bundle-catalog.ts`
- Create: `src/registry/bundle-catalog.test.ts`
- Create: `src/registry/__fixtures__/deps-lock-serve.fixture.json`
- Modify: `.prettierignore` (repo root)

**Interfaces:**
- Consumes: `bundleRootFromExec(execPath?)` (`src/services/bundle-layout.ts:22`); unit A's parity fixture on repo-tools `main` (`scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`, a wrapper `{ "lock": <deps.lock>, "expectedCatalog": [{ name, port, args }] }`, sha256 `95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230`).
- Produces:
  - `export function bundleResourcesDir(execPath?: string): string | null`
  - `export const MATTSTACK_REGISTRAR = 'rt'`
  - `export interface CatalogEntry { port: number; args: string[] }`
  - `export type BundleCatalog = Map<string, CatalogEntry>`
  - `export function parseServeCatalog(text: string): BundleCatalog` (throws on a malformed served row)
  - `export function readBundleCatalog(resourcesDir: string | null): BundleCatalog | null`
  - `export function bundleCatalog(): BundleCatalog | null` (memoized for the process)

- [ ] **Step 1: Write the fixture, byte for byte**

Unit A's file is canonical: it is the only fixture that covers a pending row carrying `serve`, unknown row and `serve` keys, and non-empty args. Create `apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json` with exactly these bytes (ASCII only, one newline after the final `}`). Its twin lives in repo-tools at `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`; both must be identical bytes, so fix the bytes, never the digest.

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

Verify the bytes against the plan's digest and against repo-tools `main`:

```bash
shasum -a 256 apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/rt/contents/scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json > <scratchpad>/a-fixture.json
shasum -a 256 <scratchpad>/a-fixture.json
```

Expected: both print `95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230`. If main's copy has a different digest, unit A changed its fixture after this plan was written: copy main's bytes over yours (`cp <scratchpad>/a-fixture.json apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json`), use main's digest as `FIXTURE_SHA256` in Step 2, and say so in your report. Never hand-edit the fixture into a third shape.

Keep prettier off the fixture. In the repo-root `.prettierignore`, directly after the `apps/deck/core/generated` line, add:

```
# deck's src/registry/bundle-catalog.test.ts pins this fixture's sha256, and
# repo-tools' byte-identical twin pins the same digest; reformatting it would
# break the parity both tests exist to hold.
apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json
```

- [ ] **Step 2: Write the failing tests**

Append to `src/services/bundle-layout.test.ts` (and add `bundleResourcesDir` to its import from `./bundle-layout.ts`):

```ts
test('bundleResourcesDir is Contents/Resources beside Helpers, null outside a bundle', () => {
  const { appRoot, exec } = tmpApp();
  expect(bundleResourcesDir(exec)).toBe(join(appRoot, 'Contents', 'Resources'));
  expect(bundleResourcesDir(join(TMPDIR, 'no-such-bundle', 'deck'))).toBeNull();
});
```

Create `src/registry/bundle-catalog.test.ts`:

```ts
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { parseServeCatalog, readBundleCatalog } from './bundle-catalog.ts';

// Parity anchor: byte-identical twin at repo-tools
// scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json, whose test pins
// the same digest and asserts repo-tools' parser derives expectedCatalog.
// Change both files together and move the digest in both tests.
const FIXTURE_SHA256 =
  '95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230';

type LockRow = Record<string, unknown>;

interface Fixture {
  lock: { tools: LockRow[] };
  expectedCatalog: Array<{ name: string; port: number; args: string[] }>;
}

const BYTES = readFileSync(
  join(import.meta.dir, '__fixtures__', 'deps-lock-serve.fixture.json')
);
const fixture = JSON.parse(BYTES.toString('utf8')) as Fixture;
const LOCK = JSON.stringify(fixture.lock);
const EXPECTED = Object.fromEntries(
  fixture.expectedCatalog.map(({ name, ...v }) => [name, v])
);

function lockCopy(): Fixture['lock'] {
  return structuredClone(fixture.lock);
}

function row(lock: Fixture['lock'], name: string): LockRow {
  const found = lock.tools.find(t => t.name === name);
  if (!found) throw new Error(`fixture has no ${name} row`);
  return found;
}

function resources(lock: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'resources-'));
  if (lock !== null) writeFileSync(join(dir, 'deps.lock'), lock);
  return dir;
}

test('the fixture bytes match the digest its repo-tools twin pins', () => {
  expect(createHash('sha256').update(BYTES).digest('hex')).toBe(
    FIXTURE_SHA256
  );
});

test('the shared fixture parses to the catalog repo-tools derives from it', () => {
  expect(Object.fromEntries(parseServeCatalog(LOCK))).toEqual(EXPECTED);
});

test('readBundleCatalog reads Resources/deps.lock', () => {
  expect(Object.fromEntries(readBundleCatalog(resources(LOCK))!)).toEqual(
    EXPECTED
  );
});

test('no catalog outside a bundle, without a lock, with a broken lock, or with no served rows', () => {
  expect(readBundleCatalog(null)).toBeNull();
  expect(readBundleCatalog(resources(null))).toBeNull();
  expect(readBundleCatalog(resources('{not json'))).toBeNull();
  const unserved = lockCopy();
  for (const t of unserved.tools) delete t.serve;
  expect(readBundleCatalog(resources(JSON.stringify(unserved)))).toBeNull();
});

test('pending and buildtool rows never serve, even carrying serve', () => {
  const lock = lockCopy();
  row(lock, 'chat').status = 'pending';
  row(lock, 'sparkle').serve = { port: 11098, args: [] };
  const catalog = parseServeCatalog(JSON.stringify(lock));
  expect(catalog.has('chat')).toBe(false);
  expect(catalog.has('sparkle')).toBe(false);
  expect(catalog.has('boxscore')).toBe(false);
  expect(catalog.has('board')).toBe(true);
});

test('a malformed serve on a served row is rejected, not guessed', () => {
  const bad: unknown[] = [
    { port: '11006', args: [] },
    { port: 11006.5, args: [] },
    { port: 70000, args: [] },
    { port: 11006, args: 'serve' },
    { port: 11006, args: [1] },
    null,
  ];
  for (const serve of bad) {
    const lock = lockCopy();
    row(lock, 'board').serve = serve;
    expect(() => parseServeCatalog(JSON.stringify(lock))).toThrow(
      /board serve/
    );
  }
});
```

The fixture file is a wrapper, not a bare deps.lock: `parseServeCatalog` on its raw text would throw `unsupported schema undefined`. Every test parses the file once and hands the parser `JSON.stringify(fixture.lock)` or a mutated deep copy of `fixture.lock`.

- [ ] **Step 3: Run them and see them fail**

```bash
bun test --cwd apps/deck src/services/bundle-layout.test.ts src/registry/bundle-catalog.test.ts
```

Expected: `bundle-layout.test.ts` fails with `bundleResourcesDir` not exported (SyntaxError on the import), and `bundle-catalog.test.ts` fails with `Cannot find module './bundle-catalog.ts'`.

- [ ] **Step 4: Implement**

Append to `src/services/bundle-layout.ts`:

```ts
/** Absolute path to the bundle's Resources directory, or null outside a bundle. */
export function bundleResourcesDir(execPath?: string): string | null {
  const root = bundleRootFromExec(execPath);
  return root ? join(root, 'Contents', 'Resources') : null;
}
```

Create `src/registry/bundle-catalog.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

import { bundleResourcesDir } from '../services/bundle-layout.ts';

/** The registrar id every mattstack-shipped row carries. */
export const MATTSTACK_REGISTRAR = 'rt';

export interface CatalogEntry {
  port: number;
  args: string[];
}

export type BundleCatalog = Map<string, CatalogEntry>;

/**
 * The apps a bundle serves: bundled helper rows of deps.lock that carry
 * `serve`. Parity anchor: repo-tools lib/bundle-layout.ts parseDepsLock
 * validates the same field, and both repos test their parser against the
 * byte-identical deps-lock-serve.fixture.json.
 */
export function parseServeCatalog(text: string): BundleCatalog {
  const raw = JSON.parse(text) as { schema?: unknown; tools?: unknown };
  if (raw.schema !== 1)
    throw new Error(`deps.lock: unsupported schema ${String(raw.schema)}`);
  if (!Array.isArray(raw.tools))
    throw new Error('deps.lock: tools must be an array');
  const catalog: BundleCatalog = new Map();
  for (const row of raw.tools as Array<Record<string, unknown> | null>) {
    if (!row || row.serve === undefined) continue;
    if (row.kind !== 'helper' || row.status !== 'bundled') continue;
    const name = row.name;
    if (typeof name !== 'string' || !name)
      throw new Error('deps.lock: a served row has no name');
    const serve = row.serve as { port?: unknown; args?: unknown } | null;
    if (typeof serve !== 'object' || serve === null)
      throw new Error(`deps.lock: ${name} serve must be an object`);
    const { port, args } = serve;
    if (
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error(`deps.lock: ${name} serve.port must be an integer port`);
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string'))
      throw new Error(
        `deps.lock: ${name} serve.args must be an array of strings`
      );
    if (catalog.has(name))
      throw new Error(`deps.lock: duplicate served app ${name}`);
    catalog.set(name, { port, args: [...args] });
  }
  return catalog;
}

/**
 * The catalog in `<resourcesDir>/deps.lock`, or null when there is none to
 * enforce: outside a bundle, no readable lock, an invalid one, or a lock from
 * before any row carried `serve`. Null keeps the pre-catalog serve rules, so
 * an older bundle can never read as "serve nothing".
 */
export function readBundleCatalog(
  resourcesDir: string | null
): BundleCatalog | null {
  if (!resourcesDir) return null;
  const path = join(resourcesDir, 'deps.lock');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const catalog = parseServeCatalog(text);
    return catalog.size > 0 ? catalog : null;
  } catch (err) {
    console.error(`[catalog] ignoring ${path}: ${String(err)}`);
    return null;
  }
}

let memo: BundleCatalog | null | undefined;

/** The running bundle's catalog; a live deck's bundle does not change under it. */
export function bundleCatalog(): BundleCatalog | null {
  if (memo === undefined) memo = readBundleCatalog(bundleResourcesDir());
  return memo;
}
```

- [ ] **Step 5: Run and see them pass**

```bash
bun test --cwd apps/deck src/services/bundle-layout.test.ts src/registry/bundle-catalog.test.ts
```

Expected: all pass.

- [ ] **Step 6: Format and commit**

```bash
bunx prettier --write apps/deck/src/services/bundle-layout.ts apps/deck/src/services/bundle-layout.test.ts apps/deck/src/registry/bundle-catalog.ts apps/deck/src/registry/bundle-catalog.test.ts
bunx prettier --check apps/deck/src/services/bundle-layout.ts apps/deck/src/services/bundle-layout.test.ts apps/deck/src/registry/bundle-catalog.ts apps/deck/src/registry/bundle-catalog.test.ts
git add apps/deck/src/services/bundle-layout.ts apps/deck/src/services/bundle-layout.test.ts apps/deck/src/registry/bundle-catalog.ts apps/deck/src/registry/bundle-catalog.test.ts apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json .prettierignore
git commit -m "deck: read the served-app catalog from the bundle's deps.lock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Catalog-aware serve shapes and the not-served rule

**Files:**
- Modify: `src/registry/serve-shape.ts` (`ServeShapeDeps` at :71-75, `bundleShape` at :102-111, `serveShape` at :117-168)
- Modify: `src/registry/serve-shape.test.ts`

**Interfaces:**
- Consumes: `BundleCatalog`, `bundleCatalog()`, `MATTSTACK_REGISTRAR` (Task 1); `bundleHelpersDir()`; `isDevMode()`.
- Produces:
  - `ServeShapeDeps` gains `catalog?: BundleCatalog | null` (undefined = read the running bundle).
  - `export interface Flavor { dev: boolean; helpersDir: string | null; catalog: BundleCatalog | null }`
  - `export function resolveFlavor(deps?: ServeShapeDeps): Flavor`
  - `export function notServedHere(record: AppRecord, deps?: ServeShapeDeps): boolean`
  - `export function bundleShape(record: AppRecord, helpersDir?: string | null, catalog?: BundleCatalog | null): ResolvedShape | null` (third parameter added; existing callers, including `migrate-dev-shape.ts:69`, keep working through the defaults)

Rules this task implements (spec section B):
- A catalog app's bundle shape is `[Helpers/<name>, ...serve.args]` with cwd `dataDir(name)`, whatever command is stored.
- A stored command whose argv0 is `<any>.app/Contents/Helpers/<name>` on a catalog app is overridden silently (no "legacy stored command ignored" issue). Any other stored command is still flagged.
- With a catalog present, a helper outside it is never served by name alone (the gitq CLI is a tool). `storedBundleCommand` inside the running Helpers still counts for non-catalog rows, which keeps dev "unchanged in spirit".
- With no catalog, behavior is exactly today's.
- `notServedHere`: true only for `managedBy === 'rt'`, prod, catalog present, name not in it.

- [ ] **Step 1: Write the failing tests**

Append to `src/registry/serve-shape.test.ts`, and add `bundleShape` and `notServedHere` to the import from `./serve-shape.ts` (line 8-13):

```ts
const CATALOG = new Map([
  ['chat', { port: 11002, args: [] }],
  ['board', { port: 11006, args: ['serve', '--quiet'] }],
]);

function fakeHelpers(...names: string[]): string {
  const helpers = join(
    mkdtempSync(join(tmpdir(), 'catalog-')),
    'mattstack.app',
    'Contents',
    'Helpers'
  );
  mkdirSync(helpers, { recursive: true });
  for (const n of names) writeFileSync(join(helpers, n), '');
  return helpers;
}

describe('bundle catalog', () => {
  test('a catalog app serves its helper with the catalog args from its data dir', () => {
    const helpers = fakeHelpers('board');
    const r = rec({ name: 'board', port: 11006 });
    putRecord(r);
    expect(
      serveShape(r, { devMode: () => false, helpersDir: helpers, catalog: CATALOG })
    ).toEqual({
      command: [join(helpers, 'board'), 'serve', '--quiet'],
      cwd: dataDir('board'),
    });
  });

  test("catalog args win over a stored command in the other flavor's bundle, silently", () => {
    const helpers = fakeHelpers('chat');
    const r = rec({
      command: ['/Applications/mattstack-dev.app/Contents/Helpers/chat'],
      workingDirectory: dataDir('chat'),
    });
    putRecord(r);
    expect(
      serveShape(r, { devMode: () => false, helpersDir: helpers, catalog: CATALOG })
    ).toEqual({ command: [join(helpers, 'chat')], cwd: dataDir('chat') });
    expect(getRecord('chat')?.issues).toBeUndefined();
  });

  test('a stored command outside any bundle is still flagged as legacy on a catalog app', () => {
    const helpers = fakeHelpers('chat');
    const r = rec({
      command: ['bun', 'src/server/index.ts'],
      workingDirectory: '/somewhere',
    });
    putRecord(r);
    serveShape(r, { devMode: () => false, helpersDir: helpers, catalog: CATALOG });
    expect(getRecord('chat')?.issues?.[0]?.message).toContain(
      'legacy stored command'
    );
  });

  test('a helper outside the catalog is never served by name alone', () => {
    const helpers = fakeHelpers('gitq');
    const r = rec({ name: 'gitq', port: 11008 });
    putRecord(r);
    expect(bundleShape(r, helpers, CATALOG)).toBeNull();
    expect(
      serveShape(r, { devMode: () => true, helpersDir: helpers, catalog: CATALOG })
    ).toBeNull();
  });

  test('dev: a linked row outside the catalog serves its source', () => {
    const helpers = fakeHelpers('gitq');
    const dir = linkedDir({ name: 'gitq', dev: { start: 'bun src/server/server.ts' } });
    const r = rec({ name: 'gitq', port: 11008, dev: { workingDirectory: dir } });
    putRecord(r);
    expect(
      serveShape(r, { devMode: () => true, helpersDir: helpers, catalog: CATALOG })
    ).toEqual({ command: ['bun', 'src/server/server.ts'], cwd: dir });
  });

  test('without a catalog the name-derived bundle shape is unchanged', () => {
    const helpers = fakeHelpers('gitq');
    expect(bundleShape(rec({ name: 'gitq' }), helpers, null)).toEqual({
      command: [join(helpers, 'gitq')],
      cwd: dataDir('gitq'),
    });
  });
});

describe('notServedHere', () => {
  test('prod with a catalog: an rt row outside it is not served', () => {
    expect(
      notServedHere(rec({ name: 'gitq' }), { devMode: () => false, catalog: CATALOG })
    ).toBe(true);
  });

  test('catalog apps, dev mode, user rows, the platform and a missing catalog are all served', () => {
    const prod = { devMode: () => false, catalog: CATALOG };
    expect(notServedHere(rec({ name: 'chat' }), prod)).toBe(false);
    expect(
      notServedHere(rec({ name: 'gitq' }), { devMode: () => true, catalog: CATALOG })
    ).toBe(false);
    expect(notServedHere(rec({ name: 'gitq', managedBy: 'user' }), prod)).toBe(false);
    expect(notServedHere(rec({ name: 'deck', managedBy: 'deck' }), prod)).toBe(false);
    expect(
      notServedHere(rec({ name: 'gitq' }), { devMode: () => false, catalog: null })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run and see them fail**

```bash
bun test --cwd apps/deck src/registry/serve-shape.test.ts
```

Expected: SyntaxError, `notServedHere` is not exported (the whole file fails to load).

- [ ] **Step 3: Implement**

In `src/registry/serve-shape.ts`:

Add to the imports:

```ts
import { bundleCatalog, MATTSTACK_REGISTRAR, type BundleCatalog } from './bundle-catalog.ts';
```

Replace `ServeShapeDeps` (:71-75) with:

```ts
export interface ServeShapeDeps {
  devMode?: () => boolean;
  /** Test seam for bundleBinaryPath's helpers dir; default derives from the running bundle. */
  helpersDir?: string | null;
  /** Test seam for the served-app catalog; default reads the running bundle's deps.lock. */
  catalog?: BundleCatalog | null;
}

export interface Flavor {
  dev: boolean;
  helpersDir: string | null;
  catalog: BundleCatalog | null;
}

export function resolveFlavor(deps: ServeShapeDeps = {}): Flavor {
  return {
    dev: (deps.devMode ?? isDevMode)(),
    helpersDir:
      deps.helpersDir !== undefined ? deps.helpersDir : bundleHelpersDir(),
    catalog: deps.catalog !== undefined ? deps.catalog : bundleCatalog(),
  };
}

/** Prod serves exactly the bundle's catalog: an rt row outside it keeps its
    record and dev link for the other flavor but runs nowhere here. */
export function notServedHere(
  record: AppRecord,
  deps: ServeShapeDeps = {}
): boolean {
  if (record.managedBy !== MATTSTACK_REGISTRAR) return false;
  const { dev, catalog } = resolveFlavor(deps);
  return !dev && catalog !== null && !catalog.has(record.name);
}

/** rt setup stores the absolute helper path of whichever flavor ran it, so any
    bundle's Helpers/<name> counts, not only the running one's. */
function isBundledHelperPath(argv0: string | undefined, name: string): boolean {
  return !!argv0 && argv0.endsWith(`.app/Contents/Helpers/${name}`);
}
```

Replace `bundleShape` (:102-111) with:

```ts
export function bundleShape(
  record: AppRecord,
  helpersDir?: string | null,
  catalog?: BundleCatalog | null
): ResolvedShape | null {
  const dir = helpersDir !== undefined ? helpersDir : bundleHelpersDir();
  const served = catalog !== undefined ? catalog : bundleCatalog();
  const entry = served?.get(record.name);
  if (entry) {
    const bin = bundleBinaryPath(record.name, dir);
    return bin
      ? { command: [bin, ...entry.args], cwd: dataDir(record.name) }
      : null;
  }
  const stored = storedBundleCommand(record, dir);
  if (stored) return stored;
  // With a catalog, a helper outside it is a tool (the gitq CLI), never an app.
  if (served) return null;
  const bin = bundleBinaryPath(record.name, dir);
  return bin ? { command: [bin], cwd: dataDir(record.name) } : null;
}
```

In `serveShape`, replace lines 126-137 (from `const helpersDir =` through the end of the `legacyIgnored` expression, keeping the existing comment above `legacyIgnored` only if it still states a constraint; it does, keep it) with:

```ts
  const { dev, helpersDir, catalog } = resolveFlavor(deps);
  const source = sourceShape(record);
  const bundle = bundleShape(record, helpersDir, catalog);
  const linkBroken = readLinkedManifest(record).state === 'broken';
  const chosen = dev ? (source ?? bundle) : (bundle ?? source);
  const legacyIgnored =
    !!record.command?.length &&
    storedBundleCommand(record, helpersDir) === null &&
    !(
      catalog?.has(record.name) &&
      isBundledHelperPath(record.command[0], record.name)
    );
```

The rest of `serveShape` (:139-167) is unchanged. `isDevMode` and `bundleHelpersDir` stay imported (now used by `resolveFlavor`).

- [ ] **Step 4: Run and see them pass**

```bash
bun test --cwd apps/deck src/registry/serve-shape.test.ts src/registry/migrate-dev-shape.test.ts
```

Expected: all pass, including the 19 pre-existing serve-shape cases (they pass no catalog and run outside a bundle, so `bundleCatalog()` is null and today's rules hold).

- [ ] **Step 5: Format and commit**

```bash
bunx prettier --write apps/deck/src/registry/serve-shape.ts apps/deck/src/registry/serve-shape.test.ts
bunx prettier --check apps/deck/src/registry/serve-shape.ts apps/deck/src/registry/serve-shape.test.ts
git add apps/deck/src/registry/serve-shape.ts apps/deck/src/registry/serve-shape.test.ts
git commit -m "deck: serve catalog apps with catalog args and never serve a tool helper by name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The spec builder owns the data dir and refuses any other missing cwd

**Files:**
- Modify: `src/api/register.ts` (`specFor` at :98-125; imports at :26-41)
- Modify: `src/api/register.test.ts` (fixture dirs: `input` at :84-88, the assertion at :116, `'/tmp/other'` at :244 and :842, `'/tmp/changed'` at :1108, `'/tmp/app2'` at :1192)
- Modify: `src/registry/bootstrap.test.ts` (`'/tmp/stale'` at :221)

**Interfaces:**
- Consumes: `dataDir(name)` (`serve-shape.ts:20`), `isMattstackOwned(record)` (`records.ts:69`).
- Produces (module-private in `register.ts`):
  - `interface BuiltSpec { spec: ServiceSpec; createdCwd: boolean }`
  - `function buildSpec(record: AppRecord, shape: ResolvedShape): BuiltSpec`
  - `function ensureWorkingDirectory(record: AppRecord, cwd: string): boolean` (true when it created the dir; throws `working directory <cwd> does not exist` for a missing dir deck does not own)
  - `specFor(record, shape)` keeps its signature and returns `buildSpec(...).spec`, so `registerApp` (:268-272), `editApp` (:701-706) and `reinstallSupervised` (:825-829) all gain the mkdir and the refusal. Every one of them already runs `specFor` inside `tryDriver` or a `try`, so a refusal lands as a `launchd` SyncIssue, never a crash.

Ownership rule: deck owns a cwd only when the record is mattstack-owned (`managedBy !== 'user'`) and the cwd is exactly `dataDir(record.name)`. A user's dir or a linked checkout is never fabricated, because an empty dir would turn "your checkout is gone" into a confusing module-not-found loop.

- [ ] **Step 1: Point the existing fixtures at real dirs**

The refusal makes every fixture that registers a service with a nonexistent cwd stop installing. In `src/api/register.test.ts`:

- Replace the `input` constant (:84-88) with:

```ts
const input = {
  name: 'myapp',
  command: ['bun', 'src/server.ts'],
  workingDirectory: mkdtempSync(join(tmpdir(), 'myapp-')),
};
```

- At :116 replace `expect(spec.workingDirectory).toBe('/tmp/myapp');` with `expect(spec.workingDirectory).toBe(input.workingDirectory);`.
- Replace each of `'/tmp/other'` (:244, :842), `'/tmp/changed'` (:1108) and `'/tmp/app2'` (:1192) with `mkdtempSync(join(tmpdir(), 'other-'))`, `mkdtempSync(join(tmpdir(), 'changed-'))` and `mkdtempSync(join(tmpdir(), 'app2-'))` respectively.

Add `dataDir` to the file's imports, after the `records.ts` import (:45-46):

```ts
const { dataDir } = await import('../registry/serve-shape.ts');
```

In `src/registry/bootstrap.test.ts` :221 replace `workingDirectory: '/tmp/stale',` with `workingDirectory: mkdtempSync(join(tmpdir(), 'stale-')),` (add `mkdtempSync`, `tmpdir` and `join` to its imports if absent).

Leave `stdoutPath: '/tmp/o'` style literals alone; they are plist fields, not cwds.

- [ ] **Step 2: Write the failing tests**

Append to `src/api/register.test.ts` after the `register:` tests (after the test ending near :225):

```ts
test('register: a user app whose working directory is gone is refused with a launchd issue, never handed to launchd', async () => {
  const gone = join(tmpdir(), `gone-${Date.now()}`);
  const res = await registerApp(
    { ...input, name: 'gone', workingDirectory: gone },
    drivers
  );
  expect(res.status).toBe(201);
  expect(drivers.manager.installed.has(`${LABEL_PREFIX}gone`)).toBe(false);
  const issue = getRecord('gone')!.issues![0]!;
  expect(issue.source).toBe('launchd');
  expect(issue.message).toContain(`working directory ${gone} does not exist`);
  expect(existsSync(gone)).toBe(false);
});

test('register: a managed app served from the bundle gets the data dir deck owns', async () => {
  const h = bundleHelpers('fresh');
  const res = await registerApp(
    {
      ...input,
      name: 'fresh',
      managedBy: 'rt',
      command: h.command('fresh'),
      workingDirectory: dataDir('fresh'),
    },
    drivers
  );
  expect(res.status).toBe(201);
  expect(existsSync(dataDir('fresh'))).toBe(true);
  expect(
    drivers.manager.installed.get(`${LABEL_PREFIX}fresh`)!.workingDirectory
  ).toBe(dataDir('fresh'));
});
```

- [ ] **Step 3: Run and see them fail**

```bash
bun test --cwd apps/deck src/api/register.test.ts -t "working directory is gone|data dir deck owns"
```

Expected: the first fails at `installed.has(...)` (received true: today the plist is written for the missing dir), the second fails at `existsSync(dataDir('fresh'))` (received false).

- [ ] **Step 4: Implement**

In `src/api/register.ts`:

- Add `isMattstackOwned` to the `../registry/records.ts` import (:26-36) and `dataDir` to the `../registry/serve-shape.ts` import (:37-41).
- Replace `specFor` (:98-125, including its doc comment) with:

```ts
interface BuiltSpec {
  spec: ServiceSpec;
  createdCwd: boolean;
}

/**
 * launchd does not search PATH for `ProgramArguments[0]`, so argv0 must be
 * absolute in the plist, and it is resolved again on every render so an
 * interpreter that moves is picked up by the next render.
 *
 * Throws rather than naming a program or a working directory that does not
 * exist: launchd declines such a job (exit 78 for a missing cwd) without
 * logging anything, so writing it anyway produces an app that is silently down.
 */
function buildSpec(record: AppRecord, shape: ResolvedShape): BuiltSpec {
  const env = serviceEnv(record);
  const path = env.PATH ?? composeServicePath();
  const [argv0, ...rest] = shape.command;
  const program = resolveProgram(argv0!, path);
  if (!program)
    throw new Error(`${argv0} not found on the service PATH (${path})`);
  const createdCwd = ensureWorkingDirectory(record, shape.cwd);
  return {
    spec: {
      label: record.label!,
      programArguments: [program, ...rest],
      workingDirectory: shape.cwd,
      environment: { ...env, PATH: path },
      stdoutPath: join(logsDir(), `${record.name}.out.log`),
      stderrPath: join(logsDir(), `${record.name}.err.log`),
    },
    createdCwd,
  };
}

/** Deck owns only a mattstack app's data dir; creating anyone else's missing
    dir would hide a deleted checkout behind an empty one. */
function ensureWorkingDirectory(record: AppRecord, cwd: string): boolean {
  if (existsSync(cwd)) return false;
  if (!isMattstackOwned(record) || cwd !== dataDir(record.name))
    throw new Error(`working directory ${cwd} does not exist`);
  mkdirSync(cwd, { recursive: true });
  return true;
}

function specFor(record: AppRecord, shape: ResolvedShape): ServiceSpec {
  return buildSpec(record, shape).spec;
}
```

`existsSync` and `mkdirSync` are already imported at :1.

- [ ] **Step 5: Run and see them pass, with the fixtures fixed**

```bash
bun test --cwd apps/deck src/api/register.test.ts src/registry/bootstrap.test.ts src/api/server.test.ts src/api/register-manifest.test.ts src/cli/commands.test.ts
```

Expected: all pass. If a test outside the lines listed in Step 1 fails because it registers a service at a nonexistent cwd and then asserts an install, give that fixture a `mkdtempSync` dir the same way and list the line in your report; change nothing else about the test.

- [ ] **Step 6: Format and commit**

```bash
bunx prettier --write apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/registry/bootstrap.test.ts
bunx prettier --check apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/registry/bootstrap.test.ts
git add apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/registry/bootstrap.test.ts
git commit -m "deck: create the data dir deck owns and refuse any other missing working directory" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Also stage any extra fixture file you had to touch in Step 5.

---

## Task 4: The sweep's not-served outcome, data-dir heal, and not-served gating

**Files:**
- Modify: `src/api/register.ts` (`registerApp` install at :266-273, `restartManagedApps` :404-426, `reresolveManagedApps` :428-506, `editApp` guard :648-655 and install :701-707, `reinstallSupervised` :813-844)
- Modify: `src/api/register.test.ts`
- Modify: `src/boot-reresolve.ts`, `src/boot-reresolve.test.ts`

**Interfaces:**
- Consumes: `notServedHere`, `resolveFlavor` (Task 2); `buildSpec` (Task 3); `ServiceManager.kickstart(label): Promise<boolean>` (`manager.ts:40`).
- Produces:
  - `reresolveManagedApps` body gains `notServed: string[]` (the `not-served` outcome): `{ ok, restarted, unchanged, notServed, failed }`.
  - Not-served rows: plist uninstalled (idempotent for a missing plist, `launchd.ts:101`), `launchd` and `dev-link` issues cleared, record and `dev` link untouched.
  - An `unchanged` plist whose owned data dir `buildSpec` just created is kickstarted and reported as `restarted`.
  - A `buildSpec` throw in the sweep now also records a `launchd` SyncIssue (the "board issue" the spec asks for), in addition to the `failed` entry.
  - `unchanged` clears any stale `launchd` issue.
  - `registerApp`, `editApp`, `reinstallSupervised` never install, and `restartManagedApps` never kickstarts, a row `notServedHere` says is not served.
  - `reresolveOnBoot` logs `not-served <names>`.

- [ ] **Step 1: Add the test helpers**

In `src/api/register.test.ts`, add `import type { AppRecord } from '../registry/records.ts';` at the top, then after the `CountingManager` class (:67-87) add:

```ts
/** Writes and removes real plist files the way LaunchdManager does, so the
    sweep's diff reads what the previous sweep installed. */
class PlistManager extends CountingManager {
  override async install(spec: ServiceSpec): Promise<void> {
    await super.install(spec);
    mkdirSync(agentsDir(), { recursive: true });
    writeFileSync(join(agentsDir(), `${spec.label}.plist`), renderPlist(spec));
  }
  override async uninstall(label: string): Promise<void> {
    await super.uninstall(label);
    rmSync(join(agentsDir(), `${label}.plist`), { force: true });
  }
}

const AT = '2026-09-24T00:00:00Z';

function checkout(name: string, start: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${name}-src-`));
  writeFileSync(
    join(dir, 'mattstack.deck.json'),
    JSON.stringify({ name, dev: { start } })
  );
  return dir;
}

function rtRow(name: string, port: number, over: Partial<AppRecord> = {}): void {
  putRecord({
    name,
    managedBy: 'rt',
    port,
    kind: 'service',
    label: `${LABEL_PREFIX}${name}`,
    createdAt: AT,
    ...over,
  });
}

const CHAT_ONLY = new Map([['chat', { port: 11002, args: [] as string[] }]]);
```

`agentsDir()` is shared by every test in this file (`LOCAL_AGENTS_DIR`, :19) and `readServices` reads ports from it, so every test that uses `PlistManager` wraps its body in `rmSync(agentsDir(), { recursive: true, force: true }); try { ... } finally { rmSync(agentsDir(), { recursive: true, force: true }); }`.

- [ ] **Step 2: Write the failing tests**

Append to the reresolve section of `src/api/register.test.ts` (after the test ending near :1491):

```ts
test('reresolve: prod does not serve an rt row outside the catalog; its plist goes, its row and dev link stay', async () => {
  rmSync(agentsDir(), { recursive: true, force: true });
  try {
    const manager = new PlistManager();
    const d = { manager, edge: drivers.edge };
    const h = bundleHelpers('chat');
    const gitqSrc = checkout('gitq', 'bun src/server/server.ts');
    rtRow('gitq', 11008, { dev: { workingDirectory: gitqSrc } });
    setServeShapeDeps({ devMode: () => true, helpersDir: h.dir, catalog: CHAT_ONLY });
    await reresolveManagedApps(d);
    const plist = join(agentsDir(), `${LABEL_PREFIX}gitq.plist`);
    expect(existsSync(plist)).toBe(true);

    setServeShapeDeps({ devMode: () => false, helpersDir: h.dir, catalog: CHAT_ONLY });
    const body = (await reresolveManagedApps(d)).body as any;

    expect(body).toMatchObject({ ok: true, notServed: ['gitq'], failed: [] });
    expect(existsSync(plist)).toBe(false);
    expect(manager.installed.has(`${LABEL_PREFIX}gitq`)).toBe(false);
    expect(getRecord('gitq')!.dev).toEqual({ workingDirectory: gitqSrc });
    expect(getRecord('gitq')!.issues).toBeUndefined();
    expect(existsSync(dataDir('gitq'))).toBe(false);
  } finally {
    rmSync(agentsDir(), { recursive: true, force: true });
  }
});

test('reresolve: prod with no catalog serves rt rows as before and marks none not-served', async () => {
  const h = bundleHelpers('gitq');
  setServeShapeDeps({ devMode: () => false, helpersDir: h.dir, catalog: null });
  await registerApp(
    { ...input, name: 'gitq', managedBy: 'rt', command: h.command('gitq', 'board') },
    drivers
  );
  const body = (await reresolveManagedApps(drivers)).body as any;
  expect(body.notServed).toEqual([]);
  expect(
    drivers.manager.installed.get(`${LABEL_PREFIX}gitq`)!.programArguments
  ).toEqual([join(h.dir, 'gitq'), 'board']);
});

test('reresolve: an unchanged plist whose owned data dir went missing gets the dir back and a kickstart', async () => {
  rmSync(agentsDir(), { recursive: true, force: true });
  try {
    const manager = new PlistManager();
    const d = { manager, edge: drivers.edge };
    const h = bundleHelpers('chat');
    setServeShapeDeps({ devMode: () => false, helpersDir: h.dir, catalog: CHAT_ONLY });
    rtRow('chat', 11002);
    await reresolveManagedApps(d);
    rmSync(dataDir('chat'), { recursive: true, force: true });
    manager.kickstarts = [];

    const body = (await reresolveManagedApps(d)).body as any;

    expect(body).toMatchObject({ ok: true, restarted: ['chat'], unchanged: [] });
    expect(existsSync(dataDir('chat'))).toBe(true);
    expect(manager.kickstarts).toEqual([`${LABEL_PREFIX}chat`]);
    expect(manager.installCalls).toEqual([`${LABEL_PREFIX}chat`]);
  } finally {
    rmSync(agentsDir(), { recursive: true, force: true });
  }
});

test('reresolve: a managed row whose non-owned cwd is gone is refused with a launchd issue and never installed', async () => {
  const counting = new CountingManager();
  const h = bundleHelpers('legacy');
  const gone = join(tmpdir(), `gone-${Date.now()}`);
  rtRow('legacy', 11050, { command: h.command('legacy'), workingDirectory: gone });
  setServeShapeDeps({ devMode: () => false, helpersDir: h.dir, catalog: null });

  const body = (await reresolveManagedApps({ manager: counting, edge: drivers.edge })).body as any;

  expect(body.failed).toEqual([
    { name: 'legacy', error: expect.stringContaining(`working directory ${gone} does not exist`) },
  ]);
  expect(getRecord('legacy')!.issues![0]!.source).toBe('launchd');
  expect(counting.installCalls).toEqual([]);
});

test('restartManagedApps skips a row prod does not serve, so the verb does not fail on its missing plist', async () => {
  const h = bundleHelpers('chat');
  setServeShapeDeps({ devMode: () => false, helpersDir: h.dir, catalog: CHAT_ONLY });
  rtRow('gitq', 11008);
  await registerApp(
    { ...input, name: 'chat', managedBy: 'rt', command: h.command('chat') },
    drivers
  );
  const res = await restartManagedApps(drivers);
  expect(res.body).toEqual({ ok: true, restarted: ['chat'], failed: [] });
  expect(drivers.manager.kickstarts).toEqual([`${LABEL_PREFIX}chat`]);
});

test('prod: registering or linking a not-served row writes the record but never its plist', async () => {
  const h = bundleHelpers('chat', 'gitq');
  setServeShapeDeps({ devMode: () => false, helpersDir: h.dir, catalog: CHAT_ONLY });
  await registerApp(
    { ...input, name: 'gitq', managedBy: 'rt', command: h.command('gitq', 'board') },
    drivers
  );
  expect(drivers.manager.installed.has(`${LABEL_PREFIX}gitq`)).toBe(false);
  const src = checkout('gitq', 'bun src/server/server.ts');
  const res = await editApp('gitq', { dev: { workingDirectory: src } }, 'user', false, drivers);
  expect(res.status).toBe(200);
  expect(getRecord('gitq')!.dev).toEqual({ workingDirectory: src });
  expect(drivers.manager.installed.has(`${LABEL_PREFIX}gitq`)).toBe(false);
});
```

Append to `src/boot-reresolve.test.ts`:

```ts
test('a bundled deck names the rows it does not serve', async () => {
  const lines: string[] = [];
  await reresolveOnBoot({
    bundleRoot: '/Applications/mattstack.app',
    reresolve: async () => swept({ notServed: ['gitq'] }),
    log: line => lines.push(line),
  });
  expect(lines).toEqual(['[reresolve] boot: not-served gitq']);
});
```

- [ ] **Step 3: Run and see them fail**

```bash
bun test --cwd apps/deck src/api/register.test.ts src/boot-reresolve.test.ts -t "not serve|no catalog|went missing|non-owned cwd|skips a row|not-served row|does not serve"
```

Expected failures: the not-served test (`notServed` undefined, plist still present); the no-catalog test (`body.notServed` undefined); the data-dir test (`unchanged: ['chat']`, no kickstart); the non-owned-cwd test (no issue on the record); the restart test (`failed: [{ name: 'gitq', error: 'kickstart failed' }]`); the not-served-row test (gitq installed); the boot log test (no line).

- [ ] **Step 4: Implement**

In `src/api/register.ts`, add `notServedHere` and `resolveFlavor` to the `../registry/serve-shape.ts` import.

`registerApp` (:266-273): replace `if (isService) {` with `if (isService && !notServedHere(record, serveShapeDeps)) {`.

`restartManagedApps` (:417): change the loop's first guard to

```ts
    if (record.kind !== 'service' || !record.label) continue;
    if (notServedHere(record, serveShapeDeps)) continue;
```

`editApp`: replace the guard at :648 `if (next.kind === 'service' && !serveShape(next, serveShapeDeps)) {` with

```ts
  const servedHere =
    next.kind === 'service' && !notServedHere(next, serveShapeDeps);
  if (servedHere && !serveShape(next, serveShapeDeps)) {
```

and at :701 replace `if (next.kind === 'service') {` with `if (servedHere) {`. The teardown uninstall at :667-672 stays unconditional (it is idempotent and must remove a plist another flavor left).

`reinstallSupervised` (:817-822): after the existing `continue` guard add

```ts
    if (notServedHere(record, serveShapeDeps)) continue;
```

Replace `reresolveManagedApps` (its doc comment :428-436 and body :437-506) with:

```ts
/**
 * The flavor sweep. Deck runs it on every bundled start, which is every
 * switch between mattstack-dev.app and mattstack.app, and it is the only
 * writer that moves managed apps between shapes. An rt row prod does not
 * serve loses its plist but keeps its record and dev link for the other
 * flavor. Every other managed row is re-resolved and diffed against its
 * installed plist (ProgramArguments, WorkingDirectory, EnvironmentVariables),
 * so a flip and a flip-back both read as "unchanged".
 */
export async function reresolveManagedApps(
  drivers: Drivers
): Promise<FlowResult> {
  const restarted: string[] = [];
  const unchanged: string[] = [];
  const notServed: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const record of listRecords()) {
    if (
      record.managedBy === 'user' ||
      record.kind !== 'service' ||
      !record.label
    )
      continue;
    // The platform never restarts itself mid-request; bootstrapSelf owns its shape.
    if (isPlatformManagedBy(record.managedBy)) continue;
    if (notServedHere(record, serveShapeDeps)) {
      const issue = await runDriver('launchd', () =>
        drivers.manager.uninstall(record.label!)
      );
      if (issue) {
        addIssue(record.name, issue);
        failed.push({ name: record.name, error: issue.message });
        continue;
      }
      clearIssues(record.name, 'launchd');
      clearIssues(record.name, 'dev-link');
      notServed.push(record.name);
      continue;
    }
    const shape = serveShape(record, serveShapeDeps);
    if (!shape) {
      failed.push({ name: record.name, error: 'no runnable shape' });
      continue;
    }
    let built: BuiltSpec;
    try {
      built = buildSpec(record, shape);
    } catch (err) {
      const message = String(err).slice(0, 300);
      addIssue(record.name, {
        source: 'launchd',
        message,
        at: new Date().toISOString(),
      });
      failed.push({ name: record.name, error: message });
      continue;
    }
    const { spec, createdCwd } = built;
    if (installedMatches(record.label, spec)) {
      if (!createdCwd) {
        clearIssues(record.name, 'launchd');
        unchanged.push(record.name);
        continue;
      }
      // The installed job has been failing to spawn on the missing dir, and
      // launchd's KeepAlive backoff would otherwise decide when it recovers.
      const ok = await drivers.manager
        .kickstart(record.label)
        .catch(() => false);
      if (ok) {
        clearIssues(record.name, 'launchd');
        restarted.push(record.name);
      } else {
        failed.push({ name: record.name, error: 'kickstart failed' });
      }
      continue;
    }
    // launchd has no atomic replace, so a failure between the two calls is a
    // real possibility: an uninstall that throws must not be followed by an
    // install attempt, and an install that throws leaves the app down, which
    // is recorded as a SyncIssue so it outlives this response.
    const uninstallIssue = await runDriver('launchd', () =>
      drivers.manager.uninstall(record.label!)
    );
    if (uninstallIssue) {
      failed.push({ name: record.name, error: uninstallIssue.message });
      continue;
    }
    const installIssue = await runDriver('launchd', () =>
      drivers.manager.install(spec)
    );
    if (installIssue) {
      addIssue(record.name, installIssue);
      failed.push({ name: record.name, error: installIssue.message });
      continue;
    }
    clearIssues(record.name, 'launchd');
    restarted.push(record.name);
  }
  return {
    status: 200,
    body: { ok: failed.length === 0, restarted, unchanged, notServed, failed },
  };
}

function installedMatches(label: string, spec: ServiceSpec): boolean {
  const installed = readInstalledProgramArguments(label);
  const installedEnv = readInstalledEnvironment(label);
  return (
    installed !== null &&
    installed.length === spec.programArguments.length &&
    installed.every((a, i) => a === spec.programArguments[i]) &&
    readInstalledWorkingDirectory(label) === spec.workingDirectory &&
    installedEnv !== null &&
    sameEnvironment(installedEnv, renderedEnvironment(spec))
  );
}
```

`resolveFlavor` is imported now and first used in Task 5; if your linter flags it as unused, add it in Task 5 instead.

In `src/boot-reresolve.ts`, add `notServed?: string[];` to `Swept` and, after the `restarted` part (:28-29), add:

```ts
  if (body.notServed?.length)
    parts.push(`not-served ${body.notServed.join(', ')}`);
```

- [ ] **Step 5: Run and see them pass**

```bash
bun test --cwd apps/deck src/api/register.test.ts src/boot-reresolve.test.ts src/registry/bootstrap.test.ts src/api/register-manifest.test.ts src/cli/commands.test.ts
```

Expected: all pass, including every pre-existing reresolve test (:1089-1491): the body only gained a key, and `toMatchObject` ignores it.

- [ ] **Step 6: Format and commit**

```bash
bunx prettier --write apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts apps/deck/src/boot-reresolve.test.ts
bunx prettier --check apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts apps/deck/src/boot-reresolve.test.ts
git add apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts apps/deck/src/boot-reresolve.test.ts
git commit -m "deck: the boot sweep stops serving rt rows outside the prod catalog and heals missing data dirs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Catalog rows are created in both flavors and adopted in prod; the dev to prod to dev flip

**Files:**
- Modify: `src/api/register.ts` (`reresolveManagedApps` from Task 4; new `ensureCatalogRows`, `adoptedCatalogRow`)
- Modify: `src/api/register.test.ts`
- Modify: `src/boot-reresolve.ts`, `src/boot-reresolve.test.ts`

**Interfaces:**
- Consumes: `resolveFlavor` (Task 2); `MATTSTACK_REGISTRAR`, `BundleCatalog` (Task 1); `readDeckManifest` (`register.ts:23`); `ingestManifest` (`register.ts:25`); `reconcileMattstackTld` (`register.ts:60`); `tryDriver` (:142).
- Produces:
  - `async function ensureCatalogRows(catalog: BundleCatalog, drivers: Drivers, adopt: boolean): Promise<{ created: string[]; adopted: string[]; failed: Array<{ name: string; error: string }> }>`
  - `function adoptedCatalogRow(record: AppRecord): AppRecord`
  - `reresolveManagedApps` body becomes `{ ok, restarted, unchanged, notServed, created, adopted, failed }`; `created`/`adopted` are always arrays (`adopted` is empty in dev, both are empty with no catalog).
  - `reresolveOnBoot` logs `created ...; adopted ...` ahead of `restarted`.

Rules (catalog present; the create leg runs in both flavors, adoption and the route-only report only in prod; see Contract note 12 for the decision this records):
- No row: create `{ name, managedBy: 'rt', port: <catalog port>, kind: 'service', label: 'com.mattstack.deck.<name>', createdAt }`, alias `<name>.localhost` to the port, run `ingestManifest(name)` (a quiet no-op until unit C gives it a bundle identity source). Refused, with a `failed` entry, when another record already holds the catalog port. A row created in dev has no dev link, so dev serves it from the dev bundle's `Helpers/<name>` with the catalog args; linking a checkout later switches it to source.
- Prod only: a `managedBy: 'user'` service row is adopted as rt. Keep its `dev` link; if it has none but its stored `workingDirectory` holds a manifest naming this app, that dir becomes the dev link and the stored `command`, `workingDirectory` and `commands` are cleared (the same slimming `migrate-dev-shape.ts:57-64` does). The row keeps its existing port.
- Prod only: a `managedBy: 'user'` route-only (`external`) row is never adopted or converted; `failed` names `deck remove <name>` as the fix. In dev both kinds of user row are the user's and are left alone.
- Any other existing row: left alone.
- After any create or adopt, `reconcileMattstackTld()` so the row gets its `.mattstack` route in the same boot.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/register.test.ts`:

```ts
// ─── the flavor flip on a lived-in registry ───────────────────────────────

const FLIP_CATALOG = new Map([
  ['board', { port: 11006, args: [] as string[] }],
  ['chat', { port: 11002, args: [] as string[] }],
  ['console', { port: 11001, args: [] as string[] }],
  ['boxscore', { port: 11005, args: [] as string[] }],
]);

function fakeBundle(appName: string): string {
  const helpers = join(
    mkdtempSync(join(tmpdir(), 'flip-')),
    appName,
    'Contents',
    'Helpers'
  );
  mkdirSync(helpers, { recursive: true });
  for (const n of ['board', 'chat', 'console', 'boxscore', 'gitq', 'deck'])
    writeFileSync(join(helpers, n), '');
  return helpers;
}

/** Every key an AppRecord could carry in deck 1.0.7; the other flavor's
    pinned deck reads the same registry file. */
const DECK_107_RECORD_KEYS = new Set([
  'name', 'managedBy', 'port', 'kind', 'command', 'workingDirectory', 'env',
  'label', 'displayName', 'description', 'icon', 'badge', 'commands',
  'altConfigs', 'activeAlt', 'sourceDirectory', 'dev', 'grandfathered',
  'createdAt', 'issues', 'remote',
]);

test('flip: dev -> prod -> dev on a lived-in registry creates missing catalog rows in either flavor, adopts only in prod, and deletes nothing', async () => {
  rmSync(agentsDir(), { recursive: true, force: true });
  try {
    const manager = new PlistManager();
    const flip = { manager, edge: drivers.edge };
    const prodHelpers = fakeBundle('mattstack.app');
    const devHelpers = fakeBundle('mattstack-dev.app');
    const chatSrc = checkout('chat', 'bun src/server/index.ts');
    const gitqSrc = checkout('gitq', 'bun src/server/server.ts');
    const boxSrc = checkout('boxscore', 'bun src/server/index.ts');
    rtRow('chat', 11002, { dev: { workingDirectory: chatSrc } });
    rtRow('gitq', 11008, { dev: { workingDirectory: gitqSrc } });
    rtRow('console', 11001, {
      command: [join(devHelpers, 'console')],
      workingDirectory: dataDir('console'),
    });
    rtRow('boxscore', 11005, {
      managedBy: 'user',
      command: ['bun', 'src/server/index.ts'],
      workingDirectory: boxSrc,
    });
    const spec = (name: string) => manager.installed.get(`${LABEL_PREFIX}${name}`);
    const dev = { devMode: () => true, helpersDir: devHelpers, catalog: FLIP_CATALOG };
    const prod = { devMode: () => false, helpersDir: prodHelpers, catalog: FLIP_CATALOG };

    setServeShapeDeps(dev);
    const dev0 = (await reresolveManagedApps(flip)).body as any;
    expect(dev0).toMatchObject({ created: ['board'], adopted: [], notServed: [], failed: [] });
    expect(getRecord('board')!.managedBy).toBe('rt');
    expect(spec('board')!.programArguments).toEqual([join(devHelpers, 'board')]);
    expect(spec('board')!.workingDirectory).toBe(dataDir('board'));
    expect(getRecord('boxscore')!.managedBy).toBe('user');
    expect(spec('chat')!.workingDirectory).toBe(chatSrc);
    expect(existsSync(dataDir('chat'))).toBe(false);

    setServeShapeDeps(prod);
    const toProd = (await reresolveManagedApps(flip)).body as any;
    expect(toProd).toMatchObject({
      ok: true,
      created: [],
      adopted: ['boxscore'],
      notServed: ['gitq'],
      failed: [],
    });
    expect([...toProd.restarted].sort()).toEqual(['board', 'boxscore', 'chat', 'console']);
    for (const name of ['board', 'boxscore', 'chat', 'console']) {
      expect(spec(name)!.programArguments).toEqual([join(prodHelpers, name)]);
      expect(spec(name)!.workingDirectory).toBe(dataDir(name));
      expect(existsSync(dataDir(name))).toBe(true);
      expect(getRecord(name)!.managedBy).toBe('rt');
      expect(getRecord(name)!.issues ?? []).toEqual([]);
    }
    expect(spec('gitq')).toBeUndefined();
    expect(existsSync(join(agentsDir(), `${LABEL_PREFIX}gitq.plist`))).toBe(false);
    expect(getRecord('gitq')!.dev).toEqual({ workingDirectory: gitqSrc });
    expect(getRecord('board')!.port).toBe(11006);
    expect(drivers.edge.aliases.get('board')).toBe(11006);
    expect(getRecord('boxscore')!.dev).toEqual({ workingDirectory: boxSrc });
    expect(getRecord('boxscore')!.command).toBeUndefined();

    setServeShapeDeps(dev);
    const toDev = (await reresolveManagedApps(flip)).body as any;
    expect(toDev).toMatchObject({ ok: true, created: [], adopted: [], notServed: [], failed: [] });
    expect(spec('chat')!.workingDirectory).toBe(chatSrc);
    expect(spec('gitq')!.workingDirectory).toBe(gitqSrc);
    expect(spec('boxscore')!.workingDirectory).toBe(boxSrc);
    expect(spec('console')!.programArguments).toEqual([join(devHelpers, 'console')]);
    expect(spec('board')!.programArguments).toEqual([join(devHelpers, 'board')]);
    expect(listRecords().map(r => r.name).sort()).toEqual([
      'board', 'boxscore', 'chat', 'console', 'gitq',
    ]);

    setServeShapeDeps(prod);
    await reresolveManagedApps(flip);
    const settled = (await reresolveManagedApps(flip)).body as any;
    expect(settled).toMatchObject({
      ok: true, restarted: [], created: [], adopted: [], notServed: ['gitq'],
    });
    expect([...settled.unchanged].sort()).toEqual(['board', 'boxscore', 'chat', 'console']);

    const file = JSON.parse(readFileSync(process.env.LOCAL_REGISTRY_PATH!, 'utf8'));
    expect(file.version).toBe(1);
    for (const record of Object.values(file.apps) as Array<Record<string, unknown>>)
      for (const key of Object.keys(record)) expect(DECK_107_RECORD_KEYS.has(key)).toBe(true);
  } finally {
    rmSync(agentsDir(), { recursive: true, force: true });
  }
});

test('prod catalog: a catalog port held by another row, or a route-only row with a catalog name, is reported and never duplicated', async () => {
  const helpers = fakeBundle('mattstack.app');
  putRecord({ name: 'mine', managedBy: 'user', port: 11006, kind: 'external', createdAt: AT });
  putRecord({ name: 'chat', managedBy: 'user', port: 11002, kind: 'external', createdAt: AT });
  setServeShapeDeps({
    devMode: () => false,
    helpersDir: helpers,
    catalog: new Map([
      ['board', { port: 11006, args: [] as string[] }],
      ['chat', { port: 11002, args: [] as string[] }],
    ]),
  });

  const body = (await reresolveManagedApps(drivers)).body as any;

  expect(body.created).toEqual([]);
  expect(body.adopted).toEqual([]);
  expect(body.failed).toEqual([
    { name: 'board', error: 'catalog port 11006 is held by mine' },
    { name: 'chat', error: 'chat is a route-only app; `deck remove chat` lets mattstack serve it' },
  ]);
  expect(getRecord('board')).toBeUndefined();
  expect(getRecord('chat')!.managedBy).toBe('user');
  expect(getRecord('chat')!.kind).toBe('external');
});
```

`readFileSync` and `listRecords` are already imported by this file (:1-8, :45-46).

Append to `src/boot-reresolve.test.ts`:

```ts
test('a prod deck names the catalog rows it created and adopted ahead of what it restarted', async () => {
  const lines: string[] = [];
  await reresolveOnBoot({
    bundleRoot: '/Applications/mattstack.app',
    reresolve: async () =>
      swept({
        created: ['board'],
        adopted: ['boxscore'],
        restarted: ['board', 'boxscore'],
        notServed: ['gitq'],
      }),
    log: line => lines.push(line),
  });
  expect(lines).toEqual([
    '[reresolve] boot: created board; adopted boxscore; restarted board, boxscore; not-served gitq',
  ]);
});
```

- [ ] **Step 2: Run and see them fail**

```bash
bun test --cwd apps/deck src/api/register.test.ts src/boot-reresolve.test.ts -t "flip: dev|catalog port held|created and adopted"
```

Expected: the flip test fails at `dev0` (`created` undefined, no board row), the collision test fails at `body.created` (undefined), the log test fails (no `created` part).

- [ ] **Step 3: Implement**

In `src/api/register.ts`, add:

```ts
import { MATTSTACK_REGISTRAR, type BundleCatalog } from '../registry/bundle-catalog.ts';
```

Add above `reresolveManagedApps`:

```ts
type SweepFailure = { name: string; error: string };

/**
 * Every catalog app gets an rt row in either flavor, so a fresh machine
 * serves the catalog whichever app it opens first. Only prod (`adopt`) takes
 * over a same-named user row: dev serves the user's registrations as they
 * are. A route-only row or a catalog port another row holds is reported,
 * never overwritten.
 */
async function ensureCatalogRows(
  catalog: BundleCatalog,
  drivers: Drivers,
  adopt: boolean
): Promise<{ created: string[]; adopted: string[]; failed: SweepFailure[] }> {
  const created: string[] = [];
  const adopted: string[] = [];
  const failed: SweepFailure[] = [];
  for (const [name, entry] of catalog) {
    const existing = getRecord(name);
    if (!existing) {
      const holder = listRecords().find(r => r.port === entry.port);
      if (holder) {
        failed.push({
          name,
          error: `catalog port ${entry.port} is held by ${holder.name}`,
        });
        continue;
      }
      putRecord({
        name,
        managedBy: MATTSTACK_REGISTRAR,
        port: entry.port,
        kind: 'service',
        label: `${LABEL_PREFIX}${name}`,
        createdAt: new Date().toISOString(),
      });
      await tryDriver(name, 'portless', () =>
        drivers.edge.alias(name, entry.port)
      );
      ingestManifest(name);
      created.push(name);
      continue;
    }
    if (!adopt || existing.managedBy !== 'user') continue;
    if (existing.kind !== 'service') {
      failed.push({
        name,
        error: `${name} is a route-only app; \`deck remove ${name}\` lets mattstack serve it`,
      });
      continue;
    }
    putRecord(adoptedCatalogRow(existing));
    ingestManifest(name);
    adopted.push(name);
  }
  return { created, adopted, failed };
}

/** A registered checkout becomes the dev link, the way migrateManagedDevShape
    slims a row; without one the stored command stays and is flagged as legacy. */
function adoptedCatalogRow(record: AppRecord): AppRecord {
  const dir = record.workingDirectory;
  const parsed = !record.dev && dir ? readDeckManifest(dir) : null;
  const dev =
    record.dev ??
    (parsed?.ok && parsed.manifest.name === record.name
      ? { workingDirectory: dir! }
      : undefined);
  if (!dev) return { ...record, managedBy: MATTSTACK_REGISTRAR };
  return {
    ...record,
    managedBy: MATTSTACK_REGISTRAR,
    dev,
    command: undefined,
    workingDirectory: undefined,
    commands: undefined,
  };
}
```

In `reresolveManagedApps` (from Task 4):

- Replace `const failed: Array<{ name: string; error: string }> = [];` with:

```ts
  const failed: SweepFailure[] = [];
  const flavor = resolveFlavor(serveShapeDeps);
  const ensured = flavor.catalog
    ? await ensureCatalogRows(flavor.catalog, drivers, !flavor.dev)
    : { created: [], adopted: [], failed: [] };
  failed.push(...ensured.failed);
```

- Replace the final `return` with:

```ts
  if (ensured.created.length || ensured.adopted.length) {
    try {
      reconcileMattstackTld();
    } catch (err) {
      failed.push({
        name: 'deck',
        error: `mattstack route reconcile failed: ${String(err).slice(0, 200)}`,
      });
    }
  }
  return {
    status: 200,
    body: {
      ok: failed.length === 0,
      restarted,
      unchanged,
      notServed,
      created: ensured.created,
      adopted: ensured.adopted,
      failed,
    },
  };
```

- Add one sentence to its doc comment, after the first sentence: `It first gives every catalog app an rt row in either flavor, adopting same-named user rows only in prod (ensureCatalogRows).`

In `src/boot-reresolve.ts`, add `created?: string[]; adopted?: string[];` to `Swept`, and at the top of the parts list (before `restarted`) add:

```ts
  if (body.created?.length) parts.push(`created ${body.created.join(', ')}`);
  if (body.adopted?.length) parts.push(`adopted ${body.adopted.join(', ')}`);
```

- [ ] **Step 4: Run and see them pass**

```bash
bun test --cwd apps/deck src/api/register.test.ts src/boot-reresolve.test.ts src/api/tld-reconcile.test.ts
```

Expected: all pass, including Task 4's not-served test (its first, dev pass now also creates a `chat` row from `CHAT_ONLY`, which serves cleanly from its helpers dir, and its prod pass still reports `notServed: ['gitq']`).

- [ ] **Step 5: Format and commit**

```bash
bunx prettier --write apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts apps/deck/src/boot-reresolve.test.ts
bunx prettier --check apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts apps/deck/src/boot-reresolve.test.ts
git add apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/boot-reresolve.ts apps/deck/src/boot-reresolve.test.ts
git commit -m "deck: the boot sweep creates a row for every catalog app and adopts in prod" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: /api/apps hides rows this flavor does not serve

**Files:**
- Modify: `src/api/discovery.ts` (`buildDiscoveryApps` at :25-50)
- Modify: `src/api/discovery.test.ts`
- Modify: `src/api/server.ts` (import from `./register.ts` at :78-89; the `/api/apps` handler at :370)

**Interfaces:**
- Consumes: `notServedHere`, `ServeShapeDeps` (Task 2); `serveShapeDeps` (`register.ts:93`).
- Produces: `export async function buildDiscoveryApps(opts: BuildStatusOpts, flavor: ServeShapeDeps = {}): Promise<DiscoveryApp[]>`. The response shape of `/api/apps` is unchanged; only its membership changes. `/api/v1/status` and `/api/v1/apps` still list the row (the deck board keeps showing it).

- [ ] **Step 1: Write the failing test**

Append to `src/api/discovery.test.ts`:

```ts
test('discovery hides an rt app the prod catalog does not serve, and shows it in dev', async () => {
  putRecord({ name: 'chat', managedBy: 'rt', port: 11002, kind: 'service', createdAt: '2026-09-24T00:00:00Z' });
  putRecord({ name: 'gitq', managedBy: 'rt', port: 11008, kind: 'service', createdAt: '2026-09-24T00:00:00Z' });
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([
      { hostname: 'chat.localhost', port: 11002 },
      { hostname: 'gitq.localhost', port: 11008 },
    ])
  );
  const catalog = new Map([['chat', { port: 11002, args: [] as string[] }]]);

  const prod = await buildDiscoveryApps(statusOpts, { devMode: () => false, catalog });
  expect(prod.map(a => a.name)).toEqual(['chat']);

  const dev = await buildDiscoveryApps(statusOpts, { devMode: () => true, catalog });
  expect(dev.map(a => a.name).sort()).toEqual(['chat', 'gitq']);
});
```

- [ ] **Step 2: Run and see it fail**

```bash
bun test --cwd apps/deck src/api/discovery.test.ts -t "does not serve"
```

Expected: fails with `prod` names `['chat', 'gitq']`.

- [ ] **Step 3: Implement**

`src/api/discovery.ts`: import `{ notServedHere, type ServeShapeDeps } from '../registry/serve-shape.ts'`, change the signature to `buildDiscoveryApps(opts: BuildStatusOpts, flavor: ServeShapeDeps = {})`, and after the user/platform `continue` (:32-33) add:

```ts
    if (notServedHere(record, flavor)) continue;
```

Extend its doc comment's first line to: `The launcher's app list: managed products this flavor serves, deck's own platform row and all user apps excluded.`

`src/api/server.ts`: add `serveShapeDeps` to the `./register.ts` import (:78-89) and change :370 to `(await buildDiscoveryApps(statusOpts, serveShapeDeps)).map(a => ({`.

- [ ] **Step 4: Run and see it pass**

```bash
bun test --cwd apps/deck src/api/discovery.test.ts src/api/discovery-e2e.test.ts src/api/server.test.ts
```

Expected: all pass.

- [ ] **Step 5: Format and commit**

```bash
bunx prettier --write apps/deck/src/api/discovery.ts apps/deck/src/api/discovery.test.ts apps/deck/src/api/server.ts
bunx prettier --check apps/deck/src/api/discovery.ts apps/deck/src/api/discovery.test.ts apps/deck/src/api/server.ts
git add apps/deck/src/api/discovery.ts apps/deck/src/api/discovery.test.ts apps/deck/src/api/server.ts
git commit -m "deck: /api/apps lists only the apps this flavor serves" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: `deck remove --managed <name>` removes one row; the refusal names the real escape hatch

**Files:**
- Modify: `src/api/register.ts` (`removeManagedApps` :508-529)
- Modify: `src/api/server.ts` (managed remove route :489-503)
- Modify: `src/cli/commands.ts` (USAGE :26; `remove --managed` branch :155-167)
- Modify: `src/registry/lifecycle.ts` (:35)
- Modify: `src/registry/lifecycle.test.ts` (:21), `src/api/register.test.ts` (:221-223, plus new tests), `src/cli/commands.test.ts`
- Modify: `core/board/useBoardState.ts` (comment at :565-566), then regenerate `core/generated/board.js` if the build output changes

**Interfaces:**
- Produces:
  - `export async function removeManagedApps(drivers: Drivers, only?: string): Promise<FlowResult>`: with `only`, removes only that managed record; `404 { error: 'unknown app' }` when no record has that name; `409 { error: '<name> is not managed' }` for a user or platform record. Without `only`, unchanged bulk behavior.
  - `POST /api/v1/apps/managed/remove` accepts an optional JSON body `{ "name": "<app>" }`.
  - `deck remove --managed [name]`; exit 1 printing the API error when the named form answers non-200.
  - Refusal message for a registrar-owned row: `Managed by <display>: remove it anyway with \`deck remove <name> --force\``.

- [ ] **Step 1: Write the failing tests**

In `src/registry/lifecycle.test.ts` replace the `message` expectation at :21 with:

```ts
    expect(v.body.message).toBe(
      'Managed by mattstack: remove it anyway with `deck remove gitq --force`'
    );
    expect(v.body.message).not.toContain('uninstall');
```

In `src/api/register.test.ts` replace the expectation at :221-223 with:

```ts
  expect((denied.body as any).message).toBe(
    'Managed by mattstack: remove it anyway with `deck remove myapp --force`'
  );
```

Append to `src/api/register.test.ts` next to the `removeManagedApps` tests (:1022-1045):

```ts
test('removeManagedApps with a name removes only that managed record', async () => {
  const h = bundleHelpers('one', 'two');
  for (const n of ['one', 'two'])
    await registerApp(
      { ...input, name: n, managedBy: 'rt', command: h.command(n) },
      drivers
    );
  await registerApp({ ...input, name: 'mine' }, drivers);

  const res = await removeManagedApps(drivers, 'one');

  expect(res.body).toMatchObject({ ok: true, removed: ['one'], failed: [] });
  expect(getRecord('one')).toBeUndefined();
  expect(getRecord('two')).toBeDefined();
  expect(getRecord('mine')).toBeDefined();
});

test('removeManagedApps with an absent or user-owned name removes nothing and says so', async () => {
  await registerApp({ ...input, name: 'mine' }, drivers);
  expect(await removeManagedApps(drivers, 'ghost')).toEqual({
    status: 404,
    body: { error: 'unknown app' },
  });
  expect(await removeManagedApps(drivers, 'mine')).toEqual({
    status: 409,
    body: { error: 'mine is not managed' },
  });
  expect(getRecord('mine')).toBeDefined();
});
```

Append to `src/cli/commands.test.ts`, modeled on the test at :94-135:

```ts
test('remove --managed <name> removes only that app', async () => {
  const helpers = mkdtempSync(join(tmpdir(), 'helpers-'));
  for (const n of ['t-one', 't-two']) writeFileSync(join(helpers, n), '');
  setServeShapeDeps({ helpersDir: helpers });
  for (const n of ['t-one', 't-two'])
    await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-local-caller': 'rt' },
      body: JSON.stringify({
        name: n,
        command: [join(helpers, n)],
        workingDirectory: dir,
      }),
    });

  const removed = io();
  expect(await runCommand(['remove', '--managed', 't-one'], removed)).toBe(0);
  expect(removed.lines.join('\n')).toContain('removed t-one');
  expect(removed.lines.join('\n')).not.toContain('t-two');

  const missing = io();
  expect(await runCommand(['remove', '--managed', 't-ghost'], missing)).toBe(1);
  expect(missing.lines.join('\n')).toContain('unknown app');

  const s = io();
  await runCommand(['status'], s);
  expect(s.lines.join('\n')).toContain('t-two');
  expect(s.lines.join('\n')).not.toContain('t-one');

  await runCommand(['remove', '--managed'], io());
  setServeShapeDeps({});
});
```

- [ ] **Step 2: Run and see them fail**

```bash
bun test --cwd apps/deck src/registry/lifecycle.test.ts src/api/register.test.ts src/cli/commands.test.ts -t "spec's exact 409|registrar-owned, 409|removeManagedApps with|remove --managed <name>"
```

Expected: the two message tests fail on the old `rt uninstall` text; the named `removeManagedApps` test fails because `two` was removed too; the absent-name test gets `200`; the CLI test sees `t-two` removed.

- [ ] **Step 3: Implement**

`src/registry/lifecycle.ts` :35 becomes:

```ts
      : `Managed by ${MANAGER_DISPLAY[record.managedBy] ?? record.managedBy}: remove it anyway with \`deck remove ${record.name} --force\``;
```

`src/api/register.ts`: replace `removeManagedApps` and its doc comment (:508-529) with:

```ts
/**
 * Lifecycle verb behind `deck remove --managed [name]`: with a name it removes
 * only that managed record, without one every non-user record deck
 * supervises. Same implicit-authority model as restartManagedApps.
 */
export async function removeManagedApps(
  drivers: Drivers,
  only?: string
): Promise<FlowResult> {
  let managed = listRecords().filter(
    r => r.managedBy !== 'user' && !isPlatformManagedBy(r.managedBy)
  );
  if (only !== undefined) {
    if (!getRecord(only)) return { status: 404, body: { error: 'unknown app' } };
    managed = managed.filter(r => r.name === only);
    if (managed.length === 0)
      return { status: 409, body: { error: `${only} is not managed` } };
  }
  const removed: string[] = [];
  const failed: string[] = [];
  for (const record of managed) {
    const flipFailure = await flipRemoteBack(record, drivers);
    if (flipFailure) {
      failed.push(record.name);
      continue;
    }
    const { ok } = await teardownRecord(record, drivers);
    if (ok) removed.push(record.name);
    else failed.push(record.name);
  }
  return { status: 200, body: { ok: failed.length === 0, removed, failed } };
}
```

`src/api/server.ts` managed-remove route (:489-503): read the optional name and pass it through.

```ts
          const b = await body(req);
          const only =
            typeof b.name === 'string' && b.name ? b.name : undefined;
          const remoteDrivers = listRecords().some(
            r => r.managedBy !== 'user' && r.remote
          )
            ? resolveRemoteDrivers(
                deps,
                await readDeckSecrets(deps.deckSecrets)
              )
            : {};
          const r = await removeManagedApps({ ...deps, ...remoteDrivers }, only);
          return json(r.body, r.status);
```

`src/cli/commands.ts`:
- USAGE :26 becomes `  deck remove --managed [name]             unregister one managed app, or every one (installer's uninstall step)` (keep the column alignment of the neighboring lines).
- In the `remove --managed` branch (:156-160) replace the `apiJson` call with:

```ts
          const only = rest.find(a => !a.startsWith('--'));
          const { status, body } = await apiJson(
            `/api/v1/apps/managed/remove`,
            {
              method: 'POST',
              ...(only && { body: JSON.stringify({ name: only }) }),
            }
          );
```

The rest of the branch is unchanged: a non-200 prints `body.error` and returns 1, which rt's uninstall already reads as "nothing to remove" for both new errors.

`core/board/useBoardState.ts` :565-566: the comment quotes the old `rt uninstall <app>` hatch. Change it to:

```ts
      // Surface the API's message VERBATIM: for managed rows it carries the
      // escape hatch (`deck remove <name> --force`).
```

Then regenerate and check the committed board bundle:

```bash
bun run --cwd apps/deck build:board
git status --short apps/deck/core/generated
```

If `core/generated/*` changed, include it in this commit.

- [ ] **Step 4: Run and see them pass**

```bash
bun test --cwd apps/deck src/registry/lifecycle.test.ts src/api/register.test.ts src/cli/commands.test.ts src/api/server.test.ts core/generated-fresh.test.ts
```

Expected: all pass (`commands.test.ts:89` only checks `toContain('Managed by mattstack')`, which still holds).

- [ ] **Step 5: Format and commit**

`core/generated` is prettier-ignored and byte-compared against `build:board` output, so if `prettier --write` changes `useBoardState.ts`, rerun `bun run --cwd apps/deck build:board` and `bun test --cwd apps/deck core/generated-fresh.test.ts` before `git add`.

```bash
bunx prettier --write apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/api/server.ts apps/deck/src/cli/commands.ts apps/deck/src/cli/commands.test.ts apps/deck/src/registry/lifecycle.ts apps/deck/src/registry/lifecycle.test.ts apps/deck/core/board/useBoardState.ts
bunx prettier --check apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/api/server.ts apps/deck/src/cli/commands.ts apps/deck/src/cli/commands.test.ts apps/deck/src/registry/lifecycle.ts apps/deck/src/registry/lifecycle.test.ts apps/deck/core/board/useBoardState.ts
git add apps/deck/src/api/register.ts apps/deck/src/api/register.test.ts apps/deck/src/api/server.ts apps/deck/src/cli/commands.ts apps/deck/src/cli/commands.test.ts apps/deck/src/registry/lifecycle.ts apps/deck/src/registry/lifecycle.test.ts apps/deck/core/board/useBoardState.ts apps/deck/core/generated
git commit -m "deck: remove --managed <name> removes only that app; the refusal names deck remove --force" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: AGENTS.md and deck 1.1.0

**Files:**
- Modify: `apps/deck/AGENTS.md` (the paragraph at :76-82 beginning "One asymmetry worth knowing")
- Modify: `apps/deck/package.json` (:3), repo-root `bun.lock` (the `apps/deck` workspace entry, :227-229)

- [ ] **Step 1: Replace the stale paragraph**

Replace the whole paragraph at `apps/deck/AGENTS.md:76-82` (it wrongly says serve units render from `record.command` via `convert.ts` and are compared only at register) with:

```markdown
Serve units are rendered by `buildSpec` in `src/api/register.ts` from the
shape `serveShape` resolves (`src/registry/serve-shape.ts`); `convert.ts` only
relabels legacy agents. The boot sweep (`reresolveManagedApps`) re-resolves
every managed row on each bundled deck start and diffs the result against the
installed plist, so a linked app that moves its entry point is picked up on
the next deck restart. The sweep reads the bundle's catalog (the `deps.lock`
rows in `Contents/Resources` that carry `serve`, read by
`src/registry/bundle-catalog.ts`) and gives each catalog app an rt row in
either flavor. In prod it also adopts a same-named user row, serves each
catalog app as `Contents/Helpers/<name> <serve.args>` from
`~/.mattstack/<name>`, which deck creates, and does not serve any other rt row
(plist removed, row and dev link kept, hidden from `/api/apps`). In dev a
catalog row serves its linked source, or the dev bundle's binary when it has
no link. Deck never creates any other missing
working directory: a user app or checkout whose dir is gone gets a launchd
issue instead of a plist launchd would reject.
```

- [ ] **Step 2: Bump the version**

Set `"version": "1.1.0"` in `apps/deck/package.json`, then:

```bash
bun install
git diff --stat bun.lock
```

Expected: `bun.lock` changes only the `apps/deck` workspace `"version"` line (1.0.7 to 1.1.0), or not at all. If it changes anything else, revert `bun.lock` (`git checkout bun.lock`) and commit only `package.json`, and say so in your report.

- [ ] **Step 3: Confirm CI's frozen install still accepts the lock**

```bash
bun install --frozen-lockfile
```

Expected: exits 0.

- [ ] **Step 4: Format and commit**

```bash
bunx prettier --write apps/deck/AGENTS.md apps/deck/package.json
bunx prettier --check apps/deck/AGENTS.md apps/deck/package.json
git add apps/deck/AGENTS.md apps/deck/package.json bun.lock
git commit -m "deck: version 1.1.0; AGENTS.md describes the catalog sweep, not convert.ts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Verify, push, open the PR

- [ ] **Step 1: Targeted tests, all touched and dependent files**

```bash
bun test --cwd apps/deck src/services/bundle-layout.test.ts src/registry/bundle-catalog.test.ts src/registry/serve-shape.test.ts src/registry/migrate-dev-shape.test.ts src/api/register.test.ts src/registry/bootstrap.test.ts src/boot-reresolve.test.ts src/api/discovery.test.ts src/api/discovery-e2e.test.ts src/api/server.test.ts src/api/status.test.ts src/api/register-manifest.test.ts src/api/tld-reconcile.test.ts src/registry/lifecycle.test.ts src/cli/commands.test.ts core/generated-fresh.test.ts
```

Expected: all pass (minus any failures you recorded as pre-existing in Task 0).

```bash
bun run format:check
```

Expected: exits 0 with `All matched files use Prettier code style!`. This is the root-level check CI's `checks` job runs; a failure names the file to `bunx prettier --write`, and if it names `deps-lock-serve.fixture.json`, the `.prettierignore` entry from Task 1 is missing.

- [ ] **Step 2: Typecheck against the baseline**

```bash
bunx tsc --noEmit -p apps/deck > <scratchpad>/tsc-b.txt 2>&1
grep -c "error TS" <scratchpad>/tsc-b.txt
grep -E "src/(registry/(bundle-catalog|serve-shape|lifecycle)|api/(register|discovery|server)|boot-reresolve|cli/commands)\.ts" <scratchpad>/tsc-b.txt
```

Expected: the count is no larger than Task 0's baseline, and the second command prints nothing.

- [ ] **Step 3: No dashes, no ticket ids in source**

```bash
git diff origin/main -U0 -- apps/deck .prettierignore > <scratchpad>/b-diff.txt
perl -CSD -ne 'print if /^\+.*([\x{2013}\x{2014}]|RT-[0-9]+)/' <scratchpad>/b-diff.txt
```

Expected: the second command prints nothing (BSD grep cannot match these bytes, so the check is in perl). Fix any hit before pushing.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin apps-2-13-b-deck-sweep
```

Write the body with the Write tool to `<scratchpad>/pr-body-b.md` (not the repo), with exactly this content:

```markdown
## Deck 1.1.0: the boot sweep serves the bundle catalog

Prod's deck now serves exactly the apps its bundle ships, and dev serves whatever is registered, so switching flavors no longer leaves chat on a missing working dir or gitq's CLI looping as a web app (RT-280, RT-281, RT-284).

### What changed

**Catalog** (`src/registry/bundle-catalog.ts`)

- Reads `Contents/Resources/deps.lock` rows that carry `serve` into a name to port and args map.
- A bundle with no served rows keeps today's rules.
- Parity fixture `deps-lock-serve.fixture.json` is byte-identical to repo-tools' twin (sha256 pinned in both tests, prettier-ignored).

**Sweep** (`reresolveManagedApps`)

- Both flavors create an rt row for each missing catalog app; prod also adopts a same-named user row, keeping its dev link.
- Catalog apps serve `Helpers/<name> <serve.args>` from `~/.mattstack/<name>`, which deck now creates.
- rt rows outside the prod catalog are `not-served`: plist removed, row and dev link kept, hidden from `/api/apps`.
- A plist that already matches but lost its data dir is healed and kickstarted.
- Catalog args override stored bundle-path commands without a legacy badge.

**Also**

- The spec builder refuses a missing working dir deck does not own, as a launchd issue.
- `deck restart --managed` and `deck setup` skip not-served rows.
- `deck remove --managed <name>` removes only that app.
- The managed-row refusal names `deck remove <name> --force`, not `rt uninstall`.
- AGENTS.md no longer points at `convert.ts`; deck is 1.1.0.

### Verification

- New tests: catalog parser and parity fixture, catalog serve shapes, the dev to prod to dev flip on a lived-in registry, not-served, data-dir heal, catalog collisions, named remove.
- Targeted deck test files green locally; the full deck suite runs in the `deck-macos` job.

### Decision to confirm

- Dev creates missing catalog rows too (served from the dev bundle's binary), so a fresh machine that only runs the dev app still gets chat and console once rt setup stops registering them. If dev should serve only what the user registered, the create leg goes back to prod-only before merge.

### Follow-up

- Deck 1.1.0 reaches a bundle through the 2.13.0 bundle-apps dispatch and its deps.lock PR; until then the bundle ships deck 1.0.7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then:

```bash
gh pr create --repo m4ttstack/apps --base main --head apps-2-13-b-deck-sweep --title "deck 1.1.0: the boot sweep serves the bundle catalog" --body-file <scratchpad>/pr-body-b.md
```

Report the PR URL.

---

## Contract notes

Refinements to the shared contracts, and why:

1. **`readBundleCatalog` also returns null for a lock with no served rows or an invalid one**, not only outside a bundle. The dev app runs source HEAD deck against the deps.lock its last build shipped; a pre-`serve` lock read as an empty catalog would make prod-mode logic uninstall every rt app. Null means "today's rules". An invalid lock logs `[catalog] ignoring ...` to stderr.
2. **The catalog is helper rows with `status: "bundled"` and a `serve` object.** Pending and buildtool rows never serve, even carrying `serve` (a pending row has no binary in the bundle, so serving it would create a row that can never run). Unit A's `servedAppCatalog` applies the same rule, and the shared fixture's pending `boxscore` row (carrying `serve`) and `sparkle` buildtool row hold both parsers to it; a deck-only test also flips `chat` to pending. Deck ignores (does not reject) `serve` on non-served rows so it never falls back to legacy over a field repo-tools might accept.
3. **Unit A's fixture is canonical: sha256 `95256df5809898010329ed5c0c331c806a4ba8ad9e860768c1b130a604b14230`.** It is a wrapper `{ "lock": <deps.lock>, "expectedCatalog": [...] }`, so each twin carries its expected answer in the shared bytes. B copies it byte for byte from repo-tools `main` (Task 1 Step 1), pins the digest in `bundle-catalog.test.ts` exactly as A's `deps-lock-serve-parity.test.ts` does, and parses `JSON.stringify(fixture.lock)`. The file sits in the root `.prettierignore` because prettier would reflow its compact rows and break the digest. A change to the fixture moves both files and both digests in one pair of PRs.
4. **The `not-served` outcome is reported under the body key `notServed`** (camelCase, beside `restarted`/`unchanged`) and logged as `not-served <names>`. The body also gains `created` and `adopted`. No rt code reads the reresolve body today (checked: repo-tools has no caller of `/api/v1/apps/managed/reresolve`).
5. **Only `managedBy: "rt"` rows can be not-served** (`MATTSTACK_REGISTRAR`), not every non-user registrar, so the new uninstall capability is scoped as tightly as the rule needs.
6. **Catalog args are appended to `Contents/Helpers/<name>`**, not to the row's `exec`. They coincide for board, chat, console and boxscore; a future app whose `exec` differs from `Helpers/<name>` would need this revisited.
7. **Adoption keeps the row's existing port; creation uses the catalog port.** A catalog port already held by another record is reported in `failed` and no row is written.
8. **Not-served gating goes beyond the sweep:** `registerApp`, `editApp` and `reinstallSupervised` do not install, and `restartManagedApps` does not kickstart, a not-served row. Without it `deck restart --managed` (tray version change, update-machine served-suite, DevBuild) fails in prod on the uninstalled label, and `deck register --dir` under prod would reinstall a gitq-style plist until the next boot.
9. **`deck remove --managed <name>` sends `POST /api/v1/apps/managed/remove` with body `{"name": "<name>"}`.** Absent name answers 404 `unknown app`; a user or platform row answers 409 `<name> is not managed`; both match rt's `DECK_NOTHING_TO_REMOVE`. Bare `--managed` still removes every managed row. Deck 1.0.7 ignores the body and bulk-removes, so unit E must only send the named form to a deck from the same bundle (1.1.0 or later).
10. **`bundleResourcesDir(execPath?)` is added to `src/services/bundle-layout.ts` here, and only here.** Unit C (PR C-apps) branches after this PR merges and imports it for `Contents/Resources/apps/<name>/` rather than adding a second copy.
11. **Unit C hook:** the sweep calls `ingestManifest(name)` right after creating or adopting a catalog row. Today that is a no-op for a created row (no dir to read). If unit C puts its bundle-identity fallback inside `ingestManifest` (or discovery), created rows pick up name, icon and badge with no change to this unit.
12. **RULED 2026-09-25 00:45 by axel (Matt's stand-in): option A, with conditions.** (1) "Missing" means no row of that name under any owner: no dev adopt, no duplicate. (2) Dev creates a row only when the dev bundle ships `Helpers/<name>`; otherwise it writes a board issue and creates nothing (pin this with a test). (3) A created row stores no bundle-absolute `command`. The implementation must satisfy all three; unit E's PR body records the ruling.

    **Dev creates catalog rows too (decision to record before unit E merges).** Spec E deletes the rt setup legs that registered chat and console, on the premise that deck's sweep is enough; with a prod-only create, a fresh machine that only ever runs the dev app would never get them. This plan implements the recommended default: `ensureCatalogRows` runs its create leg in both flavors (a created row has no dev link, so dev serves it from the dev bundle's `Helpers/<name>` with the catalog args), and adoption of a same-named user row, plus the route-only report, stay prod-only because dev serves the user's registrations as they are. If Matt rules that dev serves only what the user registered, restore the `!flavor.dev` gate in `reresolveManagedApps`, flip `dev0` in the flip test back to `created: []` with no board row, and record that ruling in unit E's PR body and in the spec's rule section.

**Depends on:** unit A merged (Task 1 copies its fixture from repo-tools `main`). Unit C's PR C-apps branches after this PR merges and reuses `bundleResourcesDir`. Deck 1.1.0 only enforces the catalog in a bundle once it ships beside a deps.lock carrying `serve`, which is the release runbook's single bundle-apps dispatch and its bot deps.lock PR (`I-release-runbook.md`).
