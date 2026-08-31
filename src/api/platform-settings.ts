import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { stateDir } from "./state.ts";
import { getSetting, setSetting } from "@mattstack/rt-client";

export interface TunnelIdentity {
  name: string;
  uuid: string;
}

export interface PlatformSettings {
  publicDomain: string | null;
  tlds: string[];
  legacyPrefixes: string[];
  secrets: { cfApiToken?: string; cfZoneId?: string };
  railway: { projectId: string; environmentId: string } | null;
  tunnel: TunnelIdentity | null;
}

const DEFAULTS: PlatformSettings = {
  publicDomain: null, tlds: ["localhost"], legacyPrefixes: [], secrets: {}, railway: null, tunnel: null,
};

const STORE_KEY = "deck.platform";
type MigratedFields = Pick<PlatformSettings, "publicDomain" | "legacyPrefixes" | "railway" | "tunnel">;

export function platformSettingsPath(): string {
  return process.env.LOCAL_PLATFORM_SETTINGS_PATH ?? join(stateDir(), "platform.json");
}

type GetSettingFn = typeof getSetting;

/**
 * Transition fallback for deck.platform (MAT-384): store wins PER FIELD over
 * platform.json; a field the store doesn't carry falls back to the file's
 * value; a resolver throw degrades to the file's values entirely (fail-open),
 * warning once per load. `resolve` defaults to the real resolver; tests
 * inject a throwing stand-in to cover the fail-open path without touching
 * real state. Delete this function whole at cutover, once the file no
 * longer carries these fields.
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
    railway: store.railway !== undefined ? store.railway : fileValues.railway,
    tunnel: store.tunnel !== undefined ? store.tunnel : fileValues.tunnel,
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

/**
 * Store ownership is a one-way latch, decided fresh on every write: rt-client's
 * read path never throws for an absent or lost key, it yields `undefined` (see
 * stores.ts -- even a malformed store file honest-degrades to "empty" there,
 * not a throw). So `undefined` here means the store does not yet own
 * deck.platform -- ownership flips only via the orchestrator's live import or
 * an explicit `rt settings set`, never manufactured by this function. Until
 * then, writes must not strip the file (there would be nowhere left holding
 * the value) and must not call `setSetting` (there is nothing to merge into,
 * and doing so would manufacture ownership deck never asked for).
 */
function isPlatformStoreOwned(resolve: GetSettingFn): boolean {
  try {
    return resolve<unknown>(STORE_KEY).value !== undefined;
  } catch {
    return false;
  }
}

export function updatePlatformSettings(patch: Partial<PlatformSettings>, resolve: GetSettingFn = getSetting): void {
  const previous = cache;
  cache = { ...cache, ...patch, secrets: { ...cache.secrets, ...(patch.secrets ?? {}) } };

  const owned = isPlatformStoreOwned(resolve);
  if (owned) {
    try {
      // Unconditional, not just when `patch` touches a migrated field: the
      // file write below always strips these migrated fields, so gating this on
      // the patch would let a tlds/secrets-only patch erase them from disk
      // with nowhere left holding the value. Writing the cache's current
      // values back is a no-op when they're unchanged. This REPLACES
      // deck.platform in the store wholesale from deck's boot-time cache --
      // a field another process wrote to the store after this process
      // booted is clobbered here, same as any other boot-read config in
      // deck (a restart is what picks up an external edit).
      setSetting(STORE_KEY, { publicDomain: cache.publicDomain, legacyPrefixes: cache.legacyPrefixes, railway: cache.railway, tunnel: cache.tunnel }, "machine");
    } catch (err) {
      cache = previous; // never claim a value neither the store nor the file actually holds
      throw err;
    }
  }

  const fileBody: Record<string, unknown> = owned
    ? (() => {
        const { publicDomain: _publicDomain, legacyPrefixes: _legacyPrefixes, railway: _railway, tunnel: _tunnel, ...rest } = cache;
        return rest;
      })()
    : cache; // unowned: the file is the only place holding these fields, so it keeps them

  const path = platformSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(fileBody, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  } catch (err) {
    if (owned) {
      try {
        setSetting(STORE_KEY, { publicDomain: previous.publicDomain, legacyPrefixes: previous.legacyPrefixes, railway: previous.railway, tunnel: previous.tunnel }, "machine");
      } catch (revertErr) {
        console.error("platform settings save: failed to revert deck.platform after a file-write failure", revertErr);
      }
    }
    cache = previous;
    throw err;
  }
}

/**
 * Secrets never transit API responses. CF credentials come from the rt
 * daemon now (src/edge/rt-secrets.ts), not this field -- so this strips
 * `secrets` without reading its contents at all, rather than reporting
 * booleans derived from it.
 */
export function redactedSettings() {
  const { secrets: _secrets, ...rest } = cache;
  return rest;
}
