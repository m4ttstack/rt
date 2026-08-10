import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-setup-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
// Nonexistent on purpose: readProxyTlds() falls back to ["localhost"] deterministically.
process.env.LOCAL_PORTLESS_TLDS_PATH = join(dir, "proxy.tlds");
process.env.LOCAL_AGENTS_DIR = join(dir, "agents"); // isolate from this machine's real LaunchAgents
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { checkPrereqs, setup, uninstall } = await import("./setup.ts");
const { bootstrapSelf } = await import("../registry/bootstrap.ts");
const { registerApp } = await import("../api/register.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, putRecord, reloadRegistry } = await import("../registry/records.ts");
const { getPlatformSettings } = await import("../api/platform-settings.ts");
const { logsDir } = await import("../api/state.ts");
const { PLATFORM_LABEL } = await import("../services/manager.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  delete process.env.LOCAL_SETUP_HEALTH_BUDGET_MS;
  delete process.env.LOCAL_SETUP_HEALTH_INTERVAL_MS;
});

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

test("checkPrereqs names the missing pieces with their install commands", async () => {
  const r = await checkPrereqs(async (argv) => ({ code: 127, stdout: "" }));
  expect(r.ok).toBe(false);
  expect(r.problems.join(" ")).toContain("npm install -g portless");
});

test("checkPrereqs enforces the 0.15.5 floor", async () => {
  const r = await checkPrereqs(async (argv) =>
    argv[0] === "portless" ? { code: 0, stdout: "0.14.0" } : { code: 0, stdout: "v24.1.0" });
  expect(r.ok).toBe(false);
  expect(r.problems.join(" ")).toContain("0.15.5");
});

test("checkPrereqs passes when node 24+ and portless 0.15.5+ are both present", async () => {
  const r = await checkPrereqs(async (argv) =>
    argv[0] === "portless" ? { code: 0, stdout: "0.15.5" } : { code: 0, stdout: "v24.1.0" });
  expect(r.ok).toBe(true);
  expect(r.problems).toEqual([]);
});

test("uninstall refuses while other records exist, force overrides", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  await registerApp({ name: "keeper", staticPort: 4000 }, { manager, edge });
  const o = io();
  expect(await uninstall({ manager, edge }, o, { force: false })).toBe(1);
  expect(o.lines.join("\n")).toContain("keeper");
  expect(await uninstall({ manager, edge }, io(), { force: true })).toBe(0);
});

test("uninstall removes Local's own agent + aliases when no other apps are registered", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/lcl", entry: null, tlds: ["localhost"],
  });
  expect(manager.installed.has(PLATFORM_LABEL)).toBe(true);
  expect(edge.aliases.has("local")).toBe(true);

  const o = io();
  expect(await uninstall({ manager, edge }, o, { force: false })).toBe(0);
  expect(manager.installed.has(PLATFORM_LABEL)).toBe(false);
  expect(edge.aliases.has("local")).toBe(false);
  expect(getRecord("local")).toBeUndefined();
});

const passExec = async (argv: string[]) =>
  argv[0] === "portless" ? { code: 0, stdout: "0.15.5" } : { code: 0, stdout: "v24.0.0" };

test("setup: prereqs pass, bootstraps, writes tlds into platform settings, prints URLs", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  // Pre-seed the self record at the listening server's port, so bootstrapSelf's
  // `existing?.port` reuses it instead of allocating a port nothing is on.
  putRecord({
    name: "local", managedBy: "local", port: server.port!, kind: "service",
    createdAt: new Date().toISOString(),
  });
  process.env.LOCAL_SETUP_HEALTH_BUDGET_MS = "2000";
  process.env.LOCAL_SETUP_HEALTH_INTERVAL_MS = "50";

  const o = io();
  const code = await setup({ manager, edge }, o, passExec);
  server.stop(true);

  expect(code).toBe(0);
  expect(o.lines.some((l) => l.includes("https://local."))).toBe(true);
  expect(getPlatformSettings().tlds).toEqual(["localhost"]);
});

test("setup: healthz timeout exits 1 and shows a tail of the error log", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  putRecord({
    name: "local", managedBy: "local", port: 39997, kind: "service",
    createdAt: new Date().toISOString(),
  });
  mkdirSync(logsDir(), { recursive: true });
  writeFileSync(join(logsDir(), "local.err.log"), "boom: something broke\n");
  process.env.LOCAL_SETUP_HEALTH_BUDGET_MS = "200";
  process.env.LOCAL_SETUP_HEALTH_INTERVAL_MS = "50";

  const o = io();
  const code = await setup({ manager, edge }, o, passExec);

  expect(code).toBe(1);
  expect(o.lines.join("\n")).toContain("boom: something broke");
});
