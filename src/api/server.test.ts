import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-api-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("./server.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { reloadRegistry } = await import("../registry/records.ts");
const { reloadPlatformSettings } = await import("./platform-settings.ts");

const PORT = 18917;
let server: ReturnType<typeof startApi>;
let manager: InstanceType<typeof FakeServiceManager>;

const DOMAIN_PORT = 18919;
let domainServer: ReturnType<typeof startApi>;
let domainCfDir: string;

beforeAll(() => {
  manager = new FakeServiceManager();
  server = startApi({
    manager, edge: new FakeEdgeProxy(),
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(),
  });

  domainCfDir = mkdtempSync(join(tmpdir(), "local-cfdir-"));
  domainServer = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    port: DOMAIN_PORT, canaryPort: DOMAIN_PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(), cloudflaredDir: domainCfDir,
  });
});
afterAll(() => {
  server.stop(true);
  domainServer.stop(true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(domainCfDir, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  reloadPlatformSettings();
});

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

test("a freshly-registered app with no route yet shows up in the list without leaking secrets", async () => {
  const created = await post("/api/v1/apps", {
    name: "secretful", command: ["bun", "s.ts"], workingDirectory: "/tmp/secret-dir",
    env: { API_KEY: "shh-do-not-leak" },
  });
  expect(created.status).toBe(201);
  const list = await (await api("/api/v1/apps")).json();
  const row = list.apps.find((a: any) => a.name === "secretful");
  expect(row).toBeDefined();
  // Same safe shape a StatusRow normally carries, e.g. still has managedBy.
  expect(row.managedBy).toBe("user");
  // Never the raw AppRecord: command/env/workingDirectory must not leak.
  expect(row.command).toBeUndefined();
  expect(row.env).toBeUndefined();
  expect(row.workingDirectory).toBeUndefined();
  // The WHOLE serialized list, not named keys: env values must not appear at
  // any nesting depth (a past regression hid one inside row.record).
  expect(JSON.stringify(list)).not.toContain("shh-do-not-leak");
});

test("a public host gets the row's record shape redacted; a local one still pre-fills the edit dialog", async () => {
  const created = await post("/api/v1/apps", {
    name: "secretful", command: ["bun", "s.ts"], workingDirectory: "/tmp/secret-dir",
    env: { API_KEY: "shh-do-not-leak" },
  });
  expect(created.status).toBe(201);

  const pubHeaders = { "x-forwarded-host": "apps.example.dev" };
  const pubRaw = await (await api("/api/v1/apps", { headers: pubHeaders })).text();
  // Whole-body assertions: a leak that sinks one level deeper must still fail.
  expect(pubRaw).not.toContain("/tmp/secret-dir");
  expect(pubRaw).not.toContain("shh-do-not-leak");
  const pubRow = JSON.parse(pubRaw).apps.find((a: any) => a.name === "secretful");
  expect(pubRow.record).toEqual({ kind: "service", command: null, workingDirectory: null });

  // The single-record endpoint's `row` half goes through the same redaction.
  const oneRaw = await (await api("/api/v1/apps/secretful", { headers: pubHeaders })).text();
  expect(oneRaw).not.toContain("/tmp/secret-dir");
  expect(JSON.parse(oneRaw).row.record).toEqual({ kind: "service", command: null, workingDirectory: null });

  // Locally the edit dialog needs the real values, so they survive there.
  const local: any = await (await api("/api/v1/apps")).json();
  const localRow = local.apps.find((a: any) => a.name === "secretful");
  expect(localRow.record).toEqual({
    kind: "service", command: ["bun", "s.ts"], workingDirectory: "/tmp/secret-dir",
  });
});

test("the single-record endpoint redacts the record too (secrets never transit)", async () => {
  const created = await post("/api/v1/apps", {
    name: "secretful", command: ["bun", "s.ts"], workingDirectory: "/tmp/secret-dir",
    env: { API_KEY: "shh-do-not-leak" },
  });
  expect(created.status).toBe(201);
  const res = await api("/api/v1/apps/secretful");
  expect(res.status).toBe(200);
  const raw = await res.text();
  // The whole body: neither `record` nor `row` may carry the secret.
  expect(raw).not.toContain("shh-do-not-leak");
  const one = JSON.parse(raw);
  expect(one.record.env).toBeUndefined();
  expect(one.record.command).toBeUndefined();
  expect(one.record.workingDirectory).toBeUndefined();
  // Redacted, not dropped: the caller still learns which vars are set.
  expect(one.record.envKeys).toEqual(["API_KEY"]);
  // The safe fields survive, and the row is the same shape the list returns.
  expect(one.record.name).toBe("secretful");
  expect(one.record.managedBy).toBe("user");
  expect(one.record.port).toBeGreaterThan(0);
  expect(one.row.name).toBe("secretful");
  expect(one.row.managedBy).toBe("user");
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
  expect(manager.kickstarts).toContain("com.mattstack.deck.r1");
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

test("platform settings: PUT stores a secret, GET never echoes its value", async () => {
  const put = await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfApiToken: "tok-abc123" }),
  });
  expect(put.status).toBe(200);
  const getRaw = await (await api("/api/v1/settings")).text();
  expect(JSON.parse(getRaw).hasCfToken).toBe(true);
  expect(getRaw).not.toContain("tok-abc123");
});

test("an identity access tier is synced to Cloudflare BEFORE it is persisted; a failed sync changes nothing", async () => {
  await post("/api/v1/apps", { name: "gated1", command: ["bun", "s.ts"], workingDirectory: "/tmp" });
  // No Cloudflare token is configured (beforeEach wipes platform settings), so
  // syncOAuth fails for lack of credentials.
  const before = await (await api("/api/v1/apps/gated1")).json();
  expect(before.row.oauth).toEqual({ mode: "off" });

  const put = await api("/api/v1/apps/gated1/access", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "emails", emails: ["m@x.dev"] }),
  });
  // Not a 200/ok response: the sync failure must surface loudly, not as
  // {ok:true, cfSynced:false} buried in a 200.
  expect(put.status).toBe(502);
  const putBody = await put.json();
  expect(putBody.ok).toBeUndefined();
  expect(putBody.error).toBe("cloudflare-sync-failed");

  const after = await (await api("/api/v1/apps/gated1")).json();
  expect(after.row.oauth).toEqual({ mode: "off" });

  const list = await (await api("/api/v1/apps")).json();
  const row = list.apps.find((a: any) => a.name === "gated1");
  expect(row.oauth).toEqual({ mode: "off" });
});

test("a password is not a precondition for a sign-in gate", async () => {
  // The old API answered 409 when the password tier was selected with no
  // password set. The two are independent axes now, so setting one must never
  // depend on the other.
  const res = await api("/api/v1/apps/gated2/access", {
    method: "PUT",
    body: JSON.stringify({ mode: "domains", domains: ["corp.com"] }),
  });
  expect(res.status).not.toBe(409);
});

test("the old tier vocabulary is rejected, not translated", async () => {
  const res = await api("/api/v1/apps/gated3/access", {
    method: "PUT",
    body: JSON.stringify({ tier: "only-me", email: "m@x.dev" }),
  });
  expect(res.status).toBe(400);
});

test("platform settings: null or empty clears a stored Cloudflare secret; 'null' is never stored as a literal string", async () => {
  // Bind a non-null publicDomain first, so a literal "null" substring in any
  // later response can only come from the bug this test guards against (the
  // secret itself being stored as the string "null"), not from JSON's own
  // `null` rendering of an unset publicDomain.
  const put1 = await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicDomain: "example.test", cfApiToken: "tok-real-value" }),
  });
  expect(put1.status).toBe(200);
  const get1 = await (await api("/api/v1/settings")).json();
  expect(get1.hasCfToken).toBe(true);

  const put2 = await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfApiToken: null }),
  });
  expect(put2.status).toBe(200);
  const get2raw = await (await api("/api/v1/settings")).text();
  expect(JSON.parse(get2raw).hasCfToken).toBe(false);
  expect(get2raw).not.toContain("null");

  // Empty string behaves the same as null.
  await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfApiToken: "tok-real-value" }),
  });
  const put3 = await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfApiToken: "" }),
  });
  expect(put3.status).toBe(200);
  const get3raw = await (await api("/api/v1/settings")).text();
  expect(JSON.parse(get3raw).hasCfToken).toBe(false);
  expect(get3raw).not.toContain("null");
});

test("legacy POST endpoints are gone (board speaks /api/v1 now)", async () => {
  for (const path of ["/restart", "/publish", "/password", "/devport", "/publicdev"]) {
    const res = await api(path, { method: "POST", body: new URLSearchParams({ app: "x" }) });
    expect(res.status).toBe(404);
  }
  // /api/status stays for one release as a status alias
  expect((await api("/api/status")).status).toBe(200);
});

test("POST /api/v1/migrate without convert runs the adopt-in-place flow", async () => {
  const res = await post("/api/v1/migrate", {});
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  // migrate()'s result shape (adopted/skipped), not convert()'s
  // (converted/rolledBack/skipped): pins the request to the OLD route.
  expect(Object.keys(body).sort()).toEqual(["adopted", "skipped"]);
});

test("POST /api/v1/migrate with convert:true runs the convert batch instead", async () => {
  // Nothing legacy-prefixed registered: an empty, instant batch, which proves
  // the request routed to convert() (its own result shape) rather than migrate().
  const res = await post("/api/v1/migrate", { convert: true });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ converted: [], rolledBack: [], skipped: [] });
});

test("POST /api/v1/migrate with convert:true skips a non-service (external) record without touching the manager", async () => {
  await post("/api/v1/apps", { name: "static-app", staticPort: 4321 });
  const res = await post("/api/v1/migrate", { convert: true });
  const body = (await res.json()) as { skipped: string[]; converted: string[] };
  expect(body.skipped).toContain("static-app");
  expect(body.converted).not.toContain("static-app");
  // external records have no launchd label at all: convert() never calls the
  // manager for them, under any label naming this app.
  expect([...manager.installed.keys()].some((label) => label.includes("static-app"))).toBe(false);
});

test("domain bind flow: POST binds, GET reports the bound domain", async () => {
  const domainApi = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${DOMAIN_PORT}${path}`, init);
  const before = await (await domainApi("/api/v1/domain")).json();
  expect(before.domain).toBeNull();

  writeFileSync(join(domainCfDir, "cert.pem"), "x"); // login evidence
  const bind = await domainApi("/api/v1/domain/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "example.dev" }),
  });
  expect(bind.status).toBe(200);

  const after = await (await domainApi("/api/v1/domain")).json();
  expect(after.domain).toBe("example.dev");
});
