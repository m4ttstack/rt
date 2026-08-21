import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { stateDir } from "./state.ts";
import { getSetting, setSetting } from "@mattstack/rt-client";

export interface PlatformSettings {
  publicDomain: string | null;
  tlds: string[];
  legacyPrefixes: string[];
  secrets: { cfApiToken?: string; cfZoneId?: string };
}

const DEFAULTS: PlatformSettings = {
  publicDomain: null, tlds: ["localhost"], legacyPrefixes: [], secrets: {},
};

const STORE_KEY = "deck.platform";
type MigratedFields = Pick<PlatformSettings, "publicDomain" | "legacyPrefixes">;
const MIGRATED_KEYS: (keyof MigratedFields)[] = ["publicDomain", "legacyPrefixes"];

export function platformSettingsPath(): string {
  return process.env.LOCAL_PLATFORM_SETTINGS_PATH ?? join(stateDir(), "platform.json");
}

type GetSettingFn = typeof getSetting;

/**
 * Transition fallback for deck.platform (MAT-384): store wins PER FIELD over
 * platform.json; a field the store doesn't carry falls back to the file's
 * value; a resolver throw degrades to the file's values entirely (fail-open),
 * warning once. `resolve` defaults to the real resolver; tests inject a
 * throwing stand-in to cover the fail-open path without touching real state.
 * Delete this function whole at cutover, once the file no longer carries
 * these fields.
 */
function withPlatformStoreFallback(fileValues: MigratedFields, resolve: GetSettingFn): MigratedFields {
  let store: Partial<MigratedFields>;
  try {
    store = (resolve<Partial<MigratedFields>>(STORE_KEY).value ?? {}) as Partial<MigratedFields>;
  } catch (err) {
    console.warn(`deck: ${STORE_KEY} unavailable, falling back to platform.json`, err);
    return fileValues;
  }
  return {
    publicDomain: store.publicDomain !== undefined ? store.publicDomain : fileValues.publicDomain,
    legacyPrefixes: store.legacyPrefixes !== undefined ? store.legacyPrefixes : fileValues.legacyPrefixes,
  };
}

let cache: PlatformSettings = load(getSetting);

function load(resolve: GetSettingFn): PlatformSettings {
  let fileValues: PlatformSettings;
  try {
    fileValues = { ...DEFAULTS, ...JSON.parse(readFileSync(platformSettingsPath(), "utf8")) };
  } catch {
    fileValues = structuredClone(DEFAULTS);
  }
  return { ...fileValues, ...withPlatformStoreFallback(fileValues, resolve) };
}

export function reloadPlatformSettings(resolve: GetSettingFn = getSetting): void { cache = load(resolve); }
export function getPlatformSettings(): PlatformSettings { return cache; }

export function updatePlatformSettings(patch: Partial<PlatformSettings>): void {
  cache = { ...cache, ...patch, secrets: { ...cache.secrets, ...(patch.secrets ?? {}) } };

  if (MIGRATED_KEYS.some((key) => key in patch)) {
    setSetting(STORE_KEY, { publicDomain: cache.publicDomain, legacyPrefixes: cache.legacyPrefixes }, "machine");
  }

  const { publicDomain: _publicDomain, legacyPrefixes: _legacyPrefixes, ...fileBody } = cache;
  const path = platformSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(fileBody, null, 2));
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/** Secrets never transit API responses (ruled): booleans out, values never. */
export function redactedSettings() {
  const { secrets, ...rest } = cache;
  return { ...rest, hasCfToken: !!secrets.cfApiToken, hasCfZone: !!secrets.cfZoneId };
}
