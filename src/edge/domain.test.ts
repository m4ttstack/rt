// src/edge/domain.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-domain-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const { bindDomain, tunnelConfigPath, TUNNEL_LABEL } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { getPlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
const { reloadRegistry } = await import("../registry/records.ts");

const CLOUDFLARED = "/opt/homebrew/bin/cloudflared";
let cfDir: string;
let tunnel: InstanceType<typeof FakeTunnelDriver>;
let manager: InstanceType<typeof FakeServiceManager>;
let dns: InstanceType<typeof FakeCfDns>;
const opts = () => ({ cloudflaredDir: cfDir, gatewayPort: 7950, random: () => "abc123", resolveBin: () => CLOUDFLARED, sleep: async () => {} });

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(join(dir, "tunnel.yml"), { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-domain-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "local-cfdir-"));
  tunnel = new FakeTunnelDriver(cfDir);
  manager = new FakeServiceManager();
  dns = new FakeCfDns();
});

test("refuses a malformed domain", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  const r = await bindDomain("not a domain", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(400);
});

test("refuses when cloudflared is not installed", async () => {
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, { ...opts(), resolveBin: () => null });
  expect(r.status).toBe(400);
  expect((r.body as any).error).toBe("cloudflared-missing");
});

test("refuses politely until cloudflared login has happened", async () => {
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(428);
  expect((r.body as any).command).toBe("cloudflared tunnel login");
});

test("refuses when the DNS token cannot edit the zone", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  dns.canEdit = false;
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(400);
  expect((r.body as any).error).toBe("cf-token-needs-zone-dns");
});

test("binds: mints + creates the tunnel, records identity, config, upserts DNS, installs + kickstarts, sets publicDomain", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(tunnel.calls[0]).toEqual(["create", expect.stringMatching(/^deck-edge-[a-z0-9-]+-abc123$/)]);
  const { tunnel: id, publicDomain } = getPlatformSettings();
  expect(id).toEqual({ name: tunnel.calls[0]![1], uuid: "fake-uuid-1" });
  expect(publicDomain).toBe("example.dev");
  expect(readFileSync(tunnelConfigPath(), "utf8")).toContain(`tunnel: fake-uuid-1`);
  expect(readFileSync(tunnelConfigPath(), "utf8")).toContain(`metrics: 127.0.0.1:7951`);
  expect(dns.cname.get("*.example.dev")).toEqual({ target: "fake-uuid-1.cfargotunnel.com", proxied: true });
  const agent = manager.installed.get(TUNNEL_LABEL)!;
  expect(agent.programArguments).toEqual([CLOUDFLARED, "tunnel", "--config", tunnelConfigPath(), "run"]);
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
  expect((r.body as any).connectors).toBe(1);
});

test("bind polls info() until a connector registers, bounded", async () => {
  writeFileSync(join(cfDir, "cert.pem"), "x");
  tunnel.connectors = 0;
  const slept: number[] = [];
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, { ...opts(), sleep: async (ms) => { slept.push(ms); if (slept.length === 2) tunnel.connectors = 2; } });
  expect(r.status).toBe(200);
  expect((r.body as any).connectors).toBe(2);
  expect(tunnel.calls.filter((c) => c[0] === "info")).toHaveLength(3);
  expect(slept).toEqual([3000, 3000]);
});
