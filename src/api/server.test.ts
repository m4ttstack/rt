import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-api-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("./server.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { reloadRegistry } = await import("../registry/records.ts");

const PORT = 18917;
let server: ReturnType<typeof startApi>;
let manager: InstanceType<typeof FakeServiceManager>;

beforeAll(() => {
  manager = new FakeServiceManager();
  server = startApi({
    manager, edge: new FakeEdgeProxy(),
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
  });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true }); reloadRegistry(); });

const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${PORT}${path}`, init);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  api(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("healthz answers ok (health contract)", async () => {
  expect(await (await api("/healthz")).text()).toBe("ok");
});

test("register -> list -> get -> delete round-trip through HTTP", async () => {
  const created = await post("/api/v1/apps", { name: "t1", command: ["bun", "s.ts"], workingDirectory: "/tmp" });
  expect(created.status).toBe(201);
  const list = await (await api("/api/v1/apps")).json();
  expect(list.apps.map((a: any) => a.name)).toContain("t1");
  const one = await api("/api/v1/apps/t1");
  expect(one.status).toBe(200);
  const del = await api("/api/v1/apps/t1", { method: "DELETE" });
  expect(del.status).toBe(200);
  expect((await api("/api/v1/apps/t1")).status).toBe(404);
});

test("caller header drives the 409; ?force=true is the escape hatch", async () => {
  await post("/api/v1/apps", { name: "g", command: ["x"], workingDirectory: "/tmp" }, { "x-local-caller": "rt" });
  const denied = await api("/api/v1/apps/g", { method: "DELETE" }); // default caller "user"
  expect(denied.status).toBe(409);
  expect((await denied.json()).escapeHatch).toBe("?force=true");
  const rtDel = await api("/api/v1/apps/g?force=true", { method: "DELETE" });
  expect(rtDel.status).toBe(200);
});

test("restart 404s on an unknown app, kickstarts a known service record", async () => {
  expect((await post("/api/v1/apps/ghost/restart", {})).status).toBe(404);
  await post("/api/v1/apps", { name: "r1", command: ["x"], workingDirectory: "/tmp" });
  const res = await post("/api/v1/apps/r1/restart", {});
  expect(res.status).toBe(200);
  expect(manager.kickstarts).toContain("com.mattstack.local.r1");
});

test("publish flips settings through the versioned path", async () => {
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: "p1.localhost", port: 12000, pid: 0 }]));
  const res = await api("/api/v1/apps/p1/publish", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ published: false }),
  });
  expect(res.status).toBe(200);
  const status = await (await api("/api/v1/status")).json();
  expect(status.apps.find((a: any) => a.name === "p1").published).toBe(false);
});

test("mutations through a public host are forbidden", async () => {
  const res = await post("/api/v1/apps", { name: "evil", staticPort: 1 }, { "x-forwarded-host": "apps.example.dev" });
  expect(res.status).toBe(403);
});

test("legacy /api/status still answers with the board document", async () => {
  const legacy = await (await api("/api/status")).json();
  expect(legacy).toHaveProperty("apps");
  expect(legacy).toHaveProperty("proxyStale");
});
