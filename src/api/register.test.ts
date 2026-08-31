import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
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

const {
  registerApp, unregisterApp, editApp, restartManagedApps, reresolveManagedApps, removeManagedApps, setServeShapeDeps,
} = await import("./register.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, putRecord, reloadRegistry, listRecords, deleteRecord } = await import("../registry/records.ts");
const {
  getAppSettings, setPublished, setPassword, setOverride, getOverride, setPublicFollowsOverride, reloadSettings,
} = await import("../../core/settings.ts");
const { setOAuth, getOAuth, reloadOAuth } = await import("../edge/oauth.ts");
const { adoptApp } = await import("./register.ts");
const { LABEL_PREFIX, PLATFORM_NAME, PLATFORM_LABEL } = await import("../services/manager.ts");
type ServiceSpec = Parameters<InstanceType<typeof FakeServiceManager>["install"]>[0];
const { agentsDir } = await import("../services/launchd.ts");
const { renderPlist } = await import("../services/plist.ts");

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

afterEach(() => {
  setServeShapeDeps({});
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

test("edit re-ports onto a port already held by another record is a 409, and the port stays unchanged", async () => {
  await registerApp(input, drivers);
  const otherRes = await registerApp({ name: "other", command: ["bun", "x"], workingDirectory: "/tmp/other" }, drivers);
  const otherPort = (otherRes.body as any).record.port as number;
  const res = await editApp("myapp", { port: otherPort }, "user", false, drivers);
  expect(res.status).toBe(409);
  expect(getRecord("myapp")!.port).toBe(11000);
});

test("edit re-ports an external (staticPort) record onto an occupied port still succeeds — staticPort is exempt from the collision guard", async () => {
  await registerApp(input, drivers); // myapp: a service on 11000
  await registerApp({ name: "ext", staticPort: 4200 }, drivers);
  const res = await editApp("ext", { port: 11000 }, "user", false, drivers);
  expect(res.status).toBe(200);
  expect(getRecord("ext")!.port).toBe(11000);
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

test("a linked managed record installs its resolved source shape in dev mode", async () => {
  setServeShapeDeps({ devMode: () => true, helpersDir: null });
  const dir = mkdtempSync(join(tmpdir(), "src-"));
  writeFileSync(join(dir, "mattstack.deck.json"),
    JSON.stringify({ name: "srcapp", dev: { start: "bun run serve" } }));
  // register as a user app first to get a record + label, then repoint it to managed+linked
  await registerApp({ name: "srcapp", command: ["bun", "x.ts"], workingDirectory: "/tmp" }, drivers);
  const r = getRecord("srcapp")!;
  putRecord({ ...r, managedBy: "rt", command: undefined, workingDirectory: undefined, dev: { workingDirectory: dir } });
  // editApp re-renders the plist through the resolver
  await editApp("srcapp", {}, "rt", true, drivers);
  const installed = drivers.manager.installed.get(`${LABEL_PREFIX}srcapp`)!;
  expect(installed.workingDirectory).toBe(dir);
  expect(installed.programArguments.slice(1)).toEqual(["run", "serve"]);
});

// ─── editApp: dev.workingDirectory link/unlink ─────────────────────────────

test("edit: a valid dev link stores dev.workingDirectory and reinstalls the service", async () => {
  await registerApp(input, drivers);
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "myapp" }));

  const res = await editApp("myapp", { dev: { workingDirectory: srcDir } }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(getRecord("myapp")!.dev).toEqual({ workingDirectory: srcDir });
  expect(drivers.manager.installed.has(`${LABEL_PREFIX}myapp`)).toBe(true);
});

test("edit: dev link validation rejects a relative path, a missing dir, a missing manifest file, a bad manifest, and a name mismatch, before any teardown", async () => {
  await registerApp(input, drivers);
  const label = `${LABEL_PREFIX}myapp`;
  const installedBefore = drivers.manager.installed.get(label);

  const relative = await editApp("myapp", { dev: { workingDirectory: "not/absolute" } }, "user", false, drivers);
  expect(relative.status).toBe(400);
  expect((relative.body as any).error).toBe("dev.workingDirectory must be an absolute path");

  const missingDir = join(tmpdir(), "dev-link-does-not-exist-xyz");
  const missing = await editApp("myapp", { dev: { workingDirectory: missingDir } }, "user", false, drivers);
  expect(missing.status).toBe(400);
  expect((missing.body as any).error).toBe("directory not found");

  const noManifestDir = mkdtempSync(join(tmpdir(), "dev-link-no-manifest-"));
  const noManifest = await editApp("myapp", { dev: { workingDirectory: noManifestDir } }, "user", false, drivers);
  expect(noManifest.status).toBe(400);
  expect((noManifest.body as any).error).toBe(`no mattstack.deck.json in ${noManifestDir}`);

  const badManifestDir = mkdtempSync(join(tmpdir(), "dev-link-bad-"));
  writeFileSync(join(badManifestDir, "mattstack.deck.json"), "not json");
  const bad = await editApp("myapp", { dev: { workingDirectory: badManifestDir } }, "user", false, drivers);
  expect(bad.status).toBe(400);
  expect((bad.body as any).error).toBe("mattstack.deck.json is not valid JSON");

  const mismatchDir = mkdtempSync(join(tmpdir(), "dev-link-mismatch-"));
  writeFileSync(join(mismatchDir, "mattstack.deck.json"), JSON.stringify({ name: "otherapp" }));
  const mismatch = await editApp("myapp", { dev: { workingDirectory: mismatchDir } }, "user", false, drivers);
  expect(mismatch.status).toBe(400);
  expect(mismatch.body).toEqual({ error: "manifest name mismatch", expected: "myapp", got: "otherapp" });

  // None of the rejected links tore down or reinstalled the running service.
  expect(drivers.manager.installed.get(label)).toEqual(installedBefore);
  expect(getRecord("myapp")!.dev).toBeUndefined();
});

test("edit: a dev-only patch on a managed record needs no force", async () => {
  await registerApp({ ...input, managedBy: "rt" }, drivers);
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "myapp" }));

  const res = await editApp("myapp", { dev: { workingDirectory: srcDir } }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(getRecord("myapp")!.dev).toEqual({ workingDirectory: srcDir });
});

test("edit: a structural patch on a managed record still needs force even when it also sets dev", async () => {
  await registerApp({ ...input, managedBy: "rt" }, drivers);
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "myapp" }));

  const res = await editApp("myapp", { port: 11500, dev: { workingDirectory: srcDir } }, "user", false, drivers);

  expect(res.status).toBe(409);
  expect(getRecord("myapp")!.dev).toBeUndefined();
});

test("edit: dev: null unlinks", async () => {
  await registerApp(input, drivers);
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "myapp" }));
  await editApp("myapp", { dev: { workingDirectory: srcDir } }, "user", false, drivers);
  expect(getRecord("myapp")!.dev).toEqual({ workingDirectory: srcDir });

  const res = await editApp("myapp", { dev: null }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(getRecord("myapp")!.dev).toBeUndefined();
});

// ─── editApp: the platform's own record takes a record-only dev path ──────

test("edit: a dev-only PATCH on the platform record is record-only -- no label rewrite, no driver call", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "deck" }));
  const installedBefore: ServiceSpec = {
    label: PLATFORM_LABEL, programArguments: ["/bundle/deck"], workingDirectory: "/tmp",
    environment: {}, stdoutPath: "/tmp/o", stderrPath: "/tmp/e",
  };
  drivers.manager.installed.set(PLATFORM_LABEL, installedBefore);
  putRecord({
    name: "deck", managedBy: PLATFORM_NAME, port: 11999, kind: "service",
    label: PLATFORM_LABEL, command: ["/bundle/deck"], createdAt: new Date().toISOString(),
  });

  const res = await editApp("deck", { dev: { workingDirectory: srcDir } }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(getRecord("deck")!.dev).toEqual({ workingDirectory: srcDir });
  // Never rewritten to `${LABEL_PREFIX}deck` -- the bare platform label stays bare.
  expect(getRecord("deck")!.label).toBe(PLATFORM_LABEL);
  expect(drivers.manager.installed.size).toBe(1);
  expect(drivers.manager.installed.get(PLATFORM_LABEL)).toEqual(installedBefore);
});

test("edit: a dev-only UNLINK on the platform record is also record-only", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "deck" }));
  putRecord({
    name: "deck", managedBy: PLATFORM_NAME, port: 11999, kind: "service",
    label: PLATFORM_LABEL, dev: { workingDirectory: srcDir }, createdAt: new Date().toISOString(),
  });
  const installedBefore: ServiceSpec = {
    label: PLATFORM_LABEL, programArguments: ["/bundle/deck"], workingDirectory: "/tmp",
    environment: {}, stdoutPath: "/tmp/o", stderrPath: "/tmp/e",
  };
  drivers.manager.installed.set(PLATFORM_LABEL, installedBefore);

  const res = await editApp("deck", { dev: null }, "user", false, drivers);

  expect(res.status).toBe(200);
  expect(getRecord("deck")!.dev).toBeUndefined();
  expect(getRecord("deck")!.label).toBe(PLATFORM_LABEL);
  expect(drivers.manager.installed.size).toBe(1);
  expect(drivers.manager.installed.get(PLATFORM_LABEL)).toEqual(installedBefore);
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

test("adopt ingests the app's mattstack.json onto the record and icon store", async () => {
  await Bun.write(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  const { iconPathFor } = await import("../registry/manifest.ts");
  const appDir = mkdtempSync(join(tmpdir(), "adopt-manifest-"));
  await Bun.write(join(appDir, "mattstack.json"), JSON.stringify({ displayName: "Chat", icon: "./i.svg" }));
  await Bun.write(
    join(appDir, "i.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
  );
  await registerApp({ ...input, name: "chat", workingDirectory: appDir }, drivers);

  const res = await adoptApp("chat", { managedBy: "rt" }, drivers);
  expect(res.status).toBe(200);
  expect(getRecord("chat")!.displayName).toBe("Chat");
  expect(existsSync(iconPathFor("chat"))).toBe(true);
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

// ─── reresolveManagedApps: selective restart on plist diff (dev/prod flip) ──

/** Seeds the on-disk plist reresolveManagedApps diffs against, independent of
    whatever the in-memory FakeServiceManager thinks is installed. */
function seedPlist(label: string, programArguments: string[]): void {
  mkdirSync(agentsDir(), { recursive: true });
  writeFileSync(join(agentsDir(), `${label}.plist`), renderPlist({
    label, programArguments, workingDirectory: "/tmp", environment: {}, stdoutPath: "/tmp/o", stderrPath: "/tmp/e",
  }));
}

class CountingManager extends FakeServiceManager {
  installCalls: string[] = [];
  uninstallCalls: string[] = [];
  /** One-shot, like FakeServiceManager's own failNext, but scoped to install only:
      failNext fails whichever op runs next for a label, and reresolve always
      uninstalls before installing the same label, so failNext alone can never
      isolate an install failure from a preceding, successful uninstall. */
  failInstallFor: string | null = null;
  override async install(spec: ServiceSpec): Promise<void> {
    this.installCalls.push(spec.label);
    if (this.failInstallFor === spec.label) {
      this.failInstallFor = null;
      throw new Error(`fake launchd: install failed for ${spec.label}`);
    }
    return super.install(spec);
  }
  override async uninstall(label: string): Promise<void> {
    this.uninstallCalls.push(label);
    return super.uninstall(label);
  }
}

test("reresolve: reinstalls only the app whose resolved command differs from its installed plist", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp({ ...input, name: "same", managedBy: "rt" }, reresolveDrivers);
  await registerApp({ ...input, name: "changed", managedBy: "rt", workingDirectory: "/tmp/changed" }, reresolveDrivers);
  const sameSpec = counting.installed.get(`${LABEL_PREFIX}same`)!;
  const changedSpec = counting.installed.get(`${LABEL_PREFIX}changed`)!;
  seedPlist(sameSpec.label, sameSpec.programArguments);
  seedPlist(changedSpec.label, [...changedSpec.programArguments.slice(0, -1), "stale-arg"]);
  counting.installCalls = [];
  counting.uninstallCalls = [];

  const res = await reresolveManagedApps(reresolveDrivers);

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, restarted: ["changed"], unchanged: ["same"], failed: [] });
  expect(counting.uninstallCalls).toEqual([changedSpec.label]);
  expect(counting.installCalls).toEqual([changedSpec.label]);
});

test("reresolve: a flip-then-flip-back is a no-op (restarts nothing, churns no driver calls)", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp({ ...input, name: "app1", managedBy: "rt" }, reresolveDrivers);
  await registerApp({ ...input, name: "app2", managedBy: "rt", workingDirectory: "/tmp/app2" }, reresolveDrivers);
  for (const name of ["app1", "app2"]) {
    const spec = counting.installed.get(`${LABEL_PREFIX}${name}`)!;
    seedPlist(spec.label, spec.programArguments);
  }
  counting.installCalls = [];
  counting.uninstallCalls = [];

  const first = await reresolveManagedApps(reresolveDrivers);
  const second = await reresolveManagedApps(reresolveDrivers); // the "flip back": identical inputs, run again

  for (const res of [first, second]) {
    expect(res.body).toMatchObject({ ok: true, restarted: [] });
    expect((res.body as any).unchanged.slice().sort()).toEqual(["app1", "app2"]);
  }
  // If the diff check were dropped (always reinstall), these would be non-empty.
  expect(counting.installCalls).toEqual([]);
  expect(counting.uninstallCalls).toEqual([]);
});

test("reresolve: skips user records and the platform record even when their plist would differ", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp({ ...input, name: "useronly" }, reresolveDrivers); // managedBy defaults to "user"
  putRecord({
    name: "deck", managedBy: PLATFORM_NAME, port: 11999, kind: "service",
    command: ["bun", "platform.ts"], workingDirectory: "/tmp/deck", label: `${LABEL_PREFIX}deck`,
    createdAt: new Date().toISOString(),
  });
  // Neither has a matching (or even present) plist: a processed row would land
  // in restarted or failed, never silently absent from every list.
  counting.installCalls = [];
  counting.uninstallCalls = [];

  const res = await reresolveManagedApps(reresolveDrivers);

  expect(res.body).toMatchObject({ ok: true, restarted: [], unchanged: [], failed: [] });
  expect(counting.installCalls).toEqual([]);
  expect(counting.uninstallCalls).toEqual([]);
});

test("reresolve: a null shape lands the app in failed and leaves its installed service untouched", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp({ ...input, name: "brokenlink" }, reresolveDrivers);
  const rec = getRecord("brokenlink")!;
  const label = rec.label!;
  putRecord({
    ...rec, managedBy: "rt", command: undefined, workingDirectory: undefined,
    dev: { workingDirectory: join(tmpdir(), "reresolve-nonexistent-dev-link-dir") },
  });
  seedPlist(label, ["/bin/echo", "still-here"]);
  // No bundle and a dev link pointing nowhere: serveShape resolves neither shape.
  setServeShapeDeps({ helpersDir: null });
  counting.installCalls = [];
  counting.uninstallCalls = [];

  const res = await reresolveManagedApps(reresolveDrivers);

  expect(res.body).toMatchObject({
    ok: false, restarted: [], unchanged: [], failed: [{ name: "brokenlink", error: "no runnable shape" }],
  });
  expect(counting.installCalls).toEqual([]);
  expect(counting.uninstallCalls).toEqual([]);
  expect(readFileSync(join(agentsDir(), `${label}.plist`), "utf8")).toContain("still-here");
});

test("reresolve: a specFor throw for one app does not block a healthy app in the same sweep", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp(
    { ...input, name: "ghost", managedBy: "rt", command: ["definitely-not-a-real-binary-xyz", "x.js"] },
    reresolveDrivers,
  );
  await registerApp({ ...input, name: "healthy", managedBy: "rt", workingDirectory: "/tmp/healthy" }, reresolveDrivers);
  const healthySpec = counting.installed.get(`${LABEL_PREFIX}healthy`)!;
  seedPlist(healthySpec.label, healthySpec.programArguments);
  counting.installCalls = [];
  counting.uninstallCalls = [];

  const res = await reresolveManagedApps(reresolveDrivers);

  const body = res.body as { ok: boolean; restarted: string[]; unchanged: string[]; failed: Array<{ name: string; error: string }> };
  expect(body.ok).toBe(false);
  expect(body.restarted).toEqual([]);
  expect(body.unchanged).toEqual(["healthy"]);
  expect(body.failed).toHaveLength(1);
  expect(body.failed[0]!.name).toBe("ghost");
  expect(body.failed[0]!.error).toContain("not found");
  // The broken app never reaches a driver call, and the healthy one is unchanged: neither installs or uninstalls.
  expect(counting.installCalls).toEqual([]);
  expect(counting.uninstallCalls).toEqual([]);
});

test("reresolve: an install failure lands the app in failed and leaves a launchd issue on its record", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp({ ...input, name: "flaky", managedBy: "rt" }, reresolveDrivers);
  const spec = counting.installed.get(`${LABEL_PREFIX}flaky`)!;
  // A mismatched plist forces reresolve down the uninstall+install path.
  seedPlist(spec.label, [...spec.programArguments.slice(0, -1), "stale-arg"]);
  counting.installCalls = [];
  counting.uninstallCalls = [];
  counting.failInstallFor = spec.label;

  const res = await reresolveManagedApps(reresolveDrivers);

  const body = res.body as { ok: boolean; restarted: string[]; unchanged: string[]; failed: Array<{ name: string; error: string }> };
  expect(body.ok).toBe(false);
  expect(body.restarted).toEqual([]);
  expect(body.unchanged).toEqual([]);
  expect(body.failed).toHaveLength(1);
  expect(body.failed[0]!.name).toBe("flaky");
  expect(body.failed[0]!.error).toContain("install failed");
  // The uninstall still ran (it succeeded); the install after it is what threw.
  expect(counting.uninstallCalls).toEqual([spec.label]);
  const rec = getRecord("flaky")!;
  expect(rec.issues).toHaveLength(1);
  expect(rec.issues![0]!.source).toBe("launchd");
});

test("reresolve: a later successful install clears the launchd issue a previous failed sweep left", async () => {
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };
  await registerApp({ ...input, name: "recovered", managedBy: "rt" }, reresolveDrivers);
  const spec = counting.installed.get(`${LABEL_PREFIX}recovered`)!;
  seedPlist(spec.label, [...spec.programArguments.slice(0, -1), "stale-arg"]);
  counting.failInstallFor = spec.label;
  await reresolveManagedApps(reresolveDrivers); // first sweep: install fails, issue lands
  expect(getRecord("recovered")!.issues).toHaveLength(1);

  const res = await reresolveManagedApps(reresolveDrivers); // second sweep: same stale plist, install succeeds this time

  expect(res.body).toMatchObject({ ok: true, restarted: ["recovered"], unchanged: [], failed: [] });
  expect(getRecord("recovered")!.issues ?? []).toEqual([]);
});

test("reresolve reads mattstack.mode fresh, not a cache a prior status poll already warmed", async () => {
  const { setSetting } = await import("@mattstack/rt-client");
  const { isDevMode, resetDevModeCache } = await import("./dev-mode.ts");
  const counting = new CountingManager();
  const reresolveDrivers = { manager: counting, edge: drivers.edge };

  const helpers = mkdtempSync(join(tmpdir(), "helpers-"));
  writeFileSync(join(helpers, "flip"), "");
  const srcDir = mkdtempSync(join(tmpdir(), "src-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "flip", dev: { start: "bun run serve" } }));

  setSetting("mattstack.mode", "prod", "machine");
  resetDevModeCache();
  setServeShapeDeps({ helpersDir: helpers });

  await registerApp({ ...input, name: "flip", managedBy: "rt" }, reresolveDrivers);
  const rec = getRecord("flip")!;
  const label = rec.label!;
  putRecord({ ...rec, command: undefined, workingDirectory: undefined, dev: { workingDirectory: srcDir } });
  // The shape a prod resolve would already have installed (bundle binary, no
  // args), so the mode flip below is what produces the diff, not this seed.
  seedPlist(label, [join(helpers, "flip")]);
  counting.installCalls = [];
  counting.uninstallCalls = [];

  // A status poll in the moment before the flag flips warms the cache with
  // the stale "prod" reading -- the same 2-second window rt's real poke races.
  isDevMode();
  setSetting("mattstack.mode", "dev", "machine");

  try {
    const res = await reresolveManagedApps(reresolveDrivers);

    expect(res.body).toMatchObject({ ok: true, restarted: ["flip"], unchanged: [], failed: [] });
    const installed = counting.installed.get(label)!;
    expect(installed.workingDirectory).toBe(srcDir);
    expect(installed.programArguments.slice(1)).toEqual(["run", "serve"]);
  } finally {
    // The cache is keyed by wall-clock TTL, not by HOME: left warm, it can leak
    // a "dev" reading into another test file's assertions for up to 2 seconds.
    resetDevModeCache();
  }
});

// ─── editApp: never uninstall a shape the patch can't replace ─────────────

test("edit: unlinking a slim row with no bundle installed is rejected before any teardown", async () => {
  setServeShapeDeps({ helpersDir: null });
  const counting = new CountingManager();
  const noBundleDrivers = { manager: counting, edge: drivers.edge };
  const srcDir = mkdtempSync(join(tmpdir(), "dev-link-"));
  writeFileSync(join(srcDir, "mattstack.deck.json"), JSON.stringify({ name: "myapp", dev: { start: "bun run serve" } }));
  await registerApp({ ...input, name: "myapp", managedBy: "rt" }, noBundleDrivers);
  const rec = getRecord("myapp")!;
  const label = rec.label!;
  putRecord({ ...rec, command: undefined, workingDirectory: undefined, dev: { workingDirectory: srcDir } });
  const installedBefore = counting.installed.get(label);
  counting.installCalls = [];
  counting.uninstallCalls = [];

  const res = await editApp("myapp", { dev: null }, "rt", true, noBundleDrivers);

  expect(res.status).toBe(400);
  expect((res.body as any).error).toContain("no runnable shape");
  // Unlinking never landed: dev is still set, and neither driver call fired.
  expect(getRecord("myapp")!.dev).toEqual({ workingDirectory: srcDir });
  expect(counting.uninstallCalls).toEqual([]);
  expect(counting.installCalls).toEqual([]);
  expect(counting.installed.get(label)).toEqual(installedBefore);
});
