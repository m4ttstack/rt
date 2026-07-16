import { readRoutes } from "./discover.ts";
import { getAppSettings, getSecret } from "./settings.ts";
import { verifyToken, signToken, parseCookie, cookieHeader, COOKIE_NAME } from "./session.ts";
import {
  pageNothingHere, pageNoRoute, pageOffline, pageRateLimited, pageLogin,
} from "./gateway-pages.ts";

const DOMAIN_SUFFIX = ".m4tthew.dev";
const LOCALHOST_SUFFIX = ".localhost";

export type Decision =
  | { kind: "no-route" }
  | { kind: "not-published" }
  | { kind: "needs-login"; app: string }
  | { kind: "proxy"; app: string; port: number };

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
  const proxyReq = new Request(url.toString(), {
    method: req.method, headers: req.headers, body: req.body, redirect: "manual",
  });
  return await fetch(proxyReq);
}

const html = (body: string, status: number, extra?: Record<string, string>): Response =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

export function startGateway(port = 7950): void {
  loadRoutes();
  setInterval(() => { try { loadRoutes(); } catch {} }, 5000);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const host = req.headers.get("host") ?? "";
      const app = appFromHost(host);
      const ip = req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "?";
      const settings = getAppSettings(app);
      const secret = getSecret();

      // Auth submission is handled by the gateway itself, never proxied.
      if (req.method === "POST" && url.pathname === "/__auth") {
        if (routes.get(app) === undefined || !settings.published) {
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
        app, port: routes.get(app), published: settings.published,
        passwordHash: settings.passwordHash, passwordVersion: settings.passwordVersion, cookie, secret,
      });

      switch (d.kind) {
        case "no-route": return html(pageNoRoute(), 502);
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
