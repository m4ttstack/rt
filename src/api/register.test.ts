import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
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
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or the import below touches the real
// ~/.mattstack; beforeEach repoints it to a fresh dir per test below.
process.env.HOME = dir;

const { registerApp, unregisterApp, editApp, restartManagedApps, removeManagedApps } = await import("./register.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, reloadRegistry, listRecords, deleteRecord } = await import("../registry/records.ts");
const {
  getAppSettings, setPublished, setPassword, setOverride, getOverride, setPublicFollowsOverride, reloadSettings,
} = await import("../../core/settings.ts");
const { setOAuth, getOAuth, reloadOAuth } = await import("../edge/oauth.ts");
const { adoptApp } = await import("./register.ts");

let drivers: { manager: InstanceType<typeof FakeServiceManager>; edge: InstanceType<typeof FakeEdgeProxy> };
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(process.env.LOCAL_APPS_SETTINGS_PATH!, { force: true });
  // A fresh HOME per test keeps deck.platform store state (read via register.ts)
  // from leaking test-to-test, same as server.test.ts.
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-flows-home-"));
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
  expect(rec.label).toBe("com.mattstack.deck.myapp");
  const spec = drivers.manager.installed.get("com.mattstack.deck.myapp")!;
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
  const res = await registerApp({ ...input, name: "deck", managedBy: "deck", staticPort: 11000, adopt: true }, drivers);
  expect(res.status).toBe(201);
  expect(drivers.manager.installed.size).toBe(0);
  expect(drivers.edge.aliases.size).toBe(0);
  expect(getRecord("deck")!.managedBy).toBe("deck");
});

test("adopt succeeds when the route ALREADY exists — the bootstrap/migrate reality", async () => {
  // In production the real portless driver writes the alias into routes.json
  // BEFORE the record catch-up runs, so the adopt call always sees its own
  // route. That must not read as a name conflict.
  const { writeFileSync } = await import("fs");
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "deck.localhost", port: 11000, pid: 0 }]),
  );
  const res = await registerApp({ name: "deck", managedBy: "deck", staticPort: 11000, adopt: true }, drivers);
  expect(res.status).toBe(201);
  expect(getRecord("deck")!.managedBy).toBe("deck");
  // A FRESH (non-adopt) registration of that same name is still a conflict:
  const fresh = await registerApp({ name: "deck", staticPort: 11000 }, drivers);
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
  expect(drivers.manager.installed.get("com.mattstack.deck.myapp")!.environment.PORT).toBe("11500");
  expect(drivers.edge.aliases.get("myapp")).toBe(11500);
});

test("edit rename: moves record, label, and alias", async () => {
  await registerApp(input, drivers);
  const res = await editApp("myapp", { name: "renamed" }, "user", false, drivers);
  expect(res.status).toBe(200);
  expect(getRecord("myapp")).toBeUndefined();
  expect(getRecord("renamed")!.label).toBe("com.mattstack.deck.renamed");
  expect(drivers.manager.installed.has("com.mattstack.deck.renamed")).toBe(true);
  expect(drivers.manager.installed.has("com.mattstack.deck.myapp")).toBe(false);
  expect(drivers.edge.aliases.has("renamed")).toBe(true);
});

test("edit: a record deleted by a second writer mid-flight stays dead, never resurrected", async () => {
  // Same class of bug as convert.ts's resurrection fix: editApp() reads its
  // record snapshot before any async work, then awaits a teardown driver
  // call before it ever writes the edited record back. If a second writer
  // (unregisterApp's DELETE) deletes the SAME record while that teardown
  // call is in flight, editApp's eventual write must not resurrect it.
  await registerApp(input, drivers);
  class RaceyManager extends FakeServiceManager {
    override async uninstall(label: string): Promise<void> {
      deleteRecord("myapp"); // the "second writer" landing mid-flight
      return super.uninstall(label);
    }
  }
  const racey = { manager: new RaceyManager(), edge: drivers.edge };

  const res = await editApp("myapp", { port: 11500 }, "user", false, racey);

  expect(getRecord("myapp")).toBeUndefined(); // stays dead
  expect(res.status).toBe(404);
});

test("unregister: a teardown driver failure keeps the record — with the issue — instead of silently deleting it", async () => {
  await registerApp(input, drivers);
  drivers.manager.failNext = "com.mattstack.deck.myapp";
  const res = await unregisterApp("myapp", "user", false, drivers);
  expect(res.status).toBe(200);
  expect((res.body as any).ok).toBe(false);
  const rec = getRecord("myapp");
  expect(rec).toBeDefined();
  expect(rec!.issues).toHaveLength(1);
  expect(rec!.issues![0]!.source).toBe("launchd");
});

test("unregister succeeds when the app's plist was already removed manually (real LaunchdManager, faked exec)", async () => {
  // The live bug this pins: a record whose plist file is already gone (and
  // whose job is already booted out) must still tear down cleanly through
  // the real driver, not just the fake. Genuine SyncIssue-preservation
  // behavior for ACTUAL failures (the test above) must keep working too.
  const scratchAgentsDir = mkdtempSync(join(tmpdir(), "local-flows-agents-"));
  const savedAgentsDir = process.env.LOCAL_AGENTS_DIR;
  process.env.LOCAL_AGENTS_DIR = scratchAgentsDir;
  try {
    const { LaunchdManager } = await import("../services/launchd.ts");
    const realDrivers = { manager: new LaunchdManager(async () => 0), edge: new FakeEdgeProxy() };
    await registerApp(input, realDrivers);
    const plistPath = join(scratchAgentsDir, "com.mattstack.deck.myapp.plist");
    expect(existsSync(plistPath)).toBe(true);
    rmSync(plistPath, { force: true }); // simulate: removed manually, job already booted out

    const res = await unregisterApp("myapp", "user", false, realDrivers);
    expect(res.status).toBe(200);
    expect((res.body as any).ok).toBe(true);
    expect(getRecord("myapp")).toBeUndefined();
  } finally {
    process.env.LOCAL_AGENTS_DIR = savedAgentsDir;
    rmSync(scratchAgentsDir, { recursive: true, force: true });
  }
});

test("edit rename: a teardown driver failure lands a visible issue on the renamed record", async () => {
  await registerApp(input, drivers);
  drivers.manager.failNext = "com.mattstack.deck.myapp";
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

test("edit rename: the app's sign-in rule moves with it — the allowlist cannot be dropped by a rename", async () => {
  await registerApp(input, drivers);
  reloadOAuth();
  setOAuth("myapp", { mode: "emails", emails: ["m@x.dev"] });

  expect((await editApp("myapp", { name: "renamed" }, "user", false, drivers)).status).toBe(200);

  expect(getOAuth("renamed")).toEqual({ mode: "emails", emails: ["m@x.dev"] });
  expect(getOAuth("myapp")).toEqual({ mode: "off" });
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
  drivers.manager.failNext = "com.mattstack.deck.myapp";
  const res = await editApp("myapp", { port: 11500 }, "user", false, drivers);
  expect(res.status).toBe(200);
  const rec = getRecord("myapp")!;
  expect(rec.port).toBe(11500);
  expect(rec.issues).toHaveLength(1);
  expect(rec.issues![0]!.source).toBe("launchd");
});

test("resolves argv0 to an absolute path at render time, keeping the logical command on the record", async () => {
  await registerApp(input, drivers);

  const spec = drivers.manager.installed.get("com.mattstack.deck.myapp")!;
  // launchd does not search PATH for ProgramArguments[0].
  expect(spec.programArguments[0]!.startsWith("/")).toBe(true);
  expect(spec.programArguments[0]!.endsWith("/bun")).toBe(true);
  expect(spec.programArguments.slice(1)).toEqual(["src/server.ts"]);
  // The record keeps the logical name, so a later render re-resolves it.
  expect(getRecord("myapp")!.command).toEqual(["bun", "src/server.ts"]);
});

test("refuses to install a service whose program cannot be found", async () => {
  const res = await registerApp(
    { ...input, name: "ghostapp", command: ["definitely-not-a-real-binary", "x.js"] },
    drivers,
  );

  // Registered, but loudly broken rather than silently down: launchd declines
  // to start a job naming a nonexistent program without logging anything.
  expect(res.status).toBe(201);
  expect(drivers.manager.installed.has("com.mattstack.deck.ghostapp")).toBe(false);
  const issues = getRecord("ghostapp")!.issues!;
  expect(issues.some((i) => i.source === "launchd" && i.message.includes("not found"))).toBe(true);
});

// ─── adopt: user app -> mattstack product (ownership flip + optional rename) ──

function routesOnDisk(): Array<{ hostname: string; port: number }> {
  return JSON.parse(require("fs").readFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "utf8"));
}

test("adopt without rename flips managedBy, ensures the .mattstack route, reports changed", async () => {
  await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  await registerApp(input, drivers);

  const res = await adoptApp("myapp", {}, drivers);
  expect(res.status).toBe(200);
  const body = res.body as any;
  expect(body.adopted).toBe(true);
  expect(body.changed).toBe(true);
  expect(body.app).toMatchObject({ name: "myapp", previousName: "myapp", managedBy: "rt", kind: "service" });
  expect(body.hostnames).toEqual(["myapp.mattstack", "myapp.localhost"]);
  expect(getRecord("myapp")!.managedBy).toBe("rt");
  expect(routesOnDisk().some((r) => r.hostname === "myapp.mattstack")).toBe(true);
});

test("adopt with --as renames record, label, alias, settings, and sign-in rule, then flips ownership", async () => {
  await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  await registerApp({ ...input, name: "mrs" }, drivers);
  await setPublished("mrs", false);
  reloadOAuth();
  setOAuth("mrs", { mode: "emails", emails: ["m@x.dev"] });

  const res = await adoptApp("mrs", { as: "board" }, drivers);
  expect(res.status).toBe(200);
  const body = res.body as any;
  expect(body.changed).toBe(true);
  expect(body.app).toMatchObject({ name: "board", previousName: "mrs", managedBy: "rt" });
  expect(getRecord("mrs")).toBeUndefined();
  const rec = getRecord("board")!;
  expect(rec.managedBy).toBe("rt");
  expect(rec.label).toBe("com.mattstack.deck.board");
  expect(drivers.edge.aliases.has("board")).toBe(true);
  expect(getAppSettings("board").published).toBe(false);
  expect(getOAuth("board")).toEqual({ mode: "emails", emails: ["m@x.dev"] });
  expect(routesOnDisk().some((r) => r.hostname === "board.mattstack")).toBe(true);
});

test("adopt is idempotent: a re-run reports changed:false and still re-ensures the route", async () => {
  await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  await registerApp({ ...input, name: "mrs" }, drivers);
  expect((await adoptApp("mrs", { as: "board" }, drivers)).status).toBe(200);

  // Someone hand-removed the route between apply runs; the re-run repairs it.
  await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  const rerun = await adoptApp("mrs", { as: "board" }, drivers);
  expect(rerun.status).toBe(200);
  const body = rerun.body as any;
  expect(body.adopted).toBe(true);
  expect(body.changed).toBe(false);
  expect(body.app).toMatchObject({ name: "board", previousName: "mrs" });
  expect(routesOnDisk().some((r) => r.hostname === "board.mattstack")).toBe(true);
});

test("adopt of a name unknown under both identities answers the frozen error string", async () => {
  const res = await adoptApp("ghost", { as: "board" }, drivers);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "unknown app" });
});

test("adopt refuses a rename target that is a different existing app", async () => {
  await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  await registerApp({ ...input, name: "mrs" }, drivers);
  await registerApp({ ...input, name: "board", workingDirectory: "/tmp/other" }, drivers);
  const res = await adoptApp("mrs", { as: "board" }, drivers);
  expect(res.status).toBe(409);
  expect((res.body as any).error).toBe("name taken");
});

test("adopt refuses managedBy user — adoption IS the ownership flip", async () => {
  await registerApp(input, drivers);
  const res = await adoptApp("myapp", { managedBy: "user" }, drivers);
  expect(res.status).toBe(400);
});

test("restartManagedApps: kickstarts every non-user record, skips user apps and staticPort externals", async () => {
  await registerApp({ ...input, name: "board", managedBy: "rt" }, drivers);
  await registerApp({ name: "gitq", managedBy: "rt", staticPort: 4200 }, drivers); // external: no label to kickstart
  await registerApp({ ...input, name: "myuserapp" }, drivers); // managedBy defaults to "user"

  const res = await restartManagedApps(drivers);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, restarted: ["board"], failed: [] });
  expect(drivers.manager.kickstarts).toEqual(["com.mattstack.deck.board"]);
});

test("restartManagedApps: a kickstart returning false surfaces as a per-app failure, not an exception", async () => {
  await registerApp({ ...input, name: "board", managedBy: "rt" }, drivers);
  await drivers.manager.uninstall("com.mattstack.deck.board"); // now kickstart(label) resolves false

  const res = await restartManagedApps(drivers);
  expect(res.body).toMatchObject({ ok: false, restarted: [], failed: [{ name: "board", error: "kickstart failed" }] });
});

test("removeManagedApps: tears down every non-user record, leaves user apps alone", async () => {
  await registerApp({ ...input, name: "board", managedBy: "rt" }, drivers);
  await registerApp({ ...input, name: "myuserapp" }, drivers);

  const res = await removeManagedApps(drivers);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, removed: ["board"], failed: [] });
  expect(getRecord("board")).toBeUndefined();
  expect(getRecord("myuserapp")).toBeDefined();
  expect(drivers.manager.installed.has("com.mattstack.deck.board")).toBe(false);
});

test("removeManagedApps: a driver failure keeps the record and reports it in failed", async () => {
  await registerApp({ ...input, name: "board", managedBy: "rt" }, drivers);
  drivers.manager.failNext = "com.mattstack.deck.board";

  const res = await removeManagedApps(drivers);
  expect(res.body).toMatchObject({ ok: false, removed: [], failed: ["board"] });
  expect(getRecord("board")).toBeDefined();
});
