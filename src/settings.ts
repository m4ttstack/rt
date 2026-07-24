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
}

export interface SettingsFile {
  version: number;
  secret?: string;
  apps: Record<string, AppSettings>;
}

export const SETTINGS_PATH =
  process.env.LOCAL_APPS_SETTINGS_PATH ?? join(import.meta.dir, "..", "data", "settings.json");

let cache: SettingsFile = load();

function load(): SettingsFile {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as SettingsFile;
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
  const tmp = SETTINGS_PATH + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(cache, null, 2));
    renameSync(tmp, SETTINGS_PATH);
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

export function getOverrides(): Record<string, PortOverride> {
  const out: Record<string, PortOverride> = {};
  for (const [app, s] of Object.entries(cache.apps)) {
    if (s.override) out[app] = s.override;
  }
  return out;
}
