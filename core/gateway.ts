import type { Server } from "bun";
import { readRoutes, bareName, dedupeRoutes } from "./discover.ts";
import { getAppSettings, getSecret } from "./settings.ts";
import { verifyToken, signToken, parseCookie, cookieHeader, COOKIE_NAME } from "./session.ts";
import {
  pageNothingHere, pageOffline, pageRateLimited, pageLogin,
} from "./gateway-pages.ts";
import {
  isWebSocketUpgrade, requestedProtocols, connectUpstream, upstreamUrl, wsHandler,
  type WsProxyData,
} from "./ws-proxy.ts";
import { getPlatformSettings } from "../src/api/platform-settings.ts";

export type Decision =
  | { kind: "no-route" }
  | { kind: "not-published" }
  | { kind: "needs-login"; app: string }
  | { kind: "proxy"; app: string; port: number };

/**
 * The port public traffic should reach.
 *
 * A dev-port override repoints routes.json so <name>.localhost hits whatever dev
 * process you are working on. By default public traffic does NOT follow it: a dev
 * server serves an unbuilt app, and one whose HMR client cannot reach its
 * websocket reload-loops the page. Public traffic therefore stays on the app's
 * stable base port, which the override recorded for us.
 *
 * `publicFollowsOverride` opts a single app out of that default. It is only safe
 * once that app's dev server accepts the public hostname and points HMR at 443
 * (preflight.ts checks both), so it is per-app and off unless explicitly set.
 */
export function publicPort(
  routePort: number | undefined,
  override?: { basePort: number },
  publicFollowsOverride = false,
): number | undefined {
  if (override && !publicFollowsOverride) return override.basePort;
  return routePort;
}

export function appFromHost(host: string, publicDomain: string | null, tlds: string[] = ["localhost"]): string {
  const h = host.replace(/:\d+$/, "");
  if (publicDomain && h.endsWith(`.${publicDomain}`)) return h.slice(0, -(publicDomain.length + 1));
  return bareName(h, tlds);
}

export function decide(input: {
  app: string; port: number | undefined; published: boolean;
  passwordHash?: string; passwordVersion: number; cookie?: string; secret: string;
}): Decision {
  if (input.port === undefined) return { kind: "no-route" };
  if (!input.published) return { kind: "not-published" };
  if (input.passwordHash) {
    const ok = verifyToken(input.cookie, input.app, input.passwordVersion, input.secret);
    if (!ok) return { kind: "needs-login", app: input.app };
  }
  return { kind: "proxy", app: input.app, port: input.port };
}

// --- runtime-only state below (not exercised by the pure tests) ---

let routes = new Map<string, number>();
function loadRoutes(): void {
  const map = new Map<string, number>();
  const tlds = getPlatformSettings().tlds;
  for (const r of dedupeRoutes(readRoutes(), tlds)) map.set(bareName(r.hostname, tlds), r.port);
  routes = map;
}

const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MAX = 10;
const LOCK_MS = 60_000;
const MAX_ATTEMPT_KEYS = 5000;

function rateKey(app: string, ip: string): string {
  return `${app}|${ip}`;
}
function isLocked(key: string): boolean {
  const e = attempts.get(key);
  return !!e && Date.now() < e.until;
}
function recordFailure(key: string): void {
  // Coarse memory bound: if the table is flooded with attacker-varied keys, drop it wholesale.
  if (attempts.size >= MAX_ATTEMPT_KEYS && !attempts.has(key)) attempts.clear();
  const e = attempts.get(key) ?? { count: 0, until: 0 };
  if (e.until !== 0 && Date.now() >= e.until) { e.count = 0; e.until = 0; }
  e.count += 1;
  if (e.count > WINDOW_MAX) e.until = Date.now() + LOCK_MS;
  attempts.set(key, e);
}

export function safeNext(next: string | null): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    !/[\x00-\x1f]/.test(next)
  ) {
    return next;
  }
  return "/";
}

async function proxyTo(port: number, req: Request, url: URL): Promise<Response> {
  url.hostname = "127.0.0.1";
  url.port = String(port);
  url.protocol = "http:";
  // Ask upstream for identity encoding: Bun's fetch transparently gunzips
  // compressed bodies but leaves the upstream Content-Encoding header on the
  // response, so forwarding a compressed upstream reply as-is sends browsers
  // decompressed bytes labeled gzip (ERR_CONTENT_DECODING_FAILED).
  const headers = new Headers(req.headers);
  headers.delete("accept-encoding");
  const proxyReq = new Request(url.toString(), {
    method: req.method, headers, body: req.body, redirect: "manual",
  });
  const res = await fetch(proxyReq);
  // Safeguard for upstreams that compress unconditionally: the body Bun hands
  // us is already decoded, so the encoding/length headers must not survive.
  if (res.headers.has("content-encoding")) {
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  }
  return res;
}

/**
 * Hand a websocket upgrade to the app behind `port`.
 *
 * Reached only after decide() returned `proxy`, so an app's password gate covers
 * its websockets too: an unauthenticated upgrade gets the 401 login page instead
 * of reaching this.
 */
async function proxyWebSocket(
  server: Server<WsProxyData>,
  req: Request,
  url: URL,
  port: number,
  app: string,
): Promise<Response | undefined> {
  let conn: Awaited<ReturnType<typeof connectUpstream>>;
  try {
    conn = await connectUpstream(
      upstreamUrl(port, url.pathname, url.search),
      requestedProtocols(req.headers.get("sec-websocket-protocol")),
    );
  } catch {
    return html(pageOffline(app), 502);
  }
  const negotiated = conn.upstream.protocol;
  const headers = negotiated ? { "sec-websocket-protocol": negotiated } : undefined;
  if (server.upgrade(req, { data: conn.data, headers })) return undefined;
  // Upgrade refused (a non-websocket request would have been filtered already):
  // drop the upstream socket rather than leaking it.
  try { conn.upstream.close(); } catch {}
  return html(pageOffline(app), 500);
}

const html = (body: string, status: number, extra?: Record<string, string>): Response =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

/** Returns the server so callers (tests) can stop it; production ignores it. */
export function startGateway(port = 7950): Server<WsProxyData> {
  loadRoutes();
  const watcher = setInterval(() => { try { loadRoutes(); } catch {} }, 5000);
  // Do not hold the process open on this timer alone.
  watcher.unref?.();

  const server = Bun.serve<WsProxyData>({
    port,
    hostname: "127.0.0.1",
    websocket: wsHandler,
    async fetch(req): Promise<Response | undefined> {
      const url = new URL(req.url);
      const host = req.headers.get("host") ?? "";
      const app = appFromHost(host, getPlatformSettings().publicDomain, getPlatformSettings().tlds);
      const ip = req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "?";
      const settings = getAppSettings(app);
      const secret = getSecret();
      // Public traffic ignores a dev-port override unless the app opted in; see publicPort.
      const port = publicPort(routes.get(app), settings.override, settings.publicFollowsOverride);

      // Auth submission is handled by the gateway itself, never proxied.
      if (req.method === "POST" && url.pathname === "/__auth") {
        if (port === undefined || !settings.published) {
          return html(pageNothingHere(), 404);
        }
        const form = await req.formData();
        const password = String(form.get("password") ?? "");
        const next = safeNext(String(form.get("next") ?? "/"));
        if (!settings.passwordHash) {
          // App has no password; nothing to authenticate, just proceed.
          return new Response(null, { status: 303, headers: { location: next } });
        }
        const key = rateKey(app, ip);
        if (isLocked(key)) return html(pageRateLimited(), 429);
        if (await Bun.password.verify(password, settings.passwordHash)) {
          attempts.delete(key);
          const token = signToken(app, settings.passwordVersion, secret);
          return new Response(null, { status: 303, headers: { location: next, "set-cookie": cookieHeader(token) } });
        }
        recordFailure(key);
        return html(pageLogin(app, { error: true, next }), 401);
      }

      const cookie = parseCookie(req.headers.get("cookie"), COOKIE_NAME);
      const d = decide({
        app, port, published: settings.published,
        passwordHash: settings.passwordHash, passwordVersion: settings.passwordVersion, cookie, secret,
      });

      switch (d.kind) {
        case "no-route": return html(pageNothingHere(), 404);
        case "not-published": return html(pageNothingHere(), 404);
        case "needs-login": return html(pageLogin(d.app, { next: url.pathname + url.search }), 401);
        case "proxy":
          // Upgrades cannot travel through fetch(), so they branch off here.
          if (isWebSocketUpgrade(req)) return await proxyWebSocket(server, req, url, d.port, d.app);
          try { return await proxyTo(d.port, req, url); }
          catch { return html(pageOffline(d.app), 502); }
      }
    },
  });

  console.log(`local-apps gateway serving on http://localhost:${server.port}`);
  return server;
}
