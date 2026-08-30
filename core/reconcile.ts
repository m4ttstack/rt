import { readRoutes, type PortlessRoute } from "./discover.ts";
import { getOverrides, type PortOverride } from "./settings.ts";
import { setRoutePort } from "./routes-writer.ts";
import { reconcileRemote } from "../src/edge/remote.ts";
import { RailwayCli } from "../src/edge/railway.ts";
import { CfDnsApi } from "../src/edge/cf-dns.ts";
import { readDeckSecrets } from "../src/edge/rt-secrets.ts";
import { listRecords } from "../src/registry/records.ts";

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
    if (!secrets.ok || !secrets.cfApiToken || !secrets.cfZoneId) return; // not configured yet; nothing to reconcile against
    const railway = new RailwayCli();
    const dns = new CfDnsApi({ zoneId: secrets.cfZoneId, token: secrets.cfApiToken });
    await reconcileRemote({ railway, dns, now: Date.now });
  } catch (err) {
    console.error("remote reconcile failed:", err);
  }
}

// Side-effectful wrapper used by the server's interval. Writes only on drift.
export async function reconcileOnce(): Promise<void> {
  for (const { hostname, devPort } of overridesToReassert(readRoutes(), getOverrides())) {
    setRoutePort(hostname, devPort);
  }
  await reconcileRemoteTick();
}
