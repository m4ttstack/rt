import { readFileSync } from "fs";
import { join } from "path";
import {
  checkHealth,
  joinApps,
  listenerFor,
  orphanServices,
  publicDomainFor,
  readRoutes,
  readServices,
  restartService,
  tailFile,
  type Health,
  type LaunchdService,
} from "./discover.ts";
import { getAppSettings, setPublished, setPassword, clearPassword } from "./settings.ts";
import { startGateway } from "./gateway.ts";

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
}

interface Status {
  suffix: string;
  canRestart: boolean;
  canManage: boolean;
  up: number;
  total: number;
  apps: StatusRow[];
  orphans: StatusRow[];
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
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
         max-width: 960px; margin: 2.5rem auto; padding: 0 1.2rem; }
  h1 { font-size: 1.15rem; margin-bottom: 0.2rem; }
  .sub { opacity: 0.6; font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
       opacity: 0.55; padding: 0.4rem 0.6rem; border-bottom: 1px solid #8884; }
  td { padding: 0.55rem 0.6rem; border-bottom: 1px solid #8883; font-size: 0.85rem; }
  td a { font-weight: 600; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  a.launch { display: inline-flex; align-items: center; margin-left: 7px; vertical-align: middle;
        color: inherit; opacity: 0.4; text-decoration: none; }
  a.launch:hover { opacity: 0.95; text-decoration: none; }
  a.launch.off { opacity: 0.2; }
  .num { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .muted { opacity: 0.55; }
  code { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
  .dot.ok { background: #2da44e; } .dot.bad { background: #cf222e; } .dot.warn { background: #bf8700; }

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

  /* access: lock affordances */
  .lock-badge { display: inline-flex; align-items: center; gap: 4px;
        font-size: 0.78rem; font-weight: 600; color: #2da44e; }
  .lock-i { vertical-align: -2px; }
  button.setpw { display: inline-flex; align-items: center; gap: 5px; font: inherit;
        font-size: 0.78rem; cursor: pointer; background: none; border: 1px solid #8884;
        border-radius: 6px; padding: 0.2rem 0.55rem; color: inherit; opacity: 0.7; }
  button.setpw:hover { opacity: 1; border-color: #8888; }
  button.linkbtn { font: inherit; font-size: 0.72rem; cursor: pointer; background: none;
        border: none; padding: 0 0 0 8px; color: inherit; opacity: 0.5; text-decoration: underline;
        text-underline-offset: 2px; }
  button.linkbtn:hover { opacity: 0.95; }
  button.linkbtn.danger:hover { color: #cf222e; opacity: 1; }

  .spin { display: inline-block; width: 11px; height: 11px; vertical-align: -1px;
        border: 2px solid #8884; border-top-color: #888; border-radius: 50%;
        animation: spin 0.7s linear infinite; margin-right: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* stderr hover card over the health status */
  .status.has-card { cursor: help; border-bottom: 1px dotted #8886; }
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

  h2 { font-size: 0.8rem; opacity: 0.6; text-transform: uppercase; margin-top: 2rem; }
  footer { margin-top: 2rem; font-size: 0.75rem; opacity: 0.45; }
</style>
</head>
<body>
<h1>local apps</h1>
<p class="sub" id="sub">loading…</p>
<table>
<thead><tr><th>site</th><th>port</th><th>health</th><th>launchd</th><th>public</th><th>access</th><th></th></tr></thead>
<tbody id="apps"></tbody>
</table>
<div id="orphans-wrap" style="display:none">
<h2>services without routes</h2>
<table><tbody id="orphans"></tbody></table>
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

    if (pathname === "/api/status") return json(await buildStatus(host));

    if (pathname !== "/") return new Response("not found", { status: 404 });
    return new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`local-apps serving on http://localhost:${PORT}`);

if (process.env.LOCAL_APPS_NO_GATEWAY !== "1") {
  try {
    startGateway();
  } catch (err) {
    console.error("gateway failed to start:", err);
  }
}
