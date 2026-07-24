import { readFileSync } from "fs";
import { join } from "path";
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
} from "./settings.ts";
import { startGateway } from "./gateway.ts";
import { setRoutePort } from "./routes-writer.ts";
import { reconcileOnce } from "./reconcile.ts";

const PORT = Number(process.env.PORT ?? 7940);
const PLIST_PREFIX = "com.matthewgoodwin.";
const CLIENT_JS = readFileSync(join(import.meta.dir, "client.js"), "utf8");

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
  override: { devPort: number; basePort: number } | null;
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
  };
}

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>local apps</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 1120px; margin: 3rem auto 4rem; padding: 0 1.4rem; color: CanvasText; }
  h1 { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 0.35rem; }
  .sub { opacity: 0.62; font-size: 0.85rem; margin: 0 0 1.6rem; }
  .sub .sep { opacity: 0.4; margin: 0 0.55em; }

  /* card container wrapping each table */
  .board { border: 1px solid color-mix(in srgb, CanvasText 13%, transparent);
        border-radius: 14px; overflow: hidden;
        box-shadow: 0 1px 2px color-mix(in srgb, CanvasText 7%, transparent); }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.06em;
        font-weight: 600; opacity: 0.5; padding: 0.65rem 0.8rem;
        background: color-mix(in srgb, CanvasText 3.5%, transparent);
        border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
  tbody td { padding: 0.72rem 0.8rem; font-size: 0.85rem; vertical-align: middle; }
  /* the launchd column can absorb slack so fixed columns are never clipped */
  td.svc-cell { width: 100%; }
  tbody tr + tr td { border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent); }
  tbody tr:hover td { background: color-mix(in srgb, CanvasText 3.5%, transparent); }
  /* keep the site link+launch icon and the launchd pid+name on one line */
  td.site-cell, td.svc-cell { white-space: nowrap; }

  td a.site { font-weight: 600; text-decoration: none; color: CanvasText; }
  td a.site:hover { text-decoration: underline; }
  a.launch { display: inline-flex; align-items: center; margin-left: 7px; vertical-align: middle;
        color: inherit; opacity: 0.35; text-decoration: none; }
  a.launch:hover { opacity: 0.9; text-decoration: none; }
  a.launch.off { opacity: 0.18; }
  .num { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.8rem; opacity: 0.85; }
  .muted { opacity: 0.5; }
  code { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px;
        vertical-align: 1px; }
  .dot.ok { background: #2da44e; } .dot.bad { background: #cf222e; } .dot.warn { background: #bf8700; }

  /* health status pill */
  .hpill { display: inline-flex; align-items: baseline; gap: 5px; padding: 2px 9px;
        border-radius: 20px; font-size: 0.76rem; font-weight: 600; white-space: nowrap; }
  .hpill.ok { background: color-mix(in srgb, #2da44e 15%, transparent); color: #1a7f37; }
  .hpill.bad { background: color-mix(in srgb, #cf222e 15%, transparent); color: #cf222e; }
  .hpill.restarting { align-items: center; gap: 6px;
        background: color-mix(in srgb, #bf8700 14%, transparent); color: #9a6700; }
  .hpill .muted { font-weight: 400; opacity: 0.75; }
  @media (prefers-color-scheme: dark) {
    .hpill.ok { color: #3fb950; } .hpill.bad { color: #ff7b72; } .hpill.restarting { color: #d4a72c; }
  }

  td.actions { text-align: right; width: 1%; white-space: nowrap; }
  button.restart { font: inherit; font-size: 0.95rem; line-height: 1; cursor: pointer;
        background: none; border: 1px solid #8884; border-radius: 6px; padding: 0.15rem 0.45rem;
        color: inherit; opacity: 0.55; transition: opacity .12s, border-color .12s, background .12s; }
  button.restart:hover { opacity: 1; border-color: #8888; background: #8881; }
  button.restart:disabled { opacity: 0.35; cursor: default; background: none; }

  /* manage columns (publish toggle + access) never wrap */
  td.manage { white-space: nowrap; }

  /* publish: a real on/off switch */
  button.toggle { position: relative; display: inline-block; width: 34px; height: 20px;
        border: none; background: none; padding: 0; cursor: pointer; vertical-align: middle; }
  .toggle-track { display: block; width: 34px; height: 20px; border-radius: 10px;
        background: #8883; transition: background .15s; }
  button.toggle.on .toggle-track { background: #2da44e; }
  .toggle-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0005; transition: transform .15s; }
  button.toggle.on .toggle-knob { transform: translateX(14px); }
  button.toggle:focus-visible { outline: 2px solid #2da44e; outline-offset: 3px; border-radius: 12px; }
  .manage-off { font-size: 0.78rem; opacity: 0.5; }

  /* access: lock affordances, one consistent pill-button treatment */
  .access-row { display: inline-flex; align-items: center; gap: 7px; }
  .lock-badge { display: inline-flex; align-items: center; gap: 4px;
        font-size: 0.78rem; font-weight: 600; color: #2da44e; }
  .lock-i { vertical-align: -2px; }
  button.pill { font: inherit; font-size: 0.72rem; line-height: 1; cursor: pointer;
        background: none; border: 1px solid #8884; border-radius: 5px; padding: 0.22rem 0.5rem;
        color: inherit; opacity: 0.7; transition: opacity .12s, border-color .12s, color .12s; }
  button.pill:hover { opacity: 1; border-color: #8888; }
  button.pill.danger:hover { color: #cf222e; border-color: #cf222e77; }
  button.pill.set { display: inline-flex; align-items: center; gap: 5px; }

  .spin { display: inline-block; width: 10px; height: 10px;
        border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
        border-top-color: currentColor; border-radius: 50%;
        animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* stderr hover card over the health status */
  .status.has-card { cursor: help; }
  .status.has-card .hpill { box-shadow: inset 0 0 0 1px currentColor; }
  .status { position: relative; }
  .status .card { display: none; position: absolute; top: calc(100% + 6px); left: 0; z-index: 20;
        min-width: 320px; max-width: 620px; background: Canvas; color: CanvasText;
        border: 1px solid #8886; border-radius: 8px; padding: 0.5rem 0.6rem;
        box-shadow: 0 8px 28px #0004; }
  .status.has-card:hover .card { display: block; }
  .card-h { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
        opacity: 0.55; margin-bottom: 0.35rem; }
  .card pre { font-family: ui-monospace, monospace; font-size: 0.72rem; white-space: pre;
        overflow-x: auto; margin: 0; }

  h2 { font-size: 0.7rem; font-weight: 600; opacity: 0.5; text-transform: uppercase;
        letter-spacing: 0.06em; margin: 2.25rem 0 0.7rem; }
  footer { margin-top: 2rem; font-size: 0.75rem; opacity: 0.4; }
</style>
</head>
<body>
<h1>local apps</h1>
<p class="sub" id="sub">loading…</p>
<div class="board">
<table>
<thead><tr><th>site</th><th>port</th><th>health</th><th>launchd</th><th>public</th><th>access</th><th></th></tr></thead>
<tbody id="apps"></tbody>
</table>
</div>
<div id="tunnels-wrap" style="display:none">
<h2>cloudflare tunnel</h2>
<div class="board"><table><tbody id="tunnels"></tbody></table></div>
</div>
<div id="orphans-wrap" style="display:none">
<h2>services without routes</h2>
<div class="board"><table><tbody id="orphans"></tbody></table></div>
</div>
<footer>discovered from ~/.portless/routes.json + ~/Library/LaunchAgents/com.matthewgoodwin.*</footer>
<noscript><p class="sub">this board needs JavaScript to show live status.</p></noscript>
<script>${CLIENT_JS}</script>
</body>
</html>`;

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
      return json({ ok: true });
    }

    if (pathname === "/api/status") return json(await buildStatus(host));

    if (pathname !== "/") return new Response("not found", { status: 404 });
    return new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8" } });
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
