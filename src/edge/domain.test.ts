// src/edge/domain.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-domain-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
// deck.platform reads through rt-client, which resolves HOME at call time (not overridable
// via a LOCAL_*_PATH var) -- must be faked here too, or this test touches the real ~/.mattstack.
process.env.HOME = dir;

const { bindDomain } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { getPlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");

let cfDir: string;
beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  // A fresh HOME per test: publicDomain now also lives in the machine
  // settings STORE, which the file reset above never touches.
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-domain-home-"));
  reloadPlatformSettings();
  cfDir = mkdtempSync(join(tmpdir(), "local-cfdir-"));
});

test("refuses politely until cloudflared login has happened", async () => {
  const res = await bindDomain("example.dev", { tunnel: new FakeTunnelDriver(), manager: new FakeServiceManager() }, { cloudflaredDir: cfDir });
  expect(res.status).toBe(428);
  expect((res.body as any).command).toBe("cloudflared tunnel login");
});

test("binds: tunnel, wildcard route, config, agent, publicDomain", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x"); // login evidence
  const tunnel = new FakeTunnelDriver();
  const manager = new FakeServiceManager();
  const res = await bindDomain("example.dev", { tunnel, manager }, { cloudflaredDir: cfDir, gatewayPort: 7950 });
  expect(res.status).toBe(200);
  expect(tunnel.calls).toEqual([["create", "local-edge"], ["routeDns", "local-edge", "*.example.dev"]]);
  const agent = manager.installed.get("com.mattstack.deck.tunnel")!;
  expect(agent.programArguments).toContain("--config");
  expect(agent.programArguments).toContain("run");
  expect(getPlatformSettings().publicDomain).toBe("example.dev");
});
