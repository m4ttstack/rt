import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-flows-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
// Point routes at an empty file so core readers see no real machine state.
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH, "[]");
// Same isolation for readServices(): a nonexistent dir reads as no services,
// so this test's port allocations aren't shifted by real launchd agents
// already running on the dev machine (see LOCAL_AGENTS_DIR in core/discover.ts).
process.env.LOCAL_AGENTS_DIR = join(dir, "agents-not-present");
// Settings live in the same throwaway dir: the rename tests write real
// published/password state and must never touch the repo's data/settings.json.
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");

const { registerApp, unregisterApp, editApp } = await import("./register.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, reloadRegistry, listRecords, deleteRecord } = await import("../registry/records.ts");
const {
  getAppSettings, setPublished, setPassword, setOverride, getOverride, setPublicFollowsOverride, reloadSettings,
} = await import("../../core/settings.ts");

let drivers: { manager: InstanceType<typeof FakeServiceManager>; edge: InstanceType<typeof FakeEdgeProxy> };
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(process.env.LOCAL_APPS_SETTINGS_PATH!, { force: true });
  reloadRegistry();
  reloadSettings();
  drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
});

const input = {
  name: "myapp",
  command: ["bun", "src/server.ts"],
  workingDirectory: "/tmp/myapp",
};

test("register: allocates from 11000, installs the service, registers the alias, writes the record", async () => {
  const res = await registerApp(input, drivers);
  expect(res.status).toBe(201);
  const rec = getRecord("myapp")!;
  expect(rec.port).toBe(11000);
  expect(rec.managedBy).toBe("user");
  expect(rec.kind).toBe("service");
  expect(rec.label).toBe("com.mattstack.local.myapp");
  const spec = drivers.manager.installed.get("com.mattstack.local.myapp")!;
  expect(spec.environment.PORT).toBe("11000");
  expect(spec.workingDirectory).toBe("/tmp/myapp");
  expect(drivers.edge.aliases.get("myapp")).toBe(11000);
});

test("register with staticPort creates an external record and no service", async () => {
  const res = await registerApp({ name: "ext", staticPort: 4200 }, drivers);
  expect(res.status).toBe(201);
  expect(getRecord("ext")!.kind).toBe("external");
  expect(getRecord("ext")!.port).toBe(4200);
  expect(drivers.manager.installed.size).toBe(0);
  expect(drivers.edge.aliases.get("ext")).toBe(4200);
});

test("register rejects a bad name and a taken name", async () => {
  expect((await registerApp({ ...input, name: "Bad Name!" }, drivers)).status).toBe(400);
  await registerApp(input, drivers);
  expect((await registerApp(input, drivers)).status).toBe(409);
});

test("register with adopt writes the record only — no driver calls (bootstrap/migrate path)", async () => {
  const res = await registerApp({ ...input, name: "local", managedBy: "local", staticPort: 11000, adopt: true }, drivers);
  expect(res.status).toBe(201);
  expect(drivers.manager.installed.size).toBe(0);
  expect(drivers.edge.aliases.size).toBe(0);
  expect(getRecord("local")!.managedBy).toBe("local");
});

test("adopt succeeds when the route ALREADY exists — the bootstrap/migrate reality", async () => {
  // In production the real portless driver writes the alias into routes.json
  // BEFORE the record catch-up runs, so the adopt call always sees its own
  // route. That must not read as a name conflict.
  const { writeFileSync } = await import("fs");
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "local.localhost", port: 11000, pid: 0 }]),
  );
  const res = await registerApp({ name: "local", managedBy: "local", staticPort: 11000, adopt: true }, drivers);
  expect(res.status).toBe(201);
  expect(getRecord("local")!.managedBy).toBe("local");
  // A FRESH (non-adopt) registration of that same name is still a conflict:
  const fresh = await registerApp({ name: "local", staticPort: 11000 }, drivers);
  expect(fresh.status).toBe(409);
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
});

test("a portless failure still registers, but lands a loud portless issue", async () => {
  drivers.edge.failNext = "myapp";
  const res = await registerApp(input, drivers);
  expect(res.status).toBe(201);
  const issues = getRecord("myapp")!.issues!;
  expect(issues).toHaveLength(1);
  expect(issues[0]!.source).toBe("portless");
});

test("unregister: registrar-owned, 409 with escape hatch, force overrides", async () => {
  await registerApp({ ...input, managedBy: "rt" }, drivers);
  const denied = await unregisterApp("myapp", "user", false, drivers);
  expect(denied.status).toBe(409);
  expect((denied.body as any).message).toBe("Managed by mattstack — `rt uninstall myapp`");
  const forced = await unregisterApp("myapp", "user", true, drivers);
  expect(forced.status).toBe(200);
  expect(getRecord("myapp")).toBeUndefined();
  expect(drivers.manager.installed.size).toBe(0);
  expect(drivers.edge.aliases.size).toBe(0);
});

test("edit re-ports: reinstalls the service on the new port and re-aliases", async () => {
  await registerApp(input, drivers);
  const res = await editApp("myapp", { port: 11500 }, "user", false, drivers);
  expect(res.status).toBe(200);
  expect(getRecord("myapp")!.port).toBe(11500);
  expect(drivers.manager.installed.get("com.mattstack.local.myapp")!.environment.PORT).toBe("11500");
  expect(drivers.edge.aliases.get("myapp")).toBe(11500);
});

test("edit rename: moves record, label, and alias", async () => {
  await registerApp(input, drivers);
  const res = await editApp("myapp", { name: "renamed" }, "user", false, drivers);
  expect(res.status).toBe(200);
  expect(getRecord("myapp")).toBeUndefined();
  expect(getRecord("renamed")!.label).toBe("com.mattstack.local.renamed");
  expect(drivers.manager.installed.has("com.mattstack.local.renamed")).toBe(true);
  expect(drivers.manager.installed.has("com.mattstack.local.myapp")).toBe(false);
  expect(drivers.edge.aliases.has("renamed")).toBe(true);
});

test("unregister: a teardown driver failure keeps the record — with the issue — instead of silently deleting it", async () => {
  await registerApp(input, drivers);
  drivers.manager.failNext = "com.mattstack.local.myapp";
  const res = await unregisterApp("myapp", "user", false, drivers);
  expect(res.status).toBe(200);
  expect((res.body as any).ok).toBe(false);
  const rec = getRecord("myapp");
  expect(rec).toBeDefined();
  expect(rec!.issues).toHaveLength(1);
  expect(rec!.issues![0]!.source).toBe("launchd");
});

test("edit rename: a teardown driver failure lands a visible issue on the renamed record", async () => {
  await registerApp(input, drivers);
  drivers.manager.failNext = "com.mattstack.local.myapp";
  const res = await editApp("myapp", { name: "renamed" }, "user", false, drivers);
  expect(res.status).toBe(200);
  expect(getRecord("myapp")).toBeUndefined();
  const rec = getRecord("renamed");
  expect(rec).toBeDefined();
  expect(rec!.issues).toHaveLength(1);
  expect(rec!.issues![0]!.source).toBe("launchd");
});

test("edit rename: the app's settings move with it — a private, password-protected app cannot go public by being renamed", async () => {
  await registerApp(input, drivers);
  await setPublished("myapp", false);
  await setPassword("myapp", "hunter2");
  setOverride("myapp", { devPort: 3000, basePort: 11000 });
  setPublicFollowsOverride("myapp", true);
  const before = getAppSettings("myapp");
  expect(before.passwordHash).toBeDefined();

  expect((await editApp("myapp", { name: "renamed" }, "user", false, drivers)).status).toBe(200);

  const after = getAppSettings("renamed");
  expect(after.published).toBe(false);
  // Moved verbatim: setPassword can only re-hash a plaintext, so the EXISTING
  // hash (and its version) has to survive the move byte-for-byte.
  expect(after.passwordHash).toBe(before.passwordHash!);
  expect(after.passwordVersion).toBe(before.passwordVersion);
  expect(after.override).toEqual({ devPort: 3000, basePort: 11000 });
  expect(after.publicFollowsOverride).toBe(true);

  // And nothing lingers under the old name: it reads exactly like a name the
  // settings store has never heard of.
  expect(getAppSettings("myapp")).toEqual(getAppSettings("never-registered"));
  expect(getAppSettings("myapp").published).toBe(true);
  expect(getAppSettings("myapp").passwordHash).toBeUndefined();
});

test("a driver that succeeds on a later pass clears the sync-failure badge a previous one left", async () => {
  drivers.edge.failNext = "myapp";
  await registerApp(input, drivers);
  expect(getRecord("myapp")!.issues!.map((i) => i.source)).toEqual(["portless"]);
  // Same code path, this time healthy: the badge must not outlive the failure.
  expect((await editApp("myapp", { port: 11500 }, "user", false, drivers)).status).toBe(200);
  expect(getRecord("myapp")!.issues ?? []).toEqual([]);
});

test("edit without a port change keeps the live route on the active dev-port override", async () => {
  await registerApp(input, drivers);
  setOverride("myapp", { devPort: 3999, basePort: 11000 });

  const res = await editApp("myapp", { command: ["bun", "src/other.ts"] }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(drivers.edge.aliases.get("myapp")).toBe(3999);
  expect(getOverride("myapp")).toEqual({ devPort: 3999, basePort: 11000 });
});

test("edit with an explicit port change clears the now-stale override and aliases to the new base port", async () => {
  await registerApp(input, drivers);
  setOverride("myapp", { devPort: 3999, basePort: 11000 });

  const res = await editApp("myapp", { port: 11500 }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(drivers.edge.aliases.get("myapp")).toBe(11500);
  expect(getOverride("myapp")).toBeUndefined();
});

test("edit re-ports: a teardown driver failure lands a visible issue without losing the port change", async () => {
  await registerApp(input, drivers);
  drivers.manager.failNext = "com.mattstack.local.myapp";
  const res = await editApp("myapp", { port: 11500 }, "user", false, drivers);
  expect(res.status).toBe(200);
  const rec = getRecord("myapp")!;
  expect(rec.port).toBe(11500);
  expect(rec.issues).toHaveLength(1);
  expect(rec.issues![0]!.source).toBe("launchd");
});
