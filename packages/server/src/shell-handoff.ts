import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/** Appended to webview UAs by the mattstack window (compatibility contract). */
export const SHELL_UA_MARKER = ' mattstack-shell/';

export interface ShellHandoffDeps {
  sockPath?: string;
  timeoutMs?: number;
  post?: (sockPath: string, url: string, timeoutMs: number) => Promise<boolean>;
}

export function traySockPath(): string {
  return process.env.RT_APP_SOCKET ?? `${homedir()}/.mattstack/rt/tray.sock`;
}

async function postToTray(
  sockPath: string,
  url: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const res = await fetch('http://tray/window/open', {
      // Bun extension: send the request over the tray's unix socket.
      unix: sockPath,
      method: 'POST',
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit & { unix: string });
    if (!res.ok) return false;
    const body = (await res.json()) as { handled?: boolean };
    return body.handled === true;
  } catch {
    return false;
  }
}

const stubPage = (): string => `<!doctype html>
<meta charset="utf-8"><title>mattstack</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#16161e;color:#e3e7f6;font:14px -apple-system,sans-serif">
<div style="text-align:center">
  <p style="font-size:17px;margin:0 0 6px">opened in mattstack</p>
  <p style="color:#7e86ad;margin:0 0 14px">this page is showing in the mattstack window</p>
  <a href="?browser=1" style="color:#7aa2f7"
     onclick="document.cookie='mattstack_browser=1;path=/;max-age=31536000';location.href=location.pathname+location.search;return false">
    continue in browser instead</a>
</div>
<script>setTimeout(() => { try { window.close(); } catch {} }, 400);</script>`;

/**
 * Hands a top-level browser navigation on a .mattstack host to the
 * mattstack window (spec: 2026-09-15-mattstack-window-design.md §7).
 * Returns the stub Response to serve, or null to serve the app normally.
 * Every failure path returns null: fail open by construction.
 */
export async function shellHandoff(
  req: Request,
  deps: ShellHandoffDeps = {}
): Promise<Response | null> {
  if (req.method !== 'GET') return null;
  if (req.headers.get('upgrade')) return null;
  const forwarded =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!forwarded) return null;
  const host = forwarded.split(',')[0]!.trim().replace(/:\d+$/, '');
  if (!host.endsWith('.mattstack')) return null;
  const dest = req.headers.get('sec-fetch-dest');
  if (
    dest
      ? dest !== 'document'
      : !(req.headers.get('accept') ?? '').includes('text/html')
  )
    return null;
  if ((req.headers.get('user-agent') ?? '').includes(SHELL_UA_MARKER))
    return null;
  const url = new URL(req.url);
  if (url.searchParams.get('browser') === '1') return null;
  if ((req.headers.get('cookie') ?? '').includes('mattstack_browser=1'))
    return null;
  const sockPath = deps.sockPath ?? traySockPath();
  if (!existsSync(sockPath)) return null;
  const target = `https://${host}${url.pathname}${url.search}`;
  const handled = await (deps.post ?? postToTray)(
    sockPath,
    target,
    deps.timeoutMs ?? 300
  );
  if (!handled) return null;
  return new Response(stubPage(), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
