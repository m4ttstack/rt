import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-cli-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("../api/server.ts");
const { writeApiInfo } = await import("../api/state.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { runCommand } = await import("./commands.ts");

const PORT = 18971;
let server: ReturnType<typeof startApi>;
beforeAll(() => {
  server = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(), tunnel: new FakeTunnelDriver(),
    // Scratch cloudflaredDir with no cert.pem: the domain verb's bind step
    // deterministically 428s here regardless of this machine's ~/.cloudflared.
    cloudflaredDir: dir,
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
  });
  writeApiInfo(PORT);
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

function io() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), lines };
}

test("add + status + remove round-trip", async () => {
  const a = io();
  expect(await runCommand(["add", "t-cli", "--port", "4999"], a)).toBe(0);
  const s = io();
  expect(await runCommand(["status"], s)).toBe(0);
  expect(s.lines.join("\n")).toContain("t-cli");
  const r = io();
  expect(await runCommand(["remove", "t-cli"], r)).toBe(0);
});

test("remove on a managed record prints the escape hatch and exits 1", async () => {
  const a = io();
  await runCommand(["add", "t-rt", "--port", "4998"], a); // user record...
  // ...flip it to rt via the API to simulate a manager registration
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/t-rt?force=true`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:${PORT}/api/v1/apps`, {
    method: "POST", headers: { "content-type": "application/json", "x-local-caller": "rt" },
    body: JSON.stringify({ name: "t-rt", staticPort: 4998 }),
  });
  const r = io();
  expect(await runCommand(["remove", "t-rt"], r)).toBe(1);
  expect(r.lines.join("\n")).toContain("Managed by mattstack");
  const f = io();
  expect(await runCommand(["remove", "t-rt", "--force"], f)).toBe(0);
});

test("unknown verb exits 2 with usage", async () => {
  const x = io();
  expect(await runCommand(["frobnicate"], x)).toBe(2);
  expect(x.lines.join("\n")).toContain("usage");
});

test("domain verb captures the CF token via the injected prompt and stores it write-only", async () => {
  const answers = ["cf-tok-123", "zone-abc"]; // token, then zone id
  const promptFn = () => answers.shift() ?? null;
  const d = io();
  // Bind itself 428s (no cert.pem in this scratch env) — exit 1 is expected;
  // what this test pins is that the token round-tripped BEFORE the bind.
  expect(await runCommand(["domain", "example.dev"], d, promptFn)).toBe(1);
  const settings = (await (await fetch(`http://127.0.0.1:${PORT}/api/v1/settings`)).json()) as {
    hasCfToken: boolean;
    hasCfZone: boolean;
  };
  expect(settings.hasCfToken).toBe(true);
  expect(settings.hasCfZone).toBe(true);
  expect(JSON.stringify(settings)).not.toContain("cf-tok-123"); // redaction holds
});

test("no running platform gives a clear error", async () => {
  const savedInfo = process.env.LOCAL_STATE_DIR;
  const emptyDir = mkdtempSync(join(tmpdir(), "local-cli-noserve-"));
  process.env.LOCAL_STATE_DIR = emptyDir;
  const x = io();
  const code = await runCommand(["status"], x);
  process.env.LOCAL_STATE_DIR = savedInfo;
  rmSync(emptyDir, { recursive: true, force: true });
  expect(code).toBe(1);
  expect(x.lines.join("\n")).toContain("local serve");
});
