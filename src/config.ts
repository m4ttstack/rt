import { readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { APP_ROOT } from "./app-root.ts";
import { getSetting, setSetting, identityFromRemote, serializeIdentity, type RepoIdentity } from "@mattstack/rt-client";
import { readBoardSecrets, type BoardSecretsData, type BoardSecretsDeps } from "./board-secrets.ts";

/** A bare "host/path" config value (not a full remote URL) never matches
    identityFromRemote's URL/scp-like parsing — it has no scheme and no
    colon. Treat it as an already-normalized remote identity directly,
    lowercasing only the host segment (parity with normalizeRemote). */
function hostPathToIdentity(value: string): RepoIdentity | null {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  const host = value.slice(0, slash).toLowerCase();
  const path = value.slice(slash + 1);
  return { kind: "remote", id: `${host}/${path}` };
}

/** Encode one rtRepos value for the daemon boundary: identityFromRemote
    first (covers a pasted full remote URL, and any fork/multi-remote
    override keyed on that exact string), else the bare host/path adapter.
    Null propagates — an unmapped or malformed value must surface as a
    fetchError, never reach the identity-only daemon as a bare string. */
export function repoIdentityField(value: string | null | undefined): string | null {
  if (!value) return null;
  const identity = identityFromRemote(value) ?? hostPathToIdentity(value);
  return identity ? serializeIdentity(identity) : null;
}

/**
 * A GitLab project's rt identity is its host plus its path, so the map the
 * daemon calls need is derived from the two team keys rather than kept as
 * a third. A config.json entry still wins for its project: the one case
 * where the tracked remote is not the project itself (a fork, a rename).
 */
export function deriveRtRepos(gitlabHost: string, projects: string[], overrides: Record<string, string> = {}): Record<string, string> {
  const host = gitlabHost.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  const derived = Object.fromEntries(projects.map((project) => [project, `${host}/${project}`]));
  return { ...derived, ...overrides };
}

/** Same, keyed by GitLab project path through config.rtRepos — the shape
    every server.ts call site actually has in hand. */
export function daemonRepoField(config: Pick<BoardConfig, "rtRepos">, projectPath: string): string | null {
  return repoIdentityField(config.rtRepos[projectPath]);
}

export interface TabConfig {
  id: string;
  label: string;
  source: { kind: "authors" } | { kind: "codeowners"; section: string; excludeMembers?: boolean };
  /** Overrides slack.channel for this tab's index, reactions, and posts. */
  slackChannel?: string;
  /** Overrides review-launch skill resolution for this tab. Empty/absent = normal resolution. */
  reviewSkill?: string;
}

/** No config.json/store tabs = one classic authors-roster tab, never zero tabs. */
export const IMPLICIT_TABS: TabConfig[] = [{ id: "team", label: "Team", source: { kind: "authors" } }];

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
  /** Domain skill the doctor wrapper delegates to. Empty = generic. */
  doctorSkill: string;
  /** Extra bot accounts whose general MR comments to hide (username or display
      name, case-insensitive). Additive to the built-in heuristic — for named
      integration bots that don't match a bot-username pattern. */
  botUsernames: string[];
  /** rt repo identities keyed by GitLab project path ("group/project" → an
      operator-authored `host/path` string, e.g. "gitlab.com/group/repo").
      The board can only show projects mapped here whose repo has the
      project-mrs grant; an unmapped project surfaces an instructive
      fetchError. */
  rtRepos: Record<string, string>;
  /** config.json's explicit project → remote entries, the only input to rtRepos that is not derived. */
  rtRepoOverrides: Record<string, string>;
  slack: SlackConfig;
  /** Peer-boards relay. Empty url disables every peer feature (publish, poll,
      nudge endpoint) cleanly. Token comes from SWITCHBOARD_TOKEN, not config. */
  switchboard: SwitchboardBoardConfig;
  /** Board tabs, in display order. Absent in config.json/store = IMPLICIT_TABS. */
  tabs: TabConfig[];
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

export const CONFIG_PATH = join(APP_ROOT, "config.json");

/** Parse and validate raw config JSON. Separated from file IO for testing.
    `source` names where a malformed value came from in every thrown message
    (default "config.json", the file path's own vocabulary) -- the store
    round trip in withBoardStoreFallback passes a settings-store label
    instead, so a malformed store value sends the operator to `rt settings`
    rather than blaming a file that isn't the actual problem (same contract
    as triage/config.ts's parseTriageBlock). */
export function parseConfig(raw: string, source = "config.json"): BoardConfig {
  const cfg = JSON.parse(raw) as Partial<BoardConfig>;
  for (const key of ["gitlabHost", "projects", "members"] as const) {
    const value = cfg[key];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`${source} is missing required field "${key}"`);
    }
  }
  for (const member of cfg.members!) {
    if (!member || !member.username) {
      throw new Error(`${source} has a member with no "username"`);
    }
    if (member.hidden !== undefined && typeof member.hidden !== "boolean") {
      throw new Error(`${source} member "${member.username}" has a non-boolean "hidden"`);
    }
  }
  if (cfg.defaultMember && cfg.defaultMember !== "all" && !cfg.members!.some((m) => m.username === cfg.defaultMember)) {
    throw new Error(`${source} "defaultMember" (${cfg.defaultMember}) is not "all" or a known member username`);
  }
  if (cfg.staleAfterDays !== undefined && (typeof cfg.staleAfterDays !== "number" || cfg.staleAfterDays <= 0)) {
    throw new Error(`${source} "staleAfterDays" must be a positive number`);
  }
  if (cfg.ticketPrefixes !== undefined) {
    if (!Array.isArray(cfg.ticketPrefixes) || cfg.ticketPrefixes.some((p) => typeof p !== "string" || !p.trim())) {
      throw new Error(`${source} "ticketPrefixes" must be an array of non-empty strings`);
    }
  }
  if (cfg.reviewCwd !== undefined && typeof cfg.reviewCwd !== "string") {
    throw new Error(`${source} "reviewCwd" must be a string (absolute path)`);
  }
  if (cfg.reviewsWorkspace !== undefined && typeof cfg.reviewsWorkspace !== "string") {
    throw new Error(`${source} "reviewsWorkspace" must be a string`);
  }
  if (cfg.respondCwd !== undefined && typeof cfg.respondCwd !== "string") {
    throw new Error(`${source} "respondCwd" must be a string (absolute path)`);
  }
  if (cfg.respondsWorkspace !== undefined && typeof cfg.respondsWorkspace !== "string") {
    throw new Error(`${source} "respondsWorkspace" must be a string`);
  }
  if (cfg.doctorCwd !== undefined && typeof cfg.doctorCwd !== "string") {
    throw new Error(`${source} "doctorCwd" must be a string (absolute path)`);
  }
  if (cfg.doctorsWorkspace !== undefined && typeof cfg.doctorsWorkspace !== "string") {
    throw new Error(`${source} "doctorsWorkspace" must be a string`);
  }
  if (cfg.claudeCommand !== undefined && typeof cfg.claudeCommand !== "string") {
    throw new Error(`${source} "claudeCommand" must be a string (a shell command that starts claude)`);
  }
  if (cfg.doctorSkill !== undefined && typeof cfg.doctorSkill !== "string") {
    throw new Error(`${source} "doctorSkill" must be a string (a skill name)`);
  }
  if (cfg.botUsernames !== undefined) {
    if (!Array.isArray(cfg.botUsernames) || cfg.botUsernames.some((b) => typeof b !== "string" || !b.trim())) {
      throw new Error(`${source} "botUsernames" must be an array of non-empty strings`);
    }
  }
  const slack = parseSlack(cfg.slack, source);
  const switchboard = parseSwitchboard(cfg.switchboard, source);
  const tabs = parseTabs(cfg.tabs, source);
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
    reviewCwd: cfg.reviewCwd ?? "",
    reviewsWorkspace: cfg.reviewsWorkspace ?? "reviews",
    respondCwd: cfg.respondCwd ?? "",
    respondsWorkspace: cfg.respondsWorkspace ?? "responses",
    doctorCwd: cfg.doctorCwd ?? "",
    doctorsWorkspace: cfg.doctorsWorkspace ?? "doctors",
    claudeCommand: cfg.claudeCommand ?? "",
    doctorSkill: cfg.doctorSkill ?? "",
    botUsernames: (cfg.botUsernames ?? []).map((b) => b.trim()),
    rtRepos: deriveRtRepos(cfg.gitlabHost!, cfg.projects!, rtRepos),
    rtRepoOverrides: rtRepos,
    slack,
    switchboard,
    tabs,
  };
}

/** Absent = IMPLICIT_TABS (the classic single authors-roster board), never zero tabs. */
export function parseTabs(raw: unknown, source: string): TabConfig[] {
  if (raw === undefined) return IMPLICIT_TABS;
  if (!Array.isArray(raw)) throw new Error(`${source} "tabs" must be an array`);
  if (raw.length === 0) throw new Error(`${source} "tabs" must not be empty (omit "tabs" for the implicit default)`);
  const seenIds = new Set<string>();
  return raw.map((entry, i) => {
    const label = `tabs[${i}]`;
    if (!entry || typeof entry !== "object") {
      throw new Error(`${source} "${label}" must be an object`);
    }
    const t = entry as Partial<TabConfig>;
    if (!t.id || typeof t.id !== "string") {
      throw new Error(`${source} "${label}" is missing a non-empty "id"`);
    }
    if (seenIds.has(t.id)) {
      throw new Error(`${source} has a duplicate tab id "${t.id}" in ${label}`);
    }
    seenIds.add(t.id);
    if (!t.label || typeof t.label !== "string") {
      throw new Error(`${source} "${label}" is missing a non-empty "label"`);
    }
    if (!t.source || typeof t.source !== "object") {
      throw new Error(`${source} "${label}.source" must be an object`);
    }
    const src = t.source as { kind?: string; section?: string; excludeMembers?: unknown };
    if (src.kind !== "authors" && src.kind !== "codeowners") {
      throw new Error(`${source} "${label}.source.kind" must be "authors" or "codeowners"`);
    }
    let source_: TabConfig["source"];
    if (src.kind === "authors") {
      source_ = { kind: "authors" };
    } else {
      if (!src.section || typeof src.section !== "string") {
        throw new Error(`${source} "${label}.source.section" is required for a codeowners tab`);
      }
      if (src.excludeMembers !== undefined && typeof src.excludeMembers !== "boolean") {
        throw new Error(`${source} "${label}.source.excludeMembers" must be a boolean`);
      }
      source_ = { kind: "codeowners", section: src.section, ...(src.excludeMembers !== undefined ? { excludeMembers: src.excludeMembers } : {}) };
    }
    if (t.slackChannel !== undefined && typeof t.slackChannel !== "string") {
      throw new Error(`${source} "${label}.slackChannel" must be a string`);
    }
    if (t.reviewSkill !== undefined && typeof t.reviewSkill !== "string") {
      throw new Error(`${source} "${label}.reviewSkill" must be a string`);
    }
    return {
      id: t.id,
      label: t.label,
      source: source_,
      ...(t.slackChannel !== undefined ? { slackChannel: t.slackChannel } : {}),
      ...(t.reviewSkill !== undefined ? { reviewSkill: t.reviewSkill } : {}),
    };
  });
}

/** Shared with saveSwitchboardUrl's owned-branch write, so a trailing slash
    never lands in the store either — peer/onboard.ts builds `${url}/invites`
    verbatim, and a stored slash would double up into `//invites`. */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseSwitchboard(raw: unknown, source: string): SwitchboardBoardConfig {
  if (raw === undefined || raw === null) return { url: "" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source} "switchboard" must be an object`);
  }
  const s = raw as Partial<SwitchboardBoardConfig>;
  if (s.url !== undefined && typeof s.url !== "string") {
    throw new Error(`${source} "switchboard.url" must be a string`);
  }
  return { url: stripTrailingSlash(s.url ?? "") };
}

function parseSlack(raw: unknown, source: string): SlackConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLACK };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source} "slack" must be an object`);
  }
  const s = raw as Partial<SlackConfig>;
  for (const key of ["channel", "singleTemplate", "multiHeader", "multiItem"] as const) {
    if (s[key] !== undefined && (typeof s[key] !== "string" || !s[key])) {
      throw new Error(`${source} "slack.${key}" must be a non-empty string`);
    }
  }
  if (
    s.autoResolveIntervalMinutes !== undefined &&
    (typeof s.autoResolveIntervalMinutes !== "number" || s.autoResolveIntervalMinutes < 0)
  ) {
    throw new Error(`${source} "slack.autoResolveIntervalMinutes" must be a non-negative number`);
  }
  return {
    channel: s.channel ?? DEFAULT_SLACK.channel,
    singleTemplate: s.singleTemplate ?? DEFAULT_SLACK.singleTemplate,
    multiHeader: s.multiHeader ?? DEFAULT_SLACK.multiHeader,
    multiItem: s.multiItem ?? DEFAULT_SLACK.multiItem,
    autoResolveIntervalMinutes: s.autoResolveIntervalMinutes ?? DEFAULT_SLACK.autoResolveIntervalMinutes,
    emoji: parseSlackEmoji(s.emoji, source),
  };
}

/** Partial override: any role left out keeps its standard-emoji default.
    Names are accepted with or without colons (`:comment:` → `comment`). */
function parseSlackEmoji(raw: unknown, source: string): SlackEmojiConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLACK_EMOJI };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source} "slack.emoji" must be an object`);
  }
  const e = raw as Partial<SlackEmojiConfig>;
  const out = { ...DEFAULT_SLACK_EMOJI };
  for (const role of ["looking", "commented", "approved"] as const) {
    if (e[role] === undefined) continue;
    if (typeof e[role] !== "string") {
      throw new Error(`${source} "slack.emoji.${role}" must be a string (a Slack emoji name)`);
    }
    const name = e[role].trim().replace(/^:|:$/g, "");
    if (!name) throw new Error(`${source} "slack.emoji.${role}" must be a non-empty emoji name`);
    out[role] = name;
  }
  return out;
}

export function loadConfig(): BoardConfig {
  return loadConfigFrom(CONFIG_PATH, getSetting);
}

type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** Read one board.* key, degrading to "not owned" (`undefined`) on a resolver
    throw (an unregistered key, or an unreadable/malformed store file --
    getSetting never touches the daemon) rather than letting that brick
    config load — same fail-open contract as the deck latch (local-apps-
    settings-wt's withPlatformStoreFallback). Warns once per call, never
    throws. The `undefined` ownership probe below relies on every board.*
    registry row carrying no `default`: a registry default would make
    getSetting always return a value, so an unset key would misread as
    store-owned. */
function storeValue<T>(key: string, resolve: GetSettingFn): T | undefined {
  try {
    return resolve<T>(key).value;
  } catch (err) {
    console.warn(`board: ${key} unavailable, falling back to config.json`, err);
    return undefined;
  }
}

/**
 * Transition fallback (board settings migration): layers every board.* store
 * key over `fileConfig`, per key. A key the store doesn't yet own falls back
 * to config.json's value for it — ownership is a one-way latch decided fresh
 * on every load (never manufactured here; see the writers below). Two keys
 * bundle several BoardConfig fields (`board.workspaces`, `board.cwds`) since
 * those three fields apiece were never independently meaningful to split;
 * store-wins is per SUB-field there so setting one doesn't blank the other
 * two back to their zero value. `rtRepos` is derived from `board.gitlabHost`
 * and `board.projects` (see deriveRtRepos), with config.json's entries as
 * per-project overrides; there is no store key for it. The members roster overlays `board.hiddenMembers` (user-scope
 * usernames) onto the roster's `hidden` flags by username, replacing
 * whatever `hidden` flags the roster source (store or file) carried inline —
 * post-migration, hidden state lives only in the user key, never on the
 * team-owned member entries. Delete this function whole at cutover, once
 * config.json carries none of these fields.
 *
 * The store is a raw value straight off getSetting — unlike fileConfig, it
 * never went through parseConfig's normalization (ticketPrefixes' trim
 * +uppercase, switchboard's trailing-slash strip, slack's DEFAULT_SLACK fill
 * for an unset field, member/defaultMember shape checks). Building `merged`
 * and then round-tripping it through parseConfig — same move loadTriageConfig
 * makes with parseTriageBlock over a store value — applies that normalization
 * uniformly regardless of which side (file or store) a field came from,
 * rather than only ever normalizing the file's half.
 *
 * The round trip passes a store-level `source` label (not per-field
 * attribution): `merged` blends fields independently sourced from the store
 * or `fileConfig` field-by-field, and parseConfig's ~20 throw sites cover
 * both top-level and nested (slack.*, switchboard.*) paths, so precise
 * per-field attribution would mean threading a lookup (not a string) through
 * every nested parser here — judged not worth it since ANY thrown error
 * post-migration is far more likely to trace back to the store than a
 * config.json most installs won't even have; the label still correctly
 * points an operator at `rt settings`, not a file that may not exist.
 */
function withBoardStoreFallback(fileConfig: BoardConfig, resolve: GetSettingFn): BoardConfig {
  const workspaces = storeValue<{ reviews?: string; responds?: string; doctors?: string }>("board.workspaces", resolve);
  const cwds = storeValue<{ review?: string; respond?: string; doctor?: string }>("board.cwds", resolve);
  const roster = storeValue<Member[]>("board.members", resolve) ?? fileConfig.members;
  const hiddenStore = storeValue<string[]>("board.hiddenMembers", resolve);
  const hiddenUsernames = new Set(hiddenStore ?? roster.filter((m) => m.hidden).map((m) => m.username));
  const members = roster.map((m) => {
    const { hidden: _hidden, ...rest } = m;
    return hiddenUsernames.has(m.username) ? { ...rest, hidden: true } : rest;
  });

  const merged: BoardConfig = {
    ...fileConfig,
    gitlabHost: storeValue("board.gitlabHost", resolve) ?? fileConfig.gitlabHost,
    projects: storeValue("board.projects", resolve) ?? fileConfig.projects,
    members,
    title: storeValue("board.title", resolve) ?? fileConfig.title,
    botUsernames: storeValue("board.botUsernames", resolve) ?? fileConfig.botUsernames,
    ticketPrefixes: storeValue("board.ticketPrefixes", resolve) ?? fileConfig.ticketPrefixes,
    slack: storeValue("board.slack", resolve) ?? fileConfig.slack,
    doctorSkill: storeValue("board.doctorSkill", resolve) ?? fileConfig.doctorSkill,
    staleAfterDays: storeValue("board.staleAfterDays", resolve) ?? fileConfig.staleAfterDays,
    reviewsWorkspace: workspaces?.reviews ?? fileConfig.reviewsWorkspace,
    respondsWorkspace: workspaces?.responds ?? fileConfig.respondsWorkspace,
    doctorsWorkspace: workspaces?.doctors ?? fileConfig.doctorsWorkspace,
    defaultMember: storeValue("board.defaultMember", resolve) ?? fileConfig.defaultMember,
    claudeCommand: storeValue("board.claudeCommand", resolve) ?? fileConfig.claudeCommand,
    reviewCwd: cwds?.review ?? fileConfig.reviewCwd,
    respondCwd: cwds?.respond ?? fileConfig.respondCwd,
    doctorCwd: cwds?.doctor ?? fileConfig.doctorCwd,
    // Explicit entries only: the reparse below validates gitlabHost/projects
    // and derives the full map from them.
    rtRepos: fileConfig.rtRepoOverrides,
    switchboard: { url: storeValue("board.switchboardUrl", resolve) ?? fileConfig.switchboard.url },
    tabs: storeValue("board.tabs", resolve) ?? fileConfig.tabs,
  };

  return parseConfig(JSON.stringify(merged), "a board.* team settings-store value");
}

/** Structurally satisfies parseConfig's required-field check without being a
    real config; only ever used one line below, gated on the team store
    already owning all three fields, so the overlay that follows replaces
    every placeholder value before it can be observed by a caller. Lets the
    board boot config.json-free once cutover (plan Task 5) hands gitlabHost/
    projects/members fully to the team store. */
const NO_FILE_PLACEHOLDER = JSON.stringify({
  gitlabHost: "unset", projects: ["unset"], members: [{ username: "unset" }],
});

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function storeOwnsRequiredFields(resolve: GetSettingFn): boolean {
  return (
    storeValue("board.gitlabHost", resolve) !== undefined &&
    storeValue("board.projects", resolve) !== undefined &&
    storeValue("board.members", resolve) !== undefined
  );
}

/** Read `path`, layer the store on top — the shared reload every writer below
    returns through, so a write to one key never regresses another already-
    store-owned field back to its file value. A missing file degrades to the
    placeholder above only when the store already owns every required field;
    any other read failure (including a missing file the store can't cover)
    surfaces loudly, same as today. Exported (with `resolve` injectable) so
    the store-latch behavior is unit-testable without a real CONFIG_PATH or
    a real getSetting/rt-client store on disk. */
export function loadConfigFrom(path: string, resolve: GetSettingFn = getSetting): BoardConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (!isEnoent(err) || !storeOwnsRequiredFields(resolve)) {
      throw new Error(`config.json not found at ${path} — copy config.example.json and fill it in, or seed the team settings store`);
    }
    raw = NO_FILE_PLACEHOLDER;
  }
  return withBoardStoreFallback(parseConfig(raw), resolve);
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

/** Store ownership is a one-way latch, decided fresh on every write — see
    withBoardStoreFallback. `undefined` means unowned; a resolver throw
    degrades to unowned rather than crashing the write. */
function isHiddenMembersOwned(resolve: GetSettingFn): boolean {
  try {
    return resolve<unknown>("board.hiddenMembers").value !== undefined;
  } catch {
    return false;
  }
}

/**
 * Persist `username`'s hidden flag and return the reload. Unowned: config.json's
 * inline `members[].hidden` stays the single writer (today's behavior) —
 * UNLESS config.json doesn't exist at all (RULING: file-authority is
 * meaningless with no file), in which case this establishes store ownership
 * outright rather than raw-ENOENT-ing (mirrors loadConfigFrom's store-boot
 * mode; only reachable when the store already owns the required team fields,
 * since that's what a config.json-free `current` needs to resolve at all).
 * Owned: `board.hiddenMembers` (the user store) is the single writer instead
 * and config.json is never touched for this — every branch is exactly one
 * write, so a `write` throw simply propagates; nothing was persisted for it
 * to revert. A non-ENOENT file-read failure (a genuinely malformed
 * config.json) still surfaces loudly, same as today.
 */
/** Whether the settings store owns the roster itself (as opposed to the
    hidden overlay). Mirrors isHiddenMembersOwned: the ownership latch decides
    which file a roster edit must land in. */
function isMembersOwned(resolve: GetSettingFn): boolean {
  return storeValue<Member[]>("board.members", resolve) !== undefined;
}

/**
 * Replace the roster wholesale, honoring the ownership latch: a store-owned
 * roster is written to the team store, otherwise to config.json. Callers own
 * validation (duplicate, unknown) and pass the full next list; this only
 * persists it and hands back the reloaded config so the server can swap its
 * in-memory copy. Hidden flags ride along on the entries, matching how the
 * roster is stored today.
 */
export function saveRosterMembers(
  next: Member[],
  path: string = CONFIG_PATH,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting,
): BoardConfig {
  if (isMembersOwned(resolve)) {
    write("board.members", next, "team");
  } else {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      throw new Error(`config.json not found at ${path}`);
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.members = next;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n");
    renameSync(tmp, path);
  }
  return loadConfigFrom(path, resolve);
}

function isTabsOwned(resolve: GetSettingFn): boolean {
  return storeValue<unknown>("board.tabs", resolve) !== undefined;
}

/**
 * Replace the tab list wholesale, honoring the same ownership latch as the
 * roster: store-owned goes to the team store, otherwise config.json's "tabs"
 * (temp-file-plus-rename), and with no config.json at all this establishes
 * store ownership, per saveMemberHidden's ruling. The list is validated here
 * so a bad write can never leave a config the next boot refuses to load.
 */
export function saveTabs(
  next: unknown,
  path: string = CONFIG_PATH,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting,
): BoardConfig {
  const tabs = parseTabs(next, "tabs");
  if (isTabsOwned(resolve)) {
    write("board.tabs", tabs, "team");
  } else {
    let raw: Record<string, unknown> | undefined;
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
    if (raw === undefined) {
      loadConfigFrom(path, resolve);
      write("board.tabs", tabs, "team");
    } else {
      raw.tabs = tabs;
      writeFileSync(path + ".tmp", JSON.stringify(raw, null, 2) + "\n");
      renameSync(path + ".tmp", path);
    }
  }
  return loadConfigFrom(path, resolve);
}

export function saveMemberHidden(
  username: string,
  hidden: boolean,
  path: string = CONFIG_PATH,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting,
): BoardConfig {
  if (isHiddenMembersOwned(resolve)) {
    const current = loadConfigFrom(path, resolve);
    if (!current.members.some((m) => m.username === username)) {
      throw new Error(`unknown member "${username}"`);
    }
    const stored = resolve<string[]>("board.hiddenMembers").value ?? [];
    const next = hidden ? [...new Set([...stored, username])] : stored.filter((u) => u !== username);
    write("board.hiddenMembers", next, "user");
  } else {
    let raw: string | undefined;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
    if (raw === undefined) {
      const current = loadConfigFrom(path, resolve);
      if (!current.members.some((m) => m.username === username)) {
        throw new Error(`unknown member "${username}"`);
      }
      write("board.hiddenMembers", hidden ? [username] : [], "user");
    } else {
      const next = setHiddenInRaw(raw, username, hidden); // throws for an unknown member
      writeFileSync(path, next);
    }
  }
  return loadConfigFrom(path, resolve);
}

function isSwitchboardUrlOwned(resolve: GetSettingFn): boolean {
  try {
    return resolve<unknown>("board.switchboardUrl").value !== undefined;
  } catch {
    return false;
  }
}

/**
 * Persist switchboard.url and return the reload. Unowned: config.json (temp-
 * file-plus-rename, as before — a crashed write must not half-eat the
 * operator's config) — UNLESS config.json doesn't exist at all (RULING:
 * file-authority is meaningless with no file), in which case this establishes
 * store ownership outright instead of raw-ENOENT-ing, same move as
 * saveMemberHidden's config.json-free branch. Owned: `board.switchboardUrl`
 * (the machine store) instead, config.json untouched. Every branch is exactly
 * one write, like saveMemberHidden. A non-ENOENT file-read failure (malformed
 * JSON) still surfaces loudly, same as today.
 */
export function saveSwitchboardUrl(
  url: string,
  path: string = CONFIG_PATH,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting,
): BoardConfig {
  if (isSwitchboardUrlOwned(resolve)) {
    write("board.switchboardUrl", stripTrailingSlash(url), "machine");
  } else {
    let raw: Record<string, unknown> | undefined;
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
    if (raw === undefined) {
      write("board.switchboardUrl", stripTrailingSlash(url), "machine");
    } else {
      raw.switchboard = { url };
      const text = JSON.stringify(raw, null, 2) + "\n";
      writeFileSync(path + ".tmp", text);
      renameSync(path + ".tmp", path);
    }
  }
  return loadConfigFrom(path, resolve);
}

/** Every board secrets loader below shares this one call: env-first, then
    the rt daemon's token-gated `secrets:read` (scope "board"). `deps` exists
    only for tests -- production callers take the default (real api-token
    file + real daemon socket, resolved at call time by board-secrets.ts).
    Any daemon-side failure (down, gate-refused, old daemon) degrades to
    `{}` after a console.warn -- these are all optional secrets, so a daemon
    problem must disable the dependent feature, never crash the board. */
async function boardSecrets(deps?: BoardSecretsDeps): Promise<BoardSecretsData> {
  const res = await readBoardSecrets(deps);
  if (res.ok) return res;
  console.warn(`board: secrets unavailable (${res.message})`);
  return {};
}

/** Optional after the rt rewire: only the display-name lookup uses it; the
    board runs fully without one. Returns null when no token is configured. */
export async function loadGitLabToken(deps?: BoardSecretsDeps): Promise<string | null> {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  return (await boardSecrets(deps)).gitlabToken ?? null;
}

/** Slack user token (xoxp) for the review-thread integration. Optional: the
    board runs fine without it; the Slack menu actions just stay disabled.
    Returns null when no token is configured. */
export async function loadSlackToken(deps?: BoardSecretsDeps): Promise<string | null> {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;
  return (await boardSecrets(deps)).slackToken ?? null;
}

/** Switchboard board token. Optional: without it (or without switchboard.url)
    the board runs exactly as before, with all peer features disabled. */
export async function loadSwitchboardToken(deps?: BoardSecretsDeps): Promise<string | null> {
  if (process.env.SWITCHBOARD_TOKEN) return process.env.SWITCHBOARD_TOKEN;
  return (await boardSecrets(deps)).switchboardToken ?? null;
}

/** Switchboard ADMIN token (operator only). Presence of this secret is what
    turns on the board's invite affordances; absence changes nothing. */
export async function loadSwitchboardAdminToken(deps?: BoardSecretsDeps): Promise<string | null> {
  if (process.env.SWITCHBOARD_ADMIN_TOKEN) return process.env.SWITCHBOARD_ADMIN_TOKEN;
  return (await boardSecrets(deps)).switchboardAdminToken ?? null;
}
