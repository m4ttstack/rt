import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-api-remote-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.HOME = dir;
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("./server.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { FakeRailwayDriver, FakeCfDns } = await import("../../test/fixture/remote.ts");
const { reloadRegistry, putRecord, getRecord } = await import("../registry/records.ts");
const { reloadPlatformSettings, updatePlatformSettings } = await import("./platform-settings.ts");
const { setOAuth } = await import("../edge/oauth.ts");

const PORT = 18931;
let server: ReturnType<typeof startApi>;
let rw: InstanceType<typeof FakeRailwayDriver>;
let dns: InstanceType<typeof FakeCfDns>;

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
      post: async () => ({ ok: true, data: { railwayToken: "rw-tok" } }),
    },
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  // A fresh HOME per test: deck.platform's migrated fields live in the
  // machine settings STORE now, which the file reset above never touches.
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-api-remote-home-"));
  reloadPlatformSettings();

  rw.calls.length = 0; rw.upCalls.length = 0; rw.upResult = { ok: true, log: "built" };
  rw.services.clear(); rw.domains.clear(); rw.status.clear(); rw.byName.clear(); rw.configured.clear();
  dns.calls.length = 0; dns.txt.clear(); dns.cname.clear(); dns.ssl = "full"; dns.canEdit = true;
});

const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${PORT}${path}`, init);
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A real temp git repo with one commit -- the routes wire the real
    gitProvenance/untrackedEnvPresent (src/edge/source.ts), not fakes. */
function gitRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "remote-route-repo-"));
  const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  run(["init", "-q"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "t"]);
  writeFileSync(join(repo, "a.txt"), "1");
  run(["add", "a.txt"]);
  run(["commit", "-q", "-m", "init"]);
  return repo;
}

test("POST /apps/:name/remote {enabled:true} returns the live url", async () => {
  const repo = gitRepo();
  await post("/api/v1/apps", { name: "site", command: ["bun", "run", "serve"], workingDirectory: repo });
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" }, publicDomain: "m4tthew.dev" });
  setOAuth("site", { mode: "emails", emails: ["m@x.dev"] });
  rw.setVerified("site.m4tthew.dev", { verified: true, proxyDetected: true });

  const res = await post("/api/v1/apps/site/remote", { enabled: true });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url?: string };
  expect(body.url).toBe("https://site.m4tthew.dev");
  expect(getRecord("site")!.remote!.status).toBe("live");
});

test("POST /apps/:name/push redeploys an app already in remote mode", async () => {
  const repo = gitRepo();
  await post("/api/v1/apps", { name: "pushme", command: ["bun", "run", "serve"], workingDirectory: repo });
  putRecord({
    ...getRecord("pushme")!,
    remote: { target: "railway", serviceId: "svc_1", customDomain: "pushme.m4tthew.dev", status: "live" },
  });
  rw.byName.set("deck-pushme", "svc_1");

  const res = await post("/api/v1/apps/pushme/push", {});
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok?: boolean; lastPush?: unknown };
  expect(body.ok).toBe(true);
  expect(body.lastPush).toBeDefined();
  expect(getRecord("pushme")!.remote!.lastPush).toBeDefined();
});

test("remote {enabled:true} on an app with no sign-in gate 400s remote-requires-access", async () => {
  await post("/api/v1/apps", { name: "gatedapp", command: ["bun", "run", "serve"], workingDirectory: "/tmp" });
  updatePlatformSettings({ railway: { projectId: "p1", environmentId: "e1" }, publicDomain: "m4tthew.dev" });
  // No setOAuth call: oauth defaults to { mode: "off" }.

  const res = await post("/api/v1/apps/gatedapp/remote", { enabled: true });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toBe("remote-requires-access");
});

test("remote {enabled:false} tears an app back down", async () => {
  const repo = gitRepo();
  await post("/api/v1/apps", { name: "offsite", command: ["bun", "run", "serve"], workingDirectory: repo });
  putRecord({
    ...getRecord("offsite")!,
    remote: { target: "railway", serviceId: "svc_9", customDomain: "offsite.m4tthew.dev", status: "live" },
  });
  rw.services.set("svc_9", { name: "deck-offsite" });
  dns.cname.set("offsite.m4tthew.dev", { target: "t", proxied: true });

  const res = await post("/api/v1/apps/offsite/remote", { enabled: false });
  expect(res.status).toBe(200);
  expect(getRecord("offsite")!.remote).toBeUndefined();
  expect(rw.calls).toContain("deleteService:svc_9");
});
