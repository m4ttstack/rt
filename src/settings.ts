import { readFileSync, renameSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

export interface AppSettings {
  published: boolean;
  passwordHash?: string;
  passwordVersion: number;
}

export interface SettingsFile {
  version: number;
  secret?: string;
  apps: Record<string, AppSettings>;
}

export const SETTINGS_PATH =
  process.env.LOCAL_APPS_SETTINGS_PATH ?? join(import.meta.dir, "..", "data", "settings.json");

const DEFAULT: SettingsFile = { version: 1, apps: {} };

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
  Bun.write(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, SETTINGS_PATH);
}

export function getAppSettings(app: string): AppSettings {
  const entry = cache.apps[app];
  return {
    published: entry?.published ?? true,
    passwordHash: entry?.passwordHash,
    passwordVersion: entry?.passwordVersion ?? 0,
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
