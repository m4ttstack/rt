// src/edge/oauth.ts: who may sign in to an app at Cloudflare's edge, and
// nothing else. Publication and the password gate live in core/settings.ts and
// are enforced independently: core/gateway.ts reads passwordHash and never
// reads this file.
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { getSetting, setSetting } from "@mattstack/rt-client";
import { stateDir } from "../api/state.ts";

export type OAuth =
  | { mode: "off" }
  | { mode: "emails"; emails: string[] }
  | { mode: "domains"; domains: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function accessPath(): string {
  return process.env.LOCAL_ACCESS_PATH ?? join(stateDir(), "access.json");
}

interface AccessFile {
  apps: Record<string, OAuth>;
}

function isOAuth(value: unknown): value is OAuth {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.mode === "off") return true;
  if (r.mode === "emails") {
    return Array.isArray(r.emails) && r.emails.length > 0
      && r.emails.every((e) => typeof e === "string" && EMAIL_RE.test(e));
  }
  if (r.mode === "domains") {
    return Array.isArray(r.domains) && r.domains.length > 0
      && r.domains.every((d) => typeof d === "string" && DOMAIN_RE.test(d));
  }
  return false;
}

const STORE_KEY = "deck.access";
type GetSettingFn = typeof getSetting;

/**
 * Transition fallback for deck.access (MAT-384): a store entry for an app
 * wins WHOLESALE over access.json's entry for that app -- OAuth is one
 * variant, not a bag of independently-mergeable fields. An app absent from
 * the store, or whose store entry doesn't match the current OAuth shape,
 * falls back to the file's entry. A resolver throw degrades to the file's
 * entries entirely (fail-open), warning once. Unlike `loadFileKept` below,
 * this NEVER rewrites the store: an invalid store entry is skipped, not
 * corrected -- the store is authoritative as-written.
 */
function withAccessStoreFallback(fileApps: Record<string, OAuth>, resolve: GetSettingFn): Record<string, OAuth> {
  let store: Record<string, unknown>;
  try {
    store = (resolve<Record<string, unknown>>(STORE_KEY).value ?? {}) as Record<string, unknown>;
  } catch (err) {
    console.warn(`deck: ${STORE_KEY} unavailable, falling back to access.json`, err);
    return fileApps;
  }
  const merged: Record<string, OAuth> = { ...fileApps };
  for (const [app, rule] of Object.entries(store)) {
    if (isOAuth(rule)) merged[app] = rule;
  }
  return merged;
}

let cache: AccessFile = load(getSetting);

// Destructive by design, file side only: an entry that does not match the
// current shape is dropped, not translated, and the drop is written back.
// There is no legacy support, so a stale entry is simply gone and its app
// reverts to no sign-in gate. Note that a Cloudflare Access app left behind
// by a dropped entry keeps challenging visitors, so the drop fails closed at
// the edge while the board understates the gate until the next Apply resyncs
// it. The store, merged in afterward by withAccessStoreFallback, does NOT
// inherit this behavior -- it is authoritative as-written.
function loadFileKept(): Record<string, OAuth> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(accessPath(), "utf8"));
  } catch {
    return {};
  }
  const apps = (parsed as AccessFile | null)?.apps;
  if (typeof apps !== "object" || apps === null) return {};

  const kept: Record<string, OAuth> = {};
  let dropped = false;
  for (const [app, rule] of Object.entries(apps)) {
    if (isOAuth(rule)) kept[app] = rule;
    else dropped = true;
  }
  if (dropped) saveFile({ apps: kept });
  return kept;
}

function load(resolve: GetSettingFn): AccessFile {
  return { apps: withAccessStoreFallback(loadFileKept(), resolve) };
}

export function reloadOAuth(resolve: GetSettingFn = getSetting): void {
  cache = load(resolve);
}

function saveFile(file: AccessFile): void {
  const path = accessPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function getOAuth(app: string): OAuth {
  return cache.apps[app] ?? { mode: "off" };
}

/**
 * Writes the store unconditionally from the WHOLE current cache (every
 * app's rule migrates wholesale, unlike deck.apps' per-field split, so there
 * is nothing left for access.json to keep) before writing the file. On a
 * store-write failure the cache reverts to `previous` and the error
 * rethrows before the file is touched, matching core/settings.ts's save().
 */
export function setOAuth(app: string, rule: OAuth): void {
  const previous = structuredClone(cache);
  cache.apps[app] = rule;
  try {
    setSetting(STORE_KEY, cache.apps, "user");
  } catch (err) {
    cache = previous;
    throw err;
  }
  saveFile({ apps: {} });
}

export function oauthRequiresCf(rule: OAuth): boolean {
  return rule.mode !== "off";
}

export function parseOAuth(body: unknown): OAuth | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "invalid body" };
  const b = body as Record<string, unknown>;
  if (b.mode === "off") return { mode: "off" };
  if (b.mode === "emails") {
    const emails = b.emails;
    if (!Array.isArray(emails) || emails.length === 0
      || !emails.every((e) => typeof e === "string" && EMAIL_RE.test(e))) {
      return { error: "emails must be a non-empty list of valid addresses" };
    }
    return { mode: "emails", emails: emails as string[] };
  }
  if (b.mode === "domains") {
    const domains = b.domains;
    if (!Array.isArray(domains) || domains.length === 0
      || !domains.every((d) => typeof d === "string" && DOMAIN_RE.test(d))) {
      return { error: "domains must be a non-empty list of valid domains" };
    }
    return { mode: "domains", domains: domains as string[] };
  }
  return { error: "unknown mode" };
}
