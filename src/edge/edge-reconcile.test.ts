import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "edge-reconcile-"));
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.HOME = dir;

const {
  reconcileEdge,
  edgeDrift,
  edgeBindingChanged,
  resetEdgeReconcileForTests,
  EDGE_LOCAL_INTERVAL_MS,
  EDGE_CF_INTERVAL_MS,
  EDGE_ERROR_BACKOFF_MS,
} = await import("./edge-reconcile.ts");
const { bindDomain, TUNNEL_LABEL, tunnelConfigPath } = await import("./domain.ts");
const { FakeTunnelDriver } = await import("./tunnel.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeCfDns } = await import("../../test/fixture/remote.ts");
const { updatePlatformSettings, reloadPlatformSettings } = await import("../api/platform-settings.ts");
const { reloadRegistry } = await import("../registry/records.ts");

const CLOUDFLARED = "/opt/homebrew/bin/cloudflared";
let cfDir: string;
let tunnel: InstanceType<typeof FakeTunnelDriver>;
let manager: InstanceType<typeof FakeServiceManager>;
let dns: InstanceType<typeof FakeCfDns>;
let running: boolean;
const clock = { t: 0, now: () => clock.t };
const opts = () => ({ cloudflaredDir: cfDir, gatewayPort: 7950, random: () => "abc123", resolveBin: () => CLOUDFLARED, sleep: async () => {} });

function deps(over: Partial<any> = {}): any {
  return {
    tunnel, manager, dns: async () => dns, now: () => clock.t,
    services: async () => [{ label: TUNNEL_LABEL, plistPath: "", program: ["cloudflared"], workingDirectory: null, stderrPath: null, port: null, pid: running ? 1 : null, lastExitStatus: null }],
    cloudflaredDir: cfDir, cloudflaredBin: CLOUDFLARED, gatewayPort: 7950, ...over,
  };
}

beforeEach(() => {
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(join(dir, "tunnel.yml"), { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "edge-reconcile-home-"));
  reloadPlatformSettings();
  reloadRegistry();
  cfDir = mkdtempSync(join(tmpdir(), "edge-reconcile-cfdir-"));
  writeFileSync(join(cfDir, "cert.pem"), "x");
  tunnel = new FakeTunnelDriver(cfDir);
  manager = new FakeServiceManager();
  dns = new FakeCfDns();
  running = true;
  clock.t = 0;
  resetEdgeReconcileForTests();
});

test("no recorded binding is a no-op (no driver calls)", async () => {
  await reconcileEdge(deps());
  expect(tunnel.calls).toEqual([]);
  expect(dns.calls).toEqual([]);
});

test("a partial bind (tunnel, no domain) is left alone", async () => {
  updatePlatformSettings({ tunnel: { name: "n", uuid: "u" } });
  await reconcileEdge(deps());
  expect(manager.kickstarts).toEqual([]);
  expect(dns.calls).toEqual([]);
});

test("stopped service is kickstarted; an edited config is rewritten AND kickstarted", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  manager.kickstarts.length = 0;
  running = false;
  await reconcileEdge(deps());
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
  running = true;
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  manager.kickstarts.length = 0;
  writeFileSync(tunnelConfigPath(), "hand edited");
  await reconcileEdge(deps());
  expect(readFileSync(tunnelConfigPath(), "utf8")).toContain("tunnel: fake-uuid-1");
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
});

test("a missing service is reinstalled", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  manager.installed.clear();
  await reconcileEdge(deps());
  expect(manager.installed.has(TUNNEL_LABEL)).toBe(true);
});

test("local pass is throttled to EDGE_LOCAL_INTERVAL_MS and the CF pass to EDGE_CF_INTERVAL_MS", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  tunnel.calls.length = 0;
  dns.calls.length = 0;
  await reconcileEdge(deps()); // first tick: local + CF
  expect(tunnel.calls).toEqual([["list"]]);
  expect(dns.calls).toContain("readCname:*.e.dev");
  tunnel.calls.length = 0;
  dns.calls.length = 0;
  clock.t += 5_000;
  await reconcileEdge(deps()); // too soon for anything
  expect(tunnel.calls).toEqual([]);
  expect(dns.calls).toEqual([]);
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  await reconcileEdge(deps()); // local only
  expect(tunnel.calls).toEqual([]);
  clock.t += EDGE_CF_INTERVAL_MS;
  await reconcileEdge(deps()); // CF again
  expect(tunnel.calls).toEqual([["list"]]);
});

test("a deleted wildcard record is upserted back; a correct one is left alone", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  dns.calls.length = 0;
  dns.cname.delete("*.e.dev");
  await reconcileEdge(deps());
  expect(dns.cname.get("*.e.dev")!.target).toBe("fake-uuid-1.cfargotunnel.com");
  dns.calls.length = 0;
  clock.t += EDGE_CF_INTERVAL_MS;
  await reconcileEdge(deps());
  expect(dns.calls.some((c) => c.startsWith("cname:"))).toBe(false);
});

test("a tunnel absent from list() flips tunnelGone and is NOT recreated", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  tunnel.tunnels.clear();
  await reconcileEdge(deps());
  expect(edgeDrift().tunnelGone).toBe(true);
  expect(tunnel.calls.filter((c) => c[0] === "create")).toHaveLength(1);
});

test("edgeBindingChanged clears the gone flag and the next tick runs the CF pass at once", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  tunnel.tunnels.clear();
  await reconcileEdge(deps());
  expect(edgeDrift().tunnelGone).toBe(true);
  await bindDomain("e.dev", { tunnel, manager, dns }, opts()); // the operator's re-run recreates it
  edgeBindingChanged();
  expect(edgeDrift().tunnelGone).toBe(false);
  tunnel.calls.length = 0;
  clock.t += 1_000; // well inside both intervals
  await reconcileEdge(deps());
  expect(tunnel.calls).toEqual([["list"]]);
  expect(edgeDrift().tunnelGone).toBe(false);
});

test("dns unavailable (rt daemon down) skips the CF pass without error and retries next time", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  tunnel.calls.length = 0;
  await reconcileEdge(deps({ dns: async () => null }));
  expect(tunnel.calls).toEqual([]);
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  await reconcileEdge(deps());
  expect(tunnel.calls).toEqual([["list"]]);
});

test("a throwing pass backs off EDGE_ERROR_BACKOFF_MS and the latch prevents overlap", async () => {
  await bindDomain("e.dev", { tunnel, manager, dns }, opts());
  const boom = deps({ services: async () => { throw new Error("launchctl"); } });
  await reconcileEdge(boom);
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  manager.kickstarts.length = 0;
  running = false;
  await reconcileEdge(deps()); // still inside the backoff window
  expect(manager.kickstarts).toEqual([]);
  clock.t += EDGE_ERROR_BACKOFF_MS;
  await reconcileEdge(deps());
  expect(manager.kickstarts).toEqual([TUNNEL_LABEL]);
  let resolveSlow!: () => void;
  const slow = deps({ services: () => new Promise((r) => { resolveSlow = () => r([]); }) });
  clock.t += EDGE_LOCAL_INTERVAL_MS;
  const p = reconcileEdge(slow);
  await reconcileEdge(deps()); // overlapped call returns immediately
  resolveSlow();
  await p;
});
