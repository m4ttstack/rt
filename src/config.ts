import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface BoardConfig {
  gitlabHost: string;
  username: string;
  /** GitLab project paths in display order, e.g. "acme/acme-dev". */
  projects: string[];
  title: string;
  port: number;
}

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");
const RT_SECRETS_PATH = join(homedir(), ".rt", "secrets.json");

export function loadConfig(): BoardConfig {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(`config.json not found at ${CONFIG_PATH} — copy config.example.json and fill it in`);
  }
  const cfg = JSON.parse(raw) as Partial<BoardConfig>;
  for (const key of ["gitlabHost", "username", "projects"] as const) {
    if (!cfg[key] || (Array.isArray(cfg[key]) && cfg[key].length === 0)) {
      throw new Error(`config.json is missing required field "${key}"`);
    }
  }
  return {
    gitlabHost: cfg.gitlabHost!,
    username: cfg.username!,
    projects: cfg.projects!,
    title: cfg.title ?? "MRs ready for review",
    port: cfg.port ?? 7930,
  };
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
