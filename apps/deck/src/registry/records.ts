import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { stateDir } from "../api/state.ts";

export interface RemoteState {
  target: "railway";
  serviceId: string;
  customDomain: string;
  /** Railway-assigned CNAME target (<id>.up.railway.app), from ensureCustomDomain; set at the verifying stage so reconcileRemote can write the CNAME. */
  cnameTarget?: string;
  /** Railway-returned TXT record name, stored so disableRemote deletes the exact record enableRemote created. */
  txtName?: string;
  status: "deploying" | "verifying" | "live" | "error";
  /** Which cutover path a real run took; set when the CNAME is written. */
  cutover?: "verified-first" | "cname-first";
  url?: string;
  lastPush?: { sha: string; dirty: boolean; at: string };
  /** Backoff gate for reconcileRemote: ISO time before which not to re-poll. */
  nextPollAt?: string;
}

export interface SyncIssue {
  source: "portless" | "launchd" | "cloudflare" | "railway" | "dev-link";
  message: string;
  at: string;
}

export interface AppRecord {
  name: string;
  /** "user" | "deck" (the platform itself; "local" pre-rename) | a manager id such as "rt". Generic: rt is just the first manager. */
  managedBy: string;
  port: number;
  /** service = Deck supervises it via launchd; external = a static port Deck only routes to. */
  kind: "service" | "external";
  command?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  /** launchd label; present for kind "service". Grandfathered records keep their legacy label. */
  label?: string;
  /** Launcher metadata, ingested from the app's mattstack.json (see
      registry/manifest.ts). Only managed products carry these. */
  displayName?: string;
  description?: string;
  /** Present once an icon has been ingested to the deck icon store. */
  icon?: { ext: "svg" };
  /** Action commands from mattstack.deck.json (shell strings), excluding `start`. Dev-mode-gated at the API for managed apps; never gated for user apps. */
  commands?: Record<string, string>;
  /** Declared serve-shape overlays; each may carry only `port` and/or `start`. */
  altConfigs?: Record<string, { port?: number; start?: string }>;
  /** The active overlay (an `altConfigs` key), if any; absent means the base serve shape. */
  activeAlt?: string;
  /** Where action commands run when it differs from workingDirectory. Only the platform sets it today. */
  sourceDirectory?: string;
  /** The developer's linked source checkout. The one stored dev value:
      serve/build/deploy commands are read live from its mattstack.deck.json. */
  dev?: { workingDirectory: string };
  grandfathered?: boolean;
  createdAt: string;
  /** Loud degradation: failed syncs land here and render on the board row. */
  issues?: SyncIssue[];
  /** Present only while the app is in remote (Railway) public-serving mode. */
  remote?: RemoteState;
}

interface RegistryFile {
  version: 1;
  apps: Record<string, AppRecord>;
}

// Computed fresh per call so tests can set LOCAL_REGISTRY_PATH after import.
// Mirrors routesPath()/settingsPath() in core. Delegates to stateDir() rather
// than re-deriving the HOME/LOCAL_STATE_DIR fallback inline -- a second copy
// of that formula previously drifted (bare `homedir()`, frozen at process
// start, never following a later HOME fake) independently of state.ts's own
// copy; importing it keeps the two from diverging again.
export function registryPath(): string {
  return process.env.LOCAL_REGISTRY_PATH ?? join(stateDir(), "registry.json");
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
// separate process (deck migrate/setup/uninstall running alongside serve) can
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
