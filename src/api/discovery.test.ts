import { test, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-discovery-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or the import below touches the real
// ~/.mattstack. beforeEach repoints it to a fresh dir per test below.
process.env.HOME = dir;

const { buildDiscoveryApps, iconResponse } = await import("./discovery.ts");
const { putRecord, reloadRegistry } = await import("../registry/records.ts");
const { ingestManifest } = await import("../registry/manifest.ts");

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>';

function manifestDir(): string {
  const appDir = mkdtempSync(join(tmpdir(), "discovery-manifest-"));
  writeFileSync(
    join(appDir, "mattstack.json"),
    JSON.stringify({ displayName: "Chat", description: "Group chat", icon: "./icon.svg" }),
  );
  writeFileSync(join(appDir, "icon.svg"), SVG);
  return appDir;
}

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-discovery-home-"));
  reloadRegistry();
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
});

const statusOpts = { port: 7940, canaryPort: 7942, proxyFreshness: "unknown" as const, autoHeal: null };

test("discovery returns managed products only, no internal fields", async () => {
  const chatDir = manifestDir();
  putRecord({
    name: "chat", managedBy: "rt", port: 11002, kind: "service",
    workingDirectory: chatDir, createdAt: "2026-08-10T00:00:00Z",
  });
  ingestManifest("chat");
  putRecord({
    name: "deck", managedBy: "deck", port: 7940, kind: "service",
    createdAt: "2026-08-10T00:00:00Z",
  });
  putRecord({
    name: "mine", managedBy: "user", port: 11003, kind: "service",
    createdAt: "2026-08-10T00:00:00Z",
  });

  // buildStatus (which buildDiscoveryApps delegates url to) joins routes.json,
  // not the registry -- seed the route deck's own alias never writes in this
  // harness. .localhost (not .mattstack) so bareName reduces it to "chat".
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: "chat.localhost", port: 11002 }]));

  const apps = await buildDiscoveryApps(statusOpts);
  expect(apps.map((a) => a.name)).toEqual(["chat"]);
  const chat = apps[0]!;
  expect(chat.displayName).toBe("Chat");
  expect(chat.url).toBe("https://chat.mattstack");
  expect(chat.icon).toBe("chat");
  const loose = chat as unknown as Record<string, unknown>;
  expect(loose.workingDirectory).toBeUndefined();
  expect(loose.port).toBeUndefined();
  expect(loose.command).toBeUndefined();
  expect(loose.env).toBeUndefined();
  expect(loose.health).toBeUndefined();
});

test("an app record with no icon ingested reports icon null", async () => {
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: "noicon.localhost", port: 11004 }]));
  putRecord({
    name: "noicon", managedBy: "rt", port: 11004, kind: "service",
    createdAt: "2026-08-10T00:00:00Z",
  });
  const apps = await buildDiscoveryApps(statusOpts);
  const row = apps.find((a) => a.name === "noicon")!;
  expect(row.icon).toBeNull();
});

test("iconResponse serves the stored svg, and 404s when there is none", async () => {
  const chatDir = manifestDir();
  putRecord({
    name: "chat", managedBy: "rt", port: 11002, kind: "service",
    workingDirectory: chatDir, createdAt: "2026-08-10T00:00:00Z",
  });
  ingestManifest("chat");

  const ok = iconResponse("chat");
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/svg+xml");
  expect(await ok.text()).toContain("<svg");

  const missing = iconResponse("nope");
  expect(missing.status).toBe(404);
});

// ---- GET /api/apps and GET /api/apps/:name/icon over HTTP ----

const { startApi } = await import("./server.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");

const PORT = 18937;
let server: ReturnType<typeof startApi>;

beforeAll(() => {
  server = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    tunnel: new FakeTunnelDriver(),
  });
});
afterAll(() => { server.stop(true); });

// deckBaseFor(host) derives the tld from the request Host's last dotted
// label. A fetch to http://127.0.0.1:PORT has Host "127.0.0.1:PORT" (garbage
// tld), so send x-forwarded-host explicitly -- server.ts reads it before host.
const api = (path: string) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { "x-forwarded-host": "chat.mattstack" } });

test("GET /api/apps lists managed products with an absolute icon URL", async () => {
  const chatDir = manifestDir();
  putRecord({
    name: "chat", managedBy: "rt", port: 11002, kind: "service",
    workingDirectory: chatDir, createdAt: "2026-08-10T00:00:00Z",
  });
  ingestManifest("chat");
  putRecord({ name: "deck", managedBy: "deck", port: 7940, kind: "service", createdAt: "2026-08-10T00:00:00Z" });
  putRecord({ name: "mine", managedBy: "user", port: 11003, kind: "service", createdAt: "2026-08-10T00:00:00Z" });
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: "chat.localhost", port: 11002 }]));

  const res = await api("/api/apps");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { apps: Array<Record<string, unknown>> };
  expect(body.apps.map((a) => a.name)).toEqual(["chat"]);
  const chat = body.apps[0]!;
  expect(chat.icon).toBe("https://deck.mattstack/api/apps/chat/icon");
  expect(chat.workingDirectory).toBeUndefined();
  expect(chat.port).toBeUndefined();
});

test("GET /api/apps/:name/icon serves 200 svg for a real icon, 404 for a missing one", async () => {
  const chatDir = manifestDir();
  putRecord({
    name: "chat", managedBy: "rt", port: 11002, kind: "service",
    workingDirectory: chatDir, createdAt: "2026-08-10T00:00:00Z",
  });
  ingestManifest("chat");

  const ok = await api("/api/apps/chat/icon");
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/svg+xml");
  expect(await ok.text()).toContain("<svg");

  const missing = await api("/api/apps/nope/icon");
  expect(missing.status).toBe(404);
});

// ---- CORS on the discovery routes ----

test("GET /api/apps echoes an allowed mattstack origin in CORS", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { headers: { origin: "https://chat.mattstack" } });
  expect(res.headers.get("access-control-allow-origin")).toBe("https://chat.mattstack");
});

test("GET /api/apps does not CORS-allow a foreign origin", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { headers: { origin: "https://evil.example.com" } });
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test("OPTIONS /api/apps preflight returns the CORS headers", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { method: "OPTIONS", headers: { origin: "https://chat.mattstack" } });
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("https://chat.mattstack");
});

test("the icon route is CORS-allowed too", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/apps/chat/icon`, { headers: { origin: "https://console.mattstack" } });
  expect(res.headers.get("access-control-allow-origin")).toBe("https://console.mattstack");
});

test("the versioned /api/v1 surface is NOT CORS-opened", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/status`, { headers: { origin: "https://chat.mattstack" } });
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});
