import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Same isolation harness as commands.test.ts: a scratch state dir, a faked HOME
// so rt-client never touches the real ~/.mattstack, and a fake API server the
// CLI talks to over 127.0.0.1. This file owns the `url` verb.
const dir = mkdtempSync(join(tmpdir(), "local-cli-url-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.HOME = dir;
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");
// publicDomain must be set before importing platform-settings (it caches at
// import), so a published app's row carries a non-null publicUrl to print.
writeFileSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH, JSON.stringify({ publicDomain: "m4tthew.dev" }));

const { startApi } = await import("../api/server.ts");
const { writeApiInfo } = await import("../api/state.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { runCommand } = await import("./commands.ts");
const { putRecord } = await import("../registry/records.ts");
const { reloadPlatformSettings } = await import("../api/platform-settings.ts");

const PORT = 18973;
let server: ReturnType<typeof startApi>;
beforeAll(() => {
  // Bun shares module state across files in one run; an earlier CLI test file
  // has already cached platform settings with a null publicDomain, so refresh
  // the cache against this file's platform.json before serving requests.
  reloadPlatformSettings();
  server = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(), tunnel: new FakeTunnelDriver(),
    cloudflaredDir: dir,
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
  });
  writeApiInfo(PORT);
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); reloadPlatformSettings(); });

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

/** Seed a managed record plus its .localhost route so buildStatus joins a live
    row (bareName strips .localhost -> the record's name), giving a real url. */
function seedRouted(name: string, port: number) {
  putRecord({ name, managedBy: "rt", port, kind: "service", createdAt: "2026-08-10T00:00:00Z" });
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([{ hostname: `${name}.localhost`, port }]));
}

test("deck url <service> prints the service's local url and exits 0", async () => {
  seedRouted("chat", 11002);
  const x = io();
  const code = await runCommand(["url", "chat"], x);
  expect(x.lines.join("\n").trim()).toBe("https://chat.mattstack");
  expect(code).toBe(0);
});

test("deck url --public errors when the app is not published", async () => {
  seedRouted("chatb", 11004);
  // Apps default to published:true, so turn it off to exercise the gate.
  expect(await runCommand(["publish", "chatb", "off"], io())).toBe(0);
  const x = io();
  const code = await runCommand(["url", "chatb", "--public"], x);
  expect(code).not.toBe(0);
  expect(x.lines.join("\n")).toContain("not published");
});

test("deck url --public prints the public url once the app is published", async () => {
  seedRouted("shared", 11006);
  expect(await runCommand(["publish", "shared", "on"], io())).toBe(0);
  const x = io();
  const code = await runCommand(["url", "shared", "--public"], x);
  expect(x.lines.join("\n").trim()).toBe("https://shared.m4tthew.dev");
  expect(code).toBe(0);
});

test("deck url of an unknown service exits non-zero with a clear message", async () => {
  const x = io();
  const code = await runCommand(["url", "nope"], x);
  expect(code).not.toBe(0);
  expect(x.lines.join("\n")).toContain("nope");
});

test("deck url of a service with no route (null url) is treated as not found", async () => {
  // A record with no route entry: buildStatus has no row to join, so the
  // synthesized row carries url:null, which must read as not found, not "".
  putRecord({ name: "noroute", managedBy: "rt", port: 11008, kind: "service", createdAt: "2026-08-10T00:00:00Z" });
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
  const x = io();
  const code = await runCommand(["url", "noroute"], x);
  expect(code).not.toBe(0);
  const out = x.lines.join("\n");
  // The verb's own null-url message, not the usage fallthrough an unimplemented
  // verb would print: this is what makes the test a real regression guard.
  expect(out).toContain("unknown service");
  expect(out).not.toContain("usage");
});

test("deck url with no service name is usage", async () => {
  const x = io();
  expect(await runCommand(["url"], x)).toBe(2);
  expect(x.lines.join("\n")).toContain("usage");
});
