import { test, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// One full-path test proving the launcher registry works end to end: adopt a
// real fixture app (mattstack.json + SVG), then hit the API and assert the
// list, the absolute icon URL, the served icon, CORS, exclusions, and refresh.
// Same isolation harness as discovery.test.ts, with its own state dir/env/port
// so it never collides with that file's fixtures or its running fake server.

const dir = mkdtempSync(join(tmpdir(), "e2e-discovery-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or the import below touches the real
// ~/.mattstack. beforeEach repoints it to a fresh dir per test below.
process.env.HOME = dir;

const { putRecord, getRecord, reloadRegistry } = await import("../registry/records.ts");
const { startApi } = await import("./server.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>';

/** A real fixture app dir: mattstack.json declaring an icon under public/, and the SVG itself there. */
function fixtureAppDir(): string {
  const appDir = mkdtempSync(join(tmpdir(), "e2e-app-"));
  writeFileSync(
    join(appDir, "mattstack.json"),
    JSON.stringify({ displayName: "Chat", description: "Group chat", icon: "./public/icon.svg" }),
  );
  mkdirSync(join(appDir, "public"), { recursive: true });
  writeFileSync(join(appDir, "public", "icon.svg"), SVG);
  return appDir;
}

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "e2e-discovery-home-"));
  reloadRegistry();
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
});

const PORT = 18980;
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

// deckBaseFor(host) derives the absolute icon URL's tld from the request
// Host's last dotted label, and publicDomainFor("chat.mattstack") is null (a
// single-label tld, not a real public domain) -- so this header is safe to
// send on every request, mutations included, without tripping the /api/v1
// public-mutation guard. The CORS assertion additionally sends an allowed
// mattstack origin.
function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-forwarded-host": "chat.mattstack", ...extra };
}

test("end-to-end: adopt a fixture app, then list/serve/CORS/refresh it through the real API", async () => {
  const chatDir = fixtureAppDir();

  putRecord({
    name: "chat", managedBy: "user", port: 11002, kind: "service",
    workingDirectory: chatDir, createdAt: "2026-08-10T00:00:00Z",
  });
  putRecord({
    name: "deck", managedBy: "deck", port: PORT, kind: "service",
    createdAt: "2026-08-10T00:00:00Z",
  });
  putRecord({
    name: "mine", managedBy: "user", port: 11003, kind: "service",
    createdAt: "2026-08-10T00:00:00Z",
  });

  // Adopt over the real HTTP surface: flips ownership, ingests the manifest
  // (displayName/description/icon), and reconciles the .mattstack route --
  // no manual routes.json seeding needed here, unlike a direct-registry test.
  const adopt = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/chat/adopt`, {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ managedBy: "rt" }),
  });
  expect(adopt.status).toBe(200);
  expect(getRecord("chat")!.managedBy).toBe("rt");
  expect(getRecord("chat")!.displayName).toBe("Chat");

  // GET /api/apps: exactly chat, absolute URL + absolute icon URL, deck's own
  // row and the user app both absent, no internal fields leaked.
  const list = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { headers: apiHeaders() });
  expect(list.status).toBe(200);
  const listBody = (await list.json()) as { apps: Array<Record<string, unknown>> };
  expect(listBody.apps.map((a) => a.name)).toEqual(["chat"]);
  const chat = listBody.apps[0]!;
  expect(chat.displayName).toBe("Chat");
  expect(chat.description).toBe("Group chat");
  expect(chat.url).toBe("https://chat.mattstack");
  expect(chat.icon).toContain("https://deck.mattstack/api/apps/chat/icon");
  expect(chat.workingDirectory).toBeUndefined();
  expect(chat.port).toBeUndefined();
  expect(chat.command).toBeUndefined();
  expect(chat.env).toBeUndefined();

  // GET /api/apps/chat/icon: 200, svg content-type, real svg body.
  const icon = await fetch(`http://127.0.0.1:${PORT}/api/apps/chat/icon`, { headers: apiHeaders() });
  expect(icon.status).toBe(200);
  expect(icon.headers.get("content-type")).toBe("image/svg+xml");
  expect(await icon.text()).toContain("<svg");

  // CORS: an allowed mattstack origin is echoed back on the discovery route.
  const cors = await fetch(`http://127.0.0.1:${PORT}/api/apps`, {
    headers: apiHeaders({ origin: "https://console.mattstack" }),
  });
  expect(cors.headers.get("access-control-allow-origin")).toBe("https://console.mattstack");

  // Edit the manifest on disk, refresh, and see the new name reflected.
  writeFileSync(
    join(chatDir, "mattstack.json"),
    JSON.stringify({ displayName: "Chat Room", description: "Group chat", icon: "./public/icon.svg" }),
  );
  const refresh = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/chat/manifest/refresh`, {
    method: "POST",
    headers: apiHeaders(),
  });
  expect(refresh.status).toBe(200);
  expect(await refresh.json()).toEqual({ ok: true });

  const relisted = await fetch(`http://127.0.0.1:${PORT}/api/apps`, { headers: apiHeaders() });
  const relistedBody = (await relisted.json()) as { apps: Array<Record<string, unknown>> };
  expect(relistedBody.apps.map((a) => a.name)).toEqual(["chat"]);
  expect(relistedBody.apps[0]!.displayName).toBe("Chat Room");
});
