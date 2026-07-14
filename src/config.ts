import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Member {
  username: string;
  /** Optional display name; falls back to the GitLab profile lookup, then username. */
  name?: string;
  /** Checked out: kept in config but hidden from the sidebar, the "All" view, and its counts. */
  hidden?: boolean;
}

export interface BoardConfig {
  gitlabHost: string;
  /** GitLab project paths whose MRs are eligible, e.g. "acme/acme-dev". */
  projects: string[];
  /** Team members whose authored MRs the board shows, in sidebar order. */
  members: Member[];
  /** Username of the member the board defaults to (or "all"), absent URL/localStorage overrides. */
  defaultMember: string;
  /** Hide MRs with no activity (last update) in more than this many days. */
  staleAfterDays: number;
  /**
   * If non-empty, only show MRs whose Linear ticket key starts with one of
   * these prefixes (e.g. ["CV"] to show only CV-#### tickets). Case-insensitive.
   * MRs with no detectable ticket key are hidden when this is set. Empty = show all.
   */
  ticketPrefixes: string[];
  title: string;
  port: number;
  /** Absolute path the review agent's herdr pane starts in (an acme-dev checkout). Empty disables review launch. */
  reviewCwd: string;
  /** herdr workspace label reviews are grouped under. */
  reviewsWorkspace: string;
}

export const CONFIG_PATH = join(import.meta.dir, "..", "config.json");
const RT_SECRETS_PATH = join(homedir(), ".rt", "secrets.json");

/** Parse and validate raw config JSON. Separated from file IO for testing. */
export function parseConfig(raw: string): BoardConfig {
  const cfg = JSON.parse(raw) as Partial<BoardConfig>;
  for (const key of ["gitlabHost", "projects", "members"] as const) {
    const value = cfg[key];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`config.json is missing required field "${key}"`);
    }
  }
  for (const member of cfg.members!) {
    if (!member || !member.username) {
      throw new Error(`config.json has a member with no "username"`);
    }
    if (member.hidden !== undefined && typeof member.hidden !== "boolean") {
      throw new Error(`config.json member "${member.username}" has a non-boolean "hidden"`);
    }
  }
  if (cfg.defaultMember && cfg.defaultMember !== "all" && !cfg.members!.some((m) => m.username === cfg.defaultMember)) {
    throw new Error(`config.json "defaultMember" (${cfg.defaultMember}) is not "all" or a known member username`);
  }
  if (cfg.staleAfterDays !== undefined && (typeof cfg.staleAfterDays !== "number" || cfg.staleAfterDays <= 0)) {
    throw new Error(`config.json "staleAfterDays" must be a positive number`);
  }
  if (cfg.ticketPrefixes !== undefined) {
    if (!Array.isArray(cfg.ticketPrefixes) || cfg.ticketPrefixes.some((p) => typeof p !== "string" || !p.trim())) {
      throw new Error(`config.json "ticketPrefixes" must be an array of non-empty strings`);
    }
  }
  if (cfg.reviewCwd !== undefined && typeof cfg.reviewCwd !== "string") {
    throw new Error(`config.json "reviewCwd" must be a string (absolute path)`);
  }
  if (cfg.reviewsWorkspace !== undefined && typeof cfg.reviewsWorkspace !== "string") {
    throw new Error(`config.json "reviewsWorkspace" must be a string`);
  }
  return {
    gitlabHost: cfg.gitlabHost!,
    projects: cfg.projects!,
    members: cfg.members!,
    defaultMember: cfg.defaultMember ?? "all",
    staleAfterDays: cfg.staleAfterDays ?? 90,
    // Normalize to uppercase so matching is case-insensitive (ticket keys are uppercased).
    ticketPrefixes: (cfg.ticketPrefixes ?? []).map((p) => p.trim().toUpperCase()),
    title: cfg.title ?? "MRs ready for review",
    port: cfg.port ?? 7930,
    reviewCwd: cfg.reviewCwd ?? "",
    reviewsWorkspace: cfg.reviewsWorkspace ?? "reviews",
  };
}

export function loadConfig(): BoardConfig {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(`config.json not found at ${CONFIG_PATH} — copy config.example.json and fill it in`);
  }
  return parseConfig(raw);
}

/**
 * Return config JSON text with `username`'s hidden flag set — removed entirely
 * when false, so the file stays clean. Pure (string in, string out) for testing.
 * Throws if the username isn't a configured member.
 */
export function setHiddenInRaw(raw: string, username: string, hidden: boolean): string {
  const obj = JSON.parse(raw) as { members?: Array<{ username: string; hidden?: boolean }> };
  const member = obj.members?.find((m) => m.username === username);
  if (!member) throw new Error(`unknown member "${username}"`);
  if (hidden) member.hidden = true;
  else delete member.hidden;
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Persist `username`'s hidden flag to config.json and return the reparsed config. */
export function saveMemberHidden(username: string, hidden: boolean): BoardConfig {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const next = setHiddenInRaw(raw, username, hidden);
  writeFileSync(CONFIG_PATH, next);
  return parseConfig(next);
}

export function loadGitLabToken(): string {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  try {
    const secrets = JSON.parse(readFileSync(RT_SECRETS_PATH, "utf8"));
    if (secrets.gitlabToken) return secrets.gitlabToken;
  } catch {
    // fall through to the error below
  }
  throw new Error(`no GitLab token: set GITLAB_TOKEN or add "gitlabToken" to ${RT_SECRETS_PATH}`);
}
