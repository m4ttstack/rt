// Served in place of the board while it has no config, so a machine whose
// team has no board settings yet shows a setup page instead of a process
// launchd restarts every few seconds. Exiting 0 once configured hands the port
// back to launchd's KeepAlive, which starts the real board.

const SETUP_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Board</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f7f8; --fg: #1d1d22; --muted: #5d5d69; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16161b; --fg: #ececf1; --muted: #a0a0ad; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; }
  main { max-width: 34rem; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 12px; color: var(--muted); }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<main>
  <h1>Board isn't set up yet</h1>
  <p>Board lists your team's open GitLab merge requests. It starts on its own once your team's board settings exist: join a team that has them, or set <code>board.gitlabHost</code>, <code>board.projects</code> and <code>board.members</code> with <code>rt settings</code>.</p>
  <p>This page checks again every few seconds.</p>
</main>
<script>
  // The real board answers /healthz with plain "ok"; a fetch error is the
  // restart gap between this server exiting and the board binding the port.
  setInterval(async () => {
    try {
      const body = await (await fetch('/healthz', { cache: 'no-store' })).text();
      if (!body.includes('"configured":false')) location.reload();
    } catch {}
  }, 5000);
</script>
</body>
</html>
`;

export function unconfiguredResponse(req: Request): Response {
  const path = new URL(req.url).pathname;
  if (path === '/healthz')
    return Response.json({ ok: true, configured: false });
  if (path.startsWith('/api/')) {
    return Response.json({ error: 'board is not set up yet' }, { status: 503 });
  }
  return new Response(SETUP_PAGE, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export interface UnconfiguredOptions {
  port: number;
  pollMs: number;
  isConfigured: () => boolean;
  exit: (code: number) => void;
}

export function serveUnconfigured(opts: UnconfiguredOptions): {
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port: opts.port,
    hostname: '127.0.0.1',
    fetch: unconfiguredResponse,
  });
  const stop = () => {
    clearInterval(timer);
    server.stop(true);
  };
  const timer = setInterval(() => {
    let configured = false;
    try {
      configured = opts.isConfigured();
    } catch {
      configured = false;
    }
    if (!configured) return;
    stop();
    opts.exit(0);
  }, opts.pollMs);
  return { port: server.port ?? opts.port, stop };
}
