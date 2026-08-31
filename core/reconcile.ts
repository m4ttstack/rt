import { readRoutes, readServices, type PortlessRoute } from "./discover.ts";
import { getOverrides, type PortOverride } from "./settings.ts";
import { setRoutePort } from "./routes-writer.ts";
import { reconcileRemote } from "../src/edge/remote.ts";
import { RailwayCli } from "../src/edge/railway.ts";
import { CfDnsApi, type CfDns } from "../src/edge/cf-dns.ts";
import { readDeckSecrets } from "../src/edge/rt-secrets.ts";
import { getPlatformSettings } from "../src/api/platform-settings.ts";
import { listRecords } from "../src/registry/records.ts";
import { reconcileEdge } from "../src/edge/edge-reconcile.ts";
import { resolveCloudflared } from "../src/edge/domain.ts";
import { CloudflaredCli } from "../src/edge/tunnel.ts";
import { LaunchdManager } from "../src/services/launchd.ts";
import { homedir } from "os";
import { join } from "path";

export type Overrides = Record<string, PortOverride>;

// Pure: given current routes and active overrides, list the re-assertions needed
// (apps whose route port has drifted away from the intended devPort).
export function overridesToReassert(
  routes: PortlessRoute[],
  overrides: Overrides,
): Array<{ hostname: string; devPort: number }> {
  const out: Array<{ hostname: string; devPort: number }> = [];
  for (const [app, ov] of Object.entries(overrides)) {
    const route = routes.find((r) => r.hostname.replace(/\.localhost$/, "") === app);
    if (route && route.port !== ov.devPort) out.push({ hostname: app, devPort: ov.devPort });
  }
  return out;
}

// Skips the rt-daemon secrets round trip on ticks where no record is
// mid-flight to Railway -- the common case, since remote push is opt-in.
function hasPendingRemoteWork(): boolean {
  return listRecords().some((r) => r.remote?.status === "deploying" || r.remote?.status === "verifying");
}

// Driver construction/poll can throw (unconfigured secrets, Railway/CF API
// errors); caught here so a remote hiccup never takes down the shared tick
// that also re-asserts dev-port overrides.
async function reconcileRemoteTick(): Promise<void> {
  if (!hasPendingRemoteWork()) return;
  try {
    const secrets = await readDeckSecrets();
    const rc = getPlatformSettings().railway;
    // Not fully configured yet: needs both CF and Railway credentials plus the project/env.
    if (!secrets.ok || !secrets.cfApiToken || !secrets.cfZoneId || !secrets.railwayApiToken || !secrets.railwayToken || !rc) return;
    const railway = new RailwayCli({ apiToken: secrets.railwayApiToken, projectToken: secrets.railwayToken, projectId: rc.projectId, environmentId: rc.environmentId });
    const dns = new CfDnsApi({ zoneId: secrets.cfZoneId, token: secrets.cfDnsToken ?? secrets.cfApiToken });
    await reconcileRemote({ railway, dns, now: Date.now });
  } catch (err) {
    console.error("remote reconcile failed:", err);
  }
}

// dns is a factory so the rt-daemon secrets read happens only when a CF pass is due.
async function edgeDns(): Promise<CfDns | null> {
  const s = await readDeckSecrets();
  const token = s.ok ? s.cfDnsToken ?? s.cfApiToken : undefined;
  return s.ok && s.cfZoneId && token ? new CfDnsApi({ zoneId: s.cfZoneId, token }) : null;
}

async function reconcileEdgeTick(): Promise<void> {
  const cloudflaredBin = resolveCloudflared();
  if (!cloudflaredBin) return; // nothing to supervise without the binary; bind reports the install hint
  try {
    await reconcileEdge({
      tunnel: new CloudflaredCli(), manager: new LaunchdManager(), dns: edgeDns, services: () => readServices(),
      now: Date.now, cloudflaredDir: join(homedir(), ".cloudflared"), cloudflaredBin, gatewayPort: 7950,
    });
  } catch (err) {
    console.error("edge reconcile tick failed:", err);
  }
}

// Side-effectful wrapper used by the server's interval. Writes only on drift.
export async function reconcileOnce(): Promise<void> {
  for (const { hostname, devPort } of overridesToReassert(readRoutes(), getOverrides())) {
    setRoutePort(hostname, devPort);
  }
  await reconcileRemoteTick();
  await reconcileEdgeTick();
}
