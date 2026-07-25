import { readRoutes } from "./discover.ts";
import { getAppSettings, getSecret } from "./settings.ts";
import { verifyToken, signToken, parseCookie, cookieHeader, COOKIE_NAME } from "./session.ts";
import {
  pageNothingHere, pageOffline, pageRateLimited, pageLogin,
} from "./gateway-pages.ts";

const DOMAIN_SUFFIX = ".m4tthew.dev";
const LOCALHOST_SUFFIX = ".localhost";

export type Decision =
  | { kind: "no-route" }
  | { kind: "not-published" }
  | { kind: "needs-login"; app: string }
  | { kind: "proxy"; app: string; port: number };

/**
 * The port public traffic should reach.
 *
 * A dev-port override is a local affordance: it repoints routes.json so
 * <name>.localhost hits whatever dev process you are working on. Public traffic
 * must NOT follow it. A dev server serves an unbuilt app whose HMR client cannot
 * reach its websocket through the tunnel, so the page reloads forever, and it
 * would expose a dev build to the internet besides. Public traffic therefore
 * stays on the app's stable base port, which the override recorded for us.
 */
export function publicPort(
  routePort: number | undefined,
  override?: { basePort: number },
): number | undefined {
  if (override) return override.basePort;
  return routePort;
}

export function appFromHost(host: string): string {
  const h = host.replace(/:\d+$/, "");
  if (h.endsWith(DOMAIN_SUFFIX)) return h.slice(0, -DOMAIN_SUFFIX.length);
  if (h.endsWith(LOCALHOST_SUFFIX)) return h.slice(0, -LOCALHOST_SUFFIX.length);
  return h;
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
  for (const r of readRoutes()) map.set(r.hostname.replace(/\.localhost$/, ""), r.port);
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

const html = (body: string, status: number, extra?: Record<string, string>): Response =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

export function startGateway(port = 7950): void {
  loadRoutes();
  setInterval(() => { try { loadRoutes(); } catch {} }, 5000);

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const host = req.headers.get("host") ?? "";
      const app = appFromHost(host);
      const ip = req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "?";
      const settings = getAppSettings(app);
      const secret = getSecret();
      // Public traffic ignores a dev-port override; see publicPort.
      const port = publicPort(routes.get(app), settings.override);

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
          try { return await proxyTo(d.port, req, url); }
          catch { return html(pageOffline(d.app), 502); }
      }
    },
  });

  console.log(`local-apps gateway serving on http://localhost:${port}`);
}
