// src/edge/oauth.ts — who may sign in to an app at Cloudflare's edge, and
// nothing else. Publication and the password gate live in core/settings.ts and
// are enforced independently: core/gateway.ts reads passwordHash and never
// reads this file.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
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

let cache: AccessFile = load();

// Destructive by design: an entry that does not match the current shape is
// dropped, not translated. There is no legacy support, so a stale entry is
// simply gone and its app reverts to no sign-in gate. Note that a Cloudflare
// Access app left behind by a dropped entry keeps challenging visitors, so the
// drop fails closed at the edge while the board understates the gate until the
// next Apply resyncs it.
function load(): AccessFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(accessPath(), "utf8"));
  } catch {
    return { apps: {} };
  }
  const apps = (parsed as AccessFile | null)?.apps;
  if (typeof apps !== "object" || apps === null) return { apps: {} };

  const kept: Record<string, OAuth> = {};
  let dropped = false;
  for (const [app, rule] of Object.entries(apps)) {
    if (isOAuth(rule)) kept[app] = rule;
    else dropped = true;
  }
  const file: AccessFile = { apps: kept };
  if (dropped) save(file);
  return file;
}

export function reloadOAuth(): void {
  cache = load();
}

// Takes the file explicitly so load() can write a migrated file back before
// the module-level cache has been assigned.
function save(file: AccessFile = cache): void {
  const path = accessPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, path);
}

export function getOAuth(app: string): OAuth {
  return cache.apps[app] ?? { mode: "off" };
}

export function setOAuth(app: string, rule: OAuth): void {
  cache.apps[app] = rule;
  save();
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
