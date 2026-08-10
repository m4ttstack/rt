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

const { registerApp, unregisterApp, editApp } = await import("./register.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, reloadRegistry, listRecords, deleteRecord } = await import("../registry/records.ts");

let drivers: { manager: InstanceType<typeof FakeServiceManager>; edge: InstanceType<typeof FakeEdgeProxy> };
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
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
