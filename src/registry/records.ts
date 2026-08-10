import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export interface SyncIssue {
  source: "portless" | "launchd" | "cloudflare";
  message: string;
  at: string;
}

export interface AppRecord {
  name: string;
  /** "user" | "local" | a manager id such as "rt". Generic: rt is just the first manager. */
  managedBy: string;
  port: number;
  /** service = Local supervises it via launchd; external = a static port Local only routes to. */
  kind: "service" | "external";
  command?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  /** launchd label; present for kind "service". Grandfathered records keep their legacy label. */
  label?: string;
  grandfathered?: boolean;
  createdAt: string;
  /** Loud degradation: failed syncs land here and render on the board row. */
  issues?: SyncIssue[];
}

interface RegistryFile {
  version: 1;
  apps: Record<string, AppRecord>;
}

// Computed fresh per call so tests can set LOCAL_REGISTRY_PATH after import.
// Mirrors routesPath()/settingsPath() in core.
export function registryPath(): string {
  return (
    process.env.LOCAL_REGISTRY_PATH ??
    join(process.env.LOCAL_STATE_DIR ?? join(homedir(), ".mattstack", "local"), "registry.json")
  );
}

let cache: RegistryFile = load();

function load(): RegistryFile {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), "utf8")) as RegistryFile;
    if (!parsed.apps) parsed.apps = {};
    return parsed;
  } catch {
    return { version: 1, apps: {} };
  }
}

/** Explicit re-read, for tests and for callers that want a fresh view. */
export function reloadRegistry(): void {
  cache = load();
}

function save(): void {
  const path = registryPath();
  mkdirSync(dirname(path), { recursive: true });
  // Atomic temp+rename is CORRECT here (unlike routes.json): nothing fs.watches
  // this file, and a torn registry would be far worse than a torn route table.
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, path);
}

export function listRecords(): AppRecord[] {
  return Object.values(cache.apps);
}

export function getRecord(name: string): AppRecord | undefined {
  return cache.apps[name];
}

// Every mutator is a read-modify-write: re-read from disk immediately before
// applying its change, because saving serializes the WHOLE cache back out. A
// separate process (local migrate/setup/uninstall running alongside serve) can
// have written since this process last loaded, and a stale-cache-modify-write
// would silently revert it. This shrinks the window to the mutation itself; it
// does not make writes atomic across processes.
export function putRecord(record: AppRecord): void {
  cache = load();
  cache.apps[record.name] = record;
  save();
}

export function deleteRecord(name: string): boolean {
  cache = load();
  if (!cache.apps[name]) return false;
  delete cache.apps[name];
  save();
  return true;
}

export function addIssue(name: string, issue: SyncIssue): void {
  cache = load();
  const r = cache.apps[name];
  if (!r) return;
  r.issues = [...(r.issues ?? []).filter((i) => i.source !== issue.source), issue];
  save();
}

export function clearIssues(name: string, source: SyncIssue["source"]): void {
  cache = load();
  const r = cache.apps[name];
  if (!r?.issues) return;
  r.issues = r.issues.filter((i) => i.source !== source);
  if (r.issues.length === 0) delete r.issues;
  save();
}
