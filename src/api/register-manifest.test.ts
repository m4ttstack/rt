import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
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
  // Isolate readServices() from this machine's real launchd agents: without
  // this, registerApp/editApp's port-collision check (Fix 1) reads whatever
  // is actually running on the developer's Mac instead of a clean fixture.
  process.env.LOCAL_AGENTS_DIR = join(dir, "agents-not-present");
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");
  return dir;
}

function appRepo(manifest: object): string {
  const dir = mkdtempSync(join(tmpdir(), "app-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify(manifest));
  return dir;
}

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
  expect(rec.command).toEqual(["bun", "run", "serve"]);
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
  expect(getRecord("chat")!.command).toEqual(["bun", "run", "serve2"]);
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
  expect(rec.command).toEqual(["bun", "run", "dev"]);
  expect(rec.activeAlt).toBe("dev");
  await applyManifest(dir, undefined, drivers);
  rec = getRecord("chat")!;
  expect(rec.port).toBe(11002);
  expect(rec.command).toEqual(["bun", "run", "serve"]);
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

test("registering a manifest onto an already-declared service port is a 409, not a silent alias onto it", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };

  const dirA = appRepo({ name: "appa", port: 5000, commands: { start: "bun run serve" } });
  const a = await applyManifest(dirA, undefined, drivers);
  expect(a.status).toBe(200);

  const dirB = appRepo({ name: "appb", port: 5000, commands: { start: "bun run serve" } });
  const b = await applyManifest(dirB, undefined, drivers);
  expect(b.status).toBe(409);
  expect(getRecord("appb")).toBeUndefined();

  // Control: the same manifest B on a free port succeeds.
  const dirC = appRepo({ name: "appb", port: 5001, commands: { start: "bun run serve" } });
  const c = await applyManifest(dirC, undefined, drivers);
  expect(c.status).toBe(200);
  expect(getRecord("appb")!.port).toBe(5001);
});

test("registering a manifest onto a port already held by a bare portless route (no registry record) is a 409", async () => {
  scratch();
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: "someapp.localhost", port: 5002, pid: 0 }]));
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };

  const appDir = appRepo({ name: "routeconflict", port: 5002, commands: { start: "bun run serve" } });
  const r = await applyManifest(appDir, undefined, drivers);
  expect(r.status).toBe(409);
  expect(getRecord("routeconflict")).toBeUndefined();
});

test("port-only app reconciles a changed port via alt (route re-points)", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = appRepo({ name: "extapp", port: 4400, altConfigs: { dev: { port: 4500 } } });

  await applyManifest(dir, undefined, drivers);
  expect(getRecord("extapp")!.kind).toBe("external");
  expect(getRecord("extapp")!.port).toBe(4400);
  expect(drivers.edge.aliases.get("extapp")).toBe(4400);

  const on = await applyManifest(dir, "dev", drivers);
  expect(on.status).toBe(200);
  expect(getRecord("extapp")!.port).toBe(4500);
  expect(getRecord("extapp")!.activeAlt).toBe("dev");
  expect(drivers.edge.aliases.get("extapp")).toBe(4500);

  const off = await applyManifest(dir, undefined, drivers);
  expect(off.status).toBe(200);
  expect(getRecord("extapp")!.port).toBe(4400);
  expect(getRecord("extapp")!.activeAlt).toBeUndefined();
  expect(drivers.edge.aliases.get("extapp")).toBe(4400);
});

test("adding commands.start to a route-only app is refused, not half-applied", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = appRepo({ name: "flip", port: 4600 });

  await applyManifest(dir, undefined, drivers);
  expect(getRecord("flip")!.kind).toBe("external");

  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "flip", port: 4600, commands: { start: "bun run serve" } }));
  const r = await applyManifest(dir, undefined, drivers);
  expect(r.status).toBe(400);
  expect(getRecord("flip")!.kind).toBe("external");
  expect(getRecord("flip")!.command).toBeUndefined();
});

test("dropping commands.start on a supervised app is refused, service kept", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = appRepo({ name: "svc", port: 4700, commands: { start: "bun run serve" } });

  await applyManifest(dir, undefined, drivers);
  expect(getRecord("svc")!.kind).toBe("service");

  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "svc", port: 4700 }));
  const r = await applyManifest(dir, undefined, drivers);
  expect(r.status).toBe(400);
  expect(getRecord("svc")!.kind).toBe("service");
  expect(getRecord("svc")!.command).toEqual(["bun", "run", "serve"]);
});

test("register carries the manifest env onto the supervised service", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = appRepo({ name: "envapp", port: 4800, commands: { start: "bun s.ts" }, env: { API_PORT: "4800", SERVE_STATIC: "1" } });

  expect((await applyManifest(dir, undefined, drivers)).status).toBe(200);
  expect(getRecord("envapp")!.env).toEqual({ API_PORT: "4800", SERVE_STATIC: "1" });
});

test("re-register syncs env from the manifest; removing it clears the record env", async () => {
  scratch();
  const { FakeServiceManager } = await import("../services/fake.ts");
  const { FakeEdgeProxy } = await import("../edge/portless.ts");
  const { reloadRegistry, getRecord } = await import("../registry/records.ts");
  const { applyManifest } = await import("./register-manifest.ts");
  reloadRegistry();
  const drivers = { manager: new FakeServiceManager(), edge: new FakeEdgeProxy() };
  const dir = appRepo({ name: "envsync", port: 4801, commands: { start: "bun s.ts" }, env: { A: "1" } });
  await applyManifest(dir, undefined, drivers);

  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "envsync", port: 4801, commands: { start: "bun s.ts" }, env: { A: "2", B: "3" } }));
  await applyManifest(dir, undefined, drivers);
  expect(getRecord("envsync")!.env).toEqual({ A: "2", B: "3" });

  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "envsync", port: 4801, commands: { start: "bun s.ts" } }));
  await applyManifest(dir, undefined, drivers);
  expect(getRecord("envsync")!.env ?? {}).toEqual({});
});
