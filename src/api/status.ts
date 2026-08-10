import {
  checkHealth,
  joinApps,
  listenerFor,
  orphanServices,
  publicDomainFor,
  readRoutes,
  readServices,
  tailFile,
  type Health,
  type LaunchdService,
} from "../../core/discover.ts";
import { getAppSettings, type PortOverride } from "../../core/settings.ts";
import { checkApp, type Issue } from "../../core/preflight.ts";
import { listRecords, type SyncIssue } from "../registry/records.ts";
import { allocatePort } from "../registry/allocate.ts";

// TODO: becomes prefix-list aware in Task 5.2.
const PLIST_PREFIX = "com.matthewgoodwin.";

export interface BuildStatusOpts {
  requestHost?: string;
  port: number;
  canaryPort: number;
  proxyFreshness: "fresh" | "stale" | "unknown";
  autoHeal: { at: number; ok: boolean | null } | null;
}

export interface StatusService {
  label: string;
  short: string;
  pid: number | null;
  lastExitStatus: number | null;
  unmanaged: { pid: number; command: string } | null;
  /** Tail of recent stderr, populated only when the service looks unhealthy. */
  stderr: string[];
}

export interface StatusRow {
  name: string;
  port: number | null;
  url: string | null;
  publicUrl: string | null;
  health: Health | null;
  service: StatusService | null;
  published: boolean;
  hasPassword: boolean;
  /** A cloudflared tunnel service (infra), rendered in its own section. */
  isTunnel: boolean;
  override: PortOverride | null;
  /** Whether public traffic follows this app's override instead of its base port. */
  publicFollowsOverride: boolean;
  /**
   * Dev-server config problems that would break public traffic. Only probed for
   * apps that opted in, so it is null for everything else rather than empty.
   */
  preflight: Issue[] | null;
  /**
   * The board's own row: never port-editable. True for the board's PORT, for
   * CANARY_PORT (its route points at the canary listener mid-freshness-check),
   * and for the port on the platform's own registry record, which after
   * self-hosting bootstrap may be neither of those.
   */
  self: boolean;
  /** Registry owner, or null for a route/service the registry has no record for (pre-migrate legacy). */
  managedBy: string | null;
  issues: SyncIssue[];
  /**
   * The registry record's structural shape, for the board's edit dialog to
   * pre-fill. Null when there is no record (pre-migrate legacy row). This is
   * distinct from the top-level `record: SafeRecord` GET /api/v1/apps/:name
   * already returns -- that one is unchanged.
   *
   * command/workingDirectory are local-only: they are null whenever the request
   * arrived through a public host, whatever the record actually holds. The edit
   * dialog that consumes them only renders under canManage (local), so it never
   * misses them, while a public GET -- always allowed through, the 403 gate only
   * covers mutations -- cannot carry them out. `kind` is not sensitive.
   */
  record: { kind: "service" | "external"; command: string[] | null; workingDirectory: string | null } | null;
}

export interface Status {
  suffix: string;
  canRestart: boolean;
  canManage: boolean;
  up: number;
  total: number;
  apps: StatusRow[];
  orphans: StatusRow[];
  nextPort: number | null;
  /** True when the proxy is serving stale routes (its watcher has died). */
  proxyStale: boolean;
  /** The most recent automatic proxy restart; ok is null while it is running. */
  autoHeal: { at: number; ok: boolean | null } | null;
}

function serviceJson(
  s: LaunchdService,
  health: Health | null,
  unmanaged: { pid: number; command: string } | null,
): StatusService {
  // Show logs when the row is in a bad state: an app that failed its health
  // probe, or an unrouted service that isn't running.
  const bad = health ? !health.ok : s.pid === null;
  return {
    label: s.label,
    short: s.label.replace(PLIST_PREFIX, ""),
    pid: s.pid,
    lastExitStatus: s.lastExitStatus,
    unmanaged,
    stderr: bad ? tailFile(s.stderrPath, 12) : [],
  };
}

export async function buildStatus(opts: BuildStatusOpts): Promise<Status> {
  const [routes, services] = [readRoutes(), await readServices()];
  const apps = joinApps(routes, services, opts.requestHost);
  const publicDomain = publicDomainFor(opts.requestHost);
  const orphans = orphanServices(apps, services);
  const healths = await Promise.all(apps.map((a) => checkHealth(a.port)));

  // One read of the registry, reused for the per-row join, the self lookup and
  // the nextPort hint below.
  const records = listRecords();
  const recordsByName = new Map(records.map((r) => [r.name, r]));
  // The platform's own registry record (once migrated) may sit at any port, so
  // its row is "self" by matching that port rather than by name lookup.
  const localRecord = records.find((r) => r.managedBy === "local");

  const appRows: StatusRow[] = await Promise.all(
    apps.map(async (a, i) => {
      const health = healths[i]!;
      // A healthy route whose managed service is stopped means something else
      // holds the port — name that unmanaged process instead of crying wolf.
      const unmanaged =
        health.ok && a.service && a.service.pid === null ? await listenerFor(a.port) : null;
      const settings = getAppSettings(a.name);
      const follows = settings.publicFollowsOverride ?? false;
      // Probing costs two requests per app, so only the apps actually routing
      // public traffic at a dev server pay for it.
      const preflight =
        follows && settings.override && a.publicUrl
          ? await checkApp({
              app: a.name,
              devPort: settings.override.devPort,
              publicHost: new URL(a.publicUrl).host,
            })
          : null;
      const record = recordsByName.get(a.name);
      return {
        name: a.name,
        port: a.port,
        url: a.url,
        publicUrl: a.publicUrl,
        health,
        service: a.service ? serviceJson(a.service, health, unmanaged) : null,
        published: settings.published,
        hasPassword: !!settings.passwordHash,
        isTunnel: false,
        override: settings.override ?? null,
        publicFollowsOverride: follows,
        preflight,
        // Also matches CANARY_PORT: during a freshness check the board's route
        // points at its canary listener, and it is still the board's own row.
        self:
          a.port === opts.port ||
          a.port === opts.canaryPort ||
          (localRecord !== undefined && a.port === localRecord.port),
        managedBy: record?.managedBy ?? null,
        issues: record?.issues ?? [],
        record: record
          ? {
              kind: record.kind,
              command: publicDomain === null ? record.command ?? null : null,
              workingDirectory: publicDomain === null ? record.workingDirectory ?? null : null,
            }
          : null,
      };
    }),
  );

  const orphanRows: StatusRow[] = orphans.map((s) => ({
    name: s.label.replace(PLIST_PREFIX, ""),
    port: null,
    url: null,
    publicUrl: null,
    health: null,
    service: serviceJson(s, null, null),
    published: true,
    hasPassword: false,
    // cloudflared tunnels are infrastructure, not stray app services.
    isTunnel: s.program.some((p) => p.includes("cloudflared")),
    override: null,
    publicFollowsOverride: false,
    preflight: null,
    self: false,
    managedBy: null,
    issues: [],
    record: null,
  }));

  return {
    suffix: publicDomain ?? "localhost",
    // Restart is a local-only control: never expose it through a public tunnel.
    canRestart: publicDomain === null,
    canManage: publicDomain === null,
    up: healths.filter((h) => h.ok).length,
    total: apps.length,
    apps: appRows,
    orphans: orphanRows,
    // Advisory only, but it must not lie: use the SAME authority the actual
    // registration path uses, so a record holding a port whose alias hasn't
    // landed yet (or failed, leaving a SyncIssue) isn't advertised as free.
    nextPort: allocatePort(records, routes, services),
    proxyStale: opts.proxyFreshness === "stale",
    autoHeal: opts.autoHeal,
  };
}
