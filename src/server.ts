import { join } from "path";
import { GitLabProvider } from "@forge-glance/sdk";
import { loadConfig, loadGitLabToken } from "./config.ts";
import { buildGroups } from "./data.ts";
import { SnapshotCache } from "./cache.ts";

const config = loadConfig();
const provider = new GitLabProvider(config.gitlabHost, loadGitLabToken());

const cache = new SnapshotCache(async () => {
  const prs = await provider.fetchPullRequests({ state: "opened" });
  return buildGroups(prs, config);
});

// Bundle the React client once at startup; served from memory.
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "client.tsx")],
  target: "browser",
  minify: true,
});
if (!build.success) {
  console.error(build.logs.join("\n"));
  throw new Error("client bundle failed");
}
const appJs = await build.outputs[0]!.text();

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${config.title.replace(/</g, "&lt;")}</title>
<script>
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => {
    const mode = localStorage.getItem("mrs-theme") ?? "system";
    const dark = mode === "dark" || (mode === "system" && mq.matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  applyTheme();
  mq.addEventListener("change", applyTheme);
  window.__applyTheme = applyTheme;
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  /* ── palette: tokyo day / tokyo night ─────────────────────────────── */
  :root {
    --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color-scheme: light;
    --bg: #e1e2e7; --panel: #eff0f5; --border: #c8cad6; --border-soft: #d5d7e2;
    --fg: #343b58; --muted: #8990b3; --accent: #2e7de9; --card: #f6f6fa;
    --green: #587539; --red: #f52a65; --amber: #8c6c3e; --purple: #7847bd; --cyan: #007197;
    --grid-line: rgba(52, 59, 88, 0.05);
  }
  :root.dark {
    color-scheme: dark;
    --bg: #16161e; --panel: #1f2335; --border: #2f334d; --border-soft: #292e44;
    --fg: #c0caf5; --muted: #565f89; --accent: #7aa2f7; --card: #262b41;
    --green: #9ece6a; --red: #f7768e; --amber: #e0af68; --purple: #bb9af7; --cyan: #7dcfff;
    --grid-line: rgba(122, 162, 247, 0.045);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    font: 13.5px/1.55 var(--font-mono);
    background: var(--bg); color: var(--fg);
    background-image:
      linear-gradient(var(--grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
    background-size: 28px 28px;
  }

  .tui { max-width: 980px; margin: 0 auto; padding: 2.5rem 1.25rem 2rem; }
  .tui-wide { max-width: 1160px; }

  /* ── header ───────────────────────────────────────────────────────── */
  .tui-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.6rem; }
  .tui-header h1 { font-size: 1.15rem; font-weight: 700; letter-spacing: 0.02em; margin: 0; }
  .tui-prompt { color: var(--accent); }
  .tui-sub { margin: 0.15rem 0 0; }
  .tui-comment { color: var(--muted); font-size: 0.78rem; opacity: 0.9; }
  .tui-controls { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .tui-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .tui-seg button {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0.3rem 0.45rem; cursor: pointer;
    background: transparent; border: none; color: var(--muted);
  }
  .tui-seg button + button { border-left: 1px solid var(--border); }
  .tui-seg button.active { background: var(--accent); color: var(--bg); font-weight: 700; }
  .tui-seg button:not(.active):hover { color: var(--fg); }

  /* ── panels (TUI frame with label on the border) ──────────────────── */
  .tui-panel {
    position: relative; border: 1px solid var(--border); border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
    padding: 1.1rem 0 0.3rem; margin: 1.5rem 0 1.8rem;
  }
  .tui-panel-title {
    position: absolute; top: -0.72em; left: 0.9rem;
    background: var(--bg); padding: 0 0.5rem;
    font-size: 0.74rem; font-weight: 700; letter-spacing: 0.04em; color: var(--accent);
  }
  .tui-panel-count { color: var(--muted); font-weight: 400; }

  /* ── rows ─────────────────────────────────────────────────────────── */
  .tui-row { padding: 0.5rem 1rem 0.55rem 1.4rem; cursor: pointer; position: relative; }
  .tui-row + .tui-row { border-top: 1px solid var(--border-soft); }
  .tui-row:hover { background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .tui-row:hover::before {
    content: "❯"; position: absolute; left: 0.45rem; top: 0.5rem; color: var(--accent);
  }
  .tui-row-1 { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
  .tui-iid { color: var(--muted); font-size: 0.78rem; flex-shrink: 0; }
  .tui-title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tui-row-2 { display: flex; align-items: baseline; gap: 0.55rem; color: var(--muted); font-size: 0.76rem; margin-top: 0.1rem; }
  .tui-branch { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tui-arrow { color: var(--muted); opacity: 0.7; }

  /* ── status dot + tooltip ─────────────────────────────────────────── */
  .tui-dot.ok { color: var(--green); }
  .tui-dot.warn { color: var(--amber); }
  .tui-dot.bad { color: var(--red); }
  .tui-dot-wrap { position: relative; flex-shrink: 0; }
  .tui-dot-wrap::after {
    content: attr(data-tip);
    position: absolute; left: 0; top: 1.5em; z-index: 10;
    white-space: pre-line; width: max-content; max-width: 320px;
    font-size: 0.74rem; line-height: 1.5; text-align: left; font-weight: 400;
    background: var(--panel); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 0.45rem 0.7rem;
    opacity: 0; visibility: hidden; transition: opacity 0.1s ease 0.15s;
    pointer-events: none;
  }
  .tui-dot-wrap:hover::after { opacity: 1; visibility: visible; }

  /* ── tokens ───────────────────────────────────────────────────────── */
  .tui-phrase { font-size: 0.76rem; flex-shrink: 0; white-space: nowrap; }
  .tui-meta { display: inline-flex; gap: 0.8rem; font-size: 0.76rem; flex-shrink: 0; white-space: nowrap; }
  .t-ok { color: var(--green); } .t-bad { color: var(--red); } .t-warn { color: var(--amber); }
  .t-cyan { color: var(--cyan); } .t-muted { color: var(--muted); } .t-accent { color: var(--accent); }
  .t-dim .t-ok, .t-dim .t-bad { opacity: 0.75; }

  /* ── ticket link ──────────────────────────────────────────────────── */
  .tui-ticket { color: var(--purple); opacity: 0.75; flex-shrink: 0; align-self: center; display: inline-flex; padding: 0.15rem; }
  .tui-ticket:hover { opacity: 1; }

  /* ── watching strip ───────────────────────────────────────────────── */
  .tui-watching { color: var(--amber); font: 500 0.78rem/1.5 var(--font-sans); margin-top: 0.2rem; }

  /* ── grid / cards ─────────────────────────────────────────────────── */
  .tui-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 1.1rem; padding: 0.5rem 1rem 0.8rem; }
  .tui-card {
    position: relative; border: 1px solid var(--border); border-radius: 8px;
    background: var(--card); padding: 1rem 0.9rem 0.7rem; cursor: pointer;
    display: flex; flex-direction: column;
  }
  .tui-card:hover { border-color: var(--accent); }
  .tui-card-label {
    position: absolute; top: -0.72em; left: 0.7rem;
    background: var(--card); padding: 0 0.45rem;
    font-size: 0.74rem; color: var(--muted);
    display: inline-flex; gap: 0.4rem; align-items: baseline;
  }
  .tui-card-title { font-weight: 600; font-size: 0.85rem; line-height: 1.4; margin-bottom: 0.2rem; }
  .tui-card-branch { color: var(--muted); font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tui-card-tokens { margin-top: 0.4rem; }
  .tui-blockers { list-style: none; margin: auto 0 0; padding: 0.45rem 0.6rem; border-left: 2px solid var(--amber); background: color-mix(in srgb, var(--amber) 7%, transparent); font-size: 0.75rem; color: var(--fg); }
  .tui-card-tokens { margin-bottom: 0.5rem; }
  .tui-blockers li { opacity: 0.85; }

  /* ── chrome ───────────────────────────────────────────────────────── */
  .tui-banner {
    color: var(--amber); border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
    border-radius: 6px; padding: 0.45rem 0.8rem; font: 500 0.82rem/1.5 var(--font-sans); margin-bottom: 1rem;
    background: color-mix(in srgb, var(--amber) 7%, transparent);
  }
  .tui-empty { color: var(--muted); font: 500 0.9rem/1.5 var(--font-sans); text-align: center; margin-top: 3.5rem; }
  .tui-loading { color: var(--muted); text-align: center; margin-top: 4rem; }
  .tui-footer { color: var(--muted); font: 500 0.76rem/1.5 var(--font-sans); text-align: center; margin-top: 2.2rem; opacity: 0.8; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

Bun.serve({
  port: config.port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    switch (pathname) {
      case "/healthz":
        return new Response("ok");
      case "/":
        return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
      case "/app.js":
        return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      case "/data.json": {
        const snapshot = await cache.get();
        return new Response(JSON.stringify({ title: config.title, ...snapshot }), {
          headers: { "content-type": "application/json" },
        });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

console.log(`mr-board serving on http://localhost:${config.port}`);
