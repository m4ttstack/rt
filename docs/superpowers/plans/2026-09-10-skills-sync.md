# rt skills sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt skills sync --pack <x>` brings a pack's compiled skills and installed plugin caches current with their sources in one deterministic chain, and `rt skills check` learns to see installed-cache lag.

**Architecture:** A new CLI leaf beside check/compile. Chain logic lives in `lib/skills/sync.ts` behind injected deps (subprocess runner, compile/check functions) so it unit-tests without spawning. The check and compile handlers in `commands/skills.ts` each get a small extraction so sync can call them in-process. Identity derivation extends the existing `discoverPacks` and `claude plugin list --json` seams; nothing new reads config files.

**Tech Stack:** Bun/TypeScript, bun:test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-skills-sync-design.md`

**Scope:** the rt half only. The spec's console surface (the sync button) lives in another repo, ships second behind a design pass, and is not part of this plan.

## Global Constraints

- This is a public repo: `scripts/repo-purity.sh` must pass. No employer or team names in code, tests, fixtures, comments, or commit messages; neutral fixture names only (`acme`, `beacon`, `t`).
- No personal ticket ids anywhere in source or commits.
- The TS CLI is UI-free: no ink/JSX/react anywhere under `commands/` or `lib/` (`lib/__tests__/no-ui-in-cli.test.ts` enforces).
- Every new command module needs a thunk entry in `lib/module-registry.ts` (`() => import("../commands/skills-sync.ts")`, path spelled literally).
- Exit convention (spec): 0 for synced or no-op; 1 with parseable JSON on stdout (under `--json`) for refusals and step failures.
- `rt skills compile` performs no git operations; sync owns the commit and push of the bump + compiled output (spec, "The chain" step 4).
- Sync never stashes, never force-pushes, never mutates a dirty tree, and never writes into a non-canonical cswap cache (spec, "Error handling").
- `bun run test` does not run e2e and CI does: run the new e2e file explicitly before claiming green.
- Type-check with `bunx tsc --noEmit` (IDE diagnostics are unreliable in this repo).
- Comments follow the clean-code rule: constraints the code cannot show, nothing else. No em dashes or en dashes in any authored text, code, or commit message.
- Commit after each task with a short imperative message.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/skills/packs.ts` (modify) | `PackInfo` gains `marketplace` (the settings registration key) |
| `lib/skills/sources.ts` (modify) | `listInstalledPlugins()`, `installedVersionFor()`, `PluginRoots` carries the raw list |
| `commands/skills.ts` (modify) | check: extract `computeCheck`/`checkPack`, add installed dimension; compile: extract `performCompile`/`compilePackAll` |
| `lib/claude-bin.ts` (create) | resolve the `claude` executable with fallbacks |
| `lib/skills/sync.ts` (create) | the sync chain: guards, pulls, updates, decide, bump, commit/push, verify, sweep, report |
| `commands/skills-sync.ts` (create) | CLI handler: flags, wiring real deps, human + JSON rendering, exit codes |
| `lib/command-tree-def.ts` (modify) | `skills sync` leaf |
| `lib/module-registry.ts` (modify) | thunk for the new module |
| `e2e/tests/skills-sync.test.ts` (create) | pins the `--json` envelope and usage |

---

### Task 1: Marketplace identity and installed-version helpers

**Files:**
- Modify: `lib/skills/packs.ts`
- Modify: `lib/skills/sources.ts`
- Modify: `commands/skills.ts` (only the `resolvePluginRootsFromDir` return shape and the two `PluginRoots` literals in `resolve()`)
- Modify: the two existing typed test literals that annotate `: PluginRoots` — `lib/skills/__tests__/sources.test.ts:96` and `commands/__tests__/skills.test.ts:216` (`computeGolden`) — each gains `list: []` (the root tsconfig type-checks test files, so `bunx tsc --noEmit` fails without this)
- Test: `lib/skills/__tests__/packs.test.ts`, `lib/skills/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: existing `discoverPacks`, `buildPluginRoots`, `PluginListEntry`.
- Produces: `PackInfo.marketplace: string | null`; `listInstalledPlugins(): PluginListEntry[]`; `installedVersionFor(list: PluginListEntry[], id: string): string | null`; `PluginRoots` = `{ byName: Record<string, { dir: string; version: string }>; list: PluginListEntry[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/skills/__tests__/packs.test.ts` (reuse its existing tmp-fixture helpers if equivalent ones exist; otherwise this self-contained fixture):

```ts
test("discoverPacks carries the marketplace registration key", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-packs-mkt-")));
  const marketDir = join(root, "beacon-market");
  const packDir = join(marketDir, "packs", "acme");
  mkdirSync(join(packDir, "pack"), { recursive: true });
  writeFileSync(join(packDir, "pack", "surface.jsonc"), `{ "public": [] }\n`);
  mkdirSync(join(marketDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(marketDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "beacon", plugins: [{ name: "acme", source: "./packs/acme" }] }),
  );
  const settingsPath = join(root, "settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify({ extraKnownMarketplaces: { beacon: { source: { source: "directory", path: marketDir } } } }),
  );

  const packs = discoverPacks({ settingsPath });
  expect(packs).toHaveLength(1);
  expect(packs[0]!.name).toBe("acme");
  expect(packs[0]!.marketplace).toBe("beacon");
});

test("extraPackDirs packs have no marketplace", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-packs-extra-")));
  writeFileSync(join(dir, "surface.jsonc"), `{ "public": [] }\n`);
  const packs = discoverPacks({ settingsPath: join(dir, "nope.json"), extraPackDirs: [{ name: "x", dir }] });
  expect(packs[0]!.marketplace).toBeNull();
});
```

Append to `lib/skills/__tests__/sources.test.ts`:

```ts
test("installedVersionFor reads the version of the matching installed id", () => {
  const install = realpathSync(mkdtempSync(join(tmpdir(), "rt-installed-")));
  mkdirSync(join(install, ".claude-plugin"), { recursive: true });
  writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "0.5.2" }));
  const list = [{ id: "acme@beacon", installPath: install }];
  expect(installedVersionFor(list, "acme@beacon")).toBe("0.5.2");
  expect(installedVersionFor(list, "acme@other")).toBeNull();
  expect(installedVersionFor([{ id: "acme@beacon", installPath: join(install, "gone") }], "acme@beacon")).toBeNull();
});

test("buildPluginRoots preserves the raw entry list", () => {
  const install = realpathSync(mkdtempSync(join(tmpdir(), "rt-roots-list-")));
  mkdirSync(join(install, ".claude-plugin"), { recursive: true });
  writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  const roots = buildPluginRoots([{ id: "acme@beacon", installPath: install }]);
  expect(roots.list).toEqual([{ id: "acme@beacon", installPath: install }]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/skills/__tests__/packs.test.ts lib/skills/__tests__/sources.test.ts`
Expected: FAIL (`marketplace` missing on PackInfo; `installedVersionFor` not exported; `roots.list` undefined).

- [ ] **Step 3: Implement**

`lib/skills/packs.ts`:
- `export type PackInfo = { name: string; dir: string; layout: PackLayout; surfacePath: string; marketplace: string | null };`
- `packFromDir(name, dir, marketplace: string | null = null)` sets it.
- In `discoverPacks`, iterate `Object.entries(settings.extraKnownMarketplaces ?? {})` so the key is in scope, and pass it: `packFromDir(entry.name, pluginDir, marketplaceKey)`.
- `extraPackDirs` and `findEnclosingPack` pass `null`.

`lib/skills/sources.ts`:
```ts
export type PluginRoots = { byName: Record<string, { dir: string; version: string }>; list: PluginListEntry[] };

export function listInstalledPlugins(): PluginListEntry[] {
  const raw = execSync("claude plugin list --json", { encoding: "utf8" });
  return JSON.parse(raw) as PluginListEntry[];
}

export function installedVersionFor(list: PluginListEntry[], id: string): string | null {
  const entry = list.find((e) => e.id === id);
  if (!entry || !existsSync(entry.installPath)) return null;
  try {
    const pluginJson = JSON.parse(readFileSync(join(entry.installPath, ".claude-plugin", "plugin.json"), "utf8"));
    return typeof pluginJson.version === "string" ? pluginJson.version : null;
  } catch {
    return null;
  }
}
```
`buildPluginRoots` returns `{ byName, list }` (the input list, entries with missing installPath included so callers see what the CLI reported); `resolvePluginRoots` becomes `buildPluginRoots(listInstalledPlugins())`.

`commands/skills.ts`: `resolvePluginRootsFromDir` returns `{ byName, list: [] }`; the rosterless literal in `resolve()` becomes `{ byName: {}, list: [] }`.

- [ ] **Step 4: Run the suites**

Run: `bun test lib/skills commands && bunx tsc --noEmit`
Expected: PASS (existing callers only read `byName`).

- [ ] **Step 5: Commit**

```bash
git add lib/skills/packs.ts lib/skills/sources.ts commands/skills.ts lib/skills/__tests__/packs.test.ts lib/skills/__tests__/sources.test.ts
git commit -m "skills: carry marketplace key on PackInfo, expose installed plugin list"
```

---

### Task 2: check learns the installed dimension (and becomes callable in-process)

**Files:**
- Modify: `commands/skills.ts` (`skillsCheck` and around it)
- Test: `commands/__tests__/skills.test.ts`

**Interfaces:**
- Consumes: `installedVersionFor`, `PackInfo.marketplace`, `packPluginIdentity`, existing `resolve`/`compileTargets`/drift machinery.
- Produces (exported from `commands/skills.ts`):
  - `type InstalledInfo = { plugin: string; marketplace: string; version: string | null; sourceVersion: string; status: "current" | "lagging" | "missing" }`
  - `installedInfoFor(resolved: { packDir: string; pluginRoots: PluginRoots }, packs: PackInfo[]): InstalledInfo | null`
  - `type CheckPayload = { pack: string; packDir: string; verbs: CheckVerbRow[]; chainErrors: string[]; installed: InstalledInfo | null; drift: boolean }` (`drift` true when any verb is stale/never-compiled or chainErrors is non-empty; `installed` never affects it)
  - `checkPack(opts: { pack?: string; packDir?: string; manifest?: string; mattstackDir?: string }): Promise<CheckPayload>`

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/skills.test.ts`, reusing its `makeMattstackDir`/`makePackDir`/manifest helpers:

```ts
describe("installedInfoFor", () => {
  function installedFixture(version: string | null): PluginRoots {
    if (version === null) return { byName: {}, list: [] };
    const install = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-installed-")));
    mkdirSync(join(install, ".claude-plugin"), { recursive: true });
    writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version }));
    return { byName: {}, list: [{ id: "acme@beacon", installPath: install }] };
  }
  function packAt(dir: string): PackInfo {
    return { name: "acme", dir, layout: "flat", surfacePath: join(dir, "surface.jsonc"), marketplace: "beacon" };
  }
  function sourcePack(version: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-src-")));
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version }));
    return dir;
  }

  test("lagging when installed is behind source", () => {
    const dir = sourcePack("0.5.3");
    const info = installedInfoFor({ packDir: dir, pluginRoots: installedFixture("0.5.2") }, [packAt(dir)]);
    expect(info).toEqual({ plugin: "acme", marketplace: "beacon", version: "0.5.2", sourceVersion: "0.5.3", status: "lagging" });
  });

  test("current when versions match", () => {
    const dir = sourcePack("0.5.3");
    expect(installedInfoFor({ packDir: dir, pluginRoots: installedFixture("0.5.3") }, [packAt(dir)])!.status).toBe("current");
  });

  test("missing when no installed record", () => {
    const dir = sourcePack("0.5.3");
    const roots: PluginRoots = { byName: {}, list: [{ id: "other@beacon", installPath: dir }] };
    expect(installedInfoFor({ packDir: dir, pluginRoots: roots }, [packAt(dir)])!.status).toBe("missing");
  });

  test("null when the pack has no marketplace or the list is empty", () => {
    const dir = sourcePack("0.5.3");
    expect(installedInfoFor({ packDir: dir, pluginRoots: installedFixture(null) }, [packAt(dir)])).toBeNull();
    const noMkt = { ...packAt(dir), marketplace: null };
    expect(installedInfoFor({ packDir: dir, pluginRoots: installedFixture("0.5.3") }, [noMkt])).toBeNull();
  });
});
```

And a handler-behavior test in the existing `skillsCheck` describe block (fixture packs run with `--mattstack-dir`, whose plugin list is empty, so):

```ts
test("check --json reports installed: null under --mattstack-dir and drift alone drives the exit code", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  const manifest = makeManifest("t");
  await skillsCompile(["--pack", "t", "--mattstack-dir", mattstackDir, "--manifest", manifest]);
  logs.length = 0;
  await skillsCheck(["--pack", "t", "--mattstack-dir", mattstackDir, "--manifest", manifest, "--json"]);
  const payload = JSON.parse(logs.at(-1)!);
  expect(payload.installed).toBeNull();
  expect(payload.verbs.every((v: { status: string }) => v.status === "in-sync")).toBe(true);
  expect(process.exitCode ?? 0).toBe(0);
});
```

(Adapt helper names to the file's actual `makeManifest`/log-capture helpers; the assertions are the contract.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/skills.test.ts`
Expected: FAIL (`installedInfoFor` not exported; payload has no `installed` key).

- [ ] **Step 3: Implement**

In `commands/skills.ts`:

```ts
export type InstalledInfo = {
  plugin: string;
  marketplace: string;
  version: string | null;
  sourceVersion: string;
  status: "current" | "lagging" | "missing";
};

export function installedInfoFor(
  resolved: { packDir: string; pluginRoots: PluginRoots },
  packs: PackInfo[],
): InstalledInfo | null {
  const self = packPluginIdentity(resolved.packDir);
  if (!self || resolved.pluginRoots.list.length === 0) return null;
  const marketplace = packs.find((p) => p.dir === resolved.packDir)?.marketplace ?? null;
  if (!marketplace) return null;
  const version = installedVersionFor(resolved.pluginRoots.list, `${self.name}@${marketplace}`);
  const status = version === null ? "missing" : version === self.version ? "current" : "lagging";
  return { plugin: self.name, marketplace, version, sourceVersion: self.version, status };
}
```

(`resolved.packDir` and `PackInfo.dir` are both realpath'd today; compare directly.)

Restructure `skillsCheck` so the row loop builds `rows`/`chainErrors`/`anyStale` without printing, into:

```ts
export type CheckPayload = {
  pack: string; packDir: string; verbs: CheckVerbRow[]; chainErrors: string[];
  installed: InstalledInfo | null; drift: boolean;
};

async function computeCheck(flags: Flags): Promise<CheckPayload> { /* the moved loop; drift = anyStale */ }

export async function checkPack(opts: { pack?: string; packDir?: string; manifest?: string; mattstackDir?: string }): Promise<CheckPayload> {
  const args: string[] = [];
  if (opts.pack) args.push("--pack", opts.pack);
  if (opts.packDir) args.push("--pack-dir", opts.packDir);
  if (opts.manifest) args.push("--manifest", opts.manifest);
  if (opts.mattstackDir) args.push("--mattstack-dir", opts.mattstackDir);
  return computeCheck(parseFlags(args));
}
```

`installed` inside `computeCheck`: `resolved.pluginRoots.list.length === 0 ? null : installedInfoFor(resolved, discoverPacks())` (skips the settings/marketplace walk in fixture mode, where the list is always empty).

The `skillsCheck` handler then prints from the payload, byte-identical human lines to today for the verb rows and chainErrors (same order: chainErrors first, then per-verb lines), plus one new line when `installed` is lagging or missing:

```
installed cache: lagging (0.5.2 installed vs 0.5.3 source) -- run rt skills sync
installed cache: missing (no installed record for acme@beacon) -- run rt skills sync
```

Exit rule: `if (payload.drift) process.exitCode = 1;` and nothing else. The JSON branch prints the whole payload minus nothing: `console.log(JSON.stringify({ pack, packDir, verbs, chainErrors, installed }))` with `drift` omitted from the wire (it is derivable; keeping the wire shape additive for the console, which types this payload today).

- [ ] **Step 4: Run the suites**

Run: `bun test commands lib/skills && bunx tsc --noEmit`
Expected: PASS, including every pre-existing skillsCheck test unchanged.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts
git commit -m "skills check: report installed-cache lag, expose checkPack for in-process callers"
```

---

### Task 3: compile becomes callable in-process

**Files:**
- Modify: `commands/skills.ts` (`skillsCompile` and around it)
- Test: `commands/__tests__/skills.test.ts`

**Interfaces:**
- Consumes: existing `resolve`, `compileTargets`, `tryCompileVerb`, `writeCompiledVerb`, `otherSideDir`, `enumerateRegistered`.
- Produces (exported): `compilePackAll(opts: { pack?: string; packDir?: string; manifest?: string; mattstackDir?: string }): Promise<{ ok: boolean; errors: string[] }>`.

- [ ] **Step 1: Write the failing test**

Append to the `skillsCompile` describe block (same fixtures as the golden-compile test):

```ts
test("compilePackAll writes the pack and reports ok", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  const manifest = makeManifest("t");
  const result = await compilePackAll({ pack: "t", mattstackDir, manifest });
  expect(result).toEqual({ ok: true, errors: [] });
  expect(existsSync(join(packDir, "skills", "watch-ci", "SKILL.md"))).toBe(true);
});

test("compilePackAll surfaces lint failures as errors, writing nothing", async () => {
  const mattstackDir = makeMattstackDir();
  const packDir = makePackDir();
  const manifest = makeBrokenManifest(packDir); // reuse the missing-required-binding fixture from the existing exit-1 test
  const result = await compilePackAll({ pack: "t", mattstackDir, manifest });
  expect(result.ok).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
});
```

(Adapt fixture-builder names to the file's; the missing-required-binding setup already exists in the "clean one-line error" test.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test commands/__tests__/skills.test.ts`
Expected: FAIL (`compilePackAll` not exported).

- [ ] **Step 3: Implement**

Extract the real-write path of `skillsCompile` (the code from `const outcomes: ... = targets.map(...)` through the misplaced scan, minus all printing and `process.exit`) into:

```ts
function performCompile(resolved: Resolved, verbFilter: string[] | null, write: boolean): {
  outcomes: { target: CompileTarget; outcome: CompileOutcome }[];
  failures: string[];
  misplaced: string[];
} { /* moved code; the write loop runs only when write && failures.length === 0 */ }
```

`skillsCompile` keeps flag parsing, preview handling, and all printing, delegating the compile+write+misplaced work to `performCompile` so the human/JSON output and exit codes stay byte-identical (the existing tests in this file are the regression net).

```ts
export async function compilePackAll(opts: { pack?: string; packDir?: string; manifest?: string; mattstackDir?: string }): Promise<{ ok: boolean; errors: string[] }> {
  const args: string[] = [];
  if (opts.pack) args.push("--pack", opts.pack);
  if (opts.packDir) args.push("--pack-dir", opts.packDir);
  if (opts.manifest) args.push("--manifest", opts.manifest);
  if (opts.mattstackDir) args.push("--mattstack-dir", opts.mattstackDir);
  const resolved = await resolve(parseFlags(args));
  const chainErrors = pipelineChainErrors(resolved);
  if (chainErrors.length > 0) return { ok: false, errors: chainErrors };
  const { failures, misplaced } = performCompile(resolved, null, true);
  const errors = [...failures, ...misplaced.map((name) => `misplaced: ${name}`)];
  return { ok: errors.length === 0, errors };
}
```

The contract: full-pack real compile; `ok` false on chain errors, lint failures, or misplaced verbs, each named in `errors`; no partial write on failure, exactly as the handler behaves today.

- [ ] **Step 4: Run the suites**

Run: `bun test commands lib/skills && bunx tsc --noEmit`
Expected: PASS, all pre-existing compile tests byte-identical.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills.test.ts
git commit -m "skills compile: extract performCompile, expose compilePackAll"
```

---

### Task 4: the sync chain

**Files:**
- Create: `lib/claude-bin.ts`
- Create: `lib/skills/sync.ts`
- Test: `lib/__tests__/claude-bin.test.ts`, `lib/skills/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `PackInfo` (with `marketplace`), `installedVersionFor`, `PluginListEntry`, `checkPack`/`compilePackAll` signatures (injected, never imported here — `lib/` must not import from `commands/`).
- Produces:

```ts
// lib/claude-bin.ts
export function resolveClaudeBin(): string | null;

// lib/skills/sync.ts
export type RunResult = { code: number; stdout: string; stderr: string };
export type SyncDeps = {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<RunResult>;
  claudeBin: string | null;
  checkPack: (packName: string) => Promise<{ drift: boolean }>;
  compilePack: (packName: string) => Promise<{ ok: boolean; errors: string[] }>;
  configDir: string;          // e.g. ~/.claude
  cswapSessionsDir: string;   // e.g. ~/.claude-swap-backup/sessions
};
export type SyncStep = { name: string; status: "ran" | "skipped" | "refused" | "failed"; detail: string };
export type SyncReport = {
  ok: boolean;
  pack: string;
  steps: SyncStep[];
  versions: {
    engine: { before: string | null; after: string | null };
    pack: { source: string; installedBefore: string | null; installedAfter: string | null };
  };
  warnings: string[];
  restartNeeded: boolean;
};
export function bumpPatchVersion(packDir: string): { before: string; after: string };
export async function syncPack(pack: PackInfo, engine: PackInfo, deps: SyncDeps): Promise<SyncReport>;
```

**Chain contract (spec "The chain"; step names are the stable JSON vocabulary):**

| step name | action | skipped when | refused when |
| --- | --- | --- | --- |
| `guards` | `git status --porcelain` in engine + pack checkouts; `git branch --show-current` in engine; existence probe for `<pack.dir>/.worktrees` and `<pack.dir>/.claude/worktrees` | never | either dirty; engine not on `main`; a worktrees directory exists in the pack dir (a directory-marketplace plugin update copies the whole working tree, gitignored junk included; refusal names the prune); `pack.marketplace` or `engine.marketplace` null; `deps.claudeBin` null |
| `pull-engine` | `git pull --ff-only` in `engine.dir` | engine dir === pack dir (the mattstack pack case, pulled once as `pull-pack`) | non-zero exit |
| `pull-pack` | `git pull --ff-only` in `pack.dir` | never | non-zero exit |
| `update-engine` | `claude plugin update <engine.name>@<engine.marketplace>` | installed engine version === engine checkout manifest version; or engine dir === pack dir | non-zero exit → `failed` |
| `check` | `deps.checkPack(pack.name)` | never | never (drives the branch); a throw → `failed` |
| `bump` | `bumpPatchVersion(pack.dir)` | no drift | never |
| `compile` | `deps.compilePack(pack.name)` | no drift | `ok: false` → refused, detail = errors joined; a throw → `failed` |
| `recheck` | `deps.checkPack(pack.name)` | no drift | still drifting → refused: "content drift survives recompile; take the agent path (mattstack:editing-skills)"; a throw → `failed` |
| `commit-push` | `git add -A .` + `git commit -m "skills sync: <pack> v<after>"` + `git push`, cwd `pack.dir` | no drift | non-zero exit → `failed` |
| `update-pack` | `claude plugin update <pack.name>@<pack.marketplace>` | check said installed current AND no drift (the no-op case ends the chain before this) | non-zero exit → `failed` |
| `verify-installed` | re-run `claude plugin list --json`, `installedVersionFor` must equal the pack source version | chain no-opped | mismatch → `failed` |
| `cswap-sweep` | readlink every entry of `cswapSessionsDir/*/plugins`; each that is not a symlink resolving to `join(configDir, "plugins")` appends a warning | sessions dir absent | never (warnings only) |

Version bookkeeping: installed versions before/after come from `deps.run(claudeBin, ["plugin", "list", "--json"])` parsed as `PluginListEntry[]` and fed to `installedVersionFor`; the source versions from each checkout's `.claude-plugin/plugin.json`. A refused or failed step stops the chain, sets `ok: false`, and every later step is omitted from `steps`. `syncPack` wraps every injected-dep and subprocess call in try/catch: a throw (the check/compile facilities raise usage errors, e.g. when manifest discovery finds nothing) becomes that step's `failed` status with the message as detail, never an escaped exception. `restartNeeded` is true iff `update-engine` or `update-pack` ran. The whole-chain no-op (no drift, installed current) ends after `check` with `ok: true, restartNeeded: false`.

`resolveClaudeBin`: `Bun.which("claude")`, then the first existing of `~/.claude/local/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`; else null.

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/claude-bin.test.ts`:

```ts
import { expect, test } from "bun:test";
import { resolveClaudeBin } from "../claude-bin.ts";

test("resolveClaudeBin returns an absolute path or null", () => {
  const bin = resolveClaudeBin();
  if (bin !== null) expect(bin.startsWith("/")).toBe(true);
});
```

`lib/skills/__tests__/sync.test.ts` — build a `FakeWorld` around the deps:

```ts
type Call = { cmd: string; args: string[]; cwd?: string };

function fixturePack(name: string, marketplace: string | null, version: string): PackInfo & { dir: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `rt-sync-${name}-`)));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }, null, 2) + "\n");
  writeFileSync(join(dir, "surface.jsonc"), `{ "public": [] }\n`);
  return { name, dir, layout: "flat", surfacePath: join(dir, "surface.jsonc"), marketplace };
}

function makeDeps(world: {
  calls: Call[];
  gitStatus?: Record<string, string>;          // cwd -> porcelain output
  branch?: string;                              // engine branch, default "main"
  installed?: Record<string, string>;           // id -> version, served via a fake plugin list
  drift?: boolean[];                            // successive checkPack answers
  compileOk?: boolean;
}): SyncDeps { /* returns deps whose run() records calls and answers from the tables;
  "claude plugin list --json" answers with entries whose installPath is a tmp dir
  holding a plugin.json at the mapped version; git commands answer code 0 with the
  mapped outputs; everything else code 0 */ }
```

Cases (one `test` each; assert on `report.steps` names/statuses, `report.ok`, `report.restartNeeded`, and the recorded `calls`):

1. **no-op:** no drift, installed current → steps end at `check`; no `claude plugin update` call recorded; `ok: true`, `restartNeeded: false`.
2. **lag only:** no drift, installed behind → `bump`/`compile`/`recheck`/`commit-push` all `skipped`; `update-pack` and `verify-installed` ran; `restartNeeded: true`.
3. **drift:** first `checkPack` drift true, second false → `bump` ran (plugin.json version on disk incremented `0.5.2` → `0.5.3`), `compile` ran, `commit-push` ran with cwd `pack.dir` and a `git push` call, `update-pack` ran.
4. **drift survives:** both checks drift → `recheck` refused, no `commit-push`, no `update-pack`, `ok: false`, refusal detail names the agent path.
5. **dirty pack checkout:** `gitStatus[pack.dir] = " M x.ts"` → `guards` refused, zero further calls.
6. **engine off-main:** `branch: "feature"` → refused.
7. **missing marketplace:** `marketplace: null` → refused naming the pack and what was looked for.
8. **claudeBin null:** refused naming the probed locations.
9. **update-engine skipped when current:** installed engine version equals checkout version → no engine update call; ran otherwise.
10. **mattstack pack (engine === pack):** `pull-engine` and `update-engine` skipped, single pull, single update as `update-pack`.
11. **cswap sweep:** a sessions dir with one `plugins` symlink to `join(configDir, "plugins")` and one real directory → exactly one warning naming the divergent session dir.
12. **failed update:** `claude plugin update` exits 2 → step `failed`, `ok: false`, stderr in detail.
13. **bumpPatchVersion:** `0.5.9` → `0.5.10`; file rewritten with 2-space indent and trailing newline.
14. **checkPack throws:** `checkPack` rejects with an Error → step `check` is `failed` with the message as detail, `ok: false`, no later calls, nothing thrown out of `syncPack`.
15. **worktrees junk:** a `.worktrees/` directory inside the pack dir → `guards` refused, detail names the directory and says to prune it, zero further calls.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/skills/__tests__/sync.test.ts lib/__tests__/claude-bin.test.ts`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement `lib/claude-bin.ts` and `lib/skills/sync.ts`**

`bumpPatchVersion`:

```ts
export function bumpPatchVersion(packDir: string): { before: string; after: string } {
  const path = join(packDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  const before = manifest.version;
  const m = typeof before === "string" ? before.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!m) throw new Error(`cannot bump non-semver version in ${path}: ${String(before)}`);
  const after = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  writeFileSync(path, JSON.stringify({ ...manifest, version: after }, null, 2) + "\n");
  return { before: before as string, after };
}
```

`syncPack` walks the chain table above, appending a `SyncStep` per row as it goes and returning early on `refused`/`failed`. Every refusal detail states the observed value and the fix (e.g. `engine checkout on branch "feature"; check out main and re-run`). Git subcommands run through `deps.run("git", [...], { cwd })`; plugin commands through `deps.run(deps.claudeBin!, ["plugin", ...])`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/skills/__tests__/sync.test.ts lib/__tests__/claude-bin.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/claude-bin.ts lib/skills/sync.ts lib/__tests__/claude-bin.test.ts lib/skills/__tests__/sync.test.ts
git commit -m "add lib/skills/sync.ts chain and lib/claude-bin.ts resolver"
```

---

### Task 5: the CLI leaf, wiring, and e2e

**Files:**
- Create: `commands/skills-sync.ts`
- Modify: `lib/command-tree-def.ts` (under the `skills` node, beside `check`)
- Modify: `lib/module-registry.ts`
- Test: `e2e/tests/skills-sync.test.ts`
- Docs: run `bun run docs:gen` and commit what it regenerates (never `docs:update`; it hangs)

**Interfaces:**
- Consumes: `syncPack`, `SyncDeps`, `resolveClaudeBin`, `discoverPacks`, `checkPack`, `compilePackAll`.
- Produces: `export async function skillsSync(args: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing e2e test**

`e2e/tests/skills-sync.test.ts`, mirroring the harness usage of an existing file in that directory (isolated HOME, compiled/`bun run` invocation helper):

```ts
test("skills sync with no packs refuses with the discovery error, exit 1", async () => {
  const { code, stdout } = await runRt(["skills", "sync", "--pack", "acme", "--json"]);
  expect(code).toBe(1);
  const payload = JSON.parse(stdout.trim());
  expect(payload.ok).toBe(false);
  expect(String(payload.error)).toContain("no packs discovered");
});

test("skills sync appears in skills help", async () => {
  const { stdout } = await runRt(["skills", "--help"]);
  expect(stdout).toContain("sync");
});
```

(Use the actual helper name the sibling e2e files use for spawning rt; the pinned strings are the contract.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/skills-sync.test.ts`
Expected: FAIL (unknown subcommand).

- [ ] **Step 3: Implement**

`commands/skills-sync.ts`:

```ts
import { homedir } from "os";
import { join } from "path";
import { discoverPacks, type PackInfo } from "../lib/skills/packs.ts";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { syncPack, type SyncDeps, type SyncReport } from "../lib/skills/sync.ts";
import { checkPack, compilePackAll } from "./skills.ts";

export async function skillsSync(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const packFlag = flagValue(args, "--pack");
  const manifest = flagValue(args, "--manifest");

  const packs = discoverPacks();
  const fail = (error: string): never => {
    if (json) console.log(JSON.stringify({ ok: false, error }));
    else console.error(`rt skills sync: ${error}`);
    process.exit(1);
  };
  if (packs.length === 0) fail("no packs discovered (no directory marketplace plugin carries a surface.jsonc); pass --pack <name>");
  const pack = packFlag ? packs.find((p) => p.name === packFlag) : packs.length === 1 ? packs[0] : undefined;
  if (!pack) fail(packFlag ? `pack "${packFlag}" not found among: ${packs.map((p) => p.name).join(", ")}` : `multiple packs; pass --pack <name> (${packs.map((p) => p.name).join(", ")})`);
  const engine = packs.find((p) => p.name === "mattstack") ?? pack!;

  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const deps: SyncDeps = {
    run: async (cmd, cmdArgs, opts) => {
      const proc = Bun.spawn([cmd, ...cmdArgs], { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, stdout, stderr };
    },
    claudeBin: resolveClaudeBin(),
    checkPack: async (name) => {
      const payload = await checkPack({ pack: name, ...(manifest ? { manifest } : {}) });
      return { drift: payload.drift };
    },
    compilePack: (name) => compilePackAll({ pack: name, ...(manifest ? { manifest } : {}) }),
    configDir,
    cswapSessionsDir: join(homedir(), ".claude-swap-backup", "sessions"),
  };

  let report: SyncReport;
  try {
    report = await syncPack(pack!, engine, deps);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }
  if (json) console.log(JSON.stringify(report));
  else renderHuman(report);
  if (!report.ok) process.exitCode = 1;
}
```

`renderHuman`: one line per step (`ran`/`skipped (…)`/`refused: …`/`failed: …`), the version transitions, each warning, and a final line: `synced; restart running Claude sessions to pick up the new caches` when `restartNeeded`, `already current` on the no-op, or the refusal sentence. `flagValue` is the local two-line helper (`const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1];`).

Error shape note: the top-level `fail` envelope (`{ ok: false, error }`) covers pre-chain refusals; chain refusals ride inside the full `SyncReport`. The e2e test pins the pre-chain shape.

`lib/command-tree-def.ts`, inside the `skills` node beside `check` (copy the exact field shape of the `check` leaf, including its `--pack`/`--manifest` arg entries):

```ts
sync: {
  description: "Bring a pack's compiled skills and installed plugin caches current (recompile and plugin-update chain; refuses on content drift)",
  module: "./commands/skills-sync.ts",
  fn: "skillsSync",
  args: [
    { name: "Pack", flag: "--pack", type: "text", placeholder: "name", hint: "Pack to sync; auto-selects when only one pack exists" },
    { name: "Manifest", flag: "--manifest", type: "text", placeholder: "/path/to/skills.jsonc", hint: "Manifest path; omit to auto-find the newest ~/.mattstack/repos/*/skills.jsonc naming this pack" },
  ],
},
```

(Match the sibling nodes' literal structure for the json flag and any shared fields; flags only, no required positional, so no `omitBehavior`.)

`lib/module-registry.ts`:

```ts
"./commands/skills-sync.ts": () => import("../commands/skills-sync.ts"),
```

- [ ] **Step 4: Verify**

Run: `bun run picker:check && bun test lib commands && bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/skills-sync.test.ts && bunx tsc --noEmit`
Expected: all PASS. Then `bun run docs:gen` and inspect the diff (discard nothing by hand; commit what it writes, except any RELEASE_NOTES.md clobber, which gets checked out).

- [ ] **Step 5: Commit**

```bash
git add commands/skills-sync.ts lib/command-tree-def.ts lib/module-registry.ts e2e/tests/skills-sync.test.ts website/
git commit -m "add rt skills sync verb"
```

---

### Task 6: full-suite verification

**Files:** none new.

- [ ] **Step 1:** `bun run test:all` (unit + e2e). Known repo trap: the full suite rotates flakes on main; a failure in a file this branch never touched gets isolated and re-run on its own before being blamed on the branch.
- [ ] **Step 2:** `bun run picker:check && bunx tsc --noEmit && sh scripts/repo-purity.sh` — all clean.
- [ ] **Step 3:** Commit anything docs:gen or the suites surfaced, then stop; PR creation is the session driver's step, not the implementer's.
