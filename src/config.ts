import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Member {
  username: string;
  /** Optional display name; falls back to the GitLab profile lookup, then username. */
  name?: string;
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
  title: string;
  port: number;
}

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");
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
  }
  if (cfg.defaultMember && cfg.defaultMember !== "all" && !cfg.members!.some((m) => m.username === cfg.defaultMember)) {
    throw new Error(`config.json "defaultMember" (${cfg.defaultMember}) is not "all" or a known member username`);
  }
  if (cfg.staleAfterDays !== undefined && (typeof cfg.staleAfterDays !== "number" || cfg.staleAfterDays <= 0)) {
    throw new Error(`config.json "staleAfterDays" must be a positive number`);
  }
  return {
    gitlabHost: cfg.gitlabHost!,
    projects: cfg.projects!,
    members: cfg.members!,
    defaultMember: cfg.defaultMember ?? "all",
    staleAfterDays: cfg.staleAfterDays ?? 90,
    title: cfg.title ?? "MRs ready for review",
    port: cfg.port ?? 7930,
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
