import {
  checkHealth,
  joinApps,
  listenerFor,
  orphanServices,
  readRoutes,
  readServices,
  tailFile,
  type App,
  type Health,
  type LaunchdService,
} from "./discover.ts";

const PORT = Number(process.env.PORT ?? 7940);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dot(cls: string, label: string): string {
  return `<span class="dot ${cls}" title="${esc(label)}"></span>`;
}

function serviceCell(s: LaunchdService | null): string {
  if (!s) return `<span class="muted">no launchd service</span>`;
  const state =
    s.pid !== null
      ? `${dot("ok", "running")} pid ${s.pid}`
      : `${dot("bad", "not running")} stopped${s.lastExitStatus ? ` (exit ${s.lastExitStatus})` : ""}`;
  return `${state} <span class="muted">· ${esc(s.label.replace("com.matthewgoodwin.", ""))}</span>`;
}

function healthCell(h: Health): string {
  if (h.status === null) return `${dot("bad", "no response")} unreachable`;
  const cls = h.ok ? "ok" : "bad";
  return `${dot(cls, `HTTP ${h.status}`)} ${h.status} <span class="muted">· ${h.ms}ms</span>`;
}

async function appRow(app: App, health: Health): Promise<string> {
  const showLogs = !health.ok && app.service?.stderrPath;
  const logs = showLogs ? tailFile(app.service!.stderrPath, 12) : [];
  // Site responding while its service is stopped means something else holds
  // the port (e.g. an orphaned dev process) — name it instead of crying wolf.
  let serviceHtml = serviceCell(app.service);
  if (health.ok && app.service && app.service.pid === null) {
    const listener = await listenerFor(app.port);
    if (listener) {
      serviceHtml = `${dot("warn", "unmanaged process")} served by unmanaged <code>${esc(listener.command)}</code> pid ${listener.pid} <span class="muted">· service ${esc(app.service.label.replace("com.matthewgoodwin.", ""))} stopped</span>`;
    }
  }
  return `<tr>
    <td><a href="${esc(app.url)}">${esc(app.name)}<span class="muted">.localhost</span></a></td>
    <td class="num">${app.port}</td>
    <td>${healthCell(health)}</td>
    <td>${serviceHtml}</td>
  </tr>
  ${logs.length ? `<tr><td colspan="4"><details open><summary>recent stderr</summary><pre>${esc(logs.join("\n"))}</pre></details></td></tr>` : ""}`;
}

function orphanRow(s: LaunchdService): string {
  return `<tr>
    <td class="muted">${esc(s.label.replace("com.matthewgoodwin.", ""))}</td>
    <td class="num muted">—</td>
    <td class="muted">no route</td>
    <td>${serviceCell(s)}</td>
  </tr>`;
}

async function renderPage(): Promise<string> {
  const [routes, services] = [readRoutes(), await readServices()];
  const apps = joinApps(routes, services);
  const orphans = orphanServices(apps, services);
  const healths = await Promise.all(apps.map((a) => checkHealth(a.port)));
  const up = healths.filter((h) => h.ok).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>local apps</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
         max-width: 780px; margin: 2.5rem auto; padding: 0 1.2rem; }
  h1 { font-size: 1.15rem; margin-bottom: 0.2rem; }
  .sub { opacity: 0.6; font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
       opacity: 0.55; padding: 0.4rem 0.6rem; border-bottom: 1px solid #8884; }
  td { padding: 0.55rem 0.6rem; border-bottom: 1px solid #8883; font-size: 0.85rem; }
  td a { font-weight: 600; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .num { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .muted { opacity: 0.55; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
  .dot.ok { background: #2da44e; } .dot.bad { background: #cf222e; } .dot.warn { background: #bf8700; }
  details summary { cursor: pointer; font-size: 0.75rem; opacity: 0.7; }
  pre { font-size: 0.72rem; background: #8881; padding: 0.6rem; border-radius: 6px;
        overflow-x: auto; margin: 0.4rem 0 0; }
  h2 { font-size: 0.8rem; opacity: 0.6; text-transform: uppercase; margin-top: 2rem; }
  footer { margin-top: 2rem; font-size: 0.75rem; opacity: 0.45; }
</style>
</head>
<body>
<h1>local apps</h1>
<p class="sub">${up}/${apps.length} routes healthy · auto-refreshes every 15s</p>
<table>
<tr><th>site</th><th>port</th><th>health</th><th>launchd</th></tr>
${(await Promise.all(apps.map((a, i) => appRow(a, healths[i]!)))).join("\n")}
</table>
${orphans.length ? `<h2>services without routes</h2><table>${orphans.map(orphanRow).join("\n")}</table>` : ""}
<footer>discovered from ~/.portless/routes.json + ~/Library/LaunchAgents/com.matthewgoodwin.*</footer>
</body>
</html>`;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname !== "/") return new Response("not found", { status: 404 });
    return new Response(await renderPage(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`local-apps serving on http://localhost:${PORT}`);
