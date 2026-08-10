// src/main.ts
import { startApi } from "./api/server.ts";
import { writeApiInfo } from "./api/state.ts";
import { LaunchdManager } from "./services/launchd.ts";
import { PortlessCli } from "./edge/portless.ts";
import { CloudflaredCli } from "./edge/tunnel.ts";
import { startGateway } from "../core/gateway.ts";
import {
  CANARY_PATH, checkProxyFreshness, startCanaryListener, type Freshness,
} from "../core/canary.ts";
import { shouldAutoHeal } from "../core/auto-heal.ts";
import { reconcileOnce } from "../core/reconcile.ts";
import { isAuthorized, startRestartDetached } from "../core/proxy-restart.ts";
import { listRecords } from "./registry/records.ts";

const PORT = Number(process.env.PORT ?? 7940);
const CANARY_PORT = Number(process.env.LOCAL_APPS_CANARY_PORT ?? 7942);
// The canary flips <APP_NAME>.localhost's route to a canary port and back, so
// this must be the route the platform actually owns. Once bootstrap has run
// that is the self-record's name ("local"), not the legacy default "apps".
const APP_NAME =
  process.env.LOCAL_APPS_APP_NAME ??
  (listRecords().find((r) => r.managedBy === "local")?.name ?? "apps");
const CANARY_INTERVAL_MS = 5 * 60_000;

export function serve(): void {
  // ---- canary / auto-heal state, lifted verbatim from core/server.ts ----
  let proxyFreshness: Freshness = "unknown";
  let lastHealAt = 0;
  let healFailures = 0;
  let autoHeal: { at: number; ok: boolean | null } | null = null;
  const AUTO_HEAL = process.env.LOCAL_APPS_AUTO_HEAL !== "0";

  async function measureFreshness(): Promise<Freshness> {
    try {
      return await checkProxyFreshness({ app: APP_NAME, mainPort: PORT, canaryPort: CANARY_PORT });
    } catch {
      return "unknown";
    }
  }
  async function runCanaryCheck(): Promise<void> {
    proxyFreshness = await measureFreshness();
    await maybeAutoHeal();
  }
  async function maybeAutoHeal(): Promise<void> {
    const decide = {
      freshness: proxyFreshness, now: Date.now(), lastHealAt,
      consecutiveFailures: healFailures, enabled: AUTO_HEAL,
    };
    if (!shouldAutoHeal(decide)) return;
    if (!(await isAuthorized())) return;
    lastHealAt = Date.now();
    autoHeal = { at: lastHealAt, ok: null };
    console.log("[auto-heal] proxy is serving stale routes, restarting it");
    startRestartDetached();
    setTimeout(async () => {
      proxyFreshness = await measureFreshness();
      const ok = proxyFreshness === "fresh";
      healFailures = ok ? 0 : healFailures + 1;
      autoHeal = { at: lastHealAt, ok };
      console.log(ok
        ? "[auto-heal] proxy restarted, routes are in sync again"
        : `[auto-heal] proxy still not in sync (${healFailures} in a row)`);
    }, 15_000);
  }

  startApi({
    manager: new LaunchdManager(),
    edge: new PortlessCli(),
    port: PORT,
    canaryPort: CANARY_PORT,
    freshness: () => proxyFreshness,
    autoHeal: () => autoHeal,
    onRouteWrite: () => setTimeout(runCanaryCheck, 500),
    tunnel: new CloudflaredCli(),
  });
  writeApiInfo(PORT);
  console.log(`local serving on http://localhost:${PORT}`);

  setInterval(() => { try { reconcileOnce(); } catch {} }, 5000);

  if (process.env.LOCAL_APPS_NO_GATEWAY !== "1") {
    try { startGateway(); } catch (err) { console.error("gateway failed to start:", err); }
    try {
      startCanaryListener(CANARY_PORT, PORT);
      setTimeout(runCanaryCheck, 10_000);
      setInterval(runCanaryCheck, CANARY_INTERVAL_MS);
    } catch (err) { console.error("proxy freshness check failed to start:", err); }
  }
}

const cmd = Bun.argv[2] ?? "serve";
if (cmd === "serve") serve();
else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
