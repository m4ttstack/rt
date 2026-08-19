import { readFileSync, renameSync, writeFileSync } from "fs";
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
  /** GitLab project paths whose MRs are eligible, e.g. "group/project". */
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
  /** Bind host passed to Bun.serve verbatim. "" means the default loopback. */
  host: string;
  /** Absolute path the review agent's herdr pane starts in (a repo checkout). Empty disables review launch. */
  reviewCwd: string;
  /** herdr workspace label reviews are grouped under. */
  reviewsWorkspace: string;
  /** Absolute path the respond agent's herdr pane starts in. Falls back to reviewCwd when empty. */
  respondCwd: string;
  /** herdr workspace label responses are grouped under. */
  respondsWorkspace: string;
  /** Absolute path the doctor agent's herdr pane starts in. Falls back to reviewCwd when empty. */
  doctorCwd: string;
  /** herdr workspace label doctor sessions are grouped under. */
  doctorsWorkspace: string;
  /** Command that starts claude in every pane the board launches, e.g.
      "cswap run 2 --share-history -- claude" to pin panes to one account.
      Inserted verbatim (trusted operator config). Empty = plain "claude". */
  claudeCommand: string;
  /** Domain skill the review wrapper delegates to, e.g. "myteam:review".
      Empty = the generic wrapper reviews on its own. Keeps all domain knowledge in config. */
  reviewSkill: string;
  /** Domain skill the respond wrapper delegates to. Empty = generic. */
  respondSkill: string;
  /** Domain skill the doctor wrapper delegates to. Empty = generic. */
  doctorSkill: string;
  /** Extra bot accounts whose general MR comments to hide (username or display
      name, case-insensitive). Additive to the built-in heuristic — for named
      integration bots that don't match a bot-username pattern. */
  botUsernames: string[];
  /** rt repo names keyed by GitLab project path ("group/project" → the name
      registered in ~/.rt/repos.json). The board can only show projects mapped
      here whose repo has the project-mrs grant; an unmapped project surfaces
      an instructive fetchError. */
  rtRepos: Record<string, string>;
  slack: SlackConfig;
  /** Peer-boards relay. Empty url disables every peer feature (publish, poll,
      nudge endpoint) cleanly. Token comes from SWITCHBOARD_TOKEN, not config. */
  switchboard: SwitchboardBoardConfig;
  /** Absolute path (or ~-path) to a mattstack team clone. When set, the board
      materializes gitlabHost/projects/members/title from that clone's
      mattstack/team.jsonc into this config file at boot, before it's parsed.
      Absent = no team zone, config.json is the sole source of truth. */
  teamClone?: string;
}

export interface SwitchboardBoardConfig {
  url: string;
}

/** The three review-signal reactions by role, as Slack emoji names (no colons).
    Adapt these to your workspace's convention — e.g. a custom `comment` emoji
    instead of the standard `speech_balloon`. */
export interface SlackEmojiConfig {
  looking: string;
  commented: string;
  approved: string;
}

export interface SlackConfig {
  /** Channel name (no #) where MR review requests live and where "post to slack" posts. */
  channel: string;
  /** Template for a single MR — used for both clipboard copy and "post to slack". */
  singleTemplate: string;
  /** Header line for the multi-MR summary (top of a "N MR's ready for review" message). */
  multiHeader: string;
  /** Per-MR line under the multi header. */
  multiItem: string;
  /** How often the server sweeps the board and resolves missing Slack refs, in minutes.
      Set to 0 to disable the sweeper (client can still resolve on-demand). */
  autoResolveIntervalMinutes: number;
  emoji: SlackEmojiConfig;
}

export const DEFAULT_SLACK_EMOJI: SlackEmojiConfig = {
  looking: "eyes",
  commented: "speech_balloon",
  approved: "white_check_mark",
};

const DEFAULT_SLACK: SlackConfig = {
  channel: "code-review",
  singleTemplate: "{title}: {url}",
  multiHeader: "{count} MR's ready for review :pray:",
  multiItem: "- {title}: {url}",
  autoResolveIntervalMinutes: 15,
  emoji: DEFAULT_SLACK_EMOJI,
};

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
  if (cfg.host !== undefined && typeof cfg.host !== "string") {
    throw new Error(`config.json "host" must be a string`);
  }
  if (cfg.reviewCwd !== undefined && typeof cfg.reviewCwd !== "string") {
    throw new Error(`config.json "reviewCwd" must be a string (absolute path)`);
  }
  if (cfg.reviewsWorkspace !== undefined && typeof cfg.reviewsWorkspace !== "string") {
    throw new Error(`config.json "reviewsWorkspace" must be a string`);
  }
  if (cfg.respondCwd !== undefined && typeof cfg.respondCwd !== "string") {
    throw new Error(`config.json "respondCwd" must be a string (absolute path)`);
  }
  if (cfg.respondsWorkspace !== undefined && typeof cfg.respondsWorkspace !== "string") {
    throw new Error(`config.json "respondsWorkspace" must be a string`);
  }
  if (cfg.doctorCwd !== undefined && typeof cfg.doctorCwd !== "string") {
    throw new Error(`config.json "doctorCwd" must be a string (absolute path)`);
  }
  if (cfg.doctorsWorkspace !== undefined && typeof cfg.doctorsWorkspace !== "string") {
    throw new Error(`config.json "doctorsWorkspace" must be a string`);
  }
  if (cfg.claudeCommand !== undefined && typeof cfg.claudeCommand !== "string") {
    throw new Error(`config.json "claudeCommand" must be a string (a shell command that starts claude)`);
  }
  if (cfg.teamClone !== undefined && typeof cfg.teamClone !== "string") {
    throw new Error(`config.json "teamClone" must be a string (absolute path or ~-path)`);
  }
  for (const key of ["reviewSkill", "respondSkill", "doctorSkill"] as const) {
    if (cfg[key] !== undefined && typeof cfg[key] !== "string") {
      throw new Error(`config.json "${key}" must be a string (a skill name)`);
    }
  }
  if (cfg.botUsernames !== undefined) {
    if (!Array.isArray(cfg.botUsernames) || cfg.botUsernames.some((b) => typeof b !== "string" || !b.trim())) {
      throw new Error(`config.json "botUsernames" must be an array of non-empty strings`);
    }
  }
  const slack = parseSlack(cfg.slack);
  const switchboard = parseSwitchboard(cfg.switchboard);
  const rtRepos = (cfg.rtRepos && typeof cfg.rtRepos === "object" && !Array.isArray(cfg.rtRepos))
    ? Object.fromEntries(Object.entries(cfg.rtRepos).filter(([, v]) => typeof v === "string"))
    : {};
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
    host: cfg.host ?? "",
    reviewCwd: cfg.reviewCwd ?? "",
    reviewsWorkspace: cfg.reviewsWorkspace ?? "reviews",
    respondCwd: cfg.respondCwd ?? "",
    respondsWorkspace: cfg.respondsWorkspace ?? "responses",
    doctorCwd: cfg.doctorCwd ?? "",
    doctorsWorkspace: cfg.doctorsWorkspace ?? "doctors",
    claudeCommand: cfg.claudeCommand ?? "",
    reviewSkill: cfg.reviewSkill ?? "",
    respondSkill: cfg.respondSkill ?? "",
    doctorSkill: cfg.doctorSkill ?? "",
    botUsernames: (cfg.botUsernames ?? []).map((b) => b.trim()),
    rtRepos,
    slack,
    switchboard,
    teamClone: cfg.teamClone,
  };
}

function parseSwitchboard(raw: unknown): SwitchboardBoardConfig {
  if (raw === undefined || raw === null) return { url: "" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`config.json "switchboard" must be an object`);
  }
  const s = raw as Partial<SwitchboardBoardConfig>;
  if (s.url !== undefined && typeof s.url !== "string") {
    throw new Error(`config.json "switchboard.url" must be a string`);
  }
  return { url: (s.url ?? "").replace(/\/+$/, "") };
}

function parseSlack(raw: unknown): SlackConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLACK };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`config.json "slack" must be an object`);
  }
  const s = raw as Partial<SlackConfig>;
  for (const key of ["channel", "singleTemplate", "multiHeader", "multiItem"] as const) {
    if (s[key] !== undefined && (typeof s[key] !== "string" || !s[key])) {
      throw new Error(`config.json "slack.${key}" must be a non-empty string`);
    }
  }
  if (
    s.autoResolveIntervalMinutes !== undefined &&
    (typeof s.autoResolveIntervalMinutes !== "number" || s.autoResolveIntervalMinutes < 0)
  ) {
    throw new Error(`config.json "slack.autoResolveIntervalMinutes" must be a non-negative number`);
  }
  return {
    channel: s.channel ?? DEFAULT_SLACK.channel,
    singleTemplate: s.singleTemplate ?? DEFAULT_SLACK.singleTemplate,
    multiHeader: s.multiHeader ?? DEFAULT_SLACK.multiHeader,
    multiItem: s.multiItem ?? DEFAULT_SLACK.multiItem,
    autoResolveIntervalMinutes: s.autoResolveIntervalMinutes ?? DEFAULT_SLACK.autoResolveIntervalMinutes,
    emoji: parseSlackEmoji(s.emoji),
  };
}

/** Partial override: any role left out keeps its standard-emoji default.
    Names are accepted with or without colons (`:comment:` → `comment`). */
function parseSlackEmoji(raw: unknown): SlackEmojiConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLACK_EMOJI };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`config.json "slack.emoji" must be an object`);
  }
  const e = raw as Partial<SlackEmojiConfig>;
  const out = { ...DEFAULT_SLACK_EMOJI };
  for (const role of ["looking", "commented", "approved"] as const) {
    if (e[role] === undefined) continue;
    if (typeof e[role] !== "string") {
      throw new Error(`config.json "slack.emoji.${role}" must be a string (a Slack emoji name)`);
    }
    const name = e[role].trim().replace(/^:|:$/g, "");
    if (!name) throw new Error(`config.json "slack.emoji.${role}" must be a non-empty emoji name`);
    out[role] = name;
  }
  return out;
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

/** Persist switchboard.url to config.json (single writer, like saveMemberHidden)
    and return the reparsed config. Temp-file-plus-rename: a crashed write must
    not half-eat the operator's config. */
export function saveSwitchboardUrl(url: string, path: string = CONFIG_PATH): BoardConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  raw.switchboard = { url };
  const text = JSON.stringify(raw, null, 2) + "\n";
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
  return parseConfig(text);
}

/** Optional after the rt rewire: only the display-name lookup uses it; the
    board runs fully without one. Returns null when no token is configured. */
export function loadGitLabToken(): string | null {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  try {
    const secrets = JSON.parse(readFileSync(RT_SECRETS_PATH, "utf8"));
    if (secrets.gitlabToken) return secrets.gitlabToken;
  } catch {
    // fall through — no secrets file, or it's unreadable/invalid
  }
  return null;
}

/** Slack user token (xoxp) for the review-thread integration. Optional: the
    board runs fine without it; the Slack menu actions just stay disabled.
    Returns null when no token is configured. */
export function loadSlackToken(): string | null {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;
  try {
    const secrets = JSON.parse(readFileSync(RT_SECRETS_PATH, "utf8"));
    if (secrets.slackToken) return secrets.slackToken;
  } catch {
    // no secrets file — treat as unconfigured
  }
  return null;
}

/** Switchboard board token. Optional: without it (or without switchboard.url)
    the board runs exactly as before, with all peer features disabled. */
export function loadSwitchboardToken(): string | null {
  if (process.env.SWITCHBOARD_TOKEN) return process.env.SWITCHBOARD_TOKEN;
  try {
    const secrets = JSON.parse(readFileSync(RT_SECRETS_PATH, "utf8"));
    if (secrets.switchboardToken) return secrets.switchboardToken;
  } catch {
    // no secrets file -- treat as unconfigured
  }
  return null;
}

/** Switchboard ADMIN token (operator only). Presence of this secret is what
    turns on the board's invite affordances; absence changes nothing. */
export function loadSwitchboardAdminToken(): string | null {
  if (process.env.SWITCHBOARD_ADMIN_TOKEN) return process.env.SWITCHBOARD_ADMIN_TOKEN;
  try {
    const secrets = JSON.parse(readFileSync(RT_SECRETS_PATH, "utf8"));
    if (secrets.switchboardAdminToken) return secrets.switchboardAdminToken;
  } catch {
    // no secrets file -- treat as unconfigured
  }
  return null;
}
