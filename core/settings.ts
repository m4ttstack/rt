import { readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

export interface PortOverride {
  devPort: number;
  basePort: number;
}

export interface AppSettings {
  published: boolean;
  passwordHash?: string;
  passwordVersion: number;
  override?: PortOverride;
  /**
   * Let public traffic follow an active dev-port override instead of pinning to
   * the app's base port. Off by default, and a sibling of `override` rather than
   * a field inside it so the preference survives clearing and re-setting one.
   * Only apps whose dev server accepts the public hostname should turn this on;
   * see preflight.ts.
   */
  publicFollowsOverride?: boolean;
}

export interface SettingsFile {
  version: number;
  secret?: string;
  apps: Record<string, AppSettings>;
}

// Computed fresh on every call (not frozen at import time) so callers that set
// LOCAL_APPS_SETTINGS_PATH after this module first loads (tests, in particular)
// still get the override, regardless of module load order. Mirrors routesPath().
export function settingsPath(): string {
  return process.env.LOCAL_APPS_SETTINGS_PATH ?? join(import.meta.dir, "..", "data", "settings.json");
}

let cache: SettingsFile = load();

function load(): SettingsFile {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as SettingsFile;
    if (!parsed.apps) parsed.apps = {};
    return parsed;
  } catch {
    return { version: 1, apps: {} };
  }
}

export function reloadSettings(): void {
  cache = load();
}

function save(): void {
  const path = settingsPath();
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(cache, null, 2));
    renameSync(tmp, path);
  } catch (err) {
    console.error("settings save failed:", err);
    throw err;
  }
}

export function getAppSettings(app: string): AppSettings {
  const entry = cache.apps[app];
  return {
    published: entry?.published ?? true,
    passwordHash: entry?.passwordHash,
    passwordVersion: entry?.passwordVersion ?? 0,
    override: entry?.override,
    publicFollowsOverride: entry?.publicFollowsOverride ?? false,
  };
}

function ensure(app: string): AppSettings {
  if (!cache.apps[app]) cache.apps[app] = { published: true, passwordVersion: 0 };
  return cache.apps[app];
}

export function getSecret(): string {
  if (!cache.secret) {
    cache.secret = randomBytes(32).toString("hex");
    save();
  }
  return cache.secret;
}

export async function setPublished(app: string, published: boolean): Promise<void> {
  ensure(app).published = published;
  save();
}

export async function setPassword(app: string, password: string): Promise<void> {
  const entry = ensure(app);
  entry.passwordHash = await Bun.password.hash(password);
  entry.passwordVersion += 1;
  save();
}

export async function clearPassword(app: string): Promise<void> {
  const entry = ensure(app);
  delete entry.passwordHash;
  entry.passwordVersion += 1;
  save();
}

/**
 * Move an app's whole settings entry to a new key, verbatim. Renaming a record
 * has to carry published/passwordHash/passwordVersion/override with it: an
 * unknown name defaults to published:true with no password, so without this a
 * rename would silently turn a private, password-protected app public. It moves
 * the raw entry because no setter above can: setPassword only takes a plaintext
 * to re-hash, and an existing hash has no plaintext to re-derive it from.
 * A no-op when the old name has no entry (nothing to carry).
 */
export function renameAppSettings(oldName: string, newName: string): void {
  const entry = cache.apps[oldName];
  if (!entry) return;
  delete cache.apps[oldName];
  cache.apps[newName] = entry;
  save();
}

export function getOverride(app: string): PortOverride | undefined {
  return cache.apps[app]?.override;
}

export function setOverride(app: string, override: PortOverride): void {
  ensure(app).override = override;
  save();
}

export function clearOverride(app: string): void {
  const entry = cache.apps[app];
  if (entry?.override) {
    delete entry.override;
    save();
  }
}

export function getPublicFollowsOverride(app: string): boolean {
  return cache.apps[app]?.publicFollowsOverride ?? false;
}

export function setPublicFollowsOverride(app: string, follows: boolean): void {
  const entry = ensure(app);
  // Store the default as an absent key rather than `false`, so settings.json
  // stays free of noise for the apps that never opt in.
  if (follows) entry.publicFollowsOverride = true;
  else delete entry.publicFollowsOverride;
  save();
}

export function getOverrides(): Record<string, PortOverride> {
  const out: Record<string, PortOverride> = {};
  for (const [app, s] of Object.entries(cache.apps)) {
    if (s.override) out[app] = s.override;
  }
  return out;
}
