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
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or this test touches the real ~/.mattstack.
process.env.HOME = dir;
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
let edge: InstanceType<typeof FakeEdgeProxy>;

const DOMAIN_PORT = 18919;
let domainServer: ReturnType<typeof startApi>;
let domainCfDir: string;

// A third server whose Cloudflare Access driver is a canned success, so the
// happy path (sync, then persist, then read it back on a row) can be asserted
// end to end. The other two servers have no accessFetch, which is what makes
// every sign-in gate on them fail.
const CF_PORT = 18921;
let cfServer: ReturnType<typeof startApi>;
const cfCalls: { method: string; url: string }[] = [];
const cannedAccessFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? "GET";
  cfCalls.push({ method, url: u });
  if (method === "GET" && u.endsWith("/access/apps")) return Response.json({ success: true, result: [] });
  if (method === "POST" && u.endsWith("/access/apps")) {
    return Response.json({ success: true, result: { id: "app-1" } });
  }
  return Response.json({ success: true, result: { id: "pol-1" } });
}) as typeof fetch;

// A dev-gated server: devMode: () => true unlocks the action-command routes
// regardless of the real machine's mattstack.mode, which this test environment
// can never set to "dev" (rt-client 0.3.0 does not register that key).
const DEV_PORT = 18923;
let devServer: ReturnType<typeof startApi>;

beforeAll(() => {
  manager = new FakeServiceManager();
  edge = new FakeEdgeProxy();
  server = startApi({
    manager, edge,
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(),
    devMode: () => false,
  });

  devServer = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    port: DEV_PORT, canaryPort: DEV_PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(),
    devMode: () => true,
  });

  domainCfDir = mkdtempSync(join(tmpdir(), "local-cfdir-"));
  domainServer = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    port: DOMAIN_PORT, canaryPort: DOMAIN_PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(), cloudflaredDir: domainCfDir,
  });

  cfServer = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    port: CF_PORT, canaryPort: CF_PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(), accessFetch: cannedAccessFetch,
    // Stands in for the rt daemon: CF creds now come from secrets:read, not
    // a PUT to /api/v1/settings.
    deckSecrets: {
      readApiToken: () => "tok",
      post: async () => ({ ok: true, data: { cfApiToken: "cf-tok", cfZoneId: "z1" } }),
    },
  });
});
afterAll(() => {
  server.stop(true);
  domainServer.stop(true);
  cfServer.stop(true);
  devServer.stop(true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(domainCfDir, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  // A fresh HOME per test, not just per file: deck.platform's migrated fields
  // now live in the machine settings STORE (~/.mattstack), which the file
  // reset above never touches — without this, one test's setSetting leaks
  // into every later test in this file.
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-api-home-"));
  reloadPlatformSettings();
});

const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${PORT}${path}`, init);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  api(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
// prodPost is the default (devMode: () => false) server: used where a test
// specifically needs the production gate rather than any of the other servers.
const prodPost = post;

const devApi = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${DEV_PORT}${path}`, init);
const devPost = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  devApi(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

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

test("platform settings: PUT rejects a CF secret in the payload with a directed message, not a silent drop", async () => {
  const put = await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfApiToken: "tok-abc123" }),
  });
  expect(put.status).toBe(400);
  const putBody = (await put.json()) as { message?: string };
  expect(putBody.message).toContain("rt secrets set deck cfApiToken");
  expect(putBody.message).toContain("rt secrets set deck cfZoneId");
  const getRaw = await (await api("/api/v1/settings")).text();
  expect(getRaw).not.toContain("tok-abc123");
  expect(getRaw).not.toContain("hasCfToken");
});

test("a sign-in gate is synced to Cloudflare BEFORE it is persisted; a failed sync changes nothing", async () => {
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
  // depend on the other. The app is registered (and left with no password)
  // so the request reaches the access handler instead of bouncing off the
  // unknown-app 404, which would make this assertion vacuous.
  await post("/api/v1/apps", { name: "gated2", command: ["bun", "s.ts"], workingDirectory: "/tmp" });
  const res = await api("/api/v1/apps/gated2/access", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "domains", domains: ["corp.com"] }),
  });
  // Asserted exactly, not as "anything but 409": this server has no Cloudflare
  // credentials, so the request gets all the way to the sync and fails there.
  // A 400 or a 404 would mean it never reached the password question at all.
  expect(res.status).toBe(502);
  const failure = (await res.json()) as { error?: string };
  expect(failure.error).toBe("cloudflare-sync-failed");
});

test("a successful Cloudflare sync persists the rule and reports it back on the row", async () => {
  // The failure path above would pass identically if the store never persisted
  // anything, so the success path needs its own end-to-end assertion: sync,
  // persist, and read the rule back off a status row.
  const cfApi = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${CF_PORT}${path}`, init);
  const putJson = (path: string, payload: unknown) => cfApi(path, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });

  await putJson("/api/v1/settings", { publicDomain: "example.dev" });
  await cfApi("/api/v1/apps", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "gatedok", command: ["bun", "s.ts"], workingDirectory: "/tmp" }),
  });
  cfCalls.length = 0;

  const rule = { mode: "domains", domains: ["corp.com"] };
  const put = await putJson("/api/v1/apps/gatedok/access", rule);
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ ok: true, oauth: rule, cfSynced: true });

  // cfSynced: true is only honest if Cloudflare was actually driven.
  expect(cfCalls.some((c) => c.method === "POST" && c.url.endsWith("/access/apps"))).toBe(true);
  expect(cfCalls.some((c) => c.url.includes("/access/apps/app-1/policies"))).toBe(true);

  const after = (await (await cfApi("/api/v1/apps/gatedok")).json()) as any;
  expect(after.row.oauth).toEqual(rule);
  const list = (await (await cfApi("/api/v1/apps")).json()) as any;
  expect(list.apps.find((a: any) => a.name === "gatedok").oauth).toEqual(rule);
});

test("the old tier vocabulary is rejected, not translated", async () => {
  // Registered so the 400 is asserted for the reason this test claims (the
  // body fails parseOAuth), not merely because the app happens to be unknown.
  await post("/api/v1/apps", { name: "gated3", command: ["bun", "s.ts"], workingDirectory: "/tmp" });
  const res = await api("/api/v1/apps/gated3/access", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "only-me", email: "m@x.dev" }),
  });
  expect(res.status).toBe(400);
});

test("platform settings: PUT rejects cfZoneId too, and rejects null/empty forms of either key, not just a real value", async () => {
  // A non-null publicDomain must still land: the rejection is scoped to the
  // CF keys, not the whole request.
  const put1 = await api("/api/v1/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicDomain: "example.test", cfZoneId: "zone-real-value" }),
  });
  expect(put1.status).toBe(400);
  const get1 = await (await api("/api/v1/settings")).json();
  expect(get1.publicDomain).toBeNull(); // rejected, so nothing in the payload was applied

  for (const payload of [{ cfApiToken: null }, { cfApiToken: "" }, { cfZoneId: null }, { cfZoneId: "" }]) {
    const put = await api("/api/v1/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(put.status).toBe(400);
  }
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

test("DELETE tears down a route-only row through the edge driver instead of 404ing", async () => {
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "strayroute.localhost", port: 11997, pid: 0 }]),
  );
  edge.aliases.set("strayroute", 11997);
  const res = await api("/api/v1/apps/strayroute", { method: "DELETE" });
  expect(res.status).toBe(200);
  expect((await res.json()).ok).toBe(true);
  expect(edge.aliases.has("strayroute")).toBe(false);
  expect((await api("/api/v1/apps/neither-route-nor-record", { method: "DELETE" })).status).toBe(404);
});

test("adopt endpoint: renames + flips ownership, and a re-run is an idempotent 200", async () => {
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  await post("/api/v1/apps", { name: "mrs", command: ["x"], workingDirectory: "/tmp" });

  const res = await post("/api/v1/apps/mrs/adopt", { as: "board" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.adopted).toBe(true);
  expect(body.changed).toBe(true);
  expect(body.app).toMatchObject({ name: "board", previousName: "mrs", managedBy: "rt" });
  expect(body.hostnames).toEqual(["board.mattstack", "board.localhost"]);

  const rerun = await post("/api/v1/apps/mrs/adopt", { as: "board" });
  expect(rerun.status).toBe(200);
  expect((await rerun.json()).changed).toBe(false);

  const ghost = await post("/api/v1/apps/ghost/adopt", {});
  expect(ghost.status).toBe(404);
  expect(await ghost.json()).toEqual({ error: "unknown app" });
});

test("POST /apps/register creates a record from a manifest dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reg-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "regtest", port: 4321, commands: { start: "bun run serve" } }));
  const res = await post("/api/v1/apps/register", { dir });
  expect(res.status).toBe(200);
  const get = await api("/api/v1/apps/regtest");
  expect(get.status).toBe(200);
});

test("POST /apps/:name/alt activates and clears an overlay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name: "altapp", port: 4400, commands: { start: "bun run serve" },
    altConfigs: { dev: { port: 4500, commands: { start: "bun run dev" } } },
  }));
  await post("/api/v1/apps/register", { dir });
  const on = await post("/api/v1/apps/altapp/alt", { alt: "dev" });
  expect(on.status).toBe(200);
  expect((await (await api("/api/v1/apps/altapp")).json()).record.port).toBe(4500);
  const off = await post("/api/v1/apps/altapp/alt", { alt: null });
  expect(off.status).toBe(200);
  expect((await (await api("/api/v1/apps/altapp")).json()).record.port).toBe(4400);
});

test("alt on an unknown app is 404", async () => {
  expect((await post("/api/v1/apps/ghost/alt", { alt: "dev" })).status).toBe(404);
});

test("command route runs a declared command in dev", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "cmdapp", port: 4800, commands: { start: "s", build: "echo built" } }));
  await devPost("/api/v1/apps/register", { dir });
  const run = await devPost("/api/v1/apps/cmdapp/commands/build", {});
  expect(run.status).toBe(200);
  const body = await run.json();
  expect(body.started).toBe(true);
  expect(typeof body.runId).toBe("string");
});

test("unknown command name is 404 in dev", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "cmdapp2", port: 4801, commands: { start: "s" } }));
  await devPost("/api/v1/apps/register", { dir });
  expect((await devPost("/api/v1/apps/cmdapp2/commands/ghost", {})).status).toBe(404);
});

test("command route is 404 in production", async () => {
  expect((await prodPost("/api/v1/apps/anything/commands/build", {})).status).toBe(404);
});

test("a port-only manifest with an action command but no workingDirectory 400s instead of spawning with cwd undefined", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmd-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "portonly", port: 4890, commands: { build: "echo hi" } }));
  await devPost("/api/v1/apps/register", { dir });
  expect((await devPost("/api/v1/apps/portonly/commands/build", {})).status).toBe(400);
});

test("status carries command names in dev, omits them in prod", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meta-"));
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "metaapp", port: 4950, commands: { start: "s", deploy: "d" } }));
  await devPost("/api/v1/apps/register", { dir });
  // Registration only creates the registry record and an in-memory alias (the
  // fake edge driver never persists to routes.json); a status row needs a
  // route on disk too, same as the other status-row tests in this file.
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: "metaapp.localhost", port: 4950, pid: 0 }]));
  const devRow = (await (await devApi("/api/v1/status")).json()).apps.find((a: any) => a.name === "metaapp");
  expect(devRow.commands).toEqual(["deploy"]);
  const prodRow = (await (await api("/api/v1/status")).json()).apps.find((a: any) => a.name === "metaapp");
  expect(prodRow.commands).toBeUndefined();
});
