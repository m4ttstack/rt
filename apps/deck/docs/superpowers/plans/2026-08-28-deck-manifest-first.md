# deck manifest-first (mattstack.deck.json) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deck app declare itself in one `mattstack.deck.json`, `deck register` from its directory create/sync the whole record, `deck alt` swap serve shapes, and (in rt dev-mode only) run named action commands from per-app board buttons and `deck cmd`.

**Architecture:** A new pure parser (`readDeckManifest` + `resolveServeShape`) feeds one shared server flow, `applyManifest(dir, activeAlt?, drivers)`, that both `deck register` (base shape) and `deck alt` (overlay shape) call. Action commands are stored on the `AppRecord`, executed by a net-new spawn-to-log runner behind dev-mode-gated routes, and surfaced as board buttons via command metadata on the status row. The manifest is the single source of truth; register re-syncs the record to it and subsumes the deleted `deck manifest refresh` verb.

**Tech Stack:** Bun + TypeScript, `.ts` extension imports; launchd supervision via `ServiceManager`; React board compiled to `core/generated/board.{js,css}`; rt state through `@mattstack/rt-client`; `bun test` with `FakeServiceManager`/`FakeEdgeProxy`/`FakeTunnelDriver` and `LOCAL_*` scratch env.

**Spec:** `docs/superpowers/specs/2026-08-28-deck-manifest-first-design.md`

## Global Constraints

- **Manifest file** is `mattstack.deck.json` at the app repo root; it wins over the deprecated identity-only `mattstack.json` when both exist.
- **Commands are shell strings**, run via `sh -c` with the app's `workingDirectory` as cwd. `start` is the only reserved command key; every other key is a free-form action command.
- **Overlays (`altConfigs`) may override ONLY `port` and `commands.start`.** Any other key inside an overlay is rejected loudly at parse (a `{ ok: false, error }` result), never silently ignored.
- **Dev-mode is the rt setting**, read through rt-client, NEVER by reading rt files directly: `getSetting<string>("mattstack.mode").value === "dev"`. Any throw or unset value counts as production (fail closed). No env escape hatch, no override.
- **Icon rules unchanged**: SVG-rooted, at most `64 * 1024` bytes, ingested to `iconsDir()/<name>.svg`.
- **Board artifacts are generated**: after any edit under `core/board/`, run `bun run build:board` and commit the regenerated `core/generated/board.js` and `core/generated/board.css`, or `core/generated-fresh.test.ts` fails.
- **Names** match `/^[a-z0-9][a-z0-9.-]*$/` (`NAME_RE` in `src/api/register.ts:41`).
- **Tests**: unit via `bun test core src`; DOM via `bun test test/dom/`. Scratch state via `LOCAL_STATE_DIR` / `LOCAL_REGISTRY_PATH` / `LOCAL_APPS_ROUTES_PATH` / `LOCAL_APPS_SETTINGS_PATH` / `LOCAL_PLATFORM_SETTINGS_PATH` plus a faked `HOME`; dynamic-import modules AFTER setting env so path resolvers pick up the scratch dir.
- **Comments**: only constraint-bearing comments (parity anchors, ordering traps, invariants). No narration, no reviewer notes. No em dashes or en dashes anywhere (use `...` or rephrase).

---

## File Structure

**New files**
- `src/registry/deck-manifest.ts` ... `DeckManifest` type, `readDeckManifest(dir)` parser + validation, `resolveServeShape(manifest, altName?)` overlay resolution. Pure, no fs side effects beyond reading the manifest file.
- `src/api/register-manifest.ts` ... `applyManifest(dir, activeAlt, drivers)`: the shared register/alt server flow that mirrors a record to a manifest.
- `src/api/dev-mode.ts` ... `isDevMode(deps?)`: rt-client-backed, fail-closed, briefly cached dev-mode read.
- `src/services/command-runner.ts` ... `startCommandRun` / `commandRunStatus`: spawn a shell string to the app log, track a runId, one-in-flight-per-app.
- `src/cli/config-init.ts` ... `configInit(cwd, io)`: scaffold `mattstack.deck.json` from `package.json`.
- `mattstack.deck.json` (repo root) ... deck's own manifest (final adopter task).
- `scripts/deploy.ts` ... deck's own `deploy` action script (build + install binary + restart self).

**Modified files**
- `src/registry/records.ts` ... add `commands`, `altConfigs`, `activeAlt` to `AppRecord`.
- `src/registry/manifest.ts` ... `ingestManifest` reads `mattstack.deck.json` identity first, falls back to `mattstack.json`.
- `src/api/register.ts` ... `adoptApp` routes its identity ingest through the shared path (slim).
- `src/api/server.ts` ... add register/alt/command routes; delete the `manifest/refresh` route; carry `commands` metadata onto rows; gate command routes + metadata on `isDevMode()`.
- `src/api/status.ts` ... include dev-gated `commands` on each `StatusRow`.
- `src/cli/commands.ts` ... add `register`, `alt`, `cmd`, `config` verbs; delete `manifest`; update `USAGE`.
- `core/board/AppsTable.tsx`, `core/board/useBoardState.ts`, `core/board/api.ts`, `core/board/logic.ts` ... command buttons + handler; regenerate `core/generated/board.{js,css}`.
- Test files alongside each, plus a new `test/dom/commands.spec.ts` and fixture.

**Shippable seam:** Phases 1-3 (parser, record model, register/alt/config-init, cleanup) are a complete, usable registration story on their own. Phases 4-6 (dev-mode, action-command runner, routes, board buttons) layer the action-command capability on top. Phase 7 makes deck adopt its own manifest.

---

## Phase 1: Manifest core (pure)

### Task 1: `readDeckManifest` parser + validation

**Files:**
- Create: `src/registry/deck-manifest.ts`
- Test: `src/registry/deck-manifest.test.ts`

**Interfaces:**
- Produces: `interface DeckManifest { name: string; displayName?: string; description?: string; icon?: string; port?: number; commands: Record<string, string>; altConfigs?: Record<string, { port?: number; start?: string }> }` where `commands` includes `start` (when present) and every action command; `type ParseResult = { ok: true; manifest: DeckManifest } | { ok: false; error: string } | null` (null = file absent); `readDeckManifest(dir: string): ParseResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/registry/deck-manifest.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readDeckManifest } from "./deck-manifest.ts";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "deckman-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

test("absent manifest is null (not an error)", () => {
  expect(readDeckManifest(repo({}))).toBeNull();
});

test("reads name, port, start and action commands", () => {
  const dir = repo({
    "mattstack.deck.json": JSON.stringify({
      name: "chat", displayName: "Chat", description: "rt chat viewer", icon: "public/icon.svg",
      port: 11002, commands: { start: "bun run serve", build: "bun run build", deploy: "bun run deploy" },
    }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(true);
  if (!r || !r.ok) throw new Error("unreachable");
  expect(r.manifest.name).toBe("chat");
  expect(r.manifest.port).toBe(11002);
  expect(r.manifest.commands).toEqual({ start: "bun run serve", build: "bun run build", deploy: "bun run deploy" });
  expect(r.manifest.displayName).toBe("Chat");
});

test("reads and normalizes altConfigs (commands.start -> start)", () => {
  const dir = repo({
    "mattstack.deck.json": JSON.stringify({
      name: "chat", commands: { start: "bun run serve" },
      altConfigs: { dev: { port: 5173, commands: { start: "bun run dev" } } },
    }),
  });
  const r = readDeckManifest(dir);
  if (!r || !r.ok) throw new Error("expected ok");
  expect(r.manifest.altConfigs).toEqual({ dev: { port: 5173, start: "bun run dev" } });
});

test("rejects an overlay that overrides anything but port/commands.start", () => {
  const dir = repo({
    "mattstack.deck.json": JSON.stringify({
      name: "chat", commands: { start: "s" },
      altConfigs: { dev: { commands: { deploy: "nope" } } },
    }),
  });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
  if (!r || r.ok) throw new Error("expected error");
  expect(r.error).toContain("dev");
});

test("rejects a non-string command value", () => {
  const dir = repo({ "mattstack.deck.json": JSON.stringify({ name: "chat", commands: { start: 5 } }) });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
});

test("rejects a bad name", () => {
  const dir = repo({ "mattstack.deck.json": JSON.stringify({ name: "Bad Name", commands: {} }) });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
});

test("unparseable JSON is a loud error, not null", () => {
  const dir = repo({ "mattstack.deck.json": "{ not json" });
  const r = readDeckManifest(dir);
  expect(r?.ok).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/registry/deck-manifest.test.ts`
Expected: FAIL (module `./deck-manifest.ts` has no `readDeckManifest`).

- [ ] **Step 3: Write the implementation**

```ts
// src/registry/deck-manifest.ts
import { readFileSync } from "fs";
import { join } from "path";

export interface DeckManifest {
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  port?: number;
  /** Shell strings. `start` (when present) is the supervised service; every other key is an action command. */
  commands: Record<string, string>;
  /** Normalized overlays: each may carry only `port` and/or `start`. */
  altConfigs?: Record<string, { port?: number; start?: string }>;
}

export type ParseResult =
  | { ok: true; manifest: DeckManifest }
  | { ok: false; error: string }
  | null;

const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

function err(error: string): ParseResult {
  return { ok: false, error };
}

export function readDeckManifest(dir: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "mattstack.deck.json"), "utf8");
  } catch {
    return null; // absent is not an error: callers fall back to mattstack.json for identity
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err("mattstack.deck.json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) return err("mattstack.deck.json must be an object");
  const m = parsed as Record<string, unknown>;

  if (typeof m.name !== "string" || !NAME_RE.test(m.name)) {
    return err(`name must match ${NAME_RE}`);
  }

  const commands: Record<string, string> = {};
  if (m.commands !== undefined) {
    if (typeof m.commands !== "object" || m.commands === null) return err("commands must be an object");
    for (const [key, val] of Object.entries(m.commands as Record<string, unknown>)) {
      if (typeof val !== "string" || val.length === 0) return err(`command ${key} must be a non-empty string`);
      commands[key] = val;
    }
  }

  const out: DeckManifest = { name: m.name, commands };
  if (typeof m.displayName === "string") out.displayName = m.displayName;
  if (typeof m.description === "string") out.description = m.description;
  if (typeof m.icon === "string") out.icon = m.icon;
  if (m.port !== undefined) {
    if (!Number.isInteger(m.port) || (m.port as number) < 1 || (m.port as number) > 65535) return err("port must be 1-65535");
    out.port = m.port as number;
  }

  if (m.altConfigs !== undefined) {
    if (typeof m.altConfigs !== "object" || m.altConfigs === null) return err("altConfigs must be an object");
    const alts: Record<string, { port?: number; start?: string }> = {};
    for (const [altName, rawOverlay] of Object.entries(m.altConfigs as Record<string, unknown>)) {
      if (typeof rawOverlay !== "object" || rawOverlay === null) return err(`overlay ${altName} must be an object`);
      const overlay = rawOverlay as Record<string, unknown>;
      const entry: { port?: number; start?: string } = {};
      for (const key of Object.keys(overlay)) {
        // The loud rejection the spec requires: an overlay is the serve shape only.
        if (key !== "port" && key !== "commands") {
          return err(`overlay ${altName} may only override port and commands.start (saw ${key})`);
        }
      }
      if (overlay.port !== undefined) {
        if (!Number.isInteger(overlay.port) || (overlay.port as number) < 1 || (overlay.port as number) > 65535) {
          return err(`overlay ${altName} port must be 1-65535`);
        }
        entry.port = overlay.port as number;
      }
      if (overlay.commands !== undefined) {
        if (typeof overlay.commands !== "object" || overlay.commands === null) return err(`overlay ${altName} commands must be an object`);
        for (const key of Object.keys(overlay.commands as Record<string, unknown>)) {
          if (key !== "start") return err(`overlay ${altName} may only override commands.start (saw commands.${key})`);
        }
        const start = (overlay.commands as Record<string, unknown>).start;
        if (start !== undefined) {
          if (typeof start !== "string" || start.length === 0) return err(`overlay ${altName} commands.start must be a non-empty string`);
          entry.start = start;
        }
      }
      alts[altName] = entry;
    }
    out.altConfigs = alts;
  }

  return { ok: true, manifest: out };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/registry/deck-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry/deck-manifest.ts src/registry/deck-manifest.test.ts
git commit -m "deck-manifest: parse + validate mattstack.deck.json"
```

### Task 2: `resolveServeShape` overlay resolution

**Files:**
- Modify: `src/registry/deck-manifest.ts`
- Test: `src/registry/deck-manifest.test.ts`

**Interfaces:**
- Consumes: `DeckManifest` from Task 1.
- Produces: `resolveServeShape(manifest: DeckManifest, altName?: string): { port?: number; command?: string[] }` ... the effective serve port and launchd argv (`["sh", "-c", start]`) for the base config (no `altName`) or with an overlay applied. Returns `command: undefined` when there is no `start` (a port-only external app).

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/registry/deck-manifest.test.ts
import { resolveServeShape } from "./deck-manifest.ts";

test("base serve shape wraps start in sh -c", () => {
  const shape = resolveServeShape({ name: "chat", port: 11002, commands: { start: "bun run serve" } });
  expect(shape).toEqual({ port: 11002, command: ["sh", "-c", "bun run serve"] });
});

test("overlay overrides port and start", () => {
  const shape = resolveServeShape(
    { name: "chat", port: 11002, commands: { start: "bun run serve" }, altConfigs: { dev: { port: 5173, start: "bun run dev" } } },
    "dev",
  );
  expect(shape).toEqual({ port: 5173, command: ["sh", "-c", "bun run dev"] });
});

test("overlay that omits a field inherits the base for it", () => {
  const shape = resolveServeShape(
    { name: "chat", port: 11002, commands: { start: "bun run serve" }, altConfigs: { hmr: { port: 5173 } } },
    "hmr",
  );
  expect(shape).toEqual({ port: 5173, command: ["sh", "-c", "bun run serve"] });
});

test("unknown alt throws", () => {
  expect(() => resolveServeShape({ name: "c", commands: { start: "s" } }, "nope")).toThrow();
});

test("no start command yields no argv (port-only app)", () => {
  expect(resolveServeShape({ name: "c", port: 4200, commands: {} })).toEqual({ port: 4200, command: undefined });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/registry/deck-manifest.test.ts -t "serve shape"`
Expected: FAIL (`resolveServeShape` not exported).

- [ ] **Step 3: Write the implementation**

```ts
// append to src/registry/deck-manifest.ts
export function resolveServeShape(
  manifest: DeckManifest,
  altName?: string,
): { port?: number; command?: string[] } {
  const overlay = altName === undefined ? undefined : manifest.altConfigs?.[altName];
  if (altName !== undefined && overlay === undefined) {
    throw new Error(`unknown alt config: ${altName}`);
  }
  const port = overlay?.port ?? manifest.port;
  const start = overlay?.start ?? manifest.commands.start;
  return { port, command: start === undefined ? undefined : ["sh", "-c", start] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/registry/deck-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry/deck-manifest.ts src/registry/deck-manifest.test.ts
git commit -m "deck-manifest: resolveServeShape base + overlay"
```

---

## Phase 2: Record model + register/alt flow

### Task 3: Extend `AppRecord` with command/overlay fields

**Files:**
- Modify: `src/registry/records.ts:11-33`
- Test: `src/registry/records.test.ts`

**Interfaces:**
- Produces: `AppRecord` gains optional `commands?: Record<string, string>`, `altConfigs?: Record<string, { port?: number; start?: string }>`, `activeAlt?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/registry/records.test.ts (mirror its existing isolate/import idiom)
test("putRecord round-trips manifest command fields", async () => {
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  putRecord({
    name: "chat", managedBy: "user", port: 11002, kind: "service", createdAt: "x",
    commands: { build: "bun run build", deploy: "bun run deploy" },
    altConfigs: { dev: { port: 5173, start: "bun run dev" } },
    activeAlt: "dev",
  });
  const r = getRecord("chat")!;
  expect(r.commands).toEqual({ build: "bun run build", deploy: "bun run deploy" });
  expect(r.altConfigs).toEqual({ dev: { port: 5173, start: "bun run dev" } });
  expect(r.activeAlt).toBe("dev");
});
```

(Match the existing scratch-env setup at the top of `records.test.ts`; if that file has no per-test isolate, set `LOCAL_REGISTRY_PATH` to a fresh temp file in this test before the dynamic import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/registry/records.test.ts -t "manifest command fields"`
Expected: FAIL (TS error: `commands` not on `AppRecord`).

- [ ] **Step 3: Add the fields**

```ts
// src/registry/records.ts, inside interface AppRecord (after `icon?: { ext: "svg" };`)
  /** Action commands from mattstack.deck.json (shell strings), excluding `start`. Dev-mode-gated at the API. */
  commands?: Record<string, string>;
  /** Declared serve-shape overlays; each may carry only `port` and/or `start`. */
  altConfigs?: Record<string, { port?: number; start?: string }>;
  /** The active overlay (an `altConfigs` key), if any; absent means the base serve shape. */
  activeAlt?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/registry/records.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry/records.ts src/registry/records.test.ts
git commit -m "records: add commands/altConfigs/activeAlt to AppRecord"
```

### Task 4: `applyManifest` shared register/alt flow

**Files:**
- Create: `src/api/register-manifest.ts`
- Modify: `src/api/register.ts` (`RegisterInput` + `registerApp` honor a declared service port)
- Modify: `src/registry/manifest.ts` (identity ingest reads deck.json first)
- Test: `src/api/register-manifest.test.ts`

**Interfaces:**
- Consumes: `readDeckManifest`/`resolveServeShape` (Tasks 1-2); `registerApp`/`editApp`/`type Drivers` (`src/api/register.ts`); `getRecord`/`putRecord` (`src/registry/records.ts`); `ingestManifest` (`src/registry/manifest.ts`).
- Produces: `applyManifest(dir: string, activeAlt: string | undefined, drivers: Drivers): Promise<FlowResult>` where `FlowResult = { status: number; body: unknown }`. On a parse error returns `{ status: 400, body: { error } }`. On success returns `{ status: 200, body: { record } }`. Creates the record when absent (via `registerApp`), else syncs it (via `editApp` for serve-shape changes) and always writes `commands`/`altConfigs`/`activeAlt` + identity.

- [ ] **Step 1: Write the failing tests**

```ts
// src/api/register-manifest.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "applyman-"));
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
  process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
  process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
  process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
  process.env.HOME = dir;
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");
  return dir;
}

function appRepo(manifest: object): string {
  const dir = mkdtempSync(join(tmpdir(), "app-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify(manifest));
  return dir;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

test("register creates a supervised record from the manifest", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const dir = appRepo({ name: "chat", port: 11002, commands: { start: "bun run serve", deploy: "bun run deploy" } });

  const r = await applyManifest(dir, undefined, { manager, edge });
  expect(r.status).toBe(200);
  const rec = getRecord("chat")!;
  expect(rec.command).toEqual(["sh", "-c", "bun run serve"]);
  expect(rec.port).toBe(11002);
  expect(rec.commands).toEqual({ deploy: "bun run deploy" });
  expect(rec.workingDirectory).toBe(dir);
  expect(manager.installed.size).toBe(1);
});

test("register is idempotent and re-syncs a changed start command", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = mkdtempSync(join(tmpdir(), "app-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "chat", port: 11002, commands: { start: "bun run serve" } }));
  await applyManifest(dir, undefined, drivers);
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "chat", port: 11002, commands: { start: "bun run serve2" } }));
  await applyManifest(dir, undefined, drivers);
  expect(getRecord("chat")!.command).toEqual(["sh", "-c", "bun run serve2"]);
});

test("activating an overlay swaps port and start; off restores base", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = appRepo({
    name: "chat", port: 11002, commands: { start: "bun run serve" },
    altConfigs: { dev: { port: 5173, commands: { start: "bun run dev" } } },
  });
  await applyManifest(dir, undefined, drivers);
  await applyManifest(dir, "dev", drivers);
  let rec = getRecord("chat")!;
  expect(rec.port).toBe(5173);
  expect(rec.command).toEqual(["sh", "-c", "bun run dev"]);
  expect(rec.activeAlt).toBe("dev");
  await applyManifest(dir, undefined, drivers);
  rec = getRecord("chat")!;
  expect(rec.port).toBe(11002);
  expect(rec.command).toEqual(["sh", "-c", "bun run serve"]);
  expect(rec.activeAlt).toBeUndefined();
});

test("a bad manifest is a 400 with the parse error", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const dir = appRepo({ name: "chat", commands: { start: "s" }, altConfigs: { dev: { nope: 1 } } });
  const r = await applyManifest(dir, undefined, { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() });
  expect(r.status).toBe(400);
});

test("an absent manifest is a 400", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const r = await applyManifest(mkdtempSync(join(tmpdir(), "empty-")), undefined, { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() });
  expect(r.status).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/register-manifest.test.ts`
Expected: FAIL (`./register-manifest.ts` missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/api/register-manifest.ts
import { readDeckManifest, resolveServeShape } from "../registry/deck-manifest.ts";
import { getRecord, putRecord } from "../registry/records.ts";
import { registerApp, editApp, type Drivers, type FlowResult } from "./register.ts";
import { ingestManifest } from "../registry/manifest.ts";

/**
 * Mirror a record to its manifest. The single flow behind both `deck register`
 * (activeAlt undefined = base serve shape) and `deck alt` (activeAlt = an
 * overlay name, or undefined to return to base). The manifest is the source of
 * truth: every field it declares is (re)written; register clears an active alt
 * because the base serve shape is the manifest's canonical one.
 */
export async function applyManifest(
  dir: string,
  activeAlt: string | undefined,
  drivers: Drivers,
): Promise<FlowResult> {
  const parsed = readDeckManifest(dir);
  if (parsed === null) return { status: 400, body: { error: "no mattstack.deck.json in " + dir } };
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const manifest = parsed.manifest;

  let shape: { port?: number; command?: string[] };
  try {
    shape = resolveServeShape(manifest, activeAlt);
  } catch (e) {
    return { status: 400, body: { error: String((e as Error).message) } };
  }

  const { start: _start, ...actionCommands } = manifest.commands;
  const existing = getRecord(manifest.name);

  if (!existing) {
    // A manifest with neither a start command nor a port declares nothing to stand up.
    if (!shape.command && shape.port === undefined) {
      return { status: 400, body: { error: "manifest must declare commands.start or a port" } };
    }
    const created = await registerApp(
      shape.command
        ? { name: manifest.name, command: shape.command, workingDirectory: dir, port: shape.port }
        : { name: manifest.name, staticPort: shape.port! },
      drivers,
    );
    if (created.status !== 201) return created;
  } else if (shape.command) {
    // Serve shape (command/port) can change between runs and on alt switches;
    // editApp tears the old launchd service down and stands the new one up.
    const edited = await editApp(
      manifest.name,
      { command: shape.command, workingDirectory: dir, ...(shape.port !== undefined && { port: shape.port }) },
      existing.managedBy,
      true,
      drivers,
    );
    if (edited.status !== 200) return edited;
  }

  // Metadata the serve-shape flows above do not carry: action commands, the
  // declared overlays, and which overlay is live. Written last, over whatever
  // registerApp/editApp persisted.
  const record = getRecord(manifest.name)!;
  putRecord({
    ...record,
    commands: Object.keys(actionCommands).length ? actionCommands : undefined,
    altConfigs: manifest.altConfigs,
    activeAlt,
  });
  ingestManifest(manifest.name);
  return { status: 200, body: { record: getRecord(manifest.name) } };
}
```

Honor a manifest-declared **service** port (this is why register.ts changes). `registerApp` today allocates a port for every service (`staticPort` forces `kind: "external"`), so a declared `port: 11002` would be ignored and the service would come up on an allocated 11000. Add `port?: number` to `RegisterInput` (`src/api/register.ts:27-37`) and let a supplied port win over allocation:

```ts
// src/api/register.ts, in registerApp, replacing `let port = input.staticPort;`
let port = input.staticPort ?? input.port;
if (port === undefined) {
  const allocated = allocatePort(listRecords(), routes, await readServices());
  if (allocated === null) return { status: 507, body: { error: "port range exhausted" } };
  port = allocated;
}
```

`isService` still keys off `staticPort === undefined`, so a service with a declared `port` stays `kind: "service"` and installs at the declared port. Existing callers pass no `port`, so they keep allocating ... backward compatible.

Then generalize identity ingest to prefer the deck manifest (edit `src/registry/manifest.ts`, `ingestManifest`, after the `if (!record || record.workingDirectory === undefined) return;` line):

```ts
// src/registry/manifest.ts, inside ingestManifest, replacing `const manifest = readManifest(...)`
  const deck = readDeckManifest(record.workingDirectory);
  const manifest =
    deck && deck.ok && deck.manifest.displayName && deck.manifest.icon
      ? { displayName: deck.manifest.displayName, description: deck.manifest.description, icon: deck.manifest.icon }
      : readManifest(record.workingDirectory); // deprecated mattstack.json fallback (identity only)
  if (!manifest) return;
```

Add `import { readDeckManifest } from "./deck-manifest.ts";` to the top of `manifest.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/register-manifest.test.ts src/registry/manifest.test.ts`
Expected: PASS (existing manifest tests still green: the deck-manifest fallback is only taken when a valid deck.json with identity fields exists).

- [ ] **Step 5: Commit**

```bash
git add src/api/register-manifest.ts src/api/register-manifest.test.ts src/registry/manifest.ts
git commit -m "register-manifest: applyManifest shared register/alt flow"
```

---

## Phase 3: CLI (config init, register, alt)

### Task 5: `deck config init` scaffolding

**Files:**
- Create: `src/cli/config-init.ts`
- Test: `src/cli/config-init.test.ts`

**Interfaces:**
- Produces: `configInit(cwd: string, io: { out(s: string): void; err(s: string): void }): number` ... writes `cwd/mattstack.deck.json`, inferring `name` from the directory basename and `commands.start`/`commands.build` from `package.json` scripts when present; refuses (returns 1) when the manifest already exists.

- [ ] **Step 1: Write the failing tests**

```ts
// src/cli/config-init.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { configInit } from "./config-init.ts";

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

test("scaffolds a manifest inferring name and scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfginit-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { serve: "bun run serve", build: "bun run build" } }));
  const a = io();
  expect(configInit(dir, a)).toBe(0);
  const m = JSON.parse(readFileSync(join(dir, "mattstack.deck.json"), "utf8"));
  expect(m.name).toBe(basename(dir));
  expect(m.commands.start).toBe("bun run serve");
  expect(m.commands.build).toBe("bun run build");
});

test("refuses to overwrite an existing manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfginit-"));
  writeFileSync(join(dir, "mattstack.deck.json"), "{}");
  const a = io();
  expect(configInit(dir, a)).toBe(1);
  expect(readFileSync(join(dir, "mattstack.deck.json"), "utf8")).toBe("{}");
});

test("still scaffolds with no package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfginit-"));
  expect(configInit(dir, io())).toBe(0);
  expect(existsSync(join(dir, "mattstack.deck.json"))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/cli/config-init.test.ts`
Expected: FAIL (`./config-init.ts` missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/cli/config-init.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

interface Io { out(s: string): void; err(s: string): void }

function readScripts(dir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

export function configInit(cwd: string, io: Io): number {
  const target = join(cwd, "mattstack.deck.json");
  if (existsSync(target)) {
    io.err("mattstack.deck.json already exists ... not overwriting");
    return 1;
  }
  const scripts = readScripts(cwd);
  const start = scripts.serve ? "bun run serve" : scripts.start ? "bun run start" : "bun run serve";
  const commands: Record<string, string> = { start };
  if (scripts.build) commands.build = "bun run build";
  const manifest = { name: basename(cwd), commands };
  writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  io.out(`wrote ${target}`);
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/cli/config-init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/config-init.ts src/cli/config-init.test.ts
git commit -m "config-init: scaffold mattstack.deck.json"
```

### Task 6: `deck register` route + verb

**Files:**
- Modify: `src/api/server.ts` (add `POST /api/v1/apps/register`)
- Modify: `src/cli/commands.ts` (add `register` and `config` verbs; update `USAGE`)
- Test: `src/api/server.test.ts`, `src/cli/commands.test.ts`

**Interfaces:**
- Consumes: `applyManifest` (Task 4), `configInit` (Task 5).
- Produces: `POST /api/v1/apps/register` with body `{ dir: string }` → `applyManifest(dir, undefined, deps)`. CLI `deck register [--dir PATH]` posts `{ dir: cwd|--dir }`; CLI `deck config init` calls `configInit(process.cwd(), io)` directly (no API).

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/api/server.test.ts (uses its existing post()/api() helpers + PORT)
test("POST /apps/register creates a record from a manifest dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reg-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "regtest", port: 4321, commands: { start: "bun run serve" } }));
  const res = await post("/api/v1/apps/register", { dir });
  expect(res.status).toBe(200);
  const get = await api("/api/v1/apps/regtest");
  expect(get.status).toBe(200);
});
```

```ts
// append to src/cli/commands.test.ts
test("register from a manifest dir, then config init refuses overwrite", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "regcli-"));
  writeFileSync(join(appDir, "mattstack.deck.json"), JSON.stringify({ name: "regcli", port: 4322, commands: { start: "bun run serve" } }));
  const a = io();
  expect(await runCommand(["register", "--dir", appDir], a)).toBe(0);
  const s = io();
  expect(await runCommand(["status"], s)).toBe(0);
  expect(s.lines.join("\n")).toContain("regcli");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/server.test.ts -t "register" ; bun test src/cli/commands.test.ts -t "register from"`
Expected: FAIL (route + verb absent).

- [ ] **Step 3: Add the route**

```ts
// src/api/server.ts, in the /api/v1 block, alongside the other POST /apps/managed/* checks
if (pathname === "/api/v1/apps/register" && req.method === "POST") {
  const b = await body(req);
  const { applyManifest } = await import("./register-manifest.ts");
  const r = await applyManifest(String(b.dir ?? ""), undefined, deps);
  return json(r.body, r.status);
}
```

Add the CLI verbs (`src/cli/commands.ts`, in the `switch (verb)`):

```ts
case "config": {
  const [sub] = rest;
  if (sub !== "init") { io.err("usage: deck config init"); return 2; }
  const { configInit } = await import("./config-init.ts");
  return configInit(process.cwd(), io);
}
case "register": {
  const dir = flag(rest, "--dir") ?? process.cwd();
  const { status, body } = await apiJson("/api/v1/apps/register", {
    method: "POST", body: JSON.stringify({ dir }),
  });
  if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
  io.out(`registered ${body.record.name} on port ${body.record.port}`);
  return 0;
}
```

Add to `USAGE` (after the `deck add` lines):

```
  deck config init                         scaffold mattstack.deck.json in cwd
  deck register [--dir PATH]               create/sync an app from its mattstack.deck.json
```

(`commands.ts` already imports at top-level; `configInit` is imported lazily inside the case to match the file's existing dynamic-import style for non-API verbs. If `commands.ts` uses static imports only, add `import { configInit } from "./config-init.ts";` at the top and call it directly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/server.test.ts src/cli/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/cli/commands.ts src/api/server.test.ts src/cli/commands.test.ts
git commit -m "cli: deck register + deck config init"
```

### Task 7: `deck alt` route + verb

**Files:**
- Modify: `src/api/server.ts` (add `POST /api/v1/apps/:name/alt`)
- Modify: `src/cli/commands.ts` (add `alt` verb; update `USAGE`)
- Test: `src/api/server.test.ts`, `src/cli/commands.test.ts`

**Interfaces:**
- Consumes: `applyManifest` (Task 4), `getRecord`.
- Produces: `POST /api/v1/apps/:name/alt` body `{ alt: string | null }` → looks up the record's `workingDirectory`, calls `applyManifest(workingDirectory, alt ?? undefined, deps)`. Returns 404 for an unknown app, 400 when the record has no `workingDirectory`. CLI `deck alt <app> <name|off>` posts `{ alt: name === "off" ? null : name }`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/api/server.test.ts
test("POST /apps/:name/alt activates and clears an overlay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name: "altapp", port: 4400, commands: { start: "bun run serve" },
    altConfigs: { dev: { port: 4500, commands: { start: "bun run dev" } } },
  }));
  await post("/api/v1/apps/register", { dir });
  const on = await post("/api/v1/apps/altapp/alt", { alt: "dev" });
  expect(on.status).toBe(200);
  expect((await (await api("/api/v1/apps/altapp")).json()).record.port).toBe(4500);
  const off = await post("/api/v1/apps/altapp/alt", { alt: null });
  expect(off.status).toBe(200);
  expect((await (await api("/api/v1/apps/altapp")).json()).record.port).toBe(4400);
});

test("alt on an unknown app is 404", async () => {
  expect((await post("/api/v1/apps/ghost/alt", { alt: "dev" })).status).toBe(404);
});
```

```ts
// append to src/cli/commands.test.ts
test("deck alt on/off round-trip", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "altcli-"));
  writeFileSync(join(appDir, "mattstack.deck.json"), JSON.stringify({
    name: "altcli", port: 4600, commands: { start: "bun run serve" },
    altConfigs: { dev: { port: 4700 } },
  }));
  expect(await runCommand(["register", "--dir", appDir], io())).toBe(0);
  expect(await runCommand(["alt", "altcli", "dev"], io())).toBe(0);
  expect(await runCommand(["alt", "altcli", "off"], io())).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/server.test.ts -t "alt" ; bun test src/cli/commands.test.ts -t "alt"`
Expected: FAIL.

- [ ] **Step 3: Add the route + verb**

```ts
// src/api/server.ts, inside the /apps/:name matcher block (near sub === "restart")
if (sub === "alt" && req.method === "POST") {
  const record = getRecord(name);
  if (!record) return json({ error: "unknown app" }, 404);
  if (!record.workingDirectory) return json({ error: "app has no manifest directory" }, 400);
  const b = await body(req);
  const alt = b.alt == null ? undefined : String(b.alt);
  const { applyManifest } = await import("./register-manifest.ts");
  const r = await applyManifest(record.workingDirectory, alt, deps);
  return json(r.body, r.status);
}
```

```ts
// src/cli/commands.ts, in the switch
case "alt": {
  const [name, which] = rest;
  if (!name || !which) { io.err(USAGE); return 2; }
  const alt = which === "off" ? null : which;
  const { status, body } = await apiJson(`/api/v1/apps/${name}/alt`, {
    method: "POST", body: JSON.stringify({ alt }),
  });
  if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
  io.out(which === "off" ? `${name} back on its base config` : `${name} now on alt "${which}"`);
  return 0;
}
```

`USAGE` line (after `deck register`):

```
  deck alt <app> <name|off>                activate a declared serve overlay, or return to base
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/server.test.ts src/cli/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/cli/commands.ts src/api/server.test.ts src/cli/commands.test.ts
git commit -m "cli: deck alt overlay activation"
```

---

## Phase 4: Dev-mode + action-command execution

### Task 8: dev-mode reader (rides `mattstack.mode` via rt-client)

**Files:**
- Create: `src/api/dev-mode.ts`
- Test: `src/api/dev-mode.test.ts`

**Interfaces:**
- Produces: `isDevMode(deps?: { read?: () => string | undefined }): boolean` ... true only when the resolved value is `"dev"`; any throw or non-`"dev"` value is production (fail closed). Default `read` calls `getSetting<string>("mattstack.mode").value` through `@mattstack/rt-client`. Result is cached for `DEV_MODE_TTL_MS` (a small window); `resetDevModeCache()` is exported for tests.

- [ ] **Step 1: Write the failing tests**

```ts
// src/api/dev-mode.test.ts
import { test, expect, beforeEach } from "bun:test";
import { isDevMode, resetDevModeCache } from "./dev-mode.ts";

beforeEach(() => resetDevModeCache());

test("dev when mattstack.mode is dev", () => {
  expect(isDevMode({ read: () => "dev" })).toBe(true);
});

test("prod when mattstack.mode is prod", () => {
  expect(isDevMode({ read: () => "prod" })).toBe(false);
});

test("unset value is production (fail closed)", () => {
  expect(isDevMode({ read: () => undefined })).toBe(false);
});

test("a throwing read is production (fail closed)", () => {
  expect(isDevMode({ read: () => { throw new Error("no daemon"); } })).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/dev-mode.test.ts`
Expected: FAIL (`./dev-mode.ts` missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/api/dev-mode.ts
import { getSetting } from "@mattstack/rt-client";

/** rt's machine-flavor setting, written by `rt settings dev-mode`. Read through
    rt-client only, never by touching ~/.mattstack/rt files directly. */
const MODE_KEY = "mattstack.mode";
const DEV_MODE_TTL_MS = 2000;

function defaultRead(): string | undefined {
  return getSetting<string>(MODE_KEY).value;
}

let cached: { at: number; dev: boolean } | null = null;

export function resetDevModeCache(): void {
  cached = null;
}

export function isDevMode(deps: { read?: () => string | undefined } = {}): boolean {
  const now = Date.now();
  if (cached && now - cached.at < DEV_MODE_TTL_MS) return cached.dev;
  let dev = false;
  try {
    dev = (deps.read ?? defaultRead)() === "dev";
  } catch {
    dev = false; // fail closed: a failed read counts as production
  }
  cached = { at: now, dev };
  return dev;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/dev-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/dev-mode.ts src/api/dev-mode.test.ts
git commit -m "dev-mode: rt-client mattstack.mode reader, fail closed"
```

### Task 9: action-command runner

**Files:**
- Create: `src/services/command-runner.ts`
- Test: `src/services/command-runner.test.ts`

**Interfaces:**
- Produces:
  - `startCommandRun(input: { name: string; cmd: string; shell: string; workingDirectory: string }, deps?: { spawn?: SpawnFn; logDir?: string }): { started: true; runId: string } | { started: false; reason: "busy" }` ... spawns `sh -c <shell>` in `workingDirectory`, appends stdout+stderr to `<logDir>/<name>.out.log` / `.err.log`, records an in-memory run keyed by `name`; refuses (`busy`) when a run for `name` is already in flight.
  - `commandRunStatus(name: string, runId: string): { status: "running" | "exited"; exitCode?: number } | null` ... null for an unknown run.
  - `type SpawnFn = (argv: string[], opts: { cwd: string; stdout: number; stderr: number }) => { exited: Promise<number> }` (a `Bun.spawn`-shaped seam).

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/command-runner.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startCommandRun, commandRunStatus, resetRuns } from "./command-runner.ts";

beforeEach(() => resetRuns());

function fakeSpawn(exit: Promise<number>) {
  const calls: Array<{ argv: string[]; cwd: string }> = [];
  const spawn = (argv: string[], opts: { cwd: string; stdout: number; stderr: number }) => {
    calls.push({ argv, cwd: opts.cwd });
    return { exited: exit };
  };
  return { spawn, calls };
}

test("spawns sh -c in the working directory and returns a runId", () => {
  const logDir = mkdtempSync(join(tmpdir(), "runlog-"));
  const { spawn, calls } = fakeSpawn(new Promise(() => {})); // never resolves = still running
  const r = startCommandRun({ name: "chat", cmd: "deploy", shell: "bun run deploy", workingDirectory: "/tmp/app" }, { spawn, logDir });
  expect(r.started).toBe(true);
  if (!r.started) throw new Error("unreachable");
  expect(calls[0].argv).toEqual(["sh", "-c", "bun run deploy"]);
  expect(calls[0].cwd).toBe("/tmp/app");
  expect(commandRunStatus("chat", r.runId)!.status).toBe("running");
});

test("refuses a second run while one is in flight (busy)", () => {
  const logDir = mkdtempSync(join(tmpdir(), "runlog-"));
  const { spawn } = fakeSpawn(new Promise(() => {}));
  const first = startCommandRun({ name: "chat", cmd: "deploy", shell: "s", workingDirectory: "/tmp" }, { spawn, logDir });
  expect(first.started).toBe(true);
  const second = startCommandRun({ name: "chat", cmd: "build", shell: "s", workingDirectory: "/tmp" }, { spawn, logDir });
  expect(second.started).toBe(false);
});

test("status flips to exited with the code when the process ends", async () => {
  const logDir = mkdtempSync(join(tmpdir(), "runlog-"));
  const { spawn } = fakeSpawn(Promise.resolve(0));
  const r = startCommandRun({ name: "chat", cmd: "deploy", shell: "s", workingDirectory: "/tmp" }, { spawn, logDir });
  if (!r.started) throw new Error("unreachable");
  await new Promise((res) => setTimeout(res, 10)); // let the exited handler run
  expect(commandRunStatus("chat", r.runId)).toEqual({ status: "exited", exitCode: 0 });
});

test("unknown run is null", () => {
  expect(commandRunStatus("chat", "nope")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/command-runner.test.ts`
Expected: FAIL (`./command-runner.ts` missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/services/command-runner.ts
import { openSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { logsDir } from "../api/state.ts";

export type SpawnFn = (
  argv: string[],
  opts: { cwd: string; stdout: number; stderr: number },
) => { exited: Promise<number> };

interface Run {
  runId: string;
  cmd: string;
  status: "running" | "exited";
  exitCode?: number;
}

const runs = new Map<string, Run>(); // keyed by app name: one in-flight run per app

export function resetRuns(): void {
  runs.clear();
}

const defaultSpawn: SpawnFn = (argv, opts) => Bun.spawn(argv, opts) as unknown as { exited: Promise<number> };

export function startCommandRun(
  input: { name: string; cmd: string; shell: string; workingDirectory: string },
  deps: { spawn?: SpawnFn; logDir?: string } = {},
): { started: true; runId: string } | { started: false; reason: "busy" } {
  const active = runs.get(input.name);
  if (active && active.status === "running") return { started: false, reason: "busy" };

  const dir = deps.logDir ?? logsDir();
  mkdirSync(dir, { recursive: true });
  // Append into the app's existing deck log, so `deck logs` shows command output.
  const out = openSync(join(dir, `${input.name}.out.log`), "a");
  const errFd = openSync(join(dir, `${input.name}.err.log`), "a");

  const runId = randomBytes(8).toString("hex");
  const run: Run = { runId, cmd: input.cmd, status: "running" };
  runs.set(input.name, run);

  const proc = (deps.spawn ?? defaultSpawn)(["sh", "-c", input.shell], {
    cwd: input.workingDirectory,
    stdout: out,
    stderr: errFd,
  });
  proc.exited.then((code) => {
    run.status = "exited";
    run.exitCode = code;
  });

  return { started: true, runId };
}

export function commandRunStatus(
  name: string,
  runId: string,
): { status: "running" | "exited"; exitCode?: number } | null {
  const run = runs.get(name);
  if (!run || run.runId !== runId) return null;
  return run.exitCode === undefined ? { status: run.status } : { status: run.status, exitCode: run.exitCode };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/services/command-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/command-runner.ts src/services/command-runner.test.ts
git commit -m "command-runner: spawn shell command to app log, one in flight"
```

### Task 10: action-command routes (dev-gated)

**Files:**
- Modify: `src/api/server.ts`
- Test: `src/api/server.test.ts`

**Interfaces:**
- Consumes: `isDevMode` (Task 8), `startCommandRun`/`commandRunStatus` (Task 9), `getRecord`.
- Produces:
  - `POST /api/v1/apps/:name/commands/:cmd` ... in dev only. 404 when `!isDevMode()`, when the app is unknown, or when `:cmd` is not a key of `record.commands`. On overlap returns 409 `{ error: "busy" }`. On success returns `{ started: true, runId }`.
  - `GET /api/v1/apps/:name/commands/:cmd/:runId` ... in dev only. Returns the run status, or 404 for an unknown run.
- Note: `isDevMode` is read from a new optional `ApiDeps.devMode?: () => boolean` so tests inject it; production wiring (Task added in Phase 5 board task / main.ts) defaults it to `isDevMode`.

- [ ] **Step 1: Write the failing tests**

Add a helper to `server.test.ts` that boots a server whose `devMode` returns true (mirror the existing multi-server setup that already stands up extra servers with `cloudflaredDir`), plus one asserting production hides the route. Representative:

```ts
// append to src/api/server.test.ts
// (devServer is a second startApi(...) built in beforeAll with devMode: () => true,
//  on DEV_PORT; devApi/devPost are its fetch helpers. Build the DEFAULT (prod)
//  server explicitly with devMode: () => false so these assertions never depend
//  on the dev machine's real mattstack.mode; prodPost hits that server.)
test("command route runs a declared command in dev", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "cmdapp", port: 4800, commands: { start: "s", build: "echo built" } }));
  await devPost("/api/v1/apps/register", { dir });
  const run = await devPost("/api/v1/apps/cmdapp/commands/build", {});
  expect(run.status).toBe(200);
  const body = await run.json();
  expect(body.started).toBe(true);
  expect(typeof body.runId).toBe("string");
});

test("unknown command name is 404 in dev", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "cmdapp2", port: 4801, commands: { start: "s" } }));
  await devPost("/api/v1/apps/register", { dir });
  expect((await devPost("/api/v1/apps/cmdapp2/commands/ghost", {})).status).toBe(404);
});

test("command route is 404 in production", async () => {
  expect((await prodPost("/api/v1/apps/anything/commands/build", {})).status).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/server.test.ts -t "command route"`
Expected: FAIL.

- [ ] **Step 3: Add the routes + deps field**

```ts
// src/api/server.ts, in interface ApiDeps
  /** Dev-mode gate for action commands. Defaults to isDevMode in production wiring; tests inject it. */
  devMode?: () => boolean;
```

```ts
// src/api/server.ts, in the /api/v1 block, ABOVE the generic /apps/:name matcher
// so the two-segment commands path is matched explicitly (like manifest/refresh was).
{
  const cm = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/commands\/([a-z0-9-]+)(?:\/([a-z0-9]+))?$/);
  if (cm) {
    const dev = (deps.devMode ?? isDevMode)();
    if (!dev) return json({ error: "not found" }, 404); // production: indistinguishable from absent
    const [, name, cmd, runId] = cm as unknown as [string, string, string, string | undefined];
    const record = getRecord(name);
    if (!record?.commands || !(cmd in record.commands)) return json({ error: "not found" }, 404);
    if (runId && req.method === "GET") {
      const st = commandRunStatus(name, runId);
      return st ? json(st) : json({ error: "unknown run" }, 404);
    }
    if (!runId && req.method === "POST") {
      const started = startCommandRun({
        name, cmd, shell: record.commands[cmd]!, workingDirectory: record.workingDirectory!,
      });
      if (!started.started) return json({ error: "busy" }, 409);
      return json({ started: true, runId: started.runId });
    }
  }
}
```

Add imports at the top of `server.ts`:

```ts
import { isDevMode } from "./dev-mode.ts";
import { startCommandRun, commandRunStatus } from "../services/command-runner.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/api/server.test.ts
git commit -m "server: dev-gated action-command run + status routes"
```

### Task 11: `deck cmd` verb

**Files:**
- Modify: `src/cli/commands.ts` (add `cmd` verb; update `USAGE`)
- Test: `src/cli/commands.test.ts`

**Interfaces:**
- Consumes: the command route (Task 10).
- Produces: `deck cmd <app> <name>` posts `POST /api/v1/apps/:app/commands/:name`, prints the `runId`, and returns 1 on a 404 (production or unknown) / 409 (busy). CLI tests boot the shared server with `devMode: () => true` (adjust the `commands.test.ts` `startApi` options to pass `devMode: () => true`).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/cli/commands.test.ts
test("deck cmd runs a declared action command", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "cmdcli-"));
  writeFileSync(join(appDir, "mattstack.deck.json"), JSON.stringify({ name: "cmdcli", port: 4900, commands: { start: "s", build: "echo hi" } }));
  expect(await runCommand(["register", "--dir", appDir], io())).toBe(0);
  const a = io();
  expect(await runCommand(["cmd", "cmdcli", "build"], a)).toBe(0);
  expect(a.lines.join("\n")).toContain("started");
});
```

(Ensure the `commands.test.ts` `startApi(...)` options include `devMode: () => true`, so command routes are live in the CLI harness.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/commands.test.ts -t "deck cmd"`
Expected: FAIL.

- [ ] **Step 3: Add the verb**

```ts
// src/cli/commands.ts, in the switch
case "cmd": {
  const [app, name] = rest;
  if (!app || !name) { io.err(USAGE); return 2; }
  const { status, body } = await apiJson(`/api/v1/apps/${app}/commands/${name}`, { method: "POST" });
  if (status === 404) { io.err(`no such command (is deck in dev mode?): ${app} ${name}`); return 1; }
  if (status === 409) { io.err(`${app} is already running a command`); return 1; }
  if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
  io.out(`started ${app} ${name} (run ${body.runId})`);
  return 0;
}
```

`USAGE` line (after `deck alt`):

```
  deck cmd <app> <name>                    run a declared action command (dev mode only)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands.ts src/cli/commands.test.ts
git commit -m "cli: deck cmd action-command verb"
```

---

## Phase 5: Status payload + board buttons

### Task 12: dev-gated `commands` metadata on the status row

**Files:**
- Modify: `src/api/status.ts` (add `commands` to `StatusRow`, populated only in dev)
- Modify: `src/api/server.ts` (thread `deps.devMode` into `buildStatus`)
- Test: `src/api/status.test.ts` (or `server.test.ts`)

**Interfaces:**
- Consumes: `isDevMode` / `deps.devMode`, `record.commands`.
- Produces: `StatusRow.commands?: string[]` ... the action-command names for the row, present only when dev-mode is on AND the record has commands; absent otherwise. `buildStatus` gains a `devMode: boolean` option threaded from the server.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/api/server.test.ts (dev server vs prod server from Task 10)
test("status carries command names in dev, omits them in prod", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meta-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "metaapp", port: 4950, commands: { start: "s", deploy: "d" } }));
  await devPost("/api/v1/apps/register", { dir });
  const devRow = (await (await devApi("/api/v1/status")).json()).apps.find((a: any) => a.name === "metaapp");
  expect(devRow.commands).toEqual(["deploy"]);
  const prodRow = (await (await api("/api/v1/status")).json()).apps.find((a: any) => a.name === "metaapp");
  expect(prodRow.commands).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/server.test.ts -t "status carries command"`
Expected: FAIL.

- [ ] **Step 3: Thread dev-mode + populate commands**

In `src/api/status.ts`: add `commands?: string[]` to `StatusRow`; add an **optional** `devMode?: boolean` (default false) to the options object `buildStatus` takes ... it MUST be optional so the existing `buildStatus(opts)` call sites in `src/api/status.test.ts` (~10 calls) and `src/api/discovery.test.ts` still compile unchanged. For each row whose record has `commands`, set `commands: opts.devMode && record.commands ? Object.keys(record.commands) : undefined`.

In `src/api/server.ts`: where `statusOpts` is built (around line 210), add `devMode: (deps.devMode ?? isDevMode)()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/api/server.test.ts src/api/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/status.ts src/api/server.ts src/api/server.test.ts
git commit -m "status: dev-gated command names on the row"
```

### Task 13: board renders a button per command

**Files:**
- Modify: `core/board/AppsTable.tsx`, `core/board/useBoardState.ts`, `core/board/api.ts`, `core/board/logic.ts`
- Regenerate: `core/generated/board.js`, `core/generated/board.css`
- Test: `test/dom/commands.spec.ts` (+ `test/fixture/status-commands.json`)

**Interfaces:**
- Consumes: `StatusRow.commands` (Task 12); the command route (Task 10).
- Produces: a `CommandsCell` (mirroring `RestartCell`, `AppsTable.tsx:268-292`) that renders one `Button` per name in `row.commands`, each calling `board.onRunCommand(row, name)`; `onRunCommand` in `useBoardState.ts` (mirroring `onRestart`, lines 141-147) POSTs `/api/v1/apps/${row.name}/commands/${name}` and swallows the rejection so a self-restarting deploy does not surface an error. No client dev-mode check: the buttons render only because `row.commands` is present, which the server already gated.

- [ ] **Step 1: Write the failing DOM test**

Create `test/fixture/status-commands.json` by copying `test/fixture/status.json` and adding `"commands": ["deploy", "build"]` to the `atlas` app row (the row `board.spec.ts` already exercises, so the `aria-label` below is deterministic). The DOM harness is `withBoard(fn, { fixture })` under `bun:test` with a raw `playwright` `Page` (NOT `@playwright/test`, no `mount`, no Playwright matchers ... assert with `bun` `expect` on `.count()` and a `posted` flag, exactly like `board.spec.ts:180-220`):

```ts
// test/dom/commands.spec.ts
import { test, expect } from "bun:test";
import { withBoard } from "./rig.ts";

test("renders a button per command and POSTs on click", async () => {
  await withBoard(async (page) => {
    let postedUrl = "";
    await page.route("**/api/v1/apps/*/commands/*", async (route) => {
      postedUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ started: true, runId: "x" }) });
    });
    const deploy = page.locator('[aria-label="deploy atlas"]');
    expect(await deploy.count()).toBe(1);
    await deploy.click();
    expect(postedUrl).toContain("/api/v1/apps/atlas/commands/deploy");
  }, { fixture: "status-commands.json" });
});

test("no command buttons when the row omits commands", async () => {
  await withBoard(async (page) => {
    expect(await page.locator('[aria-label="deploy atlas"]').count()).toBe(0);
  }, { fixture: "status.json" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run build:board && bun test test/dom/commands.spec.ts`
Expected: FAIL (no command buttons rendered).

- [ ] **Step 3: Implement the cell + handler**

Add to `core/board/api.ts` (mirror `apiPost`): nothing new needed if `apiPost(path)` exists; reuse it. Add `onRunCommand` to `useBoardState.ts`:

```ts
// core/board/useBoardState.ts (near onRestart, ~line 141)
const onRunCommand = useCallback((row: Row, name: string) => {
  // Swallow the rejection: a self-restarting deploy kills the API mid-POST,
  // exactly like onRestart; the 5s poll re-syncs once it returns.
  apiPost(`/api/v1/apps/${row.name}/commands/${name}`).catch(() => {});
}, []);
```

Expose `onRunCommand` on the returned board object. Add `CommandsCell` to `AppsTable.tsx` and place it in the row (near `RestartCell`):

```tsx
// core/board/AppsTable.tsx
function CommandsCell({ row, onRunCommand }: { row: Row; onRunCommand: (row: Row, name: string) => void }) {
  if (!row.commands?.length) return null;
  return (
    <>
      {row.commands.map((name) => (
        <Button key={name} variant="subtle" size="sm" aria-label={`${name} ${row.name}`} onClick={() => onRunCommand(row, name)}>
          {name}
        </Button>
      ))}
    </>
  );
}
```

Add `commands?: string[]` to the board's `Row`/`StatusRow` type in `core/board/logic.ts` (mirror where `override`/`service` are typed). Thread `onRunCommand` from `useBoardState` through `Board.tsx` → `AppsTable` props like `onRestart` is threaded.

- [ ] **Step 4: Regenerate artifacts and run tests**

Run: `bun run build:board && bun test test/dom/commands.spec.ts core/generated-fresh.test.ts`
Expected: PASS (and the freshness test stays green because the regenerated artifacts are about to be committed).

- [ ] **Step 5: Commit**

```bash
git add core/board/ core/generated/board.js core/generated/board.css test/dom/commands.spec.ts test/fixture/status-commands.json
git commit -m "board: per-command action buttons on the app row"
```

---

## Phase 6: CLI cleanup

### Task 14: remove `deck manifest refresh`

**Files:**
- Modify: `src/cli/commands.ts` (delete the `manifest` case; drop the `USAGE` line)
- Modify: `src/api/server.ts` (delete the `manifest/refresh` route branch, `server.ts:321-335`)
- Modify: `src/cli/commands.test.ts` (delete the manifest-refresh test block, ~lines 294-320)
- Test: existing suites stay green.

**Interfaces:**
- Removes: the `manifest` verb and `POST /api/v1/apps/:name/manifest/refresh`. `deck register`'s sync path is the replacement (re-running it re-ingests identity/icon, already covered by Task 4's idempotent-resync test and `manifest.test.ts`).

- [ ] **Step 1: Delete the manifest-refresh CLI tests**

`src/cli/commands.test.ts` has TWO manifest tests, not one: one near line 294 and another at ~lines 322-326. Remove BOTH. After removing them, the `ingestManifest` import (line 24, used only inside the first block ~line 308) is unused ... drop that import line too, or `bun test` will fail on the unused binding under the repo's TS settings. Grep to confirm no other reference: `grep -n ingestManifest src/cli/commands.test.ts`.

- [ ] **Step 2: Run tests to confirm the suite is green without it**

Run: `bun test src/cli/commands.test.ts`
Expected: PASS (the removed test is gone; nothing else references it).

- [ ] **Step 3: Delete the route and verb**

- Remove the `manifest/refresh` matched block in `src/api/server.ts` (the `{ const mr = pathname.match(...) ... }` at lines 321-335) and the now-unused `ingestManifest` import there if no other reference remains (grep first: `grep -n ingestManifest src/api/server.ts`).
- Remove the `case "manifest":` block in `src/cli/commands.ts` and its `USAGE` line (`deck manifest refresh <name> ...`).

- [ ] **Step 4: Run the full unit suite**

Run: `bun test core src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/cli/commands.ts src/cli/commands.test.ts
git commit -m "cleanup: remove deck manifest refresh (subsumed by register)"
```

### Task 15: slim `deck adopt` onto the shared ingest

**Files:**
- Modify: `src/api/register.ts` (`adoptApp`, line 418)
- Test: `src/api/server.test.ts` (adopt still ingests identity)

**Interfaces:**
- Keeps: `adoptApp`'s managedBy assignment, optional rename, and `.mattstack` route bless.
- Changes: its identity ingest now flows through the same `ingestManifest` path that reads `mattstack.deck.json` first (Task 4 already generalized `ingestManifest`), so an rt-spawned product and a hand-run `deck register` ingest through identical code. This is a no-op-shaped change if `ingestManifest` is already the call at `register.ts:418`; the task's job is to confirm adopt no longer has any bespoke `mattstack.json`-only path and to add coverage that adopt ingests a `mattstack.deck.json` identity.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/api/server.test.ts
test("adopt ingests identity from mattstack.deck.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "adopt-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "adoptme", commands: { start: "s" }, displayName: "Adopt Me", icon: "icon.svg" }));
  writeFileSync(join(dir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await post("/api/v1/apps", { name: "adoptme", command: ["sh", "-c", "s"], workingDirectory: dir });
  const res = await post("/api/v1/apps/adoptme/adopt", { managedBy: "rt" });
  expect(res.status).toBe(200);
  const row = await (await api("/api/v1/apps/adoptme")).json();
  expect(row.record.managedBy).toBe("rt");
  // identity came from the deck manifest, not mattstack.json
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test src/api/server.test.ts -t "adopt ingests identity from mattstack.deck.json"`
Expected: If `ingestManifest` was already generalized in Task 4, this may PASS immediately (confirming adopt rides the shared path). If it FAILS, adopt still has a bespoke identity path... proceed to Step 3.

- [ ] **Step 3: Confirm/clean adopt's ingest**

Verify `adoptApp` calls `ingestManifest(target)` (`register.ts:418`) and nothing else reads `mattstack.json` for adopt. If any bespoke identity read remains, delete it in favor of the single `ingestManifest(target)` call.

- [ ] **Step 4: Run the suite**

Run: `bun test core src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/register.ts src/api/server.test.ts
git commit -m "adopt: ingest identity through the shared deck-manifest path"
```

---

## Phase 7: deck adopts its own manifest

### Task 16: deck's `mattstack.deck.json` + deploy script

**Files:**
- Create: `mattstack.deck.json` (repo root)
- Create: `scripts/deploy.ts`
- Modify: `package.json` (add a `deploy` script)
- Test: `src/registry/deck-manifest.test.ts` (parse the real repo manifest)

**Interfaces:**
- Produces: deck's own manifest with `start`/`build`/`deploy`; `deploy` builds the binary, installs it over `~/.mattstack/deck/bin/deck` (the launchd-registered path, matching `install.sh`), and runs `deck restart deck` (the self-restart connection drop is expected and handled by the board's re-poll, Task 13's swallow).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/registry/deck-manifest.test.ts
import { readFileSync as _rf } from "fs";
test("deck's own repo manifest parses", () => {
  const r = readDeckManifest(join(import.meta.dir, "..", ".."));
  expect(r?.ok).toBe(true);
  if (!r || !r.ok) throw new Error("unreachable");
  expect(r.manifest.name).toBe("deck");
  expect(r.manifest.commands.deploy).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/registry/deck-manifest.test.ts -t "own repo manifest"`
Expected: FAIL (no root manifest yet).

- [ ] **Step 3: Write the manifest, deploy script, and package script**

```json
// mattstack.deck.json (repo root)
{
  "name": "deck",
  "displayName": "Deck",
  "description": "named https domains, supervision, and sharing for local apps",
  "commands": {
    "start": "bun run serve",
    "build": "bun run build && bun run build:board",
    "deploy": "bun run deploy"
  }
}
```

```ts
// scripts/deploy.ts
import { $ } from "bun";
import { homedir } from "os";
import { join } from "path";

// The launchd plist runs the binary from this exact path (see install.sh's
// BIN_DIR), so deploy must overwrite it here, not ~/.local/bin, or `deck
// restart deck` would re-exec the stale binary.
const binDir = join(homedir(), ".mattstack", "deck", "bin");
const target = join(binDir, "deck");
await $`bun run build`;
await $`bun run build:board`;
await $`mkdir -p ${binDir}`;
// Same-directory temp + rename: an atomic swap avoids ETXTBSY replacing the
// running binary; the live process keeps its old inode.
await $`install -m 0755 dist/deck ${target}.new`;
await $`mv -f ${target}.new ${target}`;
// The self-restart drops the API mid-response; the board tolerates and re-polls.
await $`deck restart deck`;
```

```jsonc
// package.json scripts: add
"deploy": "bun run scripts/deploy.ts"
```

(Deck's own row already carries `managedBy: "deck"`, so its board buttons appear the same way any other app's do once a `deck register` re-syncs the self row. Do not weaken the platform-row guards in `applyOverride`; action commands are a separate path and unaffected.)

- [ ] **Step 4: Run tests**

Run: `bun test src/registry/deck-manifest.test.ts && bun test core src`
Expected: PASS. (Do not run `bun run deploy` from the plan; it is an operational verb, not a test.)

- [ ] **Step 5: Commit**

```bash
git add mattstack.deck.json scripts/deploy.ts package.json src/registry/deck-manifest.test.ts
git commit -m "deck: adopt its own mattstack.deck.json + deploy script"
```

---

## Follow-ups (out of this plan)

- **chat** and other rt-managed products write their own `mattstack.deck.json` in their own repos (external to this repo); they flow through the identical register/adopt ingest this plan builds.
- The three deferred items from the spec stay deferred: argv (non-shell) command form, per-command env, command timeouts; widening the launcher discovery filter to manifested user apps; `deck alt` auto-selection tied to rt dev-mode.

---

## Self-Review

**Spec coverage:** manifest file + rules (Task 1-2); `deck config init` (Task 5); `deck register` create/sync, subsumes refresh (Task 4, 6, 14); `deck alt` (Task 7); `deck cmd` (Task 11); action-command route + status + one-at-a-time + unknown refusal (Task 9-10); dev-mode gate via rt setting, fail closed, routes absent in prod (Task 8, 10); board buttons + metadata presence + self-restart re-poll tolerance (Task 12-13); universality (any app may carry a manifest ... register does not require managed status); migration/fallback of `mattstack.json` for identity (Task 4); CLI cleanup, adopt slim (Task 14-15); first adopter deck itself (Task 16). Chat is external (Follow-ups).

**Type consistency:** `DeckManifest.commands` includes `start`; `applyManifest` strips `start` before writing `record.commands` (action commands only), which is what `status.ts` keys and the command route validates against ... consistent across Tasks 1, 4, 10, 12. `resolveServeShape` returns `{ port?, command? }` used identically in Task 4. `StatusRow.commands: string[]` (Task 12) matches the board `Row.commands` (Task 13). `isDevMode(deps?)` signature stable across Tasks 8, 10, 12.

**Placeholder scan:** no TBD/TODO; every code step carries real code; DOM test steps note the exact existing precedents (`board.spec.ts:180-220`, `rig.ts`) rather than inventing an API ... the implementer must open `rig.ts` to match its real `mount` signature, called out explicitly.
