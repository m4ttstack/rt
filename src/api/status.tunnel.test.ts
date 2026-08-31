import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-status-tunnel-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, "settings.json");
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, "platform.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_AGENTS_DIR = mkdtempSync(join(tmpdir(), "local-status-tunnel-agents-"));
process.env.LOCAL_LAUNCHCTL_PIDS = ""; // fixture plists carry real labels; never read the machine's launchctl
process.env.HOME = dir;

const { buildStatus, serviceJson } = await import("./status.ts");
const { reloadRegistry } = await import("../registry/records.ts");
const { updatePlatformSettings, reloadPlatformSettings } = await import("./platform-settings.ts");
const { renderPlist } = await import("../services/plist.ts");
const { tunnelServiceSpec, TUNNEL_LABEL } = await import("../edge/domain.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  rmSync(process.env.LOCAL_PLATFORM_SETTINGS_PATH!, { force: true });
  process.env.HOME = mkdtempSync(join(tmpdir(), "local-status-tunnel-home-"));
  reloadRegistry();
  reloadPlatformSettings();
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, JSON.stringify([]));
  writeFileSync(
    join(process.env.LOCAL_AGENTS_DIR!, "com.mattstack.deck.tunnel.plist"),
    renderPlist(tunnelServiceSpec({ configPath: "/x/tunnel.yml", cloudflaredBin: "/opt/homebrew/bin/cloudflared" })),
  );
});

test("the deck tunnel row carries edge health when a domain is bound", async () => {
  updatePlatformSettings({ publicDomain: "e.dev", tunnel: { name: "deck-edge-x-abc123", uuid: "u" } });
  const s = await buildStatus({ port: 1, canaryPort: 2, proxyFreshness: "unknown", autoHeal: null, readyFetch: (async () => Response.json({ status: 200, readyConnections: 3 })) as any });
  const row = s.orphans.find((r) => r.isTunnel)!;
  expect(row.service!.label).toBe("com.mattstack.deck.tunnel");
  expect(row.health).toMatchObject({ tone: "bad", detail: "stopped" });
});

test("no bound domain: the tunnel row keeps health null", async () => {
  const s = await buildStatus({ port: 1, canaryPort: 2, proxyFreshness: "unknown", autoHeal: null });
  expect(s.orphans.find((r) => r.isTunnel)!.health).toBeNull();
});

// buildStatus derives `pid` from a real `launchctl list`, which never actually
// runs the tunnel label in this harness, so a running-but-disconnected tunnel
// can't be produced end to end. This unit-covers the intent directly: a
// tunnel whose process IS running (pid set) but whose edge health reports
// unhealthy must still surface its stderr tail, not the pid-based fallback.
test("serviceJson: a running tunnel with unhealthy edge health surfaces stderr, not silence", () => {
  const stderrPath = join(dir, "tunnel.err.log");
  writeFileSync(stderrPath, "ERR: connection refused\n");
  const svc = {
    label: TUNNEL_LABEL,
    plistPath: "",
    program: ["/opt/homebrew/bin/cloudflared"],
    workingDirectory: null,
    stderrPath,
    port: null,
    pid: 4242,
    lastExitStatus: null,
  };
  const disconnected = { ok: false, tone: "warn" as const, detail: "not connected to Cloudflare", status: null, ms: null };
  const svcJson = serviceJson(svc, disconnected, null);
  expect(svcJson.stderr).toEqual(["ERR: connection refused"]);
});
