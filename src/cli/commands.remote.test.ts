import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-cli-remote-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.HOME = dir;
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("../api/server.ts");
const { writeApiInfo } = await import("../api/state.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { FakeRailwayDriver, FakeCfDns } = await import("../../test/fixture/remote.ts");
const { reloadRegistry, putRecord, getRecord } = await import("../registry/records.ts");
const { reloadPlatformSettings, updatePlatformSettings } = await import("../api/platform-settings.ts");
const { setOAuth } = await import("../edge/oauth.ts");
const { runCommand } = await import("./commands.ts");

const PORT = 18972;
let server: ReturnType<typeof startApi>;
let rw: InstanceType<typeof FakeRailwayDriver>;
let dns: InstanceType<typeof FakeCfDns>;
let secretsConfig: { railwayToken?: string } = { railwayToken: "rw-tok" };

beforeAll(() => {
  rw = new FakeRailwayDriver();
  dns = new FakeCfDns();
  server = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(),
    devMode: () => false,
    railway: rw, dns,
    deckSecrets: {
      readApiToken: () => "tok",
      post: async () => ({ ok: true, data: { railwayToken: secretsConfig.railwayToken } }),
    },
  });
  writeApiInfo(PORT);
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

function gitRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "remote-cli-repo-"));
  const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  run(["init", "-q"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  writeFileSync(join(repo, "a.txt"), "1");
  run(["add", "a.txt"]);
  run(["commit", "-q", "-m", "init"]);
  return repo;
}

test("deck remote site on prints the live url", async () => {
  const repo = gitRepo();
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "site", command: ["bun", "run", "serve"], workingDirectory: repo }),
  });
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" }, publicDomain: "m4tthew.dev" });
  setOAuth("site", { mode: "emails", emails: ["m@x.dev"] });
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });

  const x = io();
  expect(await runCommand(["remote", "site", "on"], x)).toBe(0);
  expect(x.lines.join("\n")).toContain("https://site.m4tthew.dev");
});

test("deck remote site on surfaces a 428 as a token hint", async () => {
  const repo = gitRepo();
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "notoken", command: ["bun", "run", "serve"], workingDirectory: repo }),
  });
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" }, publicDomain: "m4tthew.dev" });
  setOAuth("notoken", { mode: "emails", emails: ["m@x.dev"] });

  // Temporarily remove the railway token to trigger 428
  const savedToken = secretsConfig.railwayToken;
  secretsConfig.railwayToken = undefined;

  const x = io();
  expect(await runCommand(["remote", "notoken", "on"], x)).toBe(1);
  expect(x.lines.join("\n")).toContain("rt secrets set deck railwayToken");

  secretsConfig.railwayToken = savedToken;
});

test("deck push site prints the pushed sha", async () => {
  const repo = gitRepo();
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "pushme", command: ["bun", "run", "serve"], workingDirectory: repo }),
  });
  const created = (await res.json()) as { record?: { name: string } };
  putRecord({
    ...getRecord("pushme")!,
    remote: { target: "railway", serviceId: "svc_1", customDomain: "pushme.m4tthew.dev", status: "live" },
  });
  rw.byName.set("deck-pushme", "svc_1");
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" }, publicDomain: "m4tthew.dev" });

  const x = io();
  expect(await runCommand(["push", "pushme"], x)).toBe(0);
  expect(x.lines.join("\n")).toMatch(/pushed pushme @/);
});
