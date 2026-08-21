import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import { getSetting, setSetting } from "@mattstack/rt-client";

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

interface AppEntry {
  published?: boolean;
  passwordHash?: string;
  passwordVersion?: number;
  override?: PortOverride;
  publicFollowsOverride?: boolean;
}

export interface SettingsFile {
  version: number;
  secret?: string;
  apps: Record<string, AppEntry>;
}

// Computed fresh on every call (not frozen at import time) so callers that set
// LOCAL_APPS_SETTINGS_PATH after this module first loads (tests, in particular)
// still get the override, regardless of module load order. Mirrors routesPath().
export function settingsPath(): string {
  return process.env.LOCAL_APPS_SETTINGS_PATH ?? join(import.meta.dir, "..", "data", "settings.json");
}

const STORE_KEY = "deck.apps";
type MigratedAppFields = { published: boolean; publicFollowsOverride: boolean };
type GetSettingFn = typeof getSetting;

/**
 * Transition fallback for deck.apps (MAT-384): per app, the store's
 * published/publicFollowsOverride win PER FIELD over settings.json; a field
 * the store doesn't carry for that app falls back to the file's value for
 * it; an app absent from the store falls back to its file entry untouched.
 * A resolver throw degrades to the file's entries entirely (fail-open),
 * warning once per load. `resolve` defaults to the real resolver; tests
 * inject a throwing stand-in to cover the fail-open path without touching
 * real state.
 */
function withAppsStoreFallback(
  fileApps: Record<string, AppEntry>,
  resolve: GetSettingFn,
): Record<string, AppEntry> {
  let store: Record<string, Partial<MigratedAppFields>>;
  try {
    store = (resolve<Record<string, Partial<MigratedAppFields>>>(STORE_KEY).value ?? {}) as Record<
      string,
      Partial<MigratedAppFields>
    >;
  } catch (err) {
    console.warn(`deck: ${STORE_KEY} unavailable, falling back to settings.json`, err);
    return fileApps;
  }
  const merged: Record<string, AppEntry> = { ...fileApps };
  for (const [app, fields] of Object.entries(store)) {
    const fileEntry = fileApps[app] ?? {};
    merged[app] = {
      ...fileEntry,
      published: fields.published !== undefined ? fields.published : fileEntry.published,
      publicFollowsOverride:
        fields.publicFollowsOverride !== undefined ? fields.publicFollowsOverride : fileEntry.publicFollowsOverride,
    };
  }
  return merged;
}

let cache: SettingsFile = load(getSetting);
mintSecretIfMissing();

function load(resolve: GetSettingFn): SettingsFile {
  let fileValues: SettingsFile;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as SettingsFile;
    if (!parsed.apps) parsed.apps = {};
    fileValues = parsed;
  } catch {
    fileValues = { version: 1, apps: {} };
  }
  return { ...fileValues, apps: withAppsStoreFallback(fileValues.apps, resolve) };
}

export function reloadSettings(resolve: GetSettingFn = getSetting): void {
  cache = load(resolve);
  mintSecretIfMissing();
}

/**
 * Minted at boot (module load) and on every reload, never lazily on the
 * request path: getSecret() used to mint-and-save on first call, which put a
 * live gateway request one save() failure away from throwing. Boot is the
 * only place that needs to tolerate that -- and with an unowned store, the
 * latched save() below never touches the store at all, only the file.
 */
function mintSecretIfMissing(): void {
  if (cache.secret) return;
  const previous = structuredClone(cache);
  cache.secret = randomBytes(32).toString("hex");
  save(previous);
}

/** The store's view of every app currently in cache, defaults applied so both fields are always determinate. */
function buildAppsStoreDict(state: SettingsFile): Record<string, MigratedAppFields> {
  const out: Record<string, MigratedAppFields> = {};
  for (const [app, entry] of Object.entries(state.apps)) {
    out[app] = {
      published: entry.published ?? true,
      publicFollowsOverride: entry.publicFollowsOverride ?? false,
    };
  }
  return out;
}

// An app whose ONLY fields ever were the two migrated ones (it entered cache
// purely via a store merge in load(), never through ensure()) strips down to
// `{}` -- omit it from the file entirely rather than accreting empty-object
// noise for apps the file has nothing left to say about.
function stripMigratedFields(state: SettingsFile): SettingsFile {
  const apps: Record<string, AppEntry> = {};
  for (const [app, entry] of Object.entries(state.apps)) {
    const { published: _published, publicFollowsOverride: _publicFollowsOverride, ...rest } = entry;
    if (Object.keys(rest).length > 0) apps[app] = rest;
  }
  return { ...state, apps };
}

/**
 * Store ownership is a one-way latch, decided fresh on every save: rt-client's
 * read path never throws for an absent or lost key, it yields `undefined`
 * (even a malformed store file honest-degrades to "empty", not a throw --
 * see rt-client's stores.ts). `undefined` here means the store does not yet
 * own deck.apps -- ownership flips only via the orchestrator's live import or
 * an explicit `rt settings set`, never manufactured by this function.
 */
function isAppsStoreOwned(): boolean {
  return getSetting<unknown>(STORE_KEY).value !== undefined;
}

function currentRawAppsStore(): Record<string, Partial<MigratedAppFields>> {
  return (getSetting<Record<string, Partial<MigratedAppFields>>>(STORE_KEY).value ?? {}) as Record<
    string,
    Partial<MigratedAppFields>
  >;
}

/**
 * Overlays this process's known apps onto a FRESH read of the raw store,
 * never a wholesale replace built from cache alone: another process may have
 * written an app this process's boot-time cache never saw, and rebuilding
 * purely from cache would silently erase it. `previous.apps` keys missing
 * from the CURRENT cache -- a rename's old name -- are the one case an app
 * should actually disappear from the store, so those are deleted from the
 * result.
 */
function nextAppsStoreDict(previous: SettingsFile): Record<string, Partial<MigratedAppFields>> {
  const next: Record<string, Partial<MigratedAppFields>> = { ...currentRawAppsStore(), ...buildAppsStoreDict(cache) };
  for (const app of Object.keys(previous.apps)) {
    if (!(app in cache.apps)) delete next[app];
  }
  return next;
}

/**
 * Every mutation funnels through here. While deck.apps is unowned (see
 * isAppsStoreOwned), saves write the migrated fields straight to
 * settings.json and never call setSetting -- calling it would manufacture
 * ownership deck itself never asked for. Once the store owns the key, saves
 * write a fresh overlay into the store (nextAppsStoreDict) and strip the two
 * migrated fields from every app in the file. Either branch reverts `cache`
 * to `previous` and rethrows on a failure, so a value is never claimed as
 * persisted when neither side actually holds it. A file-write failure AFTER
 * a successful store write additionally un-writes the store back to
 * `previous`'s view (best effort, logged if that itself fails) -- otherwise
 * the store would keep a new value (e.g. a renamed app) whose file-local
 * fields (passwordHash) never actually made it to disk.
 */
function save(previous: SettingsFile): void {
  const owned = isAppsStoreOwned();

  if (owned) {
    try {
      setSetting(STORE_KEY, nextAppsStoreDict(previous), "user");
    } catch (err) {
      cache = previous;
      throw err;
    }
  }

  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const fileBody = owned ? stripMigratedFields(cache) : cache;
  try {
    writeFileSync(tmp, JSON.stringify(fileBody, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  } catch (err) {
    if (owned) {
      try {
        setSetting(STORE_KEY, buildAppsStoreDict(previous), "user");
      } catch (revertErr) {
        console.error("settings save: failed to revert deck.apps after a file-write failure", revertErr);
      }
    }
    cache = previous;
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

function ensure(app: string): AppEntry {
  if (!cache.apps[app]) cache.apps[app] = { published: true, passwordVersion: 0 };
  return cache.apps[app] as AppEntry;
}

export function getSecret(): string {
  return cache.secret as string;
}

export async function setPublished(app: string, published: boolean): Promise<void> {
  const previous = structuredClone(cache);
  ensure(app).published = published;
  save(previous);
}

export async function setPassword(app: string, password: string): Promise<void> {
  const previous = structuredClone(cache);
  const entry = ensure(app);
  entry.passwordHash = await Bun.password.hash(password);
  entry.passwordVersion = (entry.passwordVersion ?? 0) + 1;
  save(previous);
}

export async function clearPassword(app: string): Promise<void> {
  const previous = structuredClone(cache);
  const entry = ensure(app);
  delete entry.passwordHash;
  entry.passwordVersion = (entry.passwordVersion ?? 0) + 1;
  save(previous);
}

/**
 * Move an app's whole settings entry to a new key, verbatim. Renaming a record
 * has to carry published/passwordHash/passwordVersion/override with it: an
 * unknown name defaults to published:true with no password, so without this a
 * rename would silently turn a private, password-protected app public. It moves
 * the raw entry because no setter above can: setPassword only takes a plaintext
 * to re-hash, and an existing hash has no plaintext to re-derive it from.
 * A no-op when the old name has no entry (nothing to carry). The store side
 * follows automatically (when the store owns deck.apps): save()'s overlay
 * diffs `previous.apps` against the current cache, so the old key drops out
 * of the store and the new key picks up its fields.
 */
export function renameAppSettings(oldName: string, newName: string): void {
  const entry = cache.apps[oldName];
  if (!entry) return;
  const previous = structuredClone(cache);
  delete cache.apps[oldName];
  cache.apps[newName] = entry;
  save(previous);
}

export function getOverride(app: string): PortOverride | undefined {
  return cache.apps[app]?.override;
}

export function setOverride(app: string, override: PortOverride): void {
  const previous = structuredClone(cache);
  ensure(app).override = override;
  save(previous);
}

export function clearOverride(app: string): void {
  const entry = cache.apps[app];
  if (entry?.override) {
    const previous = structuredClone(cache);
    delete entry.override;
    save(previous);
  }
}

export function getPublicFollowsOverride(app: string): boolean {
  return cache.apps[app]?.publicFollowsOverride ?? false;
}

export function setPublicFollowsOverride(app: string, follows: boolean): void {
  const previous = structuredClone(cache);
  const entry = ensure(app);
  // Store the default as an absent key rather than `false`, so settings.json
  // stays free of noise for the apps that never opt in.
  if (follows) entry.publicFollowsOverride = true;
  else delete entry.publicFollowsOverride;
  save(previous);
}

export function getOverrides(): Record<string, PortOverride> {
  const out: Record<string, PortOverride> = {};
  for (const [app, s] of Object.entries(cache.apps)) {
    if (s.override) out[app] = s.override;
  }
  return out;
}
