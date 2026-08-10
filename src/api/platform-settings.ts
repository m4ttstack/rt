import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { stateDir } from "./state.ts";

export interface PlatformSettings {
  publicDomain: string | null;
  tlds: string[];
  legacyPrefixes: string[];
  secrets: { cfApiToken?: string; cfZoneId?: string };
}

const DEFAULTS: PlatformSettings = {
  publicDomain: null, tlds: ["localhost"], legacyPrefixes: [], secrets: {},
};

export function platformSettingsPath(): string {
  return process.env.LOCAL_PLATFORM_SETTINGS_PATH ?? join(stateDir(), "platform.json");
}

let cache: PlatformSettings = load();

function load(): PlatformSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(platformSettingsPath(), "utf8")) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function reloadPlatformSettings(): void { cache = load(); }
export function getPlatformSettings(): PlatformSettings { return cache; }

export function updatePlatformSettings(patch: Partial<PlatformSettings>): void {
  cache = { ...cache, ...patch, secrets: { ...cache.secrets, ...(patch.secrets ?? {}) } };
  const path = platformSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, path);
}

/** Secrets never transit API responses (ruled): booleans out, values never. */
export function redactedSettings() {
  const { secrets, ...rest } = cache;
  return { ...rest, hasCfToken: !!secrets.cfApiToken, hasCfZone: !!secrets.cfZoneId };
}
