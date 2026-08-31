// Pure port of the Alpine `board` component (core/board.js): same strings,
// same branch order, `Date.now()` replaced by an explicit `now` parameter so
// every function here is deterministic and side-effect free.
export const REFRESH_MS = 5000;
export const RESTART_TIMEOUT_MS = 30000;
export const HEAL_RECENT_MS = 120000;
export const PROXY_WAIT_MS = 45000;

interface StatusRow {
  name: string;
  /** TLD the row identity renders under; null when the row has no hostname. */
  displayTld: string | null;
  port: number | null;
  url: string | null;
  publicUrl: string | null;
  health: { ok: boolean; status: number | null; ms: number | null; tone?: "ok" | "warn" | "bad"; detail?: string; hint?: string } | null;
  service: {
    label: string;
    short: string;
    pid: number | null;
    lastExitStatus: number | null;
    unmanaged: { pid: number; command: string } | null;
    stderr: string[];
  } | null;
  published: boolean;
  hasPassword: boolean;
  /** A cloudflared tunnel service (infra), rendered in its own section. */
  isTunnel: boolean;
  override: { devPort: number; basePort: number } | null;
  publicFollowsOverride: boolean;
  preflight: { code: string; message: string; fix?: string }[] | null;
  self: boolean;
  managedBy: string | null;
  /** URL of the app's icon (the mattstack mark), null for unmanaged apps. */
  icon: string | null;
  issues: { source: "portless" | "launchd" | "cloudflare" | "dev-link"; message: string; at: string }[];
  record: { kind: "service" | "external"; command: string[] | null; workingDirectory: string | null } | null;
  oauth: { mode: "off" } | { mode: "emails"; emails: string[] } | { mode: "domains"; domains: string[] };
  /** Names of manifest-defined commands the server has gated in for this row;
      absent or empty renders no command buttons. */
  commands?: string[];
  /** Managed rows in dev mode only: drives the board's Link source / fix link affordances. */
  devLink?: "unlinked" | "linked" | "broken";
  /** Which origin serves this row's public traffic -- the cloudflared tunnel
      (default) or, once pushed live, Railway directly. */
  publicOrigin: "tunnel" | "railway";
  /** Non-null once the app has ever been pushed toward Railway; null means
      remote was never turned on for this row. */
  remote: { status: "deploying" | "verifying" | "live" | "error"; url: string | null } | null;
}

export interface StatusData {
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

export type Row = StatusData["apps"][number];
export type RestartingMap = Record<string, { pid: number | null; at: number }>;
export type Notice = { kind: "ok" | "bad"; message: string; command?: string };

function healthyFraction(data: StatusData): string {
  return `${data.up} of ${data.total} healthy`;
}

export function subline(data: StatusData | null): string {
  if (!data) return "loading…";
  const pub = data.apps.filter((r) => r.published).length;
  const prot = data.apps.filter((r) => r.hasPassword).length;
  const parts = [healthyFraction(data), `${pub} public`];
  if (prot) parts.push(`${prot} protected`);
  return parts.join(" · ");
}

// Split out so the stat strip can tone the fraction independently of the
// rest of the subline (ok when every app is healthy, bad otherwise).
export function sublineHealthy(data: StatusData): { text: string; ok: boolean } {
  return { text: healthyFraction(data), ok: data.up === data.total };
}

// Mirrors isPlatformManagedBy on the server: "local" is the pre-rename id and
// still appears on records written before the Deck rename.
export function isPlatform(managedBy: string | undefined): boolean {
  return managedBy === "deck" || managedBy === "local";
}

export function tunnelDomain(data: StatusData): string {
  return data.suffix === "localhost" ? "" : data.suffix;
}

/** A mattstack-managed product: owned by rt or by the platform itself (deck),
    as opposed to a user-added app. These get the mattstack section and icons. */
export function isMattstack(row: Row): boolean {
  return row.managedBy != null && row.managedBy !== "user";
}

// The apps tables and the strays table share one row template in board.html.
export function sections(data: StatusData | null): { key: string; title: string | null; rows: Row[] }[] {
  const apps = data ? data.apps : [];
  const strays = data ? data.orphans.filter((r) => !r.isTunnel) : [];
  // Platform (deck) sorts to the head of its own group; the rest alphabetical.
  const mattstack = apps
    .filter(isMattstack)
    .sort(
      (a, b) =>
        Number(!isPlatform(a.managedBy ?? undefined)) - Number(!isPlatform(b.managedBy ?? undefined)) ||
        a.name.localeCompare(b.name),
    );
  const yours = apps.filter((r) => !isMattstack(r));
  const out: { key: string; title: string | null; rows: Row[] }[] = [];
  if (mattstack.length) out.push({ key: "mattstack", title: "mattstack", rows: mattstack });
  // The "your apps" heading only earns its place once a mattstack group sits
  // above it; as the sole list it needs no label. Keep an (even empty) list
  // section when there is no mattstack group, matching the pre-split board.
  if (yours.length || !mattstack.length) {
    out.push({ key: "apps", title: mattstack.length ? "your apps" : null, rows: yours });
  }
  if (strays.length) out.push({ key: "strays", title: "services without routes", rows: strays });
  return out;
}

export function tunnels(data: StatusData | null): Row[] {
  return data ? data.orphans.filter((r) => r.isTunnel) : [];
}

// Clear a restarting flag once the service is back with a NEW pid and
// healthy, or when it has clearly got stuck: a spinner that never resolves is
// worse than no spinner.
export function reconcileRestarting(restarting: RestartingMap, data: StatusData, now: number): RestartingMap {
  const rows = [...data.apps, ...data.orphans];
  const next: RestartingMap = { ...restarting };
  for (const [label, st] of Object.entries(restarting)) {
    const row = rows.find((r) => r.service && r.service.label === label) || null;
    const pid = row && row.service ? row.service.pid : null;
    const healthy = row ? (row.health ? row.health.ok : pid !== null) : false;
    const restarted = pid !== null && pid !== st.pid && healthy;
    if (restarted || now - st.at > RESTART_TIMEOUT_MS) delete next[label];
  }
  return next;
}

// The automatic banner: an auto-restart in progress, one that just happened,
// or a stale proxy nothing is fixing.
export function autoBanner(data: StatusData, now: number): Notice | null {
  const heal = data.autoHeal;
  const recent = heal !== null && now - heal.at < HEAL_RECENT_MS;
  const at = heal ? new Date(heal.at).toLocaleTimeString() : "";
  if (recent && heal && heal.ok === null) {
    return { kind: "bad", message: `.localhost routes were stale. Restarting the proxy automatically (${at})…` };
  }
  if (data.proxyStale) {
    return {
      kind: "bad",
      message:
        ".localhost routes are stale. The proxy stopped following routes.json, " +
        "so overrides and renumbered apps are not reaching it. " +
        "Click reload proxy to resync.",
    };
  }
  if (recent && heal && heal.ok) {
    return { kind: "ok", message: `Routes were stale; the proxy was restarted automatically at ${at}.` };
  }
  return null;
}

export function addPayload(m: {
  name: string;
  external: boolean;
  command: string;
  workingDirectory: string;
  staticPort: string;
}): unknown {
  return m.external
    ? { name: m.name.trim(), staticPort: Number(m.staticPort) }
    : {
        name: m.name.trim(),
        // Whitespace split is the honest 90% case; commands needing shell
        // quoting belong in a wrapper script, same rule the skill used.
        command: m.command.trim().split(/\s+/),
        workingDirectory: m.workingDirectory.trim(),
      };
}

export function editPatch(m: {
  name: string;
  port: string;
  kind: string;
  command: string;
  workingDirectory: string;
}): unknown {
  const patch: Record<string, unknown> = { name: m.name.trim(), port: Number(m.port) };
  if (m.kind === "service") {
    patch.command = m.command.trim().split(/\s+/);
    patch.workingDirectory = m.workingDirectory.trim();
  }
  return patch;
}
