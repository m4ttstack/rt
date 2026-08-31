import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "domain-bind-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const { bindDomain, TUNNEL_LABEL } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { getPlatformSettings, reloadPlatformSettings, updatePlatformSettings } = await import("../api/platform-settings.ts");
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
  process.env.HOME = mkdtempSync(join(tmpdir(), "domain-bind-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "domain-bind-cfdir-"));
  writeFileSync(join(cfDir, "cert.pem"), "x");
  tunnel = new FakeTunnelDriver(cfDir);
  manager = new FakeServiceManager();
  dns = new FakeCfDns();
});

test("identity is recorded before DNS or the service are touched", async () => {
  // A DNS failure after tunnel creation must leave the tunnel visible in deck.platform.
  dns.writeProxiedCname = async () => { throw new Error("cf down"); };
  await expect(bindDomain("example.dev", { tunnel, manager, dns }, opts())).rejects.toThrow("cf down");
  expect(getPlatformSettings().tunnel).toEqual({ name: expect.stringContaining("deck-edge-"), uuid: "fake-uuid-1" });
  expect(getPlatformSettings().publicDomain).toBeNull();
  expect(manager.installed.has(TUNNEL_LABEL)).toBe(false);
});

test("same-domain re-run reuses the recorded tunnel (creds present) and repairs a drifted config", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const first = getPlatformSettings().tunnel!;
  writeFileSync(join(dir, "tunnel.yml"), "corrupt");
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(getPlatformSettings().tunnel).toEqual(first);
  expect(tunnel.calls.filter((c) => c[0] === "create")).toHaveLength(1);
  expect(readFileSync(join(dir, "tunnel.yml"), "utf8")).toContain(`tunnel: ${first.uuid}`);
});

test("recorded tunnel present at Cloudflare but creds missing: delete and recreate under the same name", async () => {
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  const first = getPlatformSettings().tunnel!;
  rmSync(join(cfDir, `${first.uuid}.json`));
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(tunnel.calls).toContainEqual(["delete", first.name]);
  expect(getPlatformSettings().tunnel).toEqual({ name: first.name, uuid: "fake-uuid-2" });
  expect(dns.cname.get("*.example.dev")!.target).toBe("fake-uuid-2.cfargotunnel.com");
});

test("recorded tunnel absent from list() (deleted remotely): create under the recorded name", async () => {
  updatePlatformSettings({ tunnel: { name: "deck-edge-mbp-zzz999", uuid: "gone-uuid" }, publicDomain: "example.dev" });
  const r = await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(r.status).toBe(200);
  expect(tunnel.calls).toContainEqual(["create", "deck-edge-mbp-zzz999"]);
  expect(tunnel.calls).not.toContainEqual(["delete", "deck-edge-mbp-zzz999"]);
  expect(getPlatformSettings().tunnel).toEqual({ name: "deck-edge-mbp-zzz999", uuid: "fake-uuid-1" });
});

test("an existing wildcard record is overwritten, not duplicated", async () => {
  await dns.writeProxiedCname("*.example.dev", "stale.cfargotunnel.com");
  await bindDomain("example.dev", { tunnel, manager, dns }, opts());
  expect(dns.cname.size).toBe(1);
  expect(dns.cname.get("*.example.dev")!.target).toBe("fake-uuid-1.cfargotunnel.com");
});
