// Pure port of the Alpine `board` component (core/board.js): same strings,
// same branch order, `Date.now()` replaced by an explicit `now` parameter so
// every function here is deterministic and side-effect free.
export const REFRESH_MS = 5000;
export const RESTART_TIMEOUT_MS = 30000;
export const HEAL_RECENT_MS = 120000;
export const PROXY_WAIT_MS = 45000;

interface StatusRow {
  name: string;
  port: number | null;
  url: string | null;
  publicUrl: string | null;
  health: { ok: boolean; status: number | null; ms: number | null } | null;
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
  issues: { source: "portless" | "launchd" | "cloudflare"; message: string; at: string }[];
  record: { kind: "service" | "external"; command: string[] | null; workingDirectory: string | null } | null;
  oauth: { mode: "off" } | { mode: "emails"; emails: string[] } | { mode: "domains"; domains: string[] };
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

export function subline(data: StatusData | null): string {
  if (!data) return "loading…";
  const pub = data.apps.filter((r) => r.published).length;
  const prot = data.apps.filter((r) => r.hasPassword).length;
  const parts = [`${data.up}/${data.total} healthy`, `${pub} public`];
  if (prot) parts.push(`${prot} protected`);
  if (data.nextPort) parts.push(`next port ${data.nextPort}`);
  parts.push("auto-refreshes");
  return parts.join(" · ");
}

// Mirrors isPlatformManagedBy on the server: "local" is the pre-rename id and
// still appears on records written before the Deck rename.
export function isPlatform(managedBy: string | undefined): boolean {
  return managedBy === "deck" || managedBy === "local";
}

export function tunnelDomain(data: StatusData): string {
  return data.suffix === "localhost" ? "" : data.suffix;
}

// The apps table and the strays table share one row template in board.html.
export function sections(data: StatusData | null): { key: string; title: string | null; rows: Row[] }[] {
  const apps = data ? data.apps : [];
  const strays = data ? data.orphans.filter((r) => !r.isTunnel) : [];
  const out: { key: string; title: string | null; rows: Row[] }[] = [{ key: "apps", title: null, rows: apps }];
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
