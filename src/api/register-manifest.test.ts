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
