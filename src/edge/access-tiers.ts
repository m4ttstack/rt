import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { stateDir } from "../api/state.ts";

export type AccessTier =
  | { tier: "public" }
  | { tier: "password" }
  | { tier: "only-me"; email: string }
  | { tier: "work-domain"; emailDomain: string }
  | { tier: "custom"; emails: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function accessPath(): string {
  return process.env.LOCAL_ACCESS_PATH ?? join(stateDir(), "access.json");
}

interface AccessFile {
  apps: Record<string, AccessTier>;
}

let cache: AccessFile = load();

function load(): AccessFile {
  try {
    const parsed = JSON.parse(readFileSync(accessPath(), "utf8")) as AccessFile;
    if (!parsed.apps) parsed.apps = {};
    return parsed;
  } catch {
    return { apps: {} };
  }
}

export function reloadTiers(): void {
  cache = load();
}

function save(): void {
  const path = accessPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, path);
}

export function getTier(app: string): AccessTier {
  return cache.apps[app] ?? { tier: "public" };
}

export function setTier(app: string, tier: AccessTier): void {
  cache.apps[app] = tier;
  save();
}

export function tierRequiresCf(tier: AccessTier): boolean {
  return tier.tier === "only-me" || tier.tier === "work-domain" || tier.tier === "custom";
}

export function parseTier(body: unknown): AccessTier | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "invalid body" };
  const tier = (body as Record<string, unknown>).tier;
  if (tier === "public" || tier === "password") return { tier };
  if (tier === "only-me") {
    const email = (body as Record<string, unknown>).email;
    if (typeof email !== "string" || !EMAIL_RE.test(email)) return { error: "email required" };
    return { tier: "only-me", email };
  }
  if (tier === "work-domain") {
    const emailDomain = (body as Record<string, unknown>).emailDomain;
    if (typeof emailDomain !== "string" || emailDomain.length === 0) return { error: "emailDomain required" };
    return { tier: "work-domain", emailDomain };
  }
  if (tier === "custom") {
    const emails = (body as Record<string, unknown>).emails;
    if (!Array.isArray(emails) || emails.length === 0 || !emails.every((e) => typeof e === "string" && EMAIL_RE.test(e))) {
      return { error: "emails must be a non-empty list of valid addresses" };
    }
    return { tier: "custom", emails: emails as string[] };
  }
  return { error: "unknown tier" };
}
