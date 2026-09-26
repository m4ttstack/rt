# Deck Dev Source Shim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the dev app, deck runs from the linked `mattstack-apps` checkout through a signed shim, and the deck row's deploy button makes new source live by restarting it.

**Architecture:** A new Swift shim (`deck-dev-shim`) replaces `Contents/Helpers/deck` in the dev bundle only, keeping the pinned release beside it as `deck-pinned`. It chooses source (`bun <checkout>/src/main.ts`) or pinned on every launch and passes `DECK_BUNDLE_ROOT`, `DECK_RUN_MODE` and (pinned) `DECK_RUN_REASON`. Deck reads the bundle root from the environment, records its run mode in `api.json`, and its deploy script restarts instead of refusing when it runs from source.

**Tech Stack:** Bun + TypeScript (`apps/deck`, `bun test`), Swift / SwiftPM (`rt-tray`, checks via `swift run mattstack-checks`), bash (`rt-tray/build.sh`, `rt-tray/check-bundle.sh`).

**Spec:** `docs/superpowers/specs/2026-09-23-deck-dev-source-shim-design.md` in mattstack-apps (commit 1b93ad46). Read it before any task.

## Global Constraints

- Two repos:
  - mattstack-apps (Tasks 1 to 3): worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/noble-marble`, branch `deck-63`.
  - repo-tools (Tasks 4 and 5): a worktree on branch `deck-dev-shim`, path given in the dispatch. Never the shared checkout `~/Documents/GitHub/repo-tools`.
- The shim-to-deck contract is exactly three environment variables: `DECK_BUNDLE_ROOT` (absolute `.app` path), `DECK_RUN_MODE` (`source` or `pinned`), `DECK_RUN_REASON` (one line, pinned only). Nothing parses a log.
- `api.json` gains `runMode: 'source' | 'pinned' | 'standalone'` and, when pinned, `runReason`. A missing `runMode` reads as `standalone`.
- The shim's bun is `$HOME/.bun/bin/bun`. The shim does not read rt's dev-mode config.
- The registry the shim reads: `~/.mattstack/deck/registry.json`, shape `{ "version": 1, "apps": { "deck": { "dev": { "workingDirectory": "<absolute>" } } } }`, trusted only when owned by this uid and not group- or other-writable.
- Prod (`./build.sh release`) output is unchanged: no shim, no `deck-pinned`.
- No em dashes or en dashes anywhere. Comments state only constraints the code cannot show; no narration, no ticket ids, no review history.
- Deck tests: `cd apps/deck && bun test <file>`; full suite `cd apps/deck && bun test core src`. Run `bun run tui-kit:build` at the repo root first if deck tests fail on a missing tui-kit build.
- Tray: `cd rt-tray && swift build && swift run mattstack-checks`. Never run `./build.sh` in any mode, never launch or install an app, never run a built `rt` or `deck` binary outside `env -i HOME=<temp>`.
- Never touch live machine state (`~/.mattstack`, launchd, running services).

## Review Focus

1. `DECK_BUNDLE_ROOT` set to a bad value (relative, not a `.app`, no `Info.plist`) must fall back to execPath logic, not trust it (Task 1 test).
2. A deploy clicked while the shim has fallen back to pinned must refuse and name the reason, never report success (Task 3 test).
3. A registry that is group-writable or owned by another uid must yield pinned with a reason, never source (Task 4 check).
4. The shim computes the `.app` root from its own absolute executable path, not the relative `argv[0]` launchd passes (Task 4 check on the pure function; Task 5 wires `_NSGetExecutablePath`).
5. The dev bundle's outer signature must still verify with `deck-pinned` present (Task 5: signing entry plus `check-bundle.sh` assertions; the controller's real build confirms).

---

### Task 1: Deck reads its bundle root from `DECK_BUNDLE_ROOT`

Repo: mattstack-apps.

**Files:**
- Modify: `apps/deck/src/services/bundle-layout.ts`
- Test: `apps/deck/src/services/bundle-layout.test.ts`

**Interfaces:**
- Produces: `bundleRootFromExec(execPath?: string): string | null` and `bundleHelpersDir(execPath?: string): string | null`. With no argument, a valid `process.env.DECK_BUNDLE_ROOT` wins; with an explicit argument the environment is ignored. Callers are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `apps/deck/src/services/bundle-layout.test.ts` (it already has `tmpApp()`, `TMPDIR`, and the `afterEach` cleanup):

```ts
test('an unargumented call honors a valid DECK_BUNDLE_ROOT', () => {
  const { appRoot } = tmpApp();
  const prev = process.env.DECK_BUNDLE_ROOT;
  process.env.DECK_BUNDLE_ROOT = appRoot;
  try {
    expect(bundleRootFromExec()).toBe(appRoot);
    expect(bundleHelpersDir()).toBe(join(appRoot, 'Contents', 'Helpers'));
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});

test('an invalid DECK_BUNDLE_ROOT is ignored', () => {
  const { appRoot } = tmpApp();
  const prev = process.env.DECK_BUNDLE_ROOT;
  try {
    for (const bad of [
      'relative/mattstack.app',
      join(TMPDIR, 'not-a-bundle'),
      join(TMPDIR, 'missing.app'),
    ]) {
      process.env.DECK_BUNDLE_ROOT = bad;
      expect(bundleRootFromExec()).not.toBe(bad);
    }
    process.env.DECK_BUNDLE_ROOT = join(appRoot, 'Contents');
    expect(bundleRootFromExec()).not.toBe(join(appRoot, 'Contents'));
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});

test('an explicit execPath ignores DECK_BUNDLE_ROOT', () => {
  const a = tmpApp();
  const b = tmpApp();
  const prev = process.env.DECK_BUNDLE_ROOT;
  process.env.DECK_BUNDLE_ROOT = a.appRoot;
  try {
    expect(bundleRootFromExec(b.exec)).toBe(b.appRoot);
    expect(bundleRootFromExec(join(TMPDIR, 'nowhere', 'deck'))).toBeNull();
  } finally {
    if (prev === undefined) delete process.env.DECK_BUNDLE_ROOT;
    else process.env.DECK_BUNDLE_ROOT = prev;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/deck && bun test src/services/bundle-layout.test.ts`
Expected: the first new test FAILS (returns null under bun). The other two may pass today; they are guards.

- [ ] **Step 3: Implement**

Replace the two exported functions in `apps/deck/src/services/bundle-layout.ts` with:

```ts
/** The shim in the dev bundle runs deck under bun, where execPath is bun
    itself, so it passes the bundle root explicitly. Trusted only when it
    names a real bundle. */
function bundleRootFromEnv(value: string | undefined): string | null {
  if (!value || !isAbsolute(value) || !value.endsWith('.app')) return null;
  return existsSync(join(value, 'Contents', 'Info.plist')) ? value : null;
}

/** The .app root containing execPath (resolved through symlinks), or null outside a bundle. */
export function bundleRootFromExec(execPath?: string): string | null {
  if (execPath === undefined) {
    const fromEnv = bundleRootFromEnv(process.env.DECK_BUNDLE_ROOT);
    if (fromEnv) return fromEnv;
  }
  let real: string;
  try {
    real = realpathSync(execPath ?? process.execPath);
  } catch {
    return null;
  }
  const binDir = dirname(real);
  const contents = dirname(binDir);
  const root = dirname(contents);
  const binDirName = basename(binDir);
  if (binDirName !== 'Helpers' && binDirName !== 'MacOS') return null;
  if (basename(contents) !== 'Contents') return null;
  if (!root.endsWith('.app') || !existsSync(join(contents, 'Info.plist')))
    return null;
  return root;
}

/** Absolute path to the bundle's Helpers directory, or null outside a bundle. */
export function bundleHelpersDir(execPath?: string): string | null {
  const root = bundleRootFromExec(execPath);
  return root ? join(root, 'Contents', 'Helpers') : null;
}
```

Change the path import to `import { basename, dirname, isAbsolute, join } from 'path';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/deck && bun test src/services/bundle-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `cd apps/deck && bun test core src`
Expected: 0 fail.

```bash
git add apps/deck/src/services/bundle-layout.ts apps/deck/src/services/bundle-layout.test.ts
git commit -m "deck: bundle root from DECK_BUNDLE_ROOT when the dev shim runs deck under bun"
```

---

### Task 2: `api.json` records deck's run mode

Repo: mattstack-apps.

**Files:**
- Modify: `apps/deck/src/api/state.ts` (`writeApiInfo`, new `runModeFromEnv`, new `readApiRunMode`)
- Test: `apps/deck/src/api/state.test.ts` (exists; edit as Step 1 says)

**Interfaces:**
- Produces:
  - `export type RunMode = 'source' | 'pinned' | 'standalone';`
  - `export function runModeFromEnv(env: Record<string, string | undefined>): { runMode: RunMode; runReason?: string }`
  - `export function readApiRunMode(): { runMode: RunMode; runReason?: string } | null` (null when `api.json` is missing or unreadable)
  - `writeApiInfo(port)` now writes `{ port, pid, runMode, runReason? }` from `process.env`.
- `readApiInfo()` is unchanged.

- [ ] **Step 1: Write the failing tests**

`apps/deck/src/api/state.test.ts` already exists. Make these exact edits:

1. Change the destructured import line to
   `const { stateDir, adoptLegacyStateDir, claimApiInfo, writeApiInfo, readApiRunMode, runModeFromEnv } = await import('./state.ts');`
   and add `afterEach` to the `bun:test` import.
2. In the existing `beforeEach`, add `delete process.env.DECK_RUN_MODE;` and `delete process.env.DECK_RUN_REASON;`, and add
   `afterEach(() => { delete process.env.DECK_RUN_MODE; delete process.env.DECK_RUN_REASON; });` right after it.
3. The four existing `claimApiInfo` assertions of the form `expect(apiJsonIn(dir)).toEqual({ port: 7940, pid: process.pid });` (writes-when-none, dead-pid, not-answering, own-port) become `expect(apiJsonIn(dir)).toEqual({ port: 7940, pid: process.pid, runMode: 'standalone' });`. The "leaves an api.json alone" assertion (`{ port: 7000, pid: 4242 }`) is unchanged.
4. Append these tests at the end of the file (they use the file's own `seededStateDir` and `apiJsonIn`; do not change HOME):

```ts
test('runModeFromEnv maps the shim variables', () => {
  expect(runModeFromEnv({})).toEqual({ runMode: 'standalone' });
  expect(runModeFromEnv({ DECK_RUN_MODE: 'source' })).toEqual({
    runMode: 'source',
  });
  expect(
    runModeFromEnv({ DECK_RUN_MODE: 'pinned', DECK_RUN_REASON: 'bun missing' })
  ).toEqual({ runMode: 'pinned', runReason: 'bun missing' });
  expect(runModeFromEnv({ DECK_RUN_MODE: 'weird' })).toEqual({
    runMode: 'standalone',
  });
});

test('writeApiInfo records the run mode and readApiRunMode reads it back', () => {
  const dir = seededStateDir();
  process.env.DECK_RUN_MODE = 'pinned';
  process.env.DECK_RUN_REASON = 'no deck dev.workingDirectory';
  writeApiInfo(7940);
  expect(readApiRunMode()).toEqual({
    runMode: 'pinned',
    runReason: 'no deck dev.workingDirectory',
  });
  expect(apiJsonIn(dir)).toEqual({
    port: 7940,
    pid: process.pid,
    runMode: 'pinned',
    runReason: 'no deck dev.workingDirectory',
  });
});

test('an api.json without runMode reads as standalone', () => {
  seededStateDir({ port: 7940, pid: 1 });
  expect(readApiRunMode()).toEqual({ runMode: 'standalone' });
});

test('readApiRunMode is null with no api.json', () => {
  seededStateDir();
  expect(readApiRunMode()).toBeNull();
});
```

Step 2 expectation: the four updated `claimApiInfo` assertions and the new tests fail (functions not exported, no `runMode` written).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/deck && bun test src/api/state.test.ts`
Expected: FAIL, `runModeFromEnv` / `readApiRunMode` not exported.

- [ ] **Step 3: Implement**

In `apps/deck/src/api/state.ts`, add above `writeApiInfo`:

```ts
export type RunMode = 'source' | 'pinned' | 'standalone';

/** DECK_RUN_MODE and DECK_RUN_REASON are set only by the dev bundle's shim;
    a deck started any other way is standalone. */
export function runModeFromEnv(env: Record<string, string | undefined>): {
  runMode: RunMode;
  runReason?: string;
} {
  if (env.DECK_RUN_MODE === 'source') return { runMode: 'source' };
  if (env.DECK_RUN_MODE === 'pinned') {
    return env.DECK_RUN_REASON
      ? { runMode: 'pinned', runReason: env.DECK_RUN_REASON }
      : { runMode: 'pinned' };
  }
  return { runMode: 'standalone' };
}
```

Replace `writeApiInfo` with:

```ts
/** Where the CLI finds a running platform. Written at serve boot. */
export function writeApiInfo(port: number): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(
    join(stateDir(), 'api.json'),
    JSON.stringify({ port, pid: process.pid, ...runModeFromEnv(process.env) })
  );
}
```

Add after `readApiInfo`:

```ts
export function readApiRunMode(): {
  runMode: RunMode;
  runReason?: string;
} | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(stateDir(), 'api.json'), 'utf8')
    );
    return runModeFromEnv({
      DECK_RUN_MODE: parsed.runMode,
      DECK_RUN_REASON: parsed.runReason,
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/deck && bun test src/api/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `cd apps/deck && bun test core src`
Expected: 0 fail.

```bash
git add apps/deck/src/api/state.ts apps/deck/src/api/state.test.ts
git commit -m "deck: api.json records whether deck runs from source, pinned, or standalone"
```

---

### Task 3: Deploy restarts a source-run deck instead of refusing

Repo: mattstack-apps.

**Files:**
- Create: `apps/deck/src/cli/deploy-mode.ts`
- Test: `apps/deck/src/cli/deploy-mode.test.ts`
- Modify: `apps/deck/scripts/deploy.ts`
- Modify: `apps/deck/AGENTS.md` ("Run only from main" section)

**Interfaces:**
- Consumes: `runModeFromEnv`, `readApiRunMode` (Task 2); `bundleRootFromExec` honoring `DECK_BUNDLE_ROOT` (Task 1); existing `deployTarget(helperOwned)` (`src/cli/deploy-target.ts`), `bundleHelperOwnsDeck`, `liveProbe`.
- Produces: `export type DeployMode = { kind: 'install' } | { kind: 'restart' } | { kind: 'refuse'; message: string }` and `export function deployMode(helperOwned: boolean, env: Record<string, string | undefined>, recorded: { runMode: RunMode; runReason?: string } | null): DeployMode`. The run mode comes from `DECK_RUN_MODE` when set (a deploy spawned by the serving deck), else from `recorded` (the serving deck's `api.json`, so a terminal `bun run deploy` works too).

- [ ] **Step 1: Write the failing tests**

Create `apps/deck/src/cli/deploy-mode.test.ts`:

```ts
import { expect, test } from 'bun:test';

import { deployMode } from './deploy-mode.ts';

test('a standalone deck installs a new build', () => {
  expect(deployMode(false, {}, null)).toEqual({ kind: 'install' });
  expect(deployMode(false, { DECK_RUN_MODE: 'source' }, null)).toEqual({
    kind: 'install',
  });
});

test('a helper-owned deck running from source restarts', () => {
  expect(deployMode(true, { DECK_RUN_MODE: 'source' }, null)).toEqual({
    kind: 'restart',
  });
});

test('from a terminal, the serving deck recorded in api.json decides', () => {
  expect(deployMode(true, {}, { runMode: 'source' })).toEqual({
    kind: 'restart',
  });
  const pinned = deployMode(true, {}, {
    runMode: 'pinned',
    runReason: 'bun missing',
  });
  expect(pinned.kind === 'refuse' && pinned.message).toContain('bun missing');
});

test('the spawning environment wins over api.json', () => {
  expect(
    deployMode(true, { DECK_RUN_MODE: 'source' }, { runMode: 'pinned' })
  ).toEqual({ kind: 'restart' });
});

test('a helper-owned deck on the pinned fallback refuses and names why', () => {
  const mode = deployMode(
    true,
    {
      DECK_RUN_MODE: 'pinned',
      DECK_RUN_REASON: 'bun not found at /Users/x/.bun/bin/bun',
    },
    null
  );
  expect(mode.kind).toBe('refuse');
  expect(mode.kind === 'refuse' && mode.message).toContain(
    'bun not found at /Users/x/.bun/bin/bun'
  );
  expect(mode.kind === 'refuse' && mode.message).toContain('pinned release');
});

test('a helper-owned deck with no shim refuses and points at the shim log', () => {
  const mode = deployMode(true, {}, null);
  expect(mode.kind).toBe('refuse');
  expect(mode.kind === 'refuse' && mode.message).toContain(
    'mattstack app owns deck'
  );
  expect(mode.kind === 'refuse' && mode.message).toContain('deck.err.log');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/deck && bun test src/cli/deploy-mode.test.ts`
Expected: FAIL, module `./deploy-mode.ts` not found.

- [ ] **Step 3: Implement the mode choice**

Create `apps/deck/src/cli/deploy-mode.ts`:

```ts
import { runModeFromEnv, type RunMode } from '../api/state.ts';

export type DeployMode =
  | { kind: 'install' }
  | { kind: 'restart' }
  | { kind: 'refuse'; message: string };

/** A helper-owned deck lives inside a signed bundle, so deploy can never
    write a binary there; only a source-run deck (the dev bundle's shim) has
    something to make live, by restarting. A deploy the serving deck spawned
    inherits its DECK_RUN_MODE; one run from a terminal reads api.json. */
export function deployMode(
  helperOwned: boolean,
  env: Record<string, string | undefined>,
  recorded: { runMode: RunMode; runReason?: string } | null
): DeployMode {
  if (!helperOwned) return { kind: 'install' };
  const { runMode, runReason } = env.DECK_RUN_MODE
    ? runModeFromEnv(env)
    : (recorded ?? { runMode: 'standalone' as const });
  if (runMode === 'source') return { kind: 'restart' };
  if (runMode === 'pinned') {
    return {
      kind: 'refuse',
      message: `deck is running the pinned release because ${runReason ?? 'the dev shim could not run source'}; fix the checkout or bun, then restart deck`,
    };
  }
  return {
    kind: 'refuse',
    message:
      "the mattstack app owns deck here and its helper runs the bundle's pinned release, so `bun run deploy` has nothing to replace (in the dev app, the last `deck-dev-shim:` line in ~/.mattstack/deck/logs/deck.err.log says why source is not running)",
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/deck && bun test src/cli/deploy-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire deploy.ts**

In `apps/deck/scripts/deploy.ts`:

1. Add imports: `import { deployMode } from '../src/cli/deploy-mode.ts';`, `import { readApiRunMode } from '../src/api/state.ts';` (merge with the existing `logsDir` import), and `import { homedir } from 'os';` if not present.
2. Replace the block from `const target = deployTarget(` through `await $\`deck restart deck\`.nothrow();` with a mode switch. The `install` branch keeps today's lines exactly (build, build:board, mkdir, backup, install, mv, restart). The `refuse` branch prints the message and exits 1. The `restart` branch runs the workspace install then the restart:

```ts
const helperOwned = await bundleHelperOwnsDeck(liveProbe, bundleRootFromExec());
const mode = deployMode(helperOwned, process.env, readApiRunMode());
if (mode.kind === 'refuse') {
  console.error(mode.message);
  process.exit(1);
}

let target: string | null = null;
let backup: string | null = null;
if (mode.kind === 'install') {
  target = deployTarget(false);
  await $`bun run build`;
  await $`bun run build:board`;
  await $`mkdir -p ${dirname(target)}`;
  // (keep the existing backup comment and lines here, assigning `backup`)
  // (keep the existing install/rename comment and lines here)
} else {
  // The served process imports the checkout's node_modules directly, so a
  // dependency bump must land before the restart or deck crash-loops.
  const workspaceRoot = join(import.meta.dir, '..', '..', '..');
  await $`${join(homedir(), '.bun', 'bin', 'bun')} install --frozen-lockfile`.cwd(
    workspaceRoot
  );
}
// (keep the existing restart comment)
await $`deck restart deck`.nothrow();
```

   Keep the existing comments that explain the ProgramArguments target, the backup and the atomic rename, attached to their lines inside the `install` branch.

3. Before the restart, record `const pidBefore = readApiInfo()?.pid ?? null;` (import `readApiInfo` from `../src/api/state.ts`). In the `restart` branch, success also requires a new process: within the same 20s deadline, poll until `readApiInfo()?.pid` is set and differs from `pidBefore`; if it never changes, print `deck restart did not bring up a new process; the new source is NOT live` and exit 1 (a failed restart call leaves the old deck answering `/healthz`). After the existing `if (await healthy(20_000)) { ... }` success block, make the success path mode-aware: for `restart`, read `readApiRunMode()` and require `runMode === 'source'`; if it is anything else, print `deck came back healthy but running ${runMode}${runReason ? `: ${runReason}` : ''}; the new source is NOT live (the last deck-dev-shim: line in ~/.mattstack/deck/logs/deck.err.log says why)` and `process.exit(1)`. The pinned fallback is an older release that may not record `runReason`, so the log pointer is always printed. For `install`, keep today's success message.
4. In the failure path, the log tails print for both modes; the restore block runs only when `mode.kind === 'install'` and `backup` exists. For `restart`, after the tails print `deck did not come back healthy after the restart; see the logs above` and exit 1.

   `deployTarget(false)` keeps the self-record lookup; `deployTarget(true)`'s refusal is now produced by `deployMode`, so no call passes `true` any more. Leave `deploy-target.ts` and its tests unchanged.

- [ ] **Step 6: Typecheck the script and run the suite**

Run: `cd apps/deck && bunx tsc --noEmit -p . 2>&1 | grep -E "scripts/deploy.ts|src/cli/deploy-mode|src/api/state" || echo "no new errors in touched files"`
Expected: `no new errors in touched files` (deck has pre-existing tsc errors elsewhere; only these files matter).
Run: `cd apps/deck && bun test core src`
Expected: 0 fail. Never run `bun run deploy` itself.

- [ ] **Step 7: Update apps/deck/AGENTS.md**

In "## Run only from main", after the paragraph that starts "On a machine with the mattstack app installed", add:

```markdown
In the dev app the helper is a shim (`Contents/Helpers/deck`, built from
repo-tools `rt-tray/Sources-deck-shim`) that runs this checkout's
`src/main.ts` under bun, with the pinned release kept as
`Contents/Helpers/deck-pinned` for when source cannot run. There the flow is
merge to `main`, pull the linked checkout, then deploy (the deck row's
button, `deck cmd deck deploy`, or `bun run deploy` from the checkout):
deploy installs dependencies and restarts deck, and succeeds only if deck
comes back running source. `api.json`'s `runMode` (`source`, `pinned`, `standalone`) and
`runReason` say which deck is serving and, for pinned, why.
```

And change the sentence "There `deck setup` and `bun run deploy` refuse" to "There `deck setup` refuses, and `bun run deploy` refuses unless the dev shim is running source".

- [ ] **Step 8: Commit**

```bash
git add apps/deck/src/cli/deploy-mode.ts apps/deck/src/cli/deploy-mode.test.ts apps/deck/scripts/deploy.ts apps/deck/AGENTS.md
git commit -m "deck: deploy restarts a source-run deck in the dev app instead of refusing"
```

---

### Task 4: Tray: the deck shim's choice logic

Repo: repo-tools (worktree given in the dispatch).

**Files:**
- Create: `rt-tray/Sources-deck-shim-logic/DeckShimLogic.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/DeckShimChecks.swift`
- Modify: `rt-tray/Package.swift` (new library target; `MattstackCoreChecks` depends on it)
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (append `+ deckShimChecks`)
- Modify: `rt-tray/project.yml` (xcodegen: a `DeckShimLogic` static library target; `MattstackCoreChecks` depends on it)

`rt-tray/deps/` is gitignored and holds the Sparkle binary target SwiftPM needs; the controller has already copied it into this worktree. If `swift build` reports "local binary target 'Sparkle' ... does not contain a binary artifact", run `mkdir -p rt-tray/deps/tools && cp -R /Users/matt/Documents/GitHub/repo-tools/rt-tray/deps/tools/sparkle-xcframework rt-tray/deps/tools/` and never commit it.

**Interfaces:**
- Produces (module `DeckShimLogic`):
  - `public enum DeckRunChoice: Equatable { case source(bun: String, entry: String); case pinned(reason: String) }`
  - `public struct DeckShimEnvironment { public init(home: String, registryTrusted: (String) -> Bool, readFile: (String) -> Data?, fileExists: (String) -> Bool, isExecutable: (String) -> Bool) }`
  - `public func chooseDeckRun(_ env: DeckShimEnvironment) -> DeckRunChoice`
  - `public func bundleRoot(fromExecutable path: String) -> String?` (`/X.app/Contents/Helpers/deck` gives `/X.app`; anything else nil)
  - `public func deckExec(choice: DeckRunChoice, bundleRoot: String, args: [String]) -> (path: String, argv: [String], env: [String: String])`

- [ ] **Step 1: Add the target and write the failing checks**

`rt-tray/Package.swift`: add to `targets`:

```swift
        .target(
            name: "DeckShimLogic",
            path: "Sources-deck-shim-logic"
        ),
```

and change `MattstackCoreChecks`'s dependencies to `["MattstackCore", "DeckShimLogic"]`.

Create `rt-tray/Sources-deck-shim-logic/DeckShimLogic.swift` with only `import Foundation` for now, so the target builds.

Create `rt-tray/Tests/MattstackCoreChecks/DeckShimChecks.swift`:

```swift
import Foundation
import DeckShimLogic

private let home = "/Users/t"
private let registry = "/Users/t/.mattstack/deck/registry.json"
private let checkout = "/Users/t/src/apps/deck"
private let bun = "/Users/t/.bun/bin/bun"

private func registryJSON(_ dir: String?) -> Data {
    let dev = dir.map { #"{"workingDirectory":"\#($0)"}"# } ?? "{}"
    return Data(#"{"version":1,"apps":{"deck":{"name":"deck","dev":\#(dev)}}}"#.utf8)
}

private func env(trusted: Bool = true, data: Data? = registryJSON(checkout),
                 files: Set<String> = ["\(checkout)/src/main.ts", bun],
                 executables: Set<String> = [bun]) -> DeckShimEnvironment {
    DeckShimEnvironment(home: home,
                        registryTrusted: { $0 == registry && trusted },
                        readFile: { $0 == registry ? data : nil },
                        fileExists: { files.contains($0) },
                        isExecutable: { executables.contains($0) })
}

private func reason(_ choice: DeckRunChoice) -> String? {
    if case .pinned(let r) = choice { return r }
    return nil
}

let deckShimChecks: [Check] = [
    Check("deck shim runs source when the checkout and bun are present") { c in
        try c.requireEqual(chooseDeckRun(env()),
                           .source(bun: bun, entry: "\(checkout)/src/main.ts"))
    },
    Check("deck shim falls back to pinned on an untrusted registry") { c in
        c.expect(reason(chooseDeckRun(env(trusted: false)))?.contains("registry") == true)
    },
    Check("deck shim falls back to pinned on unreadable or malformed registry") { c in
        c.expect(reason(chooseDeckRun(env(data: nil))) != nil)
        c.expect(reason(chooseDeckRun(env(data: Data("nope".utf8)))) != nil)
    },
    Check("deck shim falls back to pinned with no deck dev.workingDirectory") { c in
        c.expect(reason(chooseDeckRun(env(data: registryJSON(nil))))?.contains("workingDirectory") == true)
    },
    Check("deck shim refuses a relative workingDirectory") { c in
        c.expect(reason(chooseDeckRun(env(data: registryJSON("src/apps/deck")))) != nil)
    },
    Check("deck shim falls back to pinned when src/main.ts is missing") { c in
        c.expect(reason(chooseDeckRun(env(files: [bun])))?.contains("main.ts") == true)
    },
    Check("deck shim falls back to pinned when bun is missing or not executable") { c in
        c.expect(reason(chooseDeckRun(env(files: ["\(checkout)/src/main.ts"], executables: [])))?.contains("bun") == true)
        c.expect(reason(chooseDeckRun(env(executables: [])))?.contains("bun") == true)
    },
    Check("bundle root comes from the shim's own absolute path") { c in
        try c.requireEqual(bundleRoot(fromExecutable: "/Applications/mattstack-dev.app/Contents/Helpers/deck"),
                           "/Applications/mattstack-dev.app")
        c.expect(bundleRoot(fromExecutable: "Contents/Helpers/deck") == nil)
        c.expect(bundleRoot(fromExecutable: "/usr/local/bin/deck") == nil)
    },
    Check("source exec passes args through with the bundle root and mode") { c in
        let run = deckExec(choice: .source(bun: bun, entry: "\(checkout)/src/main.ts"),
                           bundleRoot: "/A.app", args: ["serve"])
        try c.requireEqual(run.path, bun)
        try c.requireEqual(run.argv, [bun, "\(checkout)/src/main.ts", "serve"])
        try c.requireEqual(run.env, ["DECK_BUNDLE_ROOT": "/A.app", "DECK_RUN_MODE": "source"])
    },
    Check("pinned exec runs deck-pinned and carries the reason") { c in
        let run = deckExec(choice: .pinned(reason: "bun missing"), bundleRoot: "/A.app", args: ["--version"])
        try c.requireEqual(run.path, "/A.app/Contents/Helpers/deck-pinned")
        try c.requireEqual(run.argv, ["/A.app/Contents/Helpers/deck-pinned", "--version"])
        try c.requireEqual(run.env, ["DECK_BUNDLE_ROOT": "/A.app", "DECK_RUN_MODE": "pinned",
                                     "DECK_RUN_REASON": "bun missing"])
    },
]
```

Append `+ deckShimChecks` to the end of the `allChecks` expression in `AllChecks.swift`.

`rt-tray/project.yml` (the xcodegen spec `build.sh` uses by default): add a target

```yaml
  DeckShimLogic:
    type: library.static
    platform: macOS
    sources: [Sources-deck-shim-logic]
```

matching the file's existing indentation and target style, and add `- target: DeckShimLogic` to the `MattstackCoreChecks` target's `dependencies`. If `xcodegen` is on PATH, run `cd rt-tray && xcodegen generate` and confirm it succeeds. The generated `.xcodeproj` is gitignored; only `project.yml` is committed.

- [ ] **Step 2: Run the checks to verify they fail**

Run: `cd rt-tray && swift run mattstack-checks`
Expected: build FAILS (`chooseDeckRun`, `DeckRunChoice` not found).

- [ ] **Step 3: Implement**

`rt-tray/Sources-deck-shim-logic/DeckShimLogic.swift`:

```swift
import Foundation

public enum DeckRunChoice: Equatable {
    case source(bun: String, entry: String)
    case pinned(reason: String)
}

/// The file system and trust test arrive as closures so the choice is
/// testable without a real home directory.
public struct DeckShimEnvironment {
    let home: String
    let registryTrusted: (String) -> Bool
    let readFile: (String) -> Data?
    let fileExists: (String) -> Bool
    let isExecutable: (String) -> Bool

    public init(home: String,
                registryTrusted: @escaping (String) -> Bool,
                readFile: @escaping (String) -> Data?,
                fileExists: @escaping (String) -> Bool,
                isExecutable: @escaping (String) -> Bool) {
        self.home = home
        self.registryTrusted = registryTrusted
        self.readFile = readFile
        self.fileExists = fileExists
        self.isExecutable = isExecutable
    }
}

private struct Registry: Decodable {
    struct App: Decodable {
        struct Dev: Decodable { let workingDirectory: String? }
        let dev: Dev?
    }
    let apps: [String: App]
}

/// The registry picks the directory deck runs from at every launch, so it is
/// only trusted when this user owns it and nobody else can write it.
public func chooseDeckRun(_ env: DeckShimEnvironment) -> DeckRunChoice {
    let registryPath = "\(env.home)/.mattstack/deck/registry.json"
    guard env.registryTrusted(registryPath) else {
        return .pinned(reason: "registry \(registryPath) is missing or not trusted")
    }
    guard let data = env.readFile(registryPath),
          let registry = try? JSONDecoder().decode(Registry.self, from: data) else {
        return .pinned(reason: "registry \(registryPath) is unreadable")
    }
    guard let dir = registry.apps["deck"]?.dev?.workingDirectory, dir.hasPrefix("/") else {
        return .pinned(reason: "no absolute deck dev.workingDirectory in the registry")
    }
    let entry = "\(dir)/src/main.ts"
    guard env.fileExists(entry) else {
        return .pinned(reason: "deck source not found at \(entry)")
    }
    let bun = "\(env.home)/.bun/bin/bun"
    guard env.fileExists(bun), env.isExecutable(bun) else {
        return .pinned(reason: "bun not found or not executable at \(bun)")
    }
    return .source(bun: bun, entry: entry)
}

public func bundleRoot(fromExecutable path: String) -> String? {
    guard path.hasPrefix("/") else { return nil }
    let url = URL(fileURLWithPath: path)
    let helpers = url.deletingLastPathComponent()
    let contents = helpers.deletingLastPathComponent()
    let app = contents.deletingLastPathComponent()
    guard helpers.lastPathComponent == "Helpers",
          contents.lastPathComponent == "Contents",
          app.pathExtension == "app" else { return nil }
    return app.path
}

public func deckExec(choice: DeckRunChoice, bundleRoot: String,
                     args: [String]) -> (path: String, argv: [String], env: [String: String]) {
    switch choice {
    case .source(let bun, let entry):
        return (bun, [bun, entry] + args,
                ["DECK_BUNDLE_ROOT": bundleRoot, "DECK_RUN_MODE": "source"])
    case .pinned(let reason):
        let pinned = "\(bundleRoot)/Contents/Helpers/deck-pinned"
        return (pinned, [pinned] + args,
                ["DECK_BUNDLE_ROOT": bundleRoot, "DECK_RUN_MODE": "pinned",
                 "DECK_RUN_REASON": reason])
    }
}
```

- [ ] **Step 4: Run the checks to verify they pass**

Run: `cd rt-tray && swift build && swift run mattstack-checks`
Expected: build succeeds, checks exit 0 including the new deck shim checks.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Package.swift rt-tray/project.yml rt-tray/Sources-deck-shim-logic/DeckShimLogic.swift rt-tray/Tests/MattstackCoreChecks/DeckShimChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "tray: deck shim choice logic, source when the linked checkout and bun are present"
```

---

### Task 5: Tray: the deck dev shim executable and the dev bundle layout

Repo: repo-tools (same worktree as Task 4).

**Files:**
- Create: `rt-tray/Sources-deck-shim/main.swift`
- Modify: `rt-tray/Package.swift` (executable target `deck-dev-shim`)
- Modify: `rt-tray/build.sh` (xcode-path build line; dev-only swap after `bundle_helpers`; signing entry)
- Modify: `rt-tray/check-bundle.sh` (allowlist, dev/prod assertions, isolated `--version` probe for the dev deck)
- Modify: `AGENTS.md` (repo root: "Getting a change into the running dev app")

**Interfaces:**
- Consumes: `DeckShimLogic` (Task 4): `chooseDeckRun`, `DeckShimEnvironment`, `bundleRoot(fromExecutable:)`, `deckExec`.
- Produces: product `deck-dev-shim` at `.build/release/deck-dev-shim`; dev bundle layout `Contents/Helpers/deck` (shim) plus `Contents/Helpers/deck-pinned`.

- [ ] **Step 1: The executable target**

`rt-tray/Package.swift`, add:

```swift
        .executableTarget(
            name: "deck-dev-shim",
            dependencies: ["DeckShimLogic"],
            path: "Sources-deck-shim"
        ),
```

and add `.executable(name: "deck-dev-shim", targets: ["deck-dev-shim"])` to `products` if the file lists products explicitly (match how `rt-daemon-shim` is declared there).

Create `rt-tray/Sources-deck-shim/main.swift`:

```swift
// deck-dev-shim: the dev bundle's Contents/Helpers/deck. It runs deck from
// the linked mattstack-apps checkout under bun when it can, and the pinned
// release (Contents/Helpers/deck-pinned) otherwise. The dev flavor only;
// the prod bundle ships the pinned binary under this name.
//
// Contract with deck: DECK_BUNDLE_ROOT, DECK_RUN_MODE, DECK_RUN_REASON.
// Signed as com.mattstack.helper.deck, the identifier the deck LaunchAgent's
// BundleProgram has always run, so launchd and TCC see the same helper.

import Darwin
import DeckShimLogic
import Foundation

private func log(_ msg: String) {
    FileHandle.standardError.write(Data("deck-dev-shim: \(msg)\n".utf8))
}

private func ownExecutablePath() -> String? {
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)
    var buf = [CChar](repeating: 0, count: Int(size))
    guard _NSGetExecutablePath(&buf, &size) == 0 else { return nil }
    guard let real = realpath(buf, nil) else { return nil }
    defer { free(real) }
    return String(cString: real)
}

private func isTrusted(_ path: String) -> Bool {
    var st = stat()
    guard stat(path, &st) == 0 else { return false }
    guard st.st_uid == getuid() else { return false }
    return (st.st_mode & (mode_t(S_IWGRP) | mode_t(S_IWOTH))) == 0
}

let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
let args = Array(CommandLine.arguments.dropFirst())
let serving = args.first == "serve"

// The deck LaunchAgent sets no StandardErrorPath, so without this the serve
// line would go to /dev/null.
if serving {
    let logsDir = "\(home)/.mattstack/deck/logs"
    try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)
    _ = freopen("\(logsDir)/deck.err.log", "a", stderr)
}

guard let exe = ownExecutablePath(), let root = bundleRoot(fromExecutable: exe) else {
    log("cannot locate the app bundle from the shim's own path")
    exit(1)
}

let fm = FileManager.default
let choice = chooseDeckRun(DeckShimEnvironment(
    home: home,
    registryTrusted: isTrusted,
    readFile: { fm.contents(atPath: $0) },
    fileExists: { fm.fileExists(atPath: $0) },
    isExecutable: { fm.isExecutableFile(atPath: $0) }
))

if serving {
    switch choice {
    case .source: log("source")
    case .pinned(let reason): log("pinned: \(reason)")
    }
}

let run = deckExec(choice: choice, bundleRoot: root, args: args)
for (key, value) in run.env { setenv(key, value, 1) }
var cArgs: [UnsafeMutablePointer<CChar>?] = run.argv.map { strdup($0) }
cArgs.append(nil)
execv(run.path, &cArgs)
log("execv(\(run.path)) failed: \(String(cString: strerror(errno)))")
exit(1)
```

Run: `cd rt-tray && swift build -c release --product deck-dev-shim`
Expected: builds `.build/release/deck-dev-shim`.

- [ ] **Step 2: build.sh**

In `rt-tray/build.sh`:

1. In the xcode branch, next to `swift build -c release --product rt-daemon-shim` (around line 95), add `swift build -c release --product deck-dev-shim 2>&1 | sed 's/^/  /'` and `DECK_SHIM_BINARY="$SCRIPT_DIR/.build/release/deck-dev-shim"`. In the swift `IS_DEV` branch (around line 104, which already builds every product), add `DECK_SHIM_BINARY="$SCRIPT_DIR/.build/release/deck-dev-shim"`.
2. Directly after the `bundle_helpers` call (line 272), add:

```bash
# Dev flavor: deck runs from the linked checkout through the shim; the
# pinned release stays beside it as the fallback. Prod ships the pin as deck.
if [ "$IS_DEV" = true ]; then
    [ -f "$DECK_SHIM_BINARY" ] || { echo "  ✗ deck-dev-shim not built"; exit 1; }
    [ -f "$CONTENTS/Helpers/deck" ] || { echo "  ✗ Helpers/deck missing before the shim swap"; exit 1; }
    mv "$CONTENTS/Helpers/deck" "$CONTENTS/Helpers/deck-pinned"
    cp "$DECK_SHIM_BINARY" "$CONTENTS/Helpers/deck"; chmod +x "$CONTENTS/Helpers/deck"
    HELPER_ENTITLEMENTS+=("$CONTENTS/Helpers/deck-pinned	jit")
    echo "  ✓ Helpers/deck is the dev shim; the pin is Helpers/deck-pinned"
fi
```

   The existing `HELPER_ENTITLEMENTS` entry for `Contents/Helpers/deck` (added by `bundle_helpers`) now signs the shim with `com.mattstack.helper.deck`; `deck-pinned` is signed as `com.mattstack.helper.deck-pinned`. Use a literal tab between the path and `jit`, matching line 267.

- [ ] **Step 3: check-bundle.sh**

In `rt-tray/check-bundle.sh`:

1. In the `allowed` list (around line 371) add `deck-pinned`: `local allowed=" rt-ui skills mattstack-proxy-install gate-fork.sh deck-pinned " ...`.
2. In the existing `if [ -n "$DEV" ]` block right after the two `check_identity` calls (around line 171), add dev assertions: `Contents/Helpers/deck-pinned` exists and is executable, `cmp -s` shows `Contents/Helpers/deck` differs from it, and `codesign --verify --strict "$DEV/Contents/Helpers/deck-pinned"` passes. Beside `check_identity "$PROD"`, `fail` if `$PROD/Contents/Helpers/deck-pinned` exists.
3. In the deps.lock `--version` loop (around line 344, inside `check_helpers`, which knows the flavor only through `$exe`), when `[ "$exe" = mattstack-dev ]` and `$name` is `deck`, run the probe as `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin "$p" --version`, so the shim finds no registry, falls back to `deck-pinned`, and never reads the builder's real `~/.mattstack`.

   Do not run `check-bundle.sh` (it builds both flavors via `build.sh`). Verify syntax only: `bash -n rt-tray/check-bundle.sh && bash -n rt-tray/build.sh`.

- [ ] **Step 4: repo-tools AGENTS.md**

Add this section right after the "## Operating on this machine" section's closing paragraph ("A claimed recovery path ... does nothing."):

```markdown
## Getting a change into the running dev app

The dev app (`/Applications/mattstack-dev.app`) takes code from three places.

- **Served apps (board, console, chat, boxscore, gitq) and deck run from
  source** in the shared `~/Documents/GitHub/mattstack-apps` checkout. To
  deploy: merge, check `git branch --show-current` is `main`, pull, then
  `deck restart <app>` (or the deck row's deploy button for deck itself).
  Deck runs through the dev shim (`rt-tray/Sources-deck-shim`), which falls
  back to `Contents/Helpers/deck-pinned` when source cannot run; `api.json`'s
  `runMode` says which is serving.
- **Manifest keys in `mattstack.deck.json` are read only at register or
  adopt.** After a manifest change, run `deck register --dir <absolute path>`.
- **Tray and shim changes need a dev app rebuild**: in a scratch tree at the
  target commit, `scripts/fetch-deps.sh arm64` then `rt-tray/build.sh dev`,
  never in the shared checkout's `rt-tray/`. Then replace
  `/Applications/mattstack-dev.app` by moving the old one aside, the way the
  dev-bundle leg of the `rt:release` skill does.
```

- [ ] **Step 5: Build and checks**

Run: `cd rt-tray && swift build && swift build -c release --product deck-dev-shim && swift run mattstack-checks && bash -n build.sh && bash -n check-bundle.sh`
Expected: all succeed; checks exit 0.

Smoke the shim in isolation (never against the real home):

```bash
T=$(mktemp -d); mkdir -p "$T/X.app/Contents/Helpers"; touch "$T/X.app/Contents/Info.plist"
cp rt-tray/.build/release/deck-dev-shim "$T/X.app/Contents/Helpers/deck"
printf '#!/bin/sh\necho "pinned:$DECK_RUN_MODE:$DECK_RUN_REASON:$DECK_BUNDLE_ROOT:$*"\n' > "$T/X.app/Contents/Helpers/deck-pinned"; chmod +x "$T/X.app/Contents/Helpers/deck-pinned"
env -i HOME="$T/home" "$T/X.app/Contents/Helpers/deck" --version
```

Expected: one line `pinned:pinned:registry <...> is missing or not trusted:<T>/X.app:--version` (with the real resolved temp path).

- [ ] **Step 6: Commit**

```bash
git add rt-tray/Package.swift rt-tray/Sources-deck-shim/main.swift rt-tray/build.sh rt-tray/check-bundle.sh AGENTS.md
git commit -m "tray: dev bundle runs deck from the linked checkout through a shim, pin kept as deck-pinned"
```

---

### Task 6: Land, rebuild the dev app, verify live (controller-owned)

Not dispatched. The controller runs it; Matt authorized rebuilding and installing the dev app on 2026-09-23.

- [ ] Merge the mattstack-apps branch to `main` and the repo-tools branch to `main` once each has a clean final review and green CI.
- [ ] Pull `~/Documents/GitHub/mattstack-apps` (check it is on `main` first).
- [ ] In a scratch repo-tools tree at the merged commit: `scripts/fetch-deps.sh arm64`, then `rt-tray/build.sh dev`. Replace `/Applications/mattstack-dev.app` by moving the running one aside and `ditto`-ing the new one in, then `open` it.
- [ ] Confirm: `ps` shows deck as `~/.bun/bin/bun …/apps/deck/src/main.ts serve`; `~/.mattstack/deck/api.json` has `runMode: "source"`; `deck.err.log` ends with `deck-dev-shim: source`; `codesign --verify --strict` passes on the installed app.
- [ ] `deck cmd deck deploy` and its log show a healthy restart with `runMode` still `source`.
- [ ] `deck register --dir` (absolute paths) for board and console, then `/api/apps` shows `badge: "/api/badge"` for both. Continue the app-badges real check from there.
