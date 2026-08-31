import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-cli-domain-"));
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or this test touches the real ~/.mattstack.
process.env.HOME = dir;
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { startApi } = await import("../api/server.ts");
const { writeApiInfo } = await import("../api/state.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { FakeTunnelDriver } = await import("../edge/tunnel.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { runCommand } = await import("./commands.ts");

const PORT = 18973;
let server: ReturnType<typeof startApi>;
const cfDir = mkdtempSync(join(tmpdir(), "local-cli-domain-cfdir-"));

beforeAll(() => {
  server = startApi({
    manager: new FakeServiceManager(), edge: new FakeEdgeProxy(),
    tunnel: new FakeTunnelDriver(cfDir), dns: new FakeCfDns(),
    cloudflaredDir: cfDir, resolveCloudflared: () => "/opt/homebrew/bin/cloudflared",
    port: PORT, canaryPort: PORT + 1,
    freshness: () => "unknown", autoHeal: () => null, onRouteWrite: () => {},
    devMode: () => true,
  });
  writeApiInfo(PORT);
});
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(cfDir, { recursive: true, force: true });
});

test("deck domain (show) prints no edge bound; bind prints the domain; unbind refuses then forces", async () => {
  const out: string[] = [], err: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  expect(await runCommand(["domain"], io)).toBe(0);
  expect(out.join("\n")).toContain("no edge bound");
  writeFileSync(join(cfDir, "cert.pem"), "x");
  expect(await runCommand(["domain", "example.dev"], io)).toBe(0);
  expect(out.join("\n")).toContain("bound example.dev");
  expect(await runCommand(["domain"], io)).toBe(0);
  expect(out.join("\n")).toContain("deck-edge-");
  out.length = 0;
  expect(await runCommand(["domain", "unbind", "--force"], io)).toBe(0);
  expect(out.join("\n")).toContain("unbound");
});
