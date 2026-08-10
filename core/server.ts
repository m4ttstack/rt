import {
  checkHealth,
  joinApps,
  listenerFor,
  nextFreePort,
  orphanServices,
  publicDomainFor,
  readRoutes,
  readServices,
  restartService,
  tailFile,
  type Health,
  type LaunchdService,
} from "./discover.ts";
import {
  getAppSettings,
  setPublished,
  setPassword,
  clearPassword,
  getOverride,
  setOverride,
  clearOverride,
  setPublicFollowsOverride,
  type PortOverride,
} from "./settings.ts";
import { checkApp, type Issue } from "./preflight.ts";
import { startGateway } from "./gateway.ts";
import { setRoutePort } from "./routes-writer.ts";
import { reconcileOnce } from "./reconcile.ts";
import {
  isAuthorized,
  startRestartDetached,
  sudoersInstallCommand,
  SUDOERS_PATH,
} from "./proxy-restart.ts";
import {
  CANARY_PATH,
  checkProxyFreshness,
  startCanaryListener,
  type Freshness,
} from "./canary.ts";
import { shouldAutoHeal } from "./auto-heal.ts";
import { boardHtml, boardJs, vendorAsset } from "./board-assets";

const PORT = Number(process.env.PORT ?? 7940);
// Second listener used only to tell whether the proxy is still reading
// routes.json. See canary.ts.
const CANARY_PORT = Number(process.env.LOCAL_APPS_CANARY_PORT ?? 7942);
const APP_NAME = process.env.LOCAL_APPS_APP_NAME ?? "apps";
const CANARY_INTERVAL_MS = 5 * 60_000;
const PLIST_PREFIX = "com.matthewgoodwin.";

interface StatusService {
  label: string;
  short: string;
  pid: number | null;
  lastExitStatus: number | null;
  unmanaged: { pid: number; command: string } | null;
  /** Tail of recent stderr, populated only when the service looks unhealthy. */
  stderr: string[];
}

interface StatusRow {
  name: string;
  port: number | null;
  url: string | null;
  publicUrl: string | null;
  health: Health | null;
  service: StatusService | null;
  published: boolean;
  hasPassword: boolean;
  /** A cloudflared tunnel service (infra), rendered in its own section. */
  isTunnel: boolean;
  override: PortOverride | null;
  /** Whether public traffic follows this app's override instead of its base port. */
  publicFollowsOverride: boolean;
  /**
   * Dev-server config problems that would break public traffic. Only probed for
   * apps that opted in, so it is null for everything else rather than empty.
   */
  preflight: Issue[] | null;
  /** The board's own row (its port === the board's PORT): never port-editable. */
  self: boolean;
}

interface Status {
  suffix: string;
  canRestart: boolean;
  canManage: boolean;
  up: number;
  total: number;
  apps: StatusRow[];
  orphans: StatusRow[];
  nextPort: number | null;
  /** True when the proxy is serving stale routes (its watcher has died). */
  proxyStale: boolean;
  /** The most recent automatic proxy restart; ok is null while it is running. */
  autoHeal: { at: number; ok: boolean | null } | null;
}

// Freshness of the proxy's route table, refreshed periodically and after any
// route write. Starts unknown; only a positive wrong answer counts as stale.
let proxyFreshness: Freshness = "unknown";
let lastHealAt = 0;
let healFailures = 0;
let autoHeal: { at: number; ok: boolean | null } | null = null;
const AUTO_HEAL = process.env.LOCAL_APPS_AUTO_HEAL !== "0";

async function measureFreshness(): Promise<Freshness> {
  try {
    return await checkProxyFreshness({
      app: APP_NAME,
      mainPort: PORT,
      canaryPort: CANARY_PORT,
    });
  } catch {
    return "unknown";
  }
}

async function runCanaryCheck(): Promise<void> {
  proxyFreshness = await measureFreshness();
  await maybeAutoHeal();
}

/**
 * Restart the proxy when it is provably serving stale routes. The policy in
 * auto-heal.ts decides whether to act; this only carries it out and records
 * whether the restart actually helped.
 */
async function maybeAutoHeal(): Promise<void> {
  const decide = {
    freshness: proxyFreshness,
    now: Date.now(),
    lastHealAt,
    consecutiveFailures: healFailures,
    enabled: AUTO_HEAL,
  };
  if (!shouldAutoHeal(decide)) return;
  // Without the sudoers rule there is nothing we can do but keep reporting it.
  if (!(await isAuthorized())) return;

  lastHealAt = Date.now();
  autoHeal = { at: lastHealAt, ok: null };
  console.log("[auto-heal] proxy is serving stale routes, restarting it");
  startRestartDetached();

  // Re-measure directly rather than via runCanaryCheck, so verifying a heal can
  // never itself trigger another one.
  setTimeout(async () => {
    proxyFreshness = await measureFreshness();
    const ok = proxyFreshness === "fresh";
    healFailures = ok ? 0 : healFailures + 1;
    autoHeal = { at: lastHealAt, ok };
    console.log(
      ok
        ? "[auto-heal] proxy restarted, routes are in sync again"
        : `[auto-heal] proxy still not in sync (${healFailures} in a row)`,
    );
  }, 15_000);
}

function serviceJson(
  s: LaunchdService,
  health: Health | null,
  unmanaged: { pid: number; command: string } | null,
): StatusService {
  // Show logs when the row is in a bad state: an app that failed its health
  // probe, or an unrouted service that isn't running.
  const bad = health ? !health.ok : s.pid === null;
  return {
    label: s.label,
    short: s.label.replace(PLIST_PREFIX, ""),
    pid: s.pid,
    lastExitStatus: s.lastExitStatus,
    unmanaged,
    stderr: bad ? tailFile(s.stderrPath, 12) : [],
  };
}

async function buildStatus(requestHost?: string): Promise<Status> {
  const [routes, services] = [readRoutes(), await readServices()];
  const apps = joinApps(routes, services, requestHost);
  const publicDomain = publicDomainFor(requestHost);
  const orphans = orphanServices(apps, services);
  const healths = await Promise.all(apps.map((a) => checkHealth(a.port)));

  const appRows: StatusRow[] = await Promise.all(
    apps.map(async (a, i) => {
      const health = healths[i]!;
      // A healthy route whose managed service is stopped means something else
      // holds the port — name that unmanaged process instead of crying wolf.
      const unmanaged =
        health.ok && a.service && a.service.pid === null ? await listenerFor(a.port) : null;
      const settings = getAppSettings(a.name);
      const follows = settings.publicFollowsOverride ?? false;
      // Probing costs two requests per app, so only the apps actually routing
      // public traffic at a dev server pay for it.
      const preflight =
        follows && settings.override
          ? await checkApp({
              app: a.name,
              devPort: settings.override.devPort,
              publicHost: new URL(a.publicUrl).host,
            })
          : null;
      return {
        name: a.name,
        port: a.port,
        url: a.url,
        publicUrl: a.publicUrl,
        health,
        service: a.service ? serviceJson(a.service, health, unmanaged) : null,
        published: settings.published,
        hasPassword: !!settings.passwordHash,
        isTunnel: false,
        override: settings.override ?? null,
        publicFollowsOverride: follows,
        preflight,
        // Also matches CANARY_PORT: during a freshness check the board's route
        // points at its canary listener, and it is still the board's own row.
        self: a.port === PORT || a.port === CANARY_PORT,
      };
    }),
  );

  const orphanRows: StatusRow[] = orphans.map((s) => ({
    name: s.label.replace(PLIST_PREFIX, ""),
    port: null,
    url: null,
    publicUrl: null,
    health: null,
    service: serviceJson(s, null, null),
    published: true,
    hasPassword: false,
    // cloudflared tunnels are infrastructure, not stray app services.
    isTunnel: s.program.some((p) => p.includes("cloudflared")),
    override: null,
    publicFollowsOverride: false,
    preflight: null,
    self: false,
  }));

  return {
    suffix: publicDomain ?? "localhost",
    // Restart is a local-only control: never expose it through a public tunnel.
    canRestart: publicDomain === null,
    canManage: publicDomain === null,
    up: healths.filter((h) => h.ok).length,
    total: apps.length,
    apps: appRows,
    orphans: orphanRows,
    nextPort: nextFreePort(routes, services),
    proxyStale: proxyFreshness === "stale",
    autoHeal,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function knownApp(app: string): Promise<boolean> {
  return readRoutes().some((r) => r.hostname.replace(/\.localhost$/, "") === app);
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/board.js") return boardJs();
    if (pathname.startsWith("/vendor/")) {
      return vendorAsset(pathname.slice("/vendor/".length)) ?? new Response("not found", { status: 404 });
    }
    // Identity endpoint the freshness check reads back through the proxy.
    if (pathname === CANARY_PATH) {
      return new Response(String(PORT), { headers: { "content-type": "text/plain" } });
    }
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? undefined;

    if (req.method === "POST" && pathname === "/restart") {
      // Local-only: a board reached through a public tunnel is read-only.
      if (publicDomainFor(host) !== null) return json({ error: "forbidden" }, 403);
      const form = await req.formData();
      const label = String(form.get("label") ?? "");
      // Whitelist against discovered services — never kickstart an arbitrary label.
      const known = (await readServices()).some((s) => s.label === label);
      if (!known) return json({ error: "unknown service" }, 400);
      const ok = await restartService(label);
      return json({ ok });
    }

    // Restart the portless proxy daemon, so route changes (dev-port overrides,
    // renumbered apps) actually reach it. Needs root, hence the scoped sudoers
    // rule; when that is missing we hand back the exact install command.
    if (req.method === "POST" && pathname === "/proxy-restart") {
      // Local-only: a board reached through a public tunnel is read-only.
      if (publicDomainFor(host) !== null) return json({ error: "forbidden" }, 403);
      if (!(await isAuthorized())) {
        return json(
          {
            ok: false,
            error: "not-authorized",
            sudoersPath: SUDOERS_PATH,
            installCommand: sudoersInstallCommand(process.env.USER ?? "matt"),
          },
          403,
        );
      }
      // Answer before restarting: the restart takes ~10s and usually kills the
      // proxy carrying this very response. The client polls for recovery.
      startRestartDetached();
      // A fresh proxy re-reads routes.json, so re-check once it is back up.
      proxyFreshness = "unknown";
      setTimeout(runCanaryCheck, 15_000);
      return json({ ok: true, restarting: true });
    }

    if (req.method === "POST" && pathname === "/publish") {
      if (publicDomainFor(host) !== null) return json({ error: "forbidden" }, 403);
      const form = await req.formData();
      const app = String(form.get("app") ?? "");
      const published = String(form.get("published") ?? "") === "true";
      if (!(await knownApp(app))) return json({ error: "unknown app" }, 400);
      await setPublished(app, published);
      return json({ ok: true });
    }

    if (req.method === "POST" && pathname === "/password") {
      if (publicDomainFor(host) !== null) return json({ error: "forbidden" }, 403);
      const form = await req.formData();
      const app = String(form.get("app") ?? "");
      const password = String(form.get("password") ?? "");
      if (!(await knownApp(app))) return json({ error: "unknown app" }, 400);
      if (password.length > 0) await setPassword(app, password);
      else await clearPassword(app);
      return json({ ok: true });
    }

    if (req.method === "POST" && pathname === "/devport") {
      // Local-only: a board reached through a public tunnel is read-only.
      if (publicDomainFor(host) !== null) return json({ error: "forbidden" }, 403);
      const form = await req.formData();
      const app = String(form.get("app") ?? "");
      const portStr = String(form.get("port") ?? "").trim();
      if (!(await knownApp(app))) return json({ error: "unknown app" }, 400);

      // The board's own row must never be port-overridden: that would repoint the
      // control plane at a dev process and take the dashboard down with it.
      const curRoute = readRoutes().find((r) => r.hostname.replace(/\.localhost$/, "") === app);
      if (curRoute?.port === PORT || getOverride(app)?.basePort === PORT) {
        return json({ error: "cannot override the board itself" }, 400);
      }

      // Blank port clears the override, restoring the captured base port.
      if (portStr === "") {
        const ov = getOverride(app);
        if (ov) {
          setRoutePort(app, ov.basePort);
          clearOverride(app);
        }
        return json({ ok: true });
      }

      const devPort = Number(portStr);
      if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
        return json({ error: "bad port" }, 400);
      }
      // Capture the base port once: never overwrite it with a dev port on re-set.
      const route = readRoutes().find((r) => r.hostname.replace(/\.localhost$/, "") === app);
      const basePort = getOverride(app)?.basePort ?? route?.port;
      if (basePort === undefined) return json({ error: "no route" }, 400);
      setRoutePort(app, devPort);
      setOverride(app, { devPort, basePort });
      // An override only takes effect on .localhost if the proxy is still
      // reading routes.json, so confirm that right when it matters.
      setTimeout(runCanaryCheck, 500);
      return json({ ok: true });
    }

    if (req.method === "POST" && pathname === "/publicdev") {
      // Local-only: a board reached through a public tunnel is read-only.
      if (publicDomainFor(host) !== null) return json({ error: "forbidden" }, 403);
      const form = await req.formData();
      const app = String(form.get("app") ?? "");
      const follows = String(form.get("follows") ?? "") === "true";
      if (!(await knownApp(app))) return json({ error: "unknown app" }, 400);
      // Meaningless without an override, and storing it would silently change
      // where public traffic goes the next time one is set.
      if (follows && !getOverride(app)) {
        return json({ error: "set a port override first" }, 400);
      }
      setPublicFollowsOverride(app, follows);
      return json({ ok: true });
    }

    if (pathname === "/api/status") return json(await buildStatus(host));

    if (pathname !== "/") return new Response("not found", { status: 404 });
    return boardHtml();
  },
});

console.log(`local-apps serving on http://localhost:${PORT}`);

// Keep active dev-port overrides sticky against other writers of routes.json
// (portless alias/prune). Writes only when a route has drifted.
setInterval(() => {
  try {
    reconcileOnce();
  } catch {}
}, 5000);

if (process.env.LOCAL_APPS_NO_GATEWAY !== "1") {
  try {
    startGateway();
  } catch (err) {
    console.error("gateway failed to start:", err);
  }
}

// Watch for the proxy's routes.json watcher dying, which would otherwise leave
// .localhost silently serving stale ports. Disabled with the gateway so tests
// and throwaway instances never touch the real proxy or bind another port.
if (process.env.LOCAL_APPS_NO_GATEWAY !== "1") {
  try {
    startCanaryListener(CANARY_PORT, PORT);
    // Let the board settle before the first flip.
    setTimeout(runCanaryCheck, 10_000);
    setInterval(runCanaryCheck, CANARY_INTERVAL_MS);
  } catch (err) {
    console.error("proxy freshness check failed to start:", err);
  }
}
