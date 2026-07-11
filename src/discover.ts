import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROUTES_PATH = join(homedir(), ".portless", "routes.json");
const AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PREFIX = "com.matthewgoodwin.";

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

/** One row on the board: a portless route joined (best-effort) to a launchd service. */
export interface App {
  name: string;
  url: string;
  port: number;
  service: LaunchdService | null;
}

export function readRoutes(): PortlessRoute[] {
  try {
    return JSON.parse(readFileSync(ROUTES_PATH, "utf8"));
  } catch {
    return [];
  }
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
  if (!existsSync(AGENTS_DIR)) return [];
  const files = readdirSync(AGENTS_DIR).filter(
    (f) => f.startsWith(PLIST_PREFIX) && f.endsWith(".plist"),
  );
  const running = await launchctlPids();
  const services: LaunchdService[] = [];
  for (const file of files) {
    const path = join(AGENTS_DIR, file);
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
 * Join routes to services: exact match on the plist's PORT env var first,
 * name overlap as a fallback. Unmatched routes render without service info.
 */
export function joinApps(routes: PortlessRoute[], services: LaunchdService[]): App[] {
  return routes.map((route) => {
    const name = route.hostname.replace(/\.localhost$/, "");
    const service =
      services.find((s) => s.port === route.port) ??
      services.find((s) => {
        const dir = s.workingDirectory?.split("/").pop() ?? "";
        return s.label.includes(name) || dir.includes(name);
      }) ??
      null;
    return { name, url: `https://${route.hostname}`, port: route.port, service };
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

export function tailFile(path: string | null, lines: number): string[] {
  if (!path || !existsSync(path)) return [];
  try {
    const content = readFileSync(path, "utf8");
    return content.split("\n").filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}
