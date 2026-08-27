# deck app-registry (launcher backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give deck the app-registry backend for the mattstack launcher: ingest each managed app's `mattstack.json` (display name, description, icon), store the icon, and serve a slim, CORS-enabled `GET /api/apps` discovery API plus `GET /api/apps/:name/icon`, with a `deck manifest refresh` verb.

**Architecture:** A new `src/registry/manifest.ts` reads/validates the manifest and copies the icon into deck's state dir; `AppRecord` gains `displayName`/`description`/`icon`; the adopt path and a new refresh route ingest it; a new `src/api/discovery.ts` builds the slim rows by reusing `buildStatus`'s resolved `url`; two new routes in `src/api/server.ts` serve the list and the icon with CORS. This is the deck half only; the `<AppLauncher />` component is a separate app-kit plan that runs after app-kit PR #1 merges.

**Tech Stack:** Bun, TypeScript, `bun:test`. deck's existing modules: `src/registry/records.ts` (AppRecord + persistence), `src/api/status.ts` (`buildStatus`, the `url` derivation), `src/api/server.ts` (`startApi` fetch handler, `json()` helper), `src/api/state.ts` (`stateDir()`), `src/services/manager.ts` (`isPlatformManagedBy`), `src/cli/commands.ts` (`runCommand`).

**Spec:** `docs/superpowers/specs/2026-08-27-mattstack-app-launcher-design.md` (read it first; this plan implements Sections A, B, C of that spec).

## Global Constraints

- No em dashes or en dashes in anything you write (code, comments, commit messages, docs). deck's existing code uses ASCII `--`; keep that, never the Unicode dashes.
- Comments state constraints the code cannot show; no narration, no change history. deck's comment style is dense and rationale-first; match it.
- Follow deck's existing patterns exactly: routes are branches inside `startApi`'s `fetch` in `src/api/server.ts`; the `json(data, status?)` helper wraps responses; records go through `listRecords()`/`getRecord(name)`/`putRecord(record)` from `src/registry/records.ts`; state paths come from `stateDir()`.
- Tests use deck's harness: a per-file `mkdtempSync` dir, `process.env.LOCAL_STATE_DIR`/`LOCAL_REGISTRY_PATH`/`LOCAL_APPS_ROUTES_PATH`/`LOCAL_APPS_SETTINGS_PATH`/`LOCAL_PLATFORM_SETTINGS_PATH` pointed into it, and `process.env.HOME = dir` (rt-client resolves HOME at call time). Server tests build `startApi({ manager: new FakeServiceManager(), edge: new FakeEdgeProxy(), tunnel: new FakeTunnelDriver(), ... })`. Never touch the real `~/.mattstack`.
- The discovery API is browser-facing and must NOT leak internal record fields (`command`, `workingDirectory`, `env`, `port`, health). It returns only `name`, `displayName`, `description`, `url`, `icon`.
- The discovery filter is `managedBy !== "user" && !isPlatformManagedBy(managedBy)` (deck's own row is `managedBy: "deck"`, which is also `!== "user"`; it must be excluded).
- Icons are SVG only for v1. Validate: parses as an `<svg`-rooted document and is at most 64 KB. A bad or missing manifest never fails an adopt; it is logged and skipped.
- Commit after every task with a short imperative subject prefixed `feat:`/`test:`/`docs:` per deck's conventional-commit style.
- Run `bun test` (deck's full suite) before each commit; it is fast. Run the focused file during TDD.
- This is deck's live-service repo. Work on a branch (`feat/app-registry`); do not push or merge (the controller opens the PR; Matt merges).

## File structure

```
src/registry/manifest.ts        NEW: Manifest type, readManifest (pure), ingestManifest, iconsDir, iconPathFor, removeIcon
src/registry/manifest.test.ts   NEW
src/registry/records.ts         MODIFY: AppRecord += displayName?/description?/icon?
src/api/discovery.ts            NEW: DiscoveryApp type, buildDiscoveryApps (reuses buildStatus url), readIconResponse
src/api/discovery.test.ts       NEW
src/api/register.ts             MODIFY: ingest on adopt; removeIcon on unregister
src/api/server.ts               MODIFY: GET /api/apps, GET /api/apps/:name/icon, POST /api/v1/apps/:name/manifest/refresh, CORS on the two /api/apps routes
src/api/server.test.ts          MODIFY (or a new src/api/discovery-routes.test.ts): route + CORS coverage
src/cli/commands.ts             MODIFY: `manifest refresh <name>` verb + USAGE line
src/cli/commands.test.ts        MODIFY: the verb hits the refresh route
README.md                       MODIFY: mattstack.json + /api/apps + deck manifest refresh docs
```

---

### Task 1: AppRecord fields, the Manifest type, and readManifest

**Files:**
- Modify: `src/registry/records.ts` (the `AppRecord` interface)
- Create: `src/registry/manifest.ts`
- Create: `src/registry/manifest.test.ts`

**Interfaces:**
- Produces: `interface Manifest { displayName: string; description?: string; icon: string }`; `readManifest(dir: string): Manifest | null` (returns null on missing/invalid, never throws); `AppRecord.displayName?`, `.description?`, `.icon?: { ext: "svg" }`.

- [ ] **Step 1: Extend AppRecord**

In `src/registry/records.ts`, add three optional fields to `AppRecord` after `label?` (keep the existing fields and comments intact):

```ts
  /** Launcher metadata, ingested from the app's mattstack.json (see
      registry/manifest.ts). Only managed products carry these. */
  displayName?: string;
  description?: string;
  /** Present once an icon has been ingested to the deck icon store. */
  icon?: { ext: "svg" };
```

- [ ] **Step 2: Write the failing test for readManifest**

Create `src/registry/manifest.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readManifest } from "./manifest.ts";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>';

test("reads a valid manifest", () => {
  const dir = repo({
    "mattstack.json": JSON.stringify({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" }),
    "public/icon.svg": SVG,
  });
  expect(readManifest(dir)).toEqual({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" });
});

test("null when no manifest file", () => {
  expect(readManifest(mkdtempSync(join(tmpdir(), "empty-")))).toBeNull();
});

test("null on malformed JSON", () => {
  expect(readManifest(repo({ "mattstack.json": "{ not json" }))).toBeNull();
});

test("null when displayName is missing", () => {
  expect(readManifest(repo({ "mattstack.json": JSON.stringify({ icon: "./i.svg" }) }))).toBeNull();
});

test("null when icon is missing", () => {
  expect(readManifest(repo({ "mattstack.json": JSON.stringify({ displayName: "X" }) }))).toBeNull();
});

test("description is optional", () => {
  const dir = repo({ "mattstack.json": JSON.stringify({ displayName: "X", icon: "./i.svg" }) });
  expect(readManifest(dir)).toEqual({ displayName: "X", icon: "./i.svg" });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `bun test src/registry/manifest.test.ts`
Expected: FAIL, cannot find module `./manifest.ts`.

- [ ] **Step 4: Implement readManifest**

Create `src/registry/manifest.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";

export interface Manifest {
  displayName: string;
  description?: string;
  icon: string;
}

/**
 * Reads and validates `<dir>/mattstack.json`. Returns null for any problem
 * (absent, unparseable, missing required fields) rather than throwing: a bad
 * manifest must never fail the adopt that triggered the read. Icon file
 * existence and SVG validity are checked later, at ingest, not here.
 */
export function readManifest(dir: string): Manifest | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "mattstack.json"), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (typeof m.displayName !== "string" || m.displayName.length === 0) return null;
  if (typeof m.icon !== "string" || m.icon.length === 0) return null;
  const out: Manifest = { displayName: m.displayName, icon: m.icon };
  if (typeof m.description === "string") out.description = m.description;
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/registry/manifest.test.ts`
Expected: PASS (6).

- [ ] **Step 6: Full suite + commit**

Run: `bun test`
Expected: green (the new AppRecord fields are optional, so nothing else breaks).

```bash
git add src/registry/manifest.ts src/registry/manifest.test.ts src/registry/records.ts
git commit -m "feat: AppRecord launcher fields and mattstack.json reader"
```

---

### Task 2: Icon store and ingestManifest

**Files:**
- Modify: `src/registry/manifest.ts`
- Modify: `src/registry/manifest.test.ts`

**Interfaces:**
- Consumes: `readManifest`, `getRecord`/`putRecord` from `records.ts`, `stateDir()` from `../api/state.ts`.
- Produces: `iconsDir(): string`, `iconPathFor(name: string): string`, `ingestManifest(name: string): void`, `removeIcon(name: string): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/registry/manifest.test.ts`:

```ts
import { existsSync, readFileSync as rf } from "fs";
import { ingestManifest, iconPathFor, removeIcon } from "./manifest.ts";

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "ingest-state-"));
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
  process.env.HOME = dir;
  return dir;
}

test("ingest copies the icon and writes record metadata", async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  const appDir = repo({
    "mattstack.json": JSON.stringify({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" }),
    "public/icon.svg": SVG,
  });
  putRecord({ name: "chat", managedBy: "rt", port: 11002, kind: "service", workingDirectory: appDir, createdAt: "x" });
  ingestManifest("chat");
  const r = getRecord("chat")!;
  expect(r.displayName).toBe("Chat");
  expect(r.description).toBe("Group chat");
  expect(r.icon).toEqual({ ext: "svg" });
  expect(existsSync(iconPathFor("chat"))).toBe(true);
  expect(rf(iconPathFor("chat"), "utf8")).toContain("<svg");
});

test("ingest is a no-op skip when workingDirectory is undefined", async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  putRecord({ name: "ext", managedBy: "rt", port: 5000, kind: "external", createdAt: "x" });
  expect(() => ingestManifest("ext")).not.toThrow();
  expect(getRecord("ext")!.displayName).toBeUndefined();
});

test("ingest skips a manifest whose icon is not svg or is too large", async () => {
  isolate();
  const { putRecord, getRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  const appDir = repo({
    "mattstack.json": JSON.stringify({ displayName: "Bad", icon: "./big.svg" }),
    "big.svg": "x".repeat(70_000),
  });
  putRecord({ name: "bad", managedBy: "rt", port: 6000, kind: "service", workingDirectory: appDir, createdAt: "x" });
  ingestManifest("bad");
  const r = getRecord("bad")!;
  expect(r.displayName).toBeUndefined();
  expect(existsSync(iconPathFor("bad"))).toBe(false);
});

test("removeIcon deletes the stored file", async () => {
  isolate();
  const { putRecord, reloadRegistry } = await import("./records.ts");
  reloadRegistry();
  const appDir = repo({ "mattstack.json": JSON.stringify({ displayName: "C", icon: "./i.svg" }), "i.svg": SVG });
  putRecord({ name: "c", managedBy: "rt", port: 1, kind: "service", workingDirectory: appDir, createdAt: "x" });
  ingestManifest("c");
  expect(existsSync(iconPathFor("c"))).toBe(true);
  removeIcon("c");
  expect(existsSync(iconPathFor("c"))).toBe(false);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/registry/manifest.test.ts`
Expected: FAIL, `ingestManifest`/`iconPathFor`/`removeIcon` not exported.

- [ ] **Step 3: Implement**

Add to `src/registry/manifest.ts` (keep the existing imports; add these):

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { stateDir } from "../api/state.ts";
import { getRecord, putRecord } from "./records.ts";

const MAX_ICON_BYTES = 64 * 1024;

export function iconsDir(): string {
  return join(stateDir(), "icons");
}

export function iconPathFor(name: string): string {
  return join(iconsDir(), `${name}.svg`);
}

export function removeIcon(name: string): void {
  const p = iconPathFor(name);
  if (existsSync(p)) rmSync(p);
}

/**
 * Reads the app's manifest from its workingDirectory, validates the icon
 * (svg-rooted, at most 64 KB), copies it to the deck icon store, and writes
 * displayName/description/icon onto the record. Every failure path is a quiet
 * skip that leaves the record's launcher fields untouched: a missing
 * workingDirectory (external, port-only apps have none), a missing or
 * malformed manifest, or an icon that fails validation. Never throws.
 */
export function ingestManifest(name: string): void {
  const record = getRecord(name);
  if (!record || record.workingDirectory === undefined) return;
  const manifest = readManifest(record.workingDirectory);
  if (!manifest) return;
  let svg: string;
  try {
    const iconPath = resolve(record.workingDirectory, manifest.icon);
    const bytes = readFileSync(iconPath);
    if (bytes.byteLength > MAX_ICON_BYTES) return;
    svg = bytes.toString("utf8");
  } catch {
    return;
  }
  if (!svg.trimStart().startsWith("<svg")) return;
  mkdirSync(iconsDir(), { recursive: true });
  writeFileSync(iconPathFor(name), svg);
  putRecord({
    ...record,
    displayName: manifest.displayName,
    description: manifest.description,
    icon: { ext: "svg" },
  });
}
```

Note: the top `readFileSync` import already exists from Task 1; merge the fs imports into one line rather than importing `readFileSync` twice.

- [ ] **Step 4: Run the tests**

Run: `bun test src/registry/manifest.test.ts`
Expected: PASS (10). If `stateDir()` does not honor `LOCAL_STATE_DIR`, read `src/api/state.ts` to confirm the env var name and use whatever it actually reads (the plan assumes `LOCAL_STATE_DIR`, which deck's own tests set).

- [ ] **Step 5: Full suite + commit**

Run: `bun test`

```bash
git add src/registry/manifest.ts src/registry/manifest.test.ts
git commit -m "feat: ingest mattstack.json icon into the deck icon store"
```

---

### Task 3: Ingest on adopt, remove icon on unregister

**Files:**
- Modify: `src/api/register.ts`
- Modify: `src/api/register.test.ts`

**Interfaces:**
- Consumes: `ingestManifest`, `removeIcon` from `../registry/manifest.ts`.

- [ ] **Step 1: Read the adopt and unregister paths**

Read `src/api/register.ts`. The real shapes (verified):
- `adoptApp(name: string, opts: { as?: string; managedBy?: string }, drivers: Drivers)` (`register.ts:362`). Three positional args; `drivers` (the fakes in tests) is required because adopt reaches `reconcileMattstackTld`/`editApp`. The record local is `current`; the adopted name is `target`; the stamp is `putRecord({ ...current, managedBy })` at `register.ts:408`; the function ends with `reconcileMattstackTld(...)` and return around `register.ts:411`.
- The delete site is NOT in `unregisterApp` directly: it is `teardownRecord`'s `deleteRecord(record.name)` at `register.ts:180`, shared by both `unregisterApp` and `removeManagedApps`, and it only fires when the record actually goes away.

- [ ] **Step 2: Write the failing test**

Add to `src/api/register.test.ts` (follow the file's existing isolate/import pattern):

```ts
test("adopt ingests the app's mattstack.json", async () => {
  // isolate state + HOME per this file's convention, then:
  const { adoptApp } = await import("./register.ts");
  const { getRecord, putRecord, reloadRegistry } = await import("../registry/records.ts");
  const { iconPathFor } = await import("../registry/manifest.ts");
  reloadRegistry();
  const appDir = /* mkdtemp with mattstack.json {displayName:"Chat",icon:"./i.svg"} + i.svg "<svg.../>" */ "";
  putRecord({ name: "chat", managedBy: "user", port: 11002, kind: "service", workingDirectory: appDir, createdAt: "x" });
  adoptApp("chat", { managedBy: "rt" }, drivers);  // drivers: Drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() } per register.test.ts (tunnel belongs to startApi's ApiDeps, not Drivers)
  expect(getRecord("chat")!.displayName).toBe("Chat");
  expect(require("fs").existsSync(iconPathFor("chat"))).toBe(true);
});
```

(Fill the `appDir` creation using the same `mkdtempSync`/`writeFileSync` helper the manifest test uses; the plan-executor writes it out concretely, no placeholder ships in the test.)

- [ ] **Step 3: Run to see it fail**

Run: `bun test src/api/register.test.ts`
Expected: FAIL, `displayName` undefined (adopt does not yet ingest).

- [ ] **Step 4: Implement**

In `adoptApp`, immediately before the closing `reconcileMattstackTld(...)`/return (around `register.ts:411`, AFTER the `putRecord({ ...current, managedBy })` stamp at `:408`), add:

```ts
  // Pull the app's launcher metadata (mattstack.json + icon) into the registry
  // now that it is a managed product. Placed here, not inside the
  // `current.managedBy !== managedBy` guard, so an idempotent re-adopt (and the
  // rename path) still refreshes the metadata. A missing or bad manifest is a
  // quiet skip inside ingestManifest, so adopt never fails on it.
  ingestManifest(target);
```

In `teardownRecord` (`register.ts:180`), immediately after `deleteRecord(record.name)`, add `removeIcon(record.name);` so a removed app does not leave an orphaned icon (this covers both `unregisterApp` and `removeManagedApps`, and only fires when the record actually goes away). Add the import: `import { ingestManifest, removeIcon } from "../registry/manifest.ts";`.

- [ ] **Step 5: Run + full suite + commit**

Run: `bun test src/api/register.test.ts && bun test`

```bash
git add src/api/register.ts src/api/register.test.ts
git commit -m "feat: ingest launcher manifest on adopt, drop icon on unregister"
```

---

### Task 4: The discovery builder and the /api/apps routes

**Files:**
- Create: `src/api/discovery.ts`
- Create: `src/api/discovery.test.ts`
- Modify: `src/api/server.ts`

**Interfaces:**
- Consumes: `buildStatus` + its `StatusRow.url` from `./status.ts`, `listRecords` from `../registry/records.ts`, `isPlatformManagedBy` from `../services/manager.ts`, `iconPathFor` from `../registry/manifest.ts`.
- Produces: `interface DiscoveryApp { name: string; displayName: string; description?: string; url: string; icon: string | null }`; `buildDiscoveryApps(opts: BuildStatusOpts): Promise<DiscoveryApp[]>`; `iconResponse(name: string): Response`.

- [ ] **Step 1: Write the failing test for the builder**

Create `src/api/discovery.test.ts` (use the server-test harness: temp dir, env vars, HOME, fakes). Register three records via `putRecord`: `chat` (managedBy rt, with displayName/icon ingested from a temp manifest dir), a `deck` platform row (managedBy "deck"), and `mine` (managedBy user).

IMPORTANT: `buildDiscoveryApps` gets each app's `url` from `buildStatus`, whose rows come from `routes.json` (via `dedupeRoutes`), NOT from the registry. `FakeEdgeProxy.alias` does not write routes.json, and the harness seeds it as `"[]"`. So a registry-only setup makes `buildStatus().apps` empty and the builder returns `[]`. Before asserting, SEED the route: write `JSON.stringify([{ hostname: "chat.localhost", port: 11002 }])` to `process.env.LOCAL_APPS_ROUTES_PATH`. Use `chat.localhost`, NOT `chat.mattstack`: `buildStatus` names each row via `bareName(hostname, tlds)`, and `bareName` strips a trailing label only when it is IN `tlds` (`core/discover.ts:170`). The isolated harness's default `tlds` is `["localhost"]` (`platform-settings.ts:14`), and nothing adopts here to derive `"mattstack"` into it, so `bareName("chat.mattstack", ["localhost"])` stays `"chat.mattstack"` (wrong key, builder skips it), while `bareName("chat.localhost", ["localhost"])` = `"chat"` (the registry key). The `chat` record is `managedBy: "rt"` so it is `owned`, and `displayTld` resolves to `MATTSTACK_TLD`, giving `url = "https://chat.mattstack"` (`status.ts:163-172`) even though the seeded route was `.localhost`. Then assert `buildDiscoveryApps` returns only `chat`, with `url` matching `https://chat.mattstack`, `icon` equal to `"chat"` (the builder's host-agnostic form; the route makes it absolute), and none of `command`/`workingDirectory`/`port` on the row.

```ts
test("discovery returns managed products only, no internal fields", async () => {
  // isolate + fakes; put the three records; ingest chat's manifest so it has an icon
  const { buildDiscoveryApps } = await import("./discovery.ts");
  const apps = await buildDiscoveryApps(statusOpts);
  expect(apps.map(a => a.name)).toEqual(["chat"]);
  const chat = apps[0];
  expect(chat.displayName).toBe("Chat");
  expect(chat.url).toMatch(/^https:\/\/chat\./);
  expect(chat.icon).toBe("chat");            // see Step 3: icon is a name here; server makes it absolute
  expect((chat as Record<string, unknown>).workingDirectory).toBeUndefined();
  expect((chat as Record<string, unknown>).port).toBeUndefined();
});
```

Decide the icon shape now (this drives Step 3): `buildDiscoveryApps` returns `icon: string | null` where the string is the app NAME when an icon exists (null when not), and the SERVER route turns it into the absolute `https://deck.<tld>/api/apps/<name>/icon` URL using the request host. This keeps the builder host-agnostic and unit-testable. Adjust the assertion above to match (`chat.icon === "chat"`).

- [ ] **Step 2: Run to see it fail**

Run: `bun test src/api/discovery.test.ts`
Expected: FAIL, `./discovery.ts` not found.

- [ ] **Step 3: Implement the builder**

Create `src/api/discovery.ts`:

```ts
import { buildStatus, type BuildStatusOpts } from "./status.ts";
import { listRecords } from "../registry/records.ts";
import { isPlatformManagedBy } from "../services/manager.ts";

export interface DiscoveryApp {
  name: string;
  displayName: string;
  description?: string;
  url: string;
  /** The app's own name when it has a stored icon, null otherwise. The route
      turns this into an absolute /api/apps/<name>/icon URL. */
  icon: string | null;
}

/**
 * The launcher's app list: managed products only, deck's own platform row and
 * all user apps excluded. `url` is reused verbatim from buildStatus (never
 * recomputed) so it matches deck's routing. No internal record field
 * (command, workingDirectory, env, port, health) crosses this boundary.
 */
export async function buildDiscoveryApps(opts: BuildStatusOpts): Promise<DiscoveryApp[]> {
  const status = await buildStatus(opts);
  const urlByName = new Map(status.apps.map((row) => [row.name, row.url]));
  const apps: DiscoveryApp[] = [];
  for (const record of listRecords()) {
    if (record.managedBy === "user" || isPlatformManagedBy(record.managedBy)) continue;
    const url = urlByName.get(record.name);
    if (!url) continue;
    apps.push({
      name: record.name,
      displayName: record.displayName ?? record.name,
      description: record.description,
      url,
      icon: record.icon ? record.name : null,
    });
  }
  apps.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.name.localeCompare(b.name));
  return apps;
}
```

If `isPlatformManagedBy` is not exported from `../services/manager.ts`, read that file and use the real predicate for deck's own row (the reviewer found it at `src/services/manager.ts`; confirm the export name).

- [ ] **Step 4: Run the builder test**

Run: `bun test src/api/discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the routes in server.ts**

In `src/api/server.ts`, add a block for the unversioned discovery API. Place it BEFORE the `if (pathname.startsWith("/api/v1/"))` block (so `/api/apps` never falls into the v1 handler). Use the existing `json()` helper and `statusOpts`:

```ts
      // ---- launcher discovery API (unversioned, browser-facing, GET only) ----
      if (pathname === "/api/apps" && req.method === "GET") {
        const base = deckBaseFor(host);           // https://deck.<tld> from the request host
        const apps = (await buildDiscoveryApps(statusOpts)).map((a) => ({
          ...a,
          icon: a.icon ? `${base}/api/apps/${a.icon}/icon` : null,
        }));
        return json({ apps });                    // CORS added in Task 5
      }
      {
        const m = pathname.match(/^\/api\/apps\/([^/]+)\/icon$/);
        if (m && req.method === "GET") {
          return iconResponse(m[1]!);             // CORS added in Task 5
        }
      }
```

Add `iconResponse` to `src/api/discovery.ts`:

```ts
import { iconPathFor } from "../registry/manifest.ts";
import { existsSync } from "fs";

export function iconResponse(name: string): Response {
  const p = iconPathFor(name);
  if (!existsSync(p)) return new Response("not found", { status: 404 });
  return new Response(Bun.file(p), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" },
  });
}
```

Add a `deckBaseFor(host)` helper near the top of `server.ts`'s module (or in discovery.ts and import it): derive `https://deck.<tld>` from the request host, where `<tld>` is the last dotted label of `host` (e.g. `chat.mattstack` -> `mattstack` -> `https://deck.mattstack`; `deck.localhost` -> `https://deck.localhost`). Fall back to `https://deck.mattstack` when host is absent. Import `buildDiscoveryApps` and `iconResponse` at the top of `server.ts`.

- [ ] **Step 6: Write the route tests**

Add to `src/api/discovery.test.ts` a `startApi` server block (like `server.test.ts`). `deckBaseFor(host)` derives the tld from the request Host's last dotted label, but a test fetching `http://127.0.0.1:${PORT}/...` has Host `127.0.0.1:PORT`, which yields a garbage base. So send an explicit `headers: { "x-forwarded-host": "chat.mattstack" }` on the fetches (`server.ts` reads `x-forwarded-host` before `host`). Assert: `GET /api/apps` returns `{ apps: [...] }` with only `chat`, its `icon` the absolute `https://deck.mattstack/api/apps/chat/icon`; `GET /api/apps/chat/icon` returns 200 `image/svg+xml`; `GET /api/apps/nope/icon` returns 404. (Or assert the icon loosely with `toContain("/api/apps/chat/icon")` if you prefer not to pin the tld.)

- [ ] **Step 7: Run + full suite + commit**

Run: `bun test src/api/discovery.test.ts && bun test`

```bash
git add src/api/discovery.ts src/api/discovery.test.ts src/api/server.ts
git commit -m "feat: /api/apps discovery list and /api/apps/:name/icon"
```

---

### Task 5: CORS on the two discovery routes

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/api/discovery.test.ts`

**Interfaces:**
- Produces: a `corsHeadersFor(origin: string | null): Record<string,string>` helper applied to the two `/api/apps` responses and an `OPTIONS` preflight branch.

- [ ] **Step 1: Write the failing tests**

Add to `src/api/discovery.test.ts`:

```ts
test("GET /api/apps echoes an allowed mattstack origin in CORS", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { headers: { origin: "https://chat.mattstack" } });
  expect(res.headers.get("access-control-allow-origin")).toBe("https://chat.mattstack");
});

test("GET /api/apps does not CORS-allow a foreign origin", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { headers: { origin: "https://evil.example.com" } });
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test("OPTIONS /api/apps preflight returns the CORS headers", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { method: "OPTIONS", headers: { origin: "https://chat.mattstack" } });
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("https://chat.mattstack");
});

test("the icon route is CORS-allowed too", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps/chat/icon`, { headers: { origin: "https://console.mattstack" } });
  expect(res.headers.get("access-control-allow-origin")).toBe("https://console.mattstack");
});

test("the versioned /api/v1 surface is NOT CORS-opened", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/status`, { headers: { origin: "https://chat.mattstack" } });
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test src/api/discovery.test.ts`
Expected: FAIL, no CORS headers present.

- [ ] **Step 3: Implement CORS**

Add `corsHeadersFor` to `src/api/server.ts`. Allowed when the origin's host equals or ends in one of the allowed TLDs. CRITICAL: deck's default `getPlatformSettings().tlds` is `["localhost"]` only (`src/api/platform-settings.ts:14`); `"mattstack"` is a DERIVED cache entry (`tld-reconcile.ts`) that is ABSENT in the isolated test harness (empty platform.json). So do NOT source `"mattstack"` from `getPlatformSettings().tlds`, or every `*.mattstack` CORS test fails. Union in the `MATTSTACK_TLD` constant explicitly (it is `"mattstack"`, `core/discover.ts:56`, and `server.ts` already imports it):

```ts
// getPlatformSettings is already imported at server.ts:21 and MATTSTACK_TLD at
// server.ts:2; reuse both, do not add duplicate import statements.

function allowedCorsTlds(): string[] {
  // MATTSTACK_TLD is always allowed (it is derived, so may be absent from the
  // stored tlds list, especially in tests); getPlatformSettings().tlds carries
  // localhost plus any bound custom domain.
  return [MATTSTACK_TLD, ...getPlatformSettings().tlds];
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  if (!origin) return {};
  let host: string;
  try { host = new URL(origin).hostname; } catch { return {}; }
  const allowed = allowedCorsTlds().some((t) => host === t || host.endsWith(`.${t}`));
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "vary": "origin",
  };
}
```

Compute `cors` ONCE at the top of the discovery block so both the preflight and the GET handlers share it. This SUPERSEDES the Task 4 Step 5 route block: Task 4 lands the routes without CORS; this task rewrites that block to the CORS-bearing version below (build the two GET responses directly, not via `json()`, so the CORS headers attach):

```ts
      // ---- launcher discovery API (unversioned, browser-facing, GET only, CORS) ----
      if (pathname === "/api/apps" || ICON_ROUTE.test(pathname)) {
        const cors = corsHeadersFor(req.headers.get("origin"));
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        if (pathname === "/api/apps" && req.method === "GET") {
          const base = deckBaseFor(host);
          const apps = (await buildDiscoveryApps(statusOpts)).map((a) => ({
            ...a,
            icon: a.icon ? `${base}/api/apps/${a.icon}/icon` : null,
          }));
          return new Response(JSON.stringify({ apps }), {
            headers: { "content-type": "application/json", ...cors },
          });
        }
        const m = pathname.match(ICON_ROUTE);
        if (m && req.method === "GET") {
          const res = iconResponse(m[1]!);
          for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
          return res;
        }
      }
```

Define `ICON_ROUTE` once at module scope: `const ICON_ROUTE = /^\/api\/apps\/([^/]+)\/icon$/;` (a single shared regex avoids duplicating the pattern). Do NOT touch the `/api/v1` responses.

- [ ] **Step 4: Run + full suite + commit**

Run: `bun test src/api/discovery.test.ts && bun test`

```bash
git add src/api/server.ts src/api/discovery.test.ts
git commit -m "feat: CORS on the /api/apps discovery routes, scoped to mattstack TLDs"
```

---

### Task 6: `deck manifest refresh` verb and the refresh route

**Files:**
- Modify: `src/api/server.ts` (the refresh route)
- Modify: `src/cli/commands.ts` (the verb + USAGE)
- Modify: `src/cli/commands.test.ts`

**Interfaces:**
- Consumes: `ingestManifest`; the API client `apiJson` from `./client.ts`.
- Produces: `POST /api/v1/apps/:name/manifest/refresh` and the `deck manifest refresh <name>` CLI verb.

- [ ] **Step 1: Write the failing route test**

Add to `src/api/discovery.test.ts` (or server.test.ts): register `chat` with a manifest whose displayName is "Chat", ingest, then edit the manifest on disk to displayName "Chatter", `POST /api/v1/apps/chat/manifest/refresh`, and assert `getRecord("chat").displayName === "Chatter"`.

- [ ] **Step 2: Run to see it fail**

Run: `bun test src/api/discovery.test.ts`
Expected: FAIL, route 404s (returns the JSON not-found).

- [ ] **Step 3: Implement the route**

In `src/api/server.ts`, inside the `/api/v1/` block, alongside the existing `/api/v1/apps/:name/...` sub-route matcher (the `pathname.match(/^\/api\/v1\/apps\/([^/]+)(?:\/([a-z-]+))?$/)` block), the current regex captures a single sub-segment. The refresh path has two segments (`manifest/refresh`), so add an explicit branch BEFORE that matcher:

```ts
        {
          const mr = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/manifest\/refresh$/);
          if (mr && req.method === "POST") {
            const name = mr[1]!;
            if (!getRecord(name)) return json({ error: "not-found" }, 404);
            ingestManifest(name);
            return json({ ok: true });
          }
        }
```

Import `ingestManifest` and `getRecord` at the top of `server.ts` if not already present. This is a mutation, so the existing `req.method !== "GET" && isPublic` guard at the top of the `/api/v1/` block already 403s it on a public host, which is correct.

- [ ] **Step 4: Add the CLI verb**

In `src/cli/commands.ts`, add a `case "manifest":` to the `runCommand` switch:

```ts
      case "manifest": {
        const [sub, name] = rest;
        if (sub !== "refresh" || !name) {
          io.err("usage: deck manifest refresh <name>");
          return 2;
        }
        const { status, body } = await apiJson(`/api/v1/apps/${name}/manifest/refresh`, { method: "POST" });
        if (status >= 400) { io.err(body.error ?? "refresh failed"); return 1; }
        io.out(`refreshed ${name}`);
        return 0;
      }
```

Add a line to the `USAGE` string near the `adopt` line:

```
  deck manifest refresh <name>             re-read the app's mattstack.json (name, icon)
```

- [ ] **Step 5: Write the CLI test**

Add to `src/cli/commands.test.ts` a test that `runCommand(["manifest","refresh","chat"], io)` posts to the refresh route and prints `refreshed chat` (follow the file's existing `runCommand` + fake-server pattern).

- [ ] **Step 6: Run + full suite + commit**

Run: `bun test src/api/discovery.test.ts src/cli/commands.test.ts && bun test`

```bash
git add src/api/server.ts src/cli/commands.ts src/cli/commands.test.ts
git commit -m "feat: deck manifest refresh verb and route"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature**

Add a short section to `README.md` (after the "How it works" section) covering:
- `mattstack.json` at an app's repo root: the three fields (`displayName`, `description?`, `icon` as a repo-relative SVG path), and that only managed (adopted) apps are ingested.
- `GET /api/apps`: the slim discovery list (name, displayName, description, url, icon), managed products only, CORS-enabled for mattstack-TLD origins, for the app launcher.
- `GET /api/apps/:name/icon`: the served SVG.
- `deck manifest refresh <name>`: re-ingest after editing the manifest or icon.

Keep it to deck's README voice (terse, example-first). No em dashes.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: mattstack.json manifest and the /api/apps launcher registry"
```

---

### Task 8: End-to-end verification

**Files:**
- Create: `src/api/discovery-e2e.test.ts` (or fold into `discovery.test.ts`)

- [ ] **Step 1: Write one full-path test**

Isolate state + fakes, `startApi`. Create a real temp app dir with `mattstack.json` (displayName "Chat", description, icon `./public/icon.svg`) and the SVG. Register `chat` (managedBy user, kind service, workingDirectory = that dir), a `deck` platform row, and a `mine` user app. Adopt `chat` via `POST /api/v1/apps/chat/adopt` (or `adoptApp`). Then:
- `GET /api/apps` returns exactly `[chat]`, with `chat.url` matching `https://chat.<tld>` and `chat.icon` an absolute `https://deck.<tld>/api/apps/chat/icon`.
- `GET /api/apps/chat/icon` is 200 `image/svg+xml` and the body contains `<svg`.
- The CORS header echoes `https://console.mattstack`.
- deck's own row and `mine` are absent.
- Edit the manifest's displayName, `POST /api/v1/apps/chat/manifest/refresh`, and `GET /api/apps` reflects the new name.

- [ ] **Step 2: Run + full suite**

Run: `bun test src/api/discovery-e2e.test.ts && bun test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/api/discovery-e2e.test.ts
git commit -m "test: end-to-end launcher registry path against fake deck"
```

---

## Self-review notes (run before handoff)

- Spec coverage: manifest (Task 1), icon store + ingest + workingDirectory guard (Task 2), adopt hook + unregister cleanup (Task 3), `/api/apps` + icon route + no-internal-field leak + filter (Task 4), CORS (Task 5), refresh verb + route (Task 6), docs (Task 7), e2e (Task 8). The spec's "opportunistic re-ingest on restart" is intentionally DROPPED (the spec allowed it: "if noisy, drop it and rely on the refresh verb").
- Names used across tasks: `Manifest`, `readManifest`, `ingestManifest`, `iconsDir`, `iconPathFor`, `removeIcon`, `DiscoveryApp`, `buildDiscoveryApps`, `iconResponse`, `deckBaseFor`, `corsHeadersFor`, `AppRecord.{displayName,description,icon}`.
- The discovery response never includes `command`/`workingDirectory`/`env`/`port` (Task 4 asserts their absence).
- Board/console/chat manifests are NOT added here (that touches other repos); this plan is deck-only and verified with fixtures. Adding real `mattstack.json` files to chat/console/board is a follow-up after this PR merges and each app is (re)adopted or `deck manifest refresh`ed.
