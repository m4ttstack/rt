import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "domain-unbind-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const { bindDomain, unbindDomain, TUNNEL_LABEL, tunnelConfigPath } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { getPlatformSettings, reloadPlatformSettings, updatePlatformSettings } = await import("../api/platform-settings.ts");
const { reloadRegistry, putRecord } = await import("../registry/records.ts");

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
  process.env.HOME = mkdtempSync(join(tmpdir(), "domain-unbind-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "domain-unbind-cfdir-"));
  writeFileSync(join(cfDir, "cert.pem"), "x");
  tunnel = new FakeTunnelDriver(cfDir);
  manager = new FakeServiceManager();
  dns = new FakeCfDns();
});

test("unbind with nothing bound is a no-op 200", async () => {
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(200);
  expect((r.body as any).alreadyUnbound).toBe(true);
});

test("unbind happy path: uninstall, delete DNS, forced tunnel delete + creds, config, state", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const id = getPlatformSettings().tunnel!;
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir, force: true });
  expect(r.status).toBe(200);
  expect(manager.installed.has(TUNNEL_LABEL)).toBe(false);
  expect(dns.cname.has("*.example.dev")).toBe(false);
  expect(tunnel.calls).toContainEqual(["delete", id.name]);
  expect(existsSync(join(cfDir, `${id.uuid}.json`))).toBe(false);
  expect(existsSync(tunnelConfigPath())).toBe(false);
  expect(getPlatformSettings()).toMatchObject({ publicDomain: null, tunnel: null });
});

test("unbind refuses while an app is remote, unless forced", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  putRecord({ name: "site", managedBy: "user", port: 3000, kind: "service", createdAt: new Date().toISOString(),
    remote: { target: "railway", serviceId: "svc", customDomain: "site.example.dev", status: "live" } });
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(409);
  expect((r.body as any).error).toBe("remote-apps-pinned-to-domain");
  expect((await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir, force: true })).status).toBe(200);
});

test("unbind lists tunnel-served apps that will go offline and requires force", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  putRecord({ name: "blog", managedBy: "user", port: 3001, kind: "service", createdAt: new Date().toISOString() });
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir });
  expect(r.status).toBe(409);
  expect((r.body as any)).toEqual({ error: "apps-will-go-offline", apps: ["blog"] });
});

test("unbind tolerates a partial bind (tunnel recorded, no domain): skips DNS, still removes the rest", async () => {
  updatePlatformSettings({ tunnel: { name: "deck-edge-mbp-abc123", uuid: "u-partial" } });
  writeFileSync(join(cfDir, "u-partial.json"), "{}");
  tunnel.tunnels.set("deck-edge-mbp-abc123", "u-partial");
  const r = await unbindDomain({ tunnel, manager, dns }, { cloudflaredDir: cfDir, force: true });
  expect(r.status).toBe(200);
  expect(dns.calls.some((c) => c.startsWith("delCname"))).toBe(false);
  expect(tunnel.calls).toContainEqual(["delete", "deck-edge-mbp-abc123"]);
  expect(existsSync(join(cfDir, "u-partial.json"))).toBe(false);
  expect(getPlatformSettings().tunnel).toBeNull();
});

test("unbind with no DNS driver (secrets unavailable) still removes local + tunnel state", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const r = await unbindDomain({ tunnel, manager, dns: null }, { cloudflaredDir: cfDir, force: true });
  expect(r.status).toBe(200);
  expect(getPlatformSettings().publicDomain).toBeNull();
});
