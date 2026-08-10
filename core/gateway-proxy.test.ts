import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Server } from "bun";
import type { WsProxyData } from "./ws-proxy.ts";

/**
 * End-to-end cover for the two things unit tests cannot reach: that public
 * traffic actually lands on the overridden dev port, and that a websocket
 * upgrade survives the trip through the gateway.
 *
 * Uses stand-in upstreams rather than a real dev server so the test does not
 * depend on anything being up.
 */

const dir = mkdtempSync(join(tmpdir(), "local-apps-gw-"));
const ROUTES = join(dir, "routes.json");
const SETTINGS = join(dir, "settings.json");
const PLATFORM_SETTINGS = join(dir, "platform.json");
process.env.LOCAL_APPS_ROUTES_PATH = ROUTES;
process.env.LOCAL_APPS_SETTINGS_PATH = SETTINGS;
process.env.LOCAL_PLATFORM_SETTINGS_PATH = PLATFORM_SETTINGS;

const APP = "testapp";
const PUBLIC_DOMAIN = "example.dev";
const HOST = `${APP}.${PUBLIC_DOMAIN}`;

// appFromHost now strips whatever publicDomain platform settings configure,
// not a hardcoded suffix, so the gateway needs one on disk before it loads.
writeFileSync(PLATFORM_SETTINGS, JSON.stringify({ publicDomain: PUBLIC_DOMAIN }));

/** Stands in for a Vite dev server: greets, and echoes over `vite-hmr`. */
const dev = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    return new Response("DEV");
  },
  websocket: {
    message(ws, msg) { ws.send(`echo:${msg}`); },
    open(ws) { ws.send("hello-from-dev"); },
  },
});

/** Stands in for the launchd-managed build on the app's base port. */
const base = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () => new Response("BASE"),
});

writeFileSync(ROUTES, JSON.stringify([{ hostname: `${APP}.localhost`, port: dev.port, pid: 0 }]));

function writeSettings(publicFollowsOverride: boolean) {
  writeFileSync(SETTINGS, JSON.stringify({
    version: 1,
    secret: "b".repeat(64),
    apps: {
      [APP]: {
        published: true,
        passwordVersion: 0,
        override: { devPort: dev.port, basePort: base.port },
        ...(publicFollowsOverride ? { publicFollowsOverride: true } : {}),
      },
    },
  }));
}

let gateway: Server<WsProxyData>;
let reloadSettings: () => void;
let origin: string;

beforeAll(async () => {
  writeSettings(true);
  // Imported after the env vars are set, since both modules resolve their paths
  // at first load.
  const settings = await import("./settings.ts");
  reloadSettings = settings.reloadSettings;
  reloadSettings();
  const { startGateway } = await import("./gateway.ts");
  gateway = startGateway(0);
  origin = `http://127.0.0.1:${gateway.port}`;
});

afterAll(() => {
  gateway?.stop(true);
  dev.stop(true);
  base.stop(true);
});

test("an opted-in app serves its dev port publicly", async () => {
  writeSettings(true);
  reloadSettings();
  const res = await fetch(`${origin}/`, { headers: { host: HOST } });
  expect(await res.text()).toBe("DEV");
});

test("without the opt-in the same app serves its base port", async () => {
  writeSettings(false);
  reloadSettings();
  const res = await fetch(`${origin}/`, { headers: { host: HOST } });
  expect(await res.text()).toBe("BASE");
});

test("a websocket upgrade reaches the dev server and frames flow both ways", async () => {
  writeSettings(true);
  reloadSettings();

  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/`, {
    headers: { host: HOST },
  } as unknown as string[]);

  const frames: string[] = [];
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no frames within 5s")), 5000);
    ws.onmessage = (e) => {
      frames.push(String(e.data));
      // The greeting proves upstream->client, the echo proves client->upstream.
      if (frames.length === 1) ws.send("ping");
      if (frames.length === 2) { clearTimeout(timer); resolve(); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("upgrade failed")); };
  });

  await done;
  ws.close();
  expect(frames).toEqual(["hello-from-dev", "echo:ping"]);
});

test("frames sent before the client socket opens are queued, not dropped", async () => {
  // The dev stand-in greets on open, which lands while the gateway is still
  // upgrading the client. Receiving it at all is the queue working.
  writeSettings(true);
  reloadSettings();

  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/`, {
    headers: { host: HOST },
  } as unknown as string[]);

  const first = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("greeting never arrived")), 5000);
    ws.onmessage = (e) => { clearTimeout(timer); resolve(String(e.data)); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("upgrade failed")); };
  });

  ws.close();
  expect(first).toBe("hello-from-dev");
});
