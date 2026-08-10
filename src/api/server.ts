import {
  publicDomainFor, readRoutes, readServices, restartService, tailFile,
} from "../../core/discover.ts";
import {
  setPublished, setPassword, clearPassword, getOverride, setOverride,
  clearOverride, setPublicFollowsOverride, getAppSettings,
} from "../../core/settings.ts";
import { setRoutePort } from "../../core/routes-writer.ts";
import {
  isAuthorized, startRestartDetached, sudoersInstallCommand, SUDOERS_PATH,
} from "../../core/proxy-restart.ts";
import { CANARY_PATH } from "../../core/canary.ts";
import { boardHtml, boardJs, vendorAsset } from "../../core/board-assets.ts";
import { buildStatus, type StatusRow } from "./status.ts";
import { registerApp, unregisterApp, editApp, type Drivers } from "./register.ts";
import { getRecord, listRecords, type AppRecord, type SyncIssue } from "../registry/records.ts";
import { redactedSettings, updatePlatformSettings, getPlatformSettings } from "./platform-settings.ts";
import { logsDir } from "./state.ts";
import { join } from "path";
import type { TunnelDriver } from "../edge/tunnel.ts";
import { bindDomain, TUNNEL_LABEL } from "../edge/domain.ts";
import { parseTier, setTier, getTier } from "../edge/access-tiers.ts";
import { syncAccessTier } from "../edge/access.ts";

export interface ApiDeps extends Drivers {
  port: number;
  canaryPort: number;
  freshness(): "fresh" | "stale" | "unknown";
  autoHeal(): { at: number; ok: boolean | null } | null;
  /** Called after any routes.json write so the canary can re-verify. */
  onRouteWrite(): void;
  tunnel: TunnelDriver;
  /** Where cert.pem / tunnel config live. Tests point this at a scratch dir; production omits it (~/.cloudflared). */
  cloudflaredDir?: string;
  /** Fake fetch for CF Access driver tests; production omits it and falls back to global fetch. */
  accessFetch?: typeof fetch;
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

/**
 * An AppRecord with everything an API response must not carry stripped out:
 * env VALUES (real secrets once the add-app form populates them) and the
 * local-only command/workingDirectory. Redaction is unconditional, because
 * GETs are always allowed through, public host or not, so there is no caller
 * policy to gate on. envKeys names the variables an app has, never the values.
 */
export interface SafeRecord {
  name: string;
  managedBy: string;
  port: number;
  kind: AppRecord["kind"];
  label?: string;
  grandfathered?: boolean;
  createdAt: string;
  issues: SyncIssue[];
  envKeys: string[];
}

function safeRecord(record: AppRecord): SafeRecord {
  return {
    name: record.name,
    managedBy: record.managedBy,
    port: record.port,
    kind: record.kind,
    ...(record.label !== undefined && { label: record.label }),
    ...(record.grandfathered !== undefined && { grandfathered: record.grandfathered }),
    createdAt: record.createdAt,
    issues: record.issues ?? [],
    envKeys: Object.keys(record.env ?? {}),
  };
}

/**
 * A record's live (route-joined, health-probed) StatusRow when one exists. A
 * record with no route yet (just-registered, before the edge driver's alias
 * lands) has no row to join against; synthesize a "not yet live" stand-in using
 * ONLY the same safe, non-secret StatusRow fields — never spread the raw
 * AppRecord, which carries command/env/workingDirectory. Shared by the list and
 * single-record endpoints so the two shapes cannot drift apart.
 *
 * `redact` mirrors buildStatus: the row's `record` shape feeds the board's
 * local-only edit dialog, so through a public host command/workingDirectory
 * must be null here exactly as they are on a joined row.
 */
function rowFor(record: AppRecord, byName: Map<string, StatusRow>, redact: boolean): StatusRow {
  return byName.get(record.name) ?? {
    name: record.name,
    port: record.port,
    url: null,
    publicUrl: null,
    health: null,
    service: null,
    published: false,
    hasPassword: false,
    isTunnel: false,
    override: null,
    publicFollowsOverride: false,
    preflight: null,
    self: false,
    managedBy: record.managedBy,
    issues: record.issues ?? [],
    record: {
      kind: record.kind,
      command: redact ? null : record.command ?? null,
      workingDirectory: redact ? null : record.workingDirectory ?? null,
    },
    accessTier: getTier(record.name),
  };
}

function rowsByName(rows: StatusRow[]): Map<string, StatusRow> {
  return new Map(rows.map((r) => [r.name, r]));
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
          // Every registered record, through the shared safe-row join.
          const byName = rowsByName((await buildStatus(statusOpts)).apps);
          const apps: StatusRow[] = listRecords().map((record) => rowFor(record, byName, isPublic));
          return json({ apps });
        }
        if (pathname === "/api/v1/settings" && req.method === "GET") {
          return json(redactedSettings());
        }
        if (pathname === "/api/v1/settings" && req.method === "PUT") {
          const b = await body(req);
          updatePlatformSettings({
            ...(b.publicDomain !== undefined && { publicDomain: b.publicDomain === null ? null : String(b.publicDomain) }),
            ...(Array.isArray(b.tlds) && { tlds: b.tlds.map(String) }),
            secrets: {
              ...(b.cfApiToken !== undefined && { cfApiToken: String(b.cfApiToken) }),
              ...(b.cfZoneId !== undefined && { cfZoneId: String(b.cfZoneId) }),
            },
          });
          return json(redactedSettings());
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
              // Same join and the same redaction the list endpoint uses: the
              // raw AppRecord (env values, command, workingDirectory) never
              // transits an API response.
              const byName = rowsByName((await buildStatus(statusOpts)).apps);
              return json({ record: safeRecord(record), row: rowFor(record, byName, isPublic) });
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
          if (sub === "access" && req.method === "PUT") {
            if (!getRecord(name) && !knownRouteApp(name)) return json({ error: "unknown app" }, 404);
            const tier = parseTier(await body(req));
            if ("error" in tier) return json(tier, 400);
            if (tier.tier === "password" && !getAppSettings(name).passwordHash) {
              return json({ error: "password-not-set", message: "Set a password first — the password tier is the gateway's own gate." }, 409);
            }
            setTier(name, tier);
            const sync = await syncAccessTier(name, tier, deps);
            return json({ ok: true, tier, cfSynced: sync.ok });
          }
        }

        if (pathname === "/api/v1/domain" && req.method === "GET") {
          const s = getPlatformSettings();
          return json({
            domain: s.publicDomain,
            tunnelInstalled: await deps.manager.isInstalled(TUNNEL_LABEL),
          });
        }
        if (pathname === "/api/v1/domain/bind" && req.method === "POST") {
          const b = await body(req);
          const r = await bindDomain(String(b.domain ?? ""), deps, {
            gatewayPort: 7950,
            cloudflaredDir: deps.cloudflaredDir,
          });
          return json(r.body, r.status);
        }

        if (pathname === "/api/v1/proxy/restart" && req.method === "POST") {
          return await proxyRestart(deps);
        }
        return json({ error: "not found" }, 404);
      }

      // /api/status: kept for one release as a GET-only status alias while any
      // stale client caches finish rolling over to GET /api/v1/status. Every
      // legacy POST endpoint (mutations) is gone -- the board is now a pure
      // /api/v1 client (Local v1 task 3.1).
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
      installCommand: sudoersInstallCommand(process.env.USER ?? "matt"),
    }, 403);
  }
  // Answer before restarting: the restart takes ~10s and usually kills the
  // proxy carrying this very response. The client polls for recovery.
  startRestartDetached();
  // A fresh proxy re-reads routes.json, so re-check once it is back up.
  deps.onRouteWrite();
  return json({ ok: true, restarting: true });
}
