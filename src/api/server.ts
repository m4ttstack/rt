import {
  publicDomainFor, readRoutes, readServices, restartService, tailFile,
} from "../../core/discover.ts";
import {
  setPublished, setPassword, clearPassword, getOverride, setOverride,
  clearOverride, setPublicFollowsOverride,
} from "../../core/settings.ts";
import { setRoutePort } from "../../core/routes-writer.ts";
import {
  isAuthorized, startRestartDetached, sudoersInstallCommand, SUDOERS_PATH,
} from "../../core/proxy-restart.ts";
import { CANARY_PATH } from "../../core/canary.ts";
import { boardHtml, boardJs, vendorAsset } from "../../core/board-assets.ts";
import { buildStatus } from "./status.ts";
import { registerApp, unregisterApp, editApp, type Drivers } from "./register.ts";
import { getRecord, listRecords } from "../registry/records.ts";
import { logsDir } from "./state.ts";
import { join } from "path";

export interface ApiDeps extends Drivers {
  port: number;
  canaryPort: number;
  freshness(): "fresh" | "stale" | "unknown";
  autoHeal(): { at: number; ok: boolean | null } | null;
  /** Called after any routes.json write so the canary can re-verify. */
  onRouteWrite(): void;
}

export function callerOf(req: Request): string {
  return req.headers.get("x-local-caller")?.trim() || "user";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return {}; }
}

function knownRouteApp(app: string): boolean {
  return readRoutes().some((r) => r.hostname.split(".")[0] === app);
}

export function startApi(deps: ApiDeps) {
  return Bun.serve({
    port: deps.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? undefined;
      const isPublic = publicDomainFor(host) !== null;
      const statusOpts = {
        requestHost: host, port: deps.port, canaryPort: deps.canaryPort,
        proxyFreshness: deps.freshness(), autoHeal: deps.autoHeal(),
      };

      // ---- static / identity (carried from core/server.ts) ----
      if (pathname === "/healthz") return new Response("ok");
      if (pathname === "/board.js") return boardJs();
      if (pathname.startsWith("/vendor/")) {
        return vendorAsset(pathname.slice("/vendor/".length)) ?? new Response("not found", { status: 404 });
      }
      if (pathname === CANARY_PATH) {
        return new Response(String(deps.port), { headers: { "content-type": "text/plain" } });
      }
      if (pathname === "/favicon.ico") return new Response(null, { status: 204 });

      // ---- versioned API ----
      if (pathname.startsWith("/api/v1/")) {
        if (req.method !== "GET" && isPublic) return json({ error: "forbidden" }, 403);
        const caller = callerOf(req);
        const force = url.searchParams.get("force") === "true";

        if (pathname === "/api/v1/status" && req.method === "GET") {
          return json(await buildStatus(statusOpts));
        }
        if (pathname === "/api/v1/apps" && req.method === "GET") {
          // Registry-only: the raw list of what's registered, independent of
          // whether a route/health probe exists yet. /api/v1/status is the
          // richer, route-joined dashboard view.
          return json({ apps: listRecords() });
        }
        if (pathname === "/api/v1/apps" && req.method === "POST") {
          const b = await body(req);
          const r = await registerApp(
            {
              name: String(b.name ?? ""),
              managedBy: b.managedBy !== undefined ? String(b.managedBy) : caller === "user" ? "user" : caller,
              command: Array.isArray(b.command) ? b.command.map(String) : undefined,
              workingDirectory: b.workingDirectory !== undefined ? String(b.workingDirectory) : undefined,
              env: b.env as Record<string, string> | undefined,
              staticPort: b.staticPort !== undefined ? Number(b.staticPort) : undefined,
              adopt: b.adopt === true,
            },
            deps,
          );
          return json(r.body, r.status);
        }

        const m = pathname.match(/^\/api\/v1\/apps\/([^/]+)(?:\/([a-z-]+))?$/);
        if (m) {
          const [, name, sub] = m as unknown as [string, string, string | undefined];
          if (!sub) {
            if (req.method === "GET") {
              const record = getRecord(name);
              if (!record) return json({ error: "unknown app" }, 404);
              const row = (await buildStatus(statusOpts)).apps.find((a) => a.name === name) ?? null;
              return json({ record, row });
            }
            if (req.method === "PATCH") {
              const r = await editApp(name, (await body(req)) as never, caller, force, deps);
              return json(r.body, r.status);
            }
            if (req.method === "DELETE") {
              const r = await unregisterApp(name, caller, force, deps);
              return json(r.body, r.status);
            }
          }
          if (sub === "restart" && req.method === "POST") {
            const record = getRecord(name);
            // Records restart via their label; legacy rows still restart via the
            // discovered-services whitelist exactly like the old /restart.
            if (record?.label) return json({ ok: await deps.manager.kickstart(record.label) });
            const svc = (await readServices()).find((s) => s.label.endsWith(`.${name}`) || s.label.split(".").pop() === name);
            if (!svc) return json({ error: "unknown app" }, 404);
            return json({ ok: await restartService(svc.label) });
          }
          if (sub === "logs" && req.method === "GET") {
            const lines = Number(url.searchParams.get("lines") ?? 40);
            const record = getRecord(name);
            const stderrPath = record ? join(logsDir(), `${name}.err.log`) : null;
            const svc = (await readServices()).find((s) => s.port === record?.port || s.label.split(".").pop() === name);
            return json({
              stderr: tailFile(stderrPath ?? svc?.stderrPath ?? null, lines),
            });
          }
          if (sub === "publish" && req.method === "PUT") {
            const b = await body(req);
            if (!getRecord(name) && !knownRouteApp(name)) return json({ error: "unknown app" }, 404);
            await setPublished(name, b.published === true);
            return json({ ok: true });
          }
          if (sub === "password" && req.method === "PUT") {
            const b = await body(req);
            if (!getRecord(name) && !knownRouteApp(name)) return json({ error: "unknown app" }, 404);
            const pw = b.password == null ? "" : String(b.password);
            if (pw.length > 0) await setPassword(name, pw);
            else await clearPassword(name);
            return json({ ok: true });
          }
          if (sub === "override" && req.method === "PUT") {
            const b = await body(req);
            const [respBody, status] = await applyOverride(name, b.devPort, deps);
            return json(respBody, status);
          }
          if (sub === "public-follows-override" && req.method === "PUT") {
            const b = await body(req);
            if (!getRecord(name) && !knownRouteApp(name)) return json({ error: "unknown app" }, 404);
            if (b.follows === true && !getOverride(name)) {
              return json({ error: "set a port override first" }, 400);
            }
            setPublicFollowsOverride(name, b.follows === true);
            return json({ ok: true });
          }
        }

        if (pathname === "/api/v1/proxy/restart" && req.method === "POST") {
          return await proxyRestart(deps);
        }
        return json({ error: "not found" }, 404);
      }

      // ---- legacy endpoints, carried verbatim from core/server.ts (removed in 3.1) ----
      // Lifted from core/server.ts lines 287-403, with buildStatus(host) ->
      // buildStatus(statusOpts), the runCanaryCheck setTimeout calls ->
      // deps.onRouteWrite(), and PORT -> deps.port. The devport handler routes
      // through applyOverride, the rule set shared with PUT /api/v1/.../override,
      // so the two paths cannot drift while both exist.

      if (req.method === "POST" && pathname === "/restart") {
        // Local-only: a board reached through a public tunnel is read-only.
        if (isPublic) return json({ error: "forbidden" }, 403);
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
        if (isPublic) return json({ error: "forbidden" }, 403);
        return await proxyRestart(deps);
      }

      if (req.method === "POST" && pathname === "/publish") {
        if (isPublic) return json({ error: "forbidden" }, 403);
        const form = await req.formData();
        const app = String(form.get("app") ?? "");
        const published = String(form.get("published") ?? "") === "true";
        if (!knownRouteApp(app)) return json({ error: "unknown app" }, 400);
        await setPublished(app, published);
        return json({ ok: true });
      }

      if (req.method === "POST" && pathname === "/password") {
        if (isPublic) return json({ error: "forbidden" }, 403);
        const form = await req.formData();
        const app = String(form.get("app") ?? "");
        const password = String(form.get("password") ?? "");
        if (!knownRouteApp(app)) return json({ error: "unknown app" }, 400);
        if (password.length > 0) await setPassword(app, password);
        else await clearPassword(app);
        return json({ ok: true });
      }

      if (req.method === "POST" && pathname === "/devport") {
        // Local-only: a board reached through a public tunnel is read-only.
        if (isPublic) return json({ error: "forbidden" }, 403);
        const form = await req.formData();
        const app = String(form.get("app") ?? "");
        const portStr = String(form.get("port") ?? "").trim();
        if (!knownRouteApp(app)) return json({ error: "unknown app" }, 400);
        const [respBody, status] = await applyOverride(app, portStr, deps);
        return json(respBody, status);
      }

      if (req.method === "POST" && pathname === "/publicdev") {
        // Local-only: a board reached through a public tunnel is read-only.
        if (isPublic) return json({ error: "forbidden" }, 403);
        const form = await req.formData();
        const app = String(form.get("app") ?? "");
        const follows = String(form.get("follows") ?? "") === "true";
        if (!knownRouteApp(app)) return json({ error: "unknown app" }, 400);
        // Meaningless without an override, and storing it would silently change
        // where public traffic goes the next time one is set.
        if (follows && !getOverride(app)) {
          return json({ error: "set a port override first" }, 400);
        }
        setPublicFollowsOverride(app, follows);
        return json({ ok: true });
      }

      if (pathname === "/api/status") return json(await buildStatus(statusOpts));
      if (pathname !== "/") return new Response("not found", { status: 404 });
      return boardHtml();
    },
  });
}

/** The devport rule set, shared by PUT /override and legacy POST /devport. */
async function applyOverride(
  app: string,
  devPortRaw: unknown,
  deps: ApiDeps,
): Promise<[unknown, number]> {
  if (!getRecord(app) && !knownRouteApp(app)) return [{ error: "unknown app" }, 404];
  const curRoute = readRoutes().find((r) => r.hostname.split(".")[0] === app);
  // The board's own row must never be port-overridden: that would repoint the
  // control plane at a dev process and take the dashboard down with it.
  if (curRoute?.port === deps.port || getOverride(app)?.basePort === deps.port) {
    return [{ error: "cannot override the board itself" }, 400];
  }
  // Blank/null port clears the override, restoring the captured base port.
  if (devPortRaw == null || devPortRaw === "") {
    const ov = getOverride(app);
    if (ov) { setRoutePort(app, ov.basePort); clearOverride(app); deps.onRouteWrite(); }
    return [{ ok: true }, 200];
  }
  const devPort = Number(devPortRaw);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) return [{ error: "bad port" }, 400];
  // Capture the base port once: never overwrite it with a dev port on re-set.
  const basePort = getOverride(app)?.basePort ?? curRoute?.port;
  if (basePort === undefined) return [{ error: "no route" }, 400];
  setRoutePort(app, devPort);
  setOverride(app, { devPort, basePort });
  // An override only takes effect on .localhost if the proxy is still reading
  // routes.json, so confirm that right when it matters.
  deps.onRouteWrite();
  return [{ ok: true }, 200];
}

async function proxyRestart(deps: ApiDeps): Promise<Response> {
  if (!(await isAuthorized())) {
    return json({
      ok: false, error: "not-authorized", sudoersPath: SUDOERS_PATH,
      installCommand: sudoersInstallCommand(process.env.USER ?? "user"),
    }, 403);
  }
  // Answer before restarting: the restart takes ~10s and usually kills the
  // proxy carrying this very response. The client polls for recovery.
  startRestartDetached();
  // A fresh proxy re-reads routes.json, so re-check once it is back up.
  deps.onRouteWrite();
  return json({ ok: true, restarting: true });
}
