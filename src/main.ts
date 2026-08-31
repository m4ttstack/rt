// src/main.ts
import "./boot-env.ts";
import { startApi } from "./api/server.ts";
import { reconcileMattstackTld } from "./api/tld-reconcile.ts";
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
import { isPlatformManagedBy } from "./services/manager.ts";

const PORT = Number(process.env.PORT ?? 7940);
const CANARY_PORT = Number(process.env.LOCAL_APPS_CANARY_PORT ?? 7942);
// The canary flips <APP_NAME>.localhost's route to a canary port and back, so
// this must be the route the platform actually owns. Once bootstrap has run
// that is the self-record's name ("deck"), not the legacy default "apps".
const APP_NAME =
  process.env.LOCAL_APPS_APP_NAME ??
  (listRecords().find((r) => isPlatformManagedBy(r.managedBy))?.name ?? "apps");
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

  const apiServer = startApi({
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
  console.log(`Deck serving on http://localhost:${PORT}`);

  // Ownership-driven TLD rehome: every managed record (mattstack product)
  // surfaces on name.mattstack; the tlds cache is then re-derived from the
  // routes that actually exist -- tlds is a derived cache of portless state,
  // never hand-authored configuration.
  try { reconcileMattstackTld(); } catch (err) { console.error("mattstack-tld reconcile failed:", err); }

  const reconcileInterval = setInterval(() => { reconcileOnce().catch((err) => console.error("reconcile tick failed:", err)); }, 5000);

  let gatewayServer: ReturnType<typeof startGateway> | null = null;
  let canaryServer: ReturnType<typeof startCanaryListener> | null = null;
  let canaryInterval: ReturnType<typeof setInterval> | null = null;
  let canaryTimeout: ReturnType<typeof setTimeout> | null = null;

  if (process.env.LOCAL_APPS_NO_GATEWAY !== "1") {
    try { gatewayServer = startGateway(); } catch (err) { console.error("gateway failed to start:", err); }
    try {
      canaryServer = startCanaryListener(CANARY_PORT, PORT);
      canaryTimeout = setTimeout(runCanaryCheck, 10_000);
      canaryInterval = setInterval(runCanaryCheck, CANARY_INTERVAL_MS);
    } catch (err) { console.error("proxy freshness check failed to start:", err); }
  }

  // Graceful shutdown (installer checklist item 5): Sparkle replaces the
  // whole bundle on update (this process's inode vanishes mid-run) and
  // launchd sends SIGTERM before its kill grace period expires either way.
  // Supervised apps (`deck add --cmd`) are NOT a shutdown concern here --
  // LaunchdManager.install() only ever does `launchctl load` and returns;
  // launchd itself owns and re-supervises those processes independently of
  // deck's own lifetime, so there is no child handle here to orphan. What
  // this closes is deck's own three listeners (api/gateway/canary) and its
  // two background timers, so /healthz stops answering and the ports are
  // actually released rather than lingering past process exit.
  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(reconcileInterval);
    if (canaryInterval) clearInterval(canaryInterval);
    if (canaryTimeout) clearTimeout(canaryTimeout);
    try { canaryServer?.stop(); } catch { /* already stopped */ }
    try { gatewayServer?.stop(); } catch { /* already stopped */ }
    try { apiServer.stop(); } catch { /* already stopped */ }
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const cmd = Bun.argv[2] ?? "serve";
if (cmd === "serve") serve();
else if (cmd === "setup") {
  const { setup } = await import("./cli/setup.ts");
  const drivers = { manager: new LaunchdManager(), edge: new PortlessCli() };
  process.exit(await setup(drivers, { out: console.log, err: console.error }));
} else if (cmd === "uninstall") {
  const { uninstall } = await import("./cli/setup.ts");
  const drivers = { manager: new LaunchdManager(), edge: new PortlessCli() };
  const force = Bun.argv.includes("--force");
  process.exit(await uninstall(drivers, { out: console.log, err: console.error }, { force }));
} else if (cmd === "update") {
  const { update } = await import("./cli/update.ts");
  process.exit(await update({ out: console.log, err: console.error }));
} else {
  const { runCommand } = await import("./cli/commands.ts");
  process.exit(await runCommand(Bun.argv.slice(2), { out: console.log, err: console.error }));
}
