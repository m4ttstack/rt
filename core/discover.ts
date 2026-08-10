import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Computed fresh on every call (not frozen at import time) so callers that set
// LOCAL_APPS_ROUTES_PATH after this module first loads (tests, in particular)
// still get the override, regardless of module load order.
export function routesPath(): string {
  return process.env.LOCAL_APPS_ROUTES_PATH ?? join(homedir(), ".portless", "routes.json");
}
// Same lazy-override pattern as routesPath() above, and as agentsDir() in
// src/services/launchd.ts (kept in sync so both readers agree in tests).
function agentsDir(): string {
  return process.env.LOCAL_AGENTS_DIR ?? join(homedir(), "Library", "LaunchAgents");
}
const PLIST_PREFIX = "com.matthewgoodwin.";
// The parent domain the shared Cloudflare tunnel serves every portless route
// under (wildcard *.PUBLIC_DOMAIN). Overridable for a different setup.
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN ?? "m4tthew.dev";

export interface PortlessRoute {
  hostname: string;
  port: number;
}

export interface LaunchdService {
  label: string;
  plistPath: string;
  program: string[];
  workingDirectory: string | null;
  stderrPath: string | null;
  /** PORT from the plist's EnvironmentVariables, the exact join key to a route. */
  port: number | null;
  /** From `launchctl list`: pid when running, null when not. */
  pid: number | null;
  /** Last exit status from launchctl list, null if never exited. */
  lastExitStatus: number | null;
}

// Managed local apps allocate ports from this range for uniformity and to avoid
// reserving common dev ports (3000, 5173, 8080, ...).
export const PORT_RANGE = { start: 11000, end: 11999 } as const;

// Lowest port in PORT_RANGE not claimed by any route or any launchd service PORT.
// Returns null only if the whole range is taken (not expected in practice).
export function nextFreePort(
  routes: PortlessRoute[],
  services: LaunchdService[],
): number | null {
  const used = new Set<number>();
  for (const r of routes) used.add(r.port);
  for (const s of services) if (s.port != null) used.add(s.port);
  for (let p = PORT_RANGE.start; p <= PORT_RANGE.end; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

/** One row on the board: a portless route joined (best-effort) to a launchd service. */
export interface App {
  name: string;
  url: string;
  /** The public tunnel URL (https://<name>.PUBLIC_DOMAIN), always set for a route. */
  publicUrl: string;
  port: number;
  service: LaunchdService | null;
}

// Last successfully parsed routes, used to ride out a torn read. routes.json is
// written in place (see routes-writer.ts, which must not use rename), so a
// reader can occasionally catch it mid-write. Returning [] then would empty the
// gateway's route table and 404 every app for a poll interval.
let lastGoodRoutes: PortlessRoute[] = [];

export function readRoutes(): PortlessRoute[] {
  try {
    const parsed = JSON.parse(readFileSync(routesPath(), "utf8"));
    if (Array.isArray(parsed)) {
      lastGoodRoutes = parsed;
      return parsed;
    }
  } catch {
    // Fall through to the last good value rather than reporting "no routes".
  }
  return lastGoodRoutes;
}

async function plistToJson(path: string): Promise<Record<string, unknown> | null> {
  const proc = Bun.spawn(["plutil", "-convert", "json", "-o", "-", path], { stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

async function launchctlPids(): Promise<Map<string, { pid: number | null; status: number }>> {
  const proc = Bun.spawn(["launchctl", "list"], { stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const map = new Map<string, { pid: number | null; status: number }>();
  for (const line of out.split("\n").slice(1)) {
    const [pid, status, label] = line.trim().split(/\t+/);
    if (!label) continue;
    map.set(label, { pid: pid === "-" ? null : Number(pid), status: Number(status) });
  }
  return map;
}

export async function readServices(): Promise<LaunchdService[]> {
  const dir = agentsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(
    (f) => f.startsWith(PLIST_PREFIX) && f.endsWith(".plist"),
  );
  const running = await launchctlPids();
  const services: LaunchdService[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const plist = await plistToJson(path);
    if (!plist) continue;
    const label = (plist["Label"] as string) ?? file.replace(".plist", "");
    const state = running.get(label);
    services.push({
      label,
      plistPath: path,
      program: (plist["ProgramArguments"] as string[]) ?? [],
      workingDirectory: (plist["WorkingDirectory"] as string) ?? null,
      stderrPath: (plist["StandardErrorPath"] as string) ?? null,
      port: Number((plist["EnvironmentVariables"] as Record<string, string>)?.["PORT"]) || null,
      pid: state?.pid ?? null,
      lastExitStatus: state && state.pid === null ? state.status : null,
    });
  }
  return services;
}

/**
 * The parent domain to show/link when the board is reached through a real domain
 * (e.g. a Cloudflare tunnel), or null for local access. Feed it the value portless
 * forwards as `x-forwarded-host` — the raw `Host` is rewritten to the 127.0.0.1
 * upstream, so relying on it renders a bogus "0.0.1" suffix.
 */
export function publicDomainFor(requestHost?: string): string | null {
  if (!requestHost) return null;
  const host = requestHost.replace(/:\d+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (/^[\d.]+$/.test(host)) return null; // bare IP address, not a domain
  const parent = host.replace(/^[^.]+\./, "");
  return parent.includes(".") ? parent : null; // require a real multi-label domain
}

/**
 * Join routes to services: exact match on the plist's PORT env var first,
 * name overlap as a fallback. Unmatched routes render without service info.
 */
export function joinApps(routes: PortlessRoute[], services: LaunchdService[], requestHost?: string): App[] {
  const domain = publicDomainFor(requestHost);
  return routes.map((route) => {
    const name = route.hostname.replace(/\.localhost$/, "");
    const service =
      services.find((s) => s.port === route.port) ??
      services.find((s) => {
        const dir = s.workingDirectory?.split("/").pop() ?? "";
        return s.label.includes(name) || dir.includes(name);
      }) ??
      null;
    const url = domain ? `https://${name}.${domain}` : `https://${route.hostname}`;
    const publicUrl = `https://${name}.${PUBLIC_DOMAIN}`;
    return { name, url, publicUrl, port: route.port, service };
  });
}

/** Services that have no portless route (e.g. the mr-board tunnel). */
export function orphanServices(apps: App[], services: LaunchdService[]): LaunchdService[] {
  const claimed = new Set(apps.map((a) => a.service?.label).filter(Boolean));
  return services.filter((s) => !claimed.has(s.label));
}

export interface Health {
  ok: boolean;
  status: number | null;
  ms: number | null;
}

/** Probe a route over http on its port directly (portless proxy adds TLS we can skip). */
export async function checkHealth(port: number): Promise<Health> {
  const started = Date.now();
  let last: Health = { ok: false, status: null, ms: null };
  for (const path of ["/healthz", "/"]) {
    try {
      const res = await fetch(`http://localhost:${port}${path}`, {
        signal: AbortSignal.timeout(3000),
        redirect: "manual",
      });
      last = { ok: res.status < 500, status: res.status, ms: Date.now() - started };
      // 404 on /healthz just means the app has no health endpoint — judge by "/".
      if (res.status !== 404) return last;
    } catch {
      // try next path
    }
  }
  return last;
}

/** The process actually listening on a port, per lsof. Null when nothing listens. */
export async function listenerFor(port: number): Promise<{ pid: number; command: string } | null> {
  const proc = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const pid = /^p(\d+)$/m.exec(out)?.[1];
  const command = /^c(.+)$/m.exec(out)?.[1];
  return pid ? { pid: Number(pid), command: command ?? "?" } : null;
}

/**
 * Restart a launchd service by label via `launchctl kickstart -k` (kills it if
 * running, then relaunches — picking up any source changes). The caller must
 * validate `label` against the discovered services first: we never restart an
 * arbitrary label. Returns true on a clean exit.
 */
export async function restartService(label: string): Promise<boolean> {
  const uid = process.getuid?.() ?? 0;
  const proc = Bun.spawn(["launchctl", "kickstart", "-k", `gui/${uid}/${label}`], {
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

export function tailFile(path: string | null, lines: number): string[] {
  if (!path || !existsSync(path)) return [];
  try {
    const content = readFileSync(path, "utf8");
    return content.split("\n").filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}
