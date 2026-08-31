import {
  publicDomainFor, readRoutes, readServices, restartService, tailFile, bareName, MATTSTACK_TLD,
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
import { boardHtml, boardJs, boardCss } from "../../core/board-assets.ts";
import { DECK_ICON_SVG } from "../../core/deck-icon.ts";
import { buildStatus, type StatusRow } from "./status.ts";
import { buildDiscoveryApps, iconResponse } from "./discovery.ts";
import { registerApp, unregisterApp, editApp, adoptApp, restartManagedApps, reresolveManagedApps, removeManagedApps,
  type Drivers, knownRouteApp,
} from "./register.ts";
import { getRecord, listRecords, type AppRecord, type SyncIssue } from "../registry/records.ts";
import { isPlatformManagedBy } from "../services/manager.ts";
import { migrate } from "../registry/migrate.ts";
import { convert } from "../registry/convert.ts";
import { redactedSettings, updatePlatformSettings, getPlatformSettings } from "./platform-settings.ts";
import { logsDir } from "./state.ts";
import { isDevMode } from "./dev-mode.ts";
import { startCommandRun, commandRunStatus } from "../services/command-runner.ts";
import { readLinkedManifest } from "../registry/serve-shape.ts";
import { join } from "path";
import { userInfo } from "os";
import type { TunnelDriver } from "../edge/tunnel.ts";
import { bindDomain, unbindDomain, TUNNEL_LABEL } from "../edge/domain.ts";
import { describeEdge } from "../edge/edge-health.ts";
import { edgeDrift, edgeBindingChanged } from "../edge/edge-reconcile.ts";
import { parseOAuth, setOAuth, getOAuth, oauthRequiresCf } from "../edge/oauth.ts";
import { syncOAuth } from "../edge/access.ts";
import { readDeckSecrets, type RtSecretsDeps } from "../edge/rt-secrets.ts";
import { enableRemote, disableRemote, pushRemote, resolveRemoteDrivers } from "../edge/remote.ts";
import type { RailwayDriver } from "../edge/railway.ts";
import { resolveCfDns, type CfDns } from "../edge/cf-dns.ts";
import { gitProvenance, untrackedEnvPresent } from "../edge/source.ts";

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
  /** Fake rt-secrets transport for CF Access driver tests; production omits it and reads the real daemon. */
  deckSecrets?: RtSecretsDeps;
  /** Dev-mode gate for action commands. Defaults to isDevMode in production wiring; tests inject it. */
  devMode?: () => boolean;
  /** Real RailwayCli in production; tests inject FakeRailwayDriver. See resolveRemoteDrivers. */
  railway?: RailwayDriver;
  /** Real CfDnsApi in production; tests inject FakeCfDns. See resolveRemoteDrivers. */
  dns?: CfDns;
  /** Fake `/ready` fetch for tests; production reads the connector's local metrics endpoint. */
  readyFetch?: typeof fetch;
  /** Tests inject an absolute fake path; production resolves cloudflared on the service PATH. */
  resolveCloudflared?: () => string | null;
}

/** DNS driver for the edge routes, or null when the deck secrets do not carry a zone id and a DNS-capable token. */
async function edgeDns(deps: ApiDeps): Promise<CfDns | null> {
  return deps.dns ?? (await resolveCfDns(deps.deckSecrets));
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

// hasOwnProperty, not bracket access alone: an inherited Object.prototype
// name (constructor, toString, ...) must never resolve as a command.
function ownCommand(commands: Record<string, string> | undefined, key: string): string | undefined {
  if (!commands || !Object.prototype.hasOwnProperty.call(commands, key)) return undefined;
  return commands[key];
}

const ICON_ROUTE = /^\/api\/apps\/([^/]+)\/icon$/;

/**
 * MATTSTACK_TLD is always allowed even though it is a derived cache entry
 * (tld-reconcile.ts) that may be absent from getPlatformSettings().tlds,
 * especially in an isolated test harness whose stored tlds default to
 * ["localhost"] only. getPlatformSettings().tlds carries that default plus
 * any bound custom domain.
 */
function allowedCorsTlds(): string[] {
  return [MATTSTACK_TLD, ...getPlatformSettings().tlds];
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  if (!origin) return {};
  let host: string;
  try { host = new URL(origin).hostname; } catch { return {}; }
  const allowed = allowedCorsTlds().some((t) => host === t || host.endsWith(`.${t}`));
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "vary": "origin",
  };
}

/**
 * The absolute origin the discovery API's icon URLs resolve against: deck
 * itself, on whichever tld the requesting app's own host carries (its last
 * dotted label), so an icon URL a browser fetches lands on the same tld as
 * the page that requested it. Falls back to MATTSTACK_TLD when no host is
 * available (e.g. a direct request with neither x-forwarded-host nor host).
 */
function deckBaseFor(host: string | undefined): string {
  if (!host) return `https://deck.${MATTSTACK_TLD}`;
  const labels = host.replace(/:\d+$/, "").split(".");
  return `https://deck.${labels[labels.length - 1] || MATTSTACK_TLD}`;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return {}; }
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
    // Same ownership rule as buildStatus: a managed record is a mattstack
    // product and surfaces as name.mattstack even before its route lands.
    displayTld: record.managedBy != null && record.managedBy !== "user" ? MATTSTACK_TLD : "localhost",
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
    icon: isPlatformManagedBy(record.managedBy)
      ? "/favicon.svg"
      : record.icon
        ? `/api/apps/${record.name}/icon`
        : null,
    issues: record.issues ?? [],
    record: {
      kind: record.kind,
      command: redact ? null : record.command ?? null,
      workingDirectory: redact ? null : record.workingDirectory ?? null,
    },
    oauth: getOAuth(record.name),
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

      const fixtureDir = process.env.DECK_FIXTURE || null;
      if (fixtureDir && pathname.startsWith("/api/v1/")) {
        if (pathname === "/api/v1/status" && req.method === "GET") {
          return new Response(Bun.file(join(fixtureDir, "status.json")), {
            headers: { "content-type": "application/json" },
          });
        }
        // Mutations are inert and deterministic: the DOM tests assert the REQUEST
        // (via page.route interception) and the optimistic UI, never launchd effects.
        return json({ ok: true });
      }

      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? undefined;
      const isPublic = publicDomainFor(host) !== null;
      const statusOpts = {
        requestHost: host, port: deps.port, canaryPort: deps.canaryPort,
        proxyFreshness: deps.freshness(), autoHeal: deps.autoHeal(),
        devMode: (deps.devMode ?? isDevMode)(),
        readyFetch: deps.readyFetch, edgeDrift,
      };

      // ---- static / identity (carried from core/server.ts) ----
      if (pathname === "/healthz") return new Response("ok");
      if (pathname === "/board.js") return boardJs();
      if (pathname === "/board.css") return boardCss();
      if (pathname === CANARY_PATH) {
        return new Response(String(deps.port), { headers: { "content-type": "text/plain" } });
      }
      if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
      if (pathname === "/favicon.svg") {
        return new Response(DECK_ICON_SVG, {
          headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "max-age=300" },
        });
      }

      // ---- launcher discovery API (unversioned, browser-facing, GET only, CORS) ----
      if (pathname === "/api/apps" || ICON_ROUTE.test(pathname)) {
        const cors = corsHeadersFor(req.headers.get("origin"));
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        if (pathname === "/api/apps" && req.method === "GET") {
          const base = deckBaseFor(host); // https://deck.<tld> from the request host
          const apps = (await buildDiscoveryApps(statusOpts)).map((a) => ({
            ...a,
            icon: a.icon ? `${base}/api/apps/${a.icon}/icon` : null,
          }));
          // vary: origin unconditionally, allowed or not: a browser must never
          // reuse a cached response for one origin's CORS decision on another's.
          return new Response(JSON.stringify({ apps }), {
            headers: { "content-type": "application/json", vary: "origin", ...cors },
          });
        }
        const m = pathname.match(ICON_ROUTE);
        if (m && req.method === "GET") {
          const res = iconResponse(m[1]!);
          // cache-control: max-age=300 on this response means a denied-origin
          // fetch, cached without vary, would shadow later cross-origin fetches
          // for up to 5 minutes -- vary: origin must be set even when cors is {}.
          res.headers.set("vary", "origin");
          for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
          return res;
        }
      }

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
          if (b.cfApiToken !== undefined || b.cfZoneId !== undefined) {
            return json({
              error: "cf-secrets-not-accepted",
              message: "Cloudflare credentials are no longer stored here — store with: rt secrets set deck cfApiToken "
                + "(and: rt secrets set deck cfZoneId) — interactive prompt; add --stdin when piping from a script",
            }, 400);
          }
          updatePlatformSettings({
            ...(b.publicDomain !== undefined && { publicDomain: b.publicDomain === null ? null : String(b.publicDomain) }),
            ...(Array.isArray(b.tlds) && { tlds: b.tlds.map(String) }),
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

        // Checked ahead of the generic /apps/:name matcher below so a real app
        // named "register" or "managed" can never shadow these routes.
        if (pathname === "/api/v1/apps/register" && req.method === "POST") {
          const b = await body(req);
          const { applyManifest } = await import("./register-manifest.ts");
          const r = await applyManifest(String(b.dir ?? ""), undefined, deps);
          return json(r.body, r.status);
        }
        if (pathname === "/api/v1/apps/managed/restart" && req.method === "POST") {
          const r = await restartManagedApps(deps);
          return json(r.body, r.status);
        }
        if (pathname === "/api/v1/apps/managed/reresolve" && req.method === "POST") {
          const r = await reresolveManagedApps(deps);
          return json(r.body, r.status);
        }
        if (pathname === "/api/v1/apps/managed/remove" && req.method === "POST") {
          const remoteDrivers = listRecords().some((r) => r.managedBy !== "user" && r.remote)
            ? resolveRemoteDrivers(deps, await readDeckSecrets(deps.deckSecrets))
            : {};
          const r = await removeManagedApps({ ...deps, ...remoteDrivers });
          return json(r.body, r.status);
        }

        // Action-command routes, gated per app class: user rows are never
        // mode-gated (fixes a prod over-gate), grandfathered managed rows keep
        // the dev-gated record.commands behavior verbatim, and slim managed
        // rows read commands live off the linked manifest. Production must
        // 404 exactly as if the route did not exist, so no command metadata
        // leaks off-machine.
        {
          const cm = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/commands\/([a-z0-9-]+)(?:\/([a-z0-9]+))?$/);
          if (cm) {
            const [, name, cmd, runId] = cm as unknown as [string, string, string, string | undefined];
            const record = getRecord(name);
            if (!record) return json({ error: "not found" }, 404);
            const dev = (deps.devMode ?? isDevMode)();
            let shell: string | undefined;
            let cwd: string | undefined;
            // A managed row with commands and no dev link predates the dev-link
            // migration: route it through the legacy branch, not the manifest one.
            const grandfathered = !record.dev?.workingDirectory && !!record.commands;
            if (record.managedBy === "user") {
              shell = ownCommand(record.commands, cmd);
              cwd = record.sourceDirectory ?? record.workingDirectory;
            } else if (grandfathered) {
              if (!dev) return json({ error: "not found" }, 404); // production: indistinguishable from absent
              shell = ownCommand(record.commands, cmd);
              cwd = record.sourceDirectory ?? record.workingDirectory;
            } else {
              if (!dev || !record.dev?.workingDirectory) return json({ error: "not found" }, 404);
              const link = readLinkedManifest(record);
              if (link.state !== "linked") return json({ error: "not found" }, 404); // a broken link 404s rather than failing later
              shell = ownCommand(link.manifest.dev, cmd);
              cwd = link.dir;
            }
            if (!shell) return json({ error: "not found" }, 404);

            if (runId && req.method === "GET") {
              const st = commandRunStatus(name, runId);
              return st ? json(st) : json({ error: "unknown run" }, 404);
            }
            if (!runId && req.method === "POST") {
              // A port-only (external) manifest carries commands but no workingDirectory:
              // never spawn with cwd undefined, which would run in deck's own directory.
              // The platform's service runs from the state dir but its commands
              // belong to the source checkout attached at register time.
              if (!cwd) return json({ error: "app has no manifest directory" }, 400);
              const started = startCommandRun({ name, cmd, shell, workingDirectory: cwd });
              if (!started.started) return json({ error: "busy" }, 409);
              return json({ started: true, runId: started.runId });
            }
          }
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
              const remoteDrivers = getRecord(name)?.remote
                ? resolveRemoteDrivers(deps, await readDeckSecrets(deps.deckSecrets))
                : {};
              const r = await unregisterApp(name, caller, force, { ...deps, ...remoteDrivers });
              return json(r.body, r.status);
            }
          }
          if (sub === "adopt" && req.method === "POST") {
            const b = await body(req);
            const r = await adoptApp(
              name,
              {
                as: b.as !== undefined ? String(b.as) : undefined,
                managedBy: b.managedBy !== undefined ? String(b.managedBy) : undefined,
              },
              deps,
            );
            return json(r.body, r.status);
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
          if (sub === "alt" && req.method === "POST") {
            const record = getRecord(name);
            if (!record) return json({ error: "unknown app" }, 404);
            if (!record.workingDirectory) return json({ error: "app has no manifest directory" }, 400);
            const b = await body(req);
            const alt = b.alt == null ? undefined : String(b.alt);
            const { applyManifest } = await import("./register-manifest.ts");
            const r = await applyManifest(record.workingDirectory, alt, deps);
            return json(r.body, r.status);
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
            const rule = parseOAuth(await body(req));
            if ("error" in rule) return json(rule, 400);
            if (oauthRequiresCf(rule)) {
              // A sign-in gate is a security control: sync to Cloudflare BEFORE
              // persisting, so a failed sync never leaves the board claiming a
              // gate that was never actually enforced. Silence is never success.
              const sync = await syncOAuth(name, rule, deps);
              if (!sync.ok) {
                return json({
                  error: "cloudflare-sync-failed",
                  message: sync.message ?? "Cloudflare sync failed, the previous sign-in rule is still in effect.",
                  oauth: getOAuth(name),
                }, 502);
              }
              setOAuth(name, rule);
              return json({ ok: true, oauth: rule, cfSynced: true });
            }
            // Turning sign-in off takes effect locally either way. syncOAuth still
            // tears down the Cloudflare Access app left from before, and a failure
            // there is recorded as a SyncIssue, not a reason to fail this request.
            setOAuth(name, rule);
            const sync = await syncOAuth(name, rule, deps);
            return json({ ok: true, oauth: rule, cfSynced: sync.ok });
          }
          if (sub === "remote" && req.method === "POST") {
            const b = await body(req);
            const sec = await readDeckSecrets(deps.deckSecrets);
            const settings = getPlatformSettings();
            const { railway, dns } = resolveRemoteDrivers(deps, sec);
            const result = b.enabled === true
              ? await enableRemote(name, {
                  railway, dns, token: sec.ok ? sec.railwayToken ?? "" : "",
                  projectId: settings.railway?.projectId ?? "", environmentId: settings.railway?.environmentId ?? "",
                  railwayConf: settings.railway, publicDomain: settings.publicDomain,
                  oauth: getOAuth(name), hasRailwayToken: sec.ok && !!sec.railwayToken,
                  provenance: gitProvenance, hasUntrackedEnv: untrackedEnvPresent,
                  pollBudgetMs: 600000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now,
                })
              : await disableRemote(name, { railway, dns });
            return json(result.body, result.status);
          }
          if (sub === "push" && req.method === "POST") {
            const sec = await readDeckSecrets(deps.deckSecrets);
            const settings = getPlatformSettings();
            const { railway } = resolveRemoteDrivers(deps, sec);
            const result = await pushRemote(name, {
              railway, token: sec.ok ? sec.railwayToken ?? "" : "",
              projectId: settings.railway?.projectId ?? "", environmentId: settings.railway?.environmentId ?? "",
              provenance: gitProvenance, hasUntrackedEnv: untrackedEnvPresent,
            });
            return json(result.body, result.status);
          }
        }

        if (pathname === "/api/v1/domain" && req.method === "GET") {
          const s = getPlatformSettings();
          const installed = await deps.manager.isInstalled(TUNNEL_LABEL);
          const svc = (await readServices()).find((x) => x.label === TUNNEL_LABEL);
          const edge = s.tunnel
            ? await describeEdge({ installed, running: !!svc && svc.pid !== null, tunnelGone: edgeDrift().tunnelGone, domain: s.publicDomain, fetchImpl: deps.readyFetch })
            : null;
          return json({ domain: s.publicDomain, tunnel: s.tunnel, partial: !!s.tunnel && !s.publicDomain, edge });
        }
        if (pathname === "/api/v1/domain/bind" && req.method === "POST") {
          const b = await body(req);
          const dns = await edgeDns(deps);
          if (!dns) return json({ error: "cf-secrets-required", hint: "rt secrets set deck cfZoneId / cfDnsToken" }, 400);
          const r = await bindDomain(String(b.domain ?? ""), { tunnel: deps.tunnel, manager: deps.manager, dns }, {
            gatewayPort: 7950, cloudflaredDir: deps.cloudflaredDir, force: b.force === true, resolveBin: deps.resolveCloudflared,
          });
          if (r.status === 200) edgeBindingChanged();
          return json(r.body, r.status);
        }
        if (pathname === "/api/v1/domain/unbind" && req.method === "POST") {
          const b = await body(req);
          const dns = await edgeDns(deps);
          if (!dns) return json({ error: "cf-secrets-required", hint: "rt secrets set deck cfZoneId / cfDnsToken" }, 400);
          const r = await unbindDomain({ tunnel: deps.tunnel, manager: deps.manager, dns }, { force: b.force === true, cloudflaredDir: deps.cloudflaredDir });
          if (r.status === 200) edgeBindingChanged();
          return json(r.body, r.status);
        }

        if (pathname === "/api/v1/proxy/restart" && req.method === "POST") {
          return await proxyRestart(deps);
        }

        if (pathname === "/api/v1/migrate" && req.method === "POST") {
          const b = await body(req);
          if (b.convert === true) return json(await convert({ manager: deps.manager }));
          return json(await migrate({}));
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
  const curRoute = readRoutes().find((r) => bareName(r.hostname, getPlatformSettings().tlds) === app);
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
      installCommand: sudoersInstallCommand(process.env.USER ?? userInfo().username),
    }, 403);
  }
  // Answer before restarting: the restart takes ~10s and usually kills the
  // proxy carrying this very response. The client polls for recovery.
  startRestartDetached();
  // A fresh proxy re-reads routes.json, so re-check once it is back up.
  deps.onRouteWrite();
  return json({ ok: true, restarting: true });
}
