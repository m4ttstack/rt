/**
 * Wire types for the rt-ui bridge. One JSON object per line, UTF-8. The
 * same shapes are golden-tested from Go against ui/fixtures/*.json; a
 * change here without a fixture change is a contract break.
 */

export const PROTOCOL_VERSION = 1 as const;

export interface PromptOption {
  value: string;
  label: string;
  hint?: string;
}

interface PromptBase {
  t: "prompt";
  protocol: typeof PROTOCOL_VERSION;
  /** Domain text only: a description, or the validation message a re-prompt carries. Go composes the keybind header itself. */
  hint?: string;
}

export interface SelectSpec extends PromptBase {
  kind: "select";
  title: string;
  options: PromptOption[];
  initial?: string;
  back?: { label: string };
}

export interface MultiselectSpec extends PromptBase {
  kind: "multiselect";
  title: string;
  options: PromptOption[];
  initial?: string[];
  min?: number;
  max?: number;
}

export interface ConfirmSpec extends PromptBase {
  kind: "confirm";
  message: string;
  default?: boolean;
  destructive?: boolean;
}

export interface TextSpec extends PromptBase {
  kind: "text";
  title: string;
  placeholder?: string;
  initial?: string;
  validate?: { pattern: string; message: string };
}

export type PromptSpec = SelectSpec | MultiselectSpec | ConfirmSpec | TextSpec;

export type PromptResult =
  | { t: "result"; value: string }
  | { t: "result"; values: string[] }
  | { t: "result"; ok: boolean }
  | { t: "result"; text: string };

export type StepLevel = "info" | "warn" | "error" | "success";

export type StepEvent =
  | { t: "hello"; protocol: typeof PROTOCOL_VERSION }
  | { t: "start"; title: string }
  | { t: "log"; level: StepLevel; text: string }
  | { t: "done"; title: string; hint?: string }
  | { t: "fail"; title: string; hint?: string };

export function encodeLine(msg: object): string {
  return JSON.stringify(msg) + "\n";
}

export function parsePromptResult(line: string): PromptResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    throw new Error(`rt-ui result: not JSON: ${line.slice(0, 120)}`);
  }
  const r = parsed as Record<string, unknown>;
  if (r?.t !== "result") throw new Error(`rt-ui result: unexpected message ${line.slice(0, 120)}`);
  if (typeof r.value === "string") return { t: "result", value: r.value };
  if (Array.isArray(r.values)) return { t: "result", values: r.values.map(String) };
  if (typeof r.ok === "boolean") return { t: "result", ok: r.ok };
  if (typeof r.text === "string") return { t: "result", text: r.text };
  throw new Error(`rt-ui result: no value/values/ok/text in ${line.slice(0, 120)}`);
}

// ─── session ─────────────────────────────────────────────────────────────────

export type BoardState = "running" | "stopped" | "crashed" | "starting" | "stopping";

export interface BoardTailLine {
  text: string;
}

export interface BoardEntry {
  id: string;
  name: string;
  command: string;
  pkg: string;
  repo: string;
  state: BoardState;
  startedAt: string | null;
  exitCode: number | null;
  error: string | null;
  url: string | null;
  tail: BoardTailLine[] | null;
}

export interface BoardModel {
  workspace: string;
  entries: BoardEntry[];
}

// ─── mission ─────────────────────────────────────────────────────────────────

export interface MissionBadge {
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  clean: boolean;
  lastFetchedAt: string;
}

export interface MissionRepoRow {
  id: string;
  label: string;
  group: string;
  badge: MissionBadge;
  current: boolean;
}

export interface MissionWorktreeRow {
  path: string;
  name: string;
  branch: string;
  badge: MissionBadge;
  current: boolean;
  onDeck: boolean;
}

export interface MissionBranchRow {
  name: string;
  current: boolean;
  ahead: number;
  behind: number;
  /** "" = free; else the refusal detail. */
  guardedBy: string;
  group: "default branch" | "recent" | "other" | "guarded";
  /** True for the repo's remote default branch (origin/main or origin/master), stripped of the "origin/" prefix to compare against local branch names. */
  default: boolean;
  /** Driver-computed relative date, GHD-style ("2 days ago", "last month"); "" for the current row, which shows its ahead/behind pills instead. */
  when: string;
}

export interface MissionChangeRow {
  path: string;
  origPath: string;
  status: "new" | "modified" | "deleted" | "renamed" | "copied" | "conflicted";
  include: "all" | "none" | "partial";
}

export interface MissionDiffLine {
  /** 0 = absent. */
  oldNo: number;
  /** 0 = absent. */
  newNo: number;
  kind: "context" | "add" | "del" | "hunk";
  text: string;
  /** Staging selection state for add/del lines. */
  selected: boolean;
  /** git-core DiffSelection line index; -1 for context/hunk. */
  selIdx: number;
}

export interface MissionDiffModel {
  path: string;
  status: string;
  kind: "text" | "binary" | "oversized" | "none";
  stats: string;
  /** Chroma lexer hint, e.g. "typescript"; "" = plain. */
  lang: string;
  lines: MissionDiffLine[];
  /** A committed diff (History): no stage gutter, nothing toggles. */
  readOnly: boolean;
}

export interface MissionHistoryCommitRow {
  sha: string;
  shortSha: string;
  summary: string;
  /** GHD's commit-attribution: "A", "A, B", or "N people". */
  byline: string;
  /** Driver-computed relative author date. */
  when: string;
  /** Date header the row sits under: "Today", "Yesterday", "Earlier this week", "Last week", or "September 2026". */
  group: string;
  tags: string[];
  unpushed: boolean;
  /** The driver's selection; the view adopts it when its own cursor falls off the list. */
  selected: boolean;
}

export interface MissionHistoryHeader {
  summary: string;
  body: string;
  byline: string;
  /** Expanded author list, "Name <email>" (GHD renderExpandedAuthor). */
  authors: string[];
  sha: string;
  shortSha: string;
  linesAdded: number;
  linesDeleted: number;
  tags: string[];
  /** Selected commit count; above 1 the header reads "Showing changes from N commits". */
  rangeCount: number;
  contiguous: boolean;
}

export interface MissionHistoryFileRow {
  path: string;
  origPath: string;
  status: MissionChangeRow["status"];
  /** The path exists in the current worktree, not just in the commit. */
  onDisk: boolean;
}

export interface MissionHistoryModel {
  commits: MissionHistoryCommitRow[];
  hasMore: boolean;
  loading: boolean;
  header: MissionHistoryHeader | null;
  files: MissionHistoryFileRow[];
  selectedFile: string;
}

export interface MissionActionModel {
  kind: "fetch" | "pull" | "pull-rebase" | "push" | "force-push" | "publish-branch" | "publish-repo" | "busy" | "detached";
  title: string;
  meta: string;
  ahead: number;
  behind: number;
  busy: boolean;
}

export interface MissionLastCommit {
  summary: string;
  /** Driver-computed relative date, GHD-style ("2 minutes ago") -- same convention as action.meta and MissionBranchRow.when; the view renders it verbatim. */
  when: string;
  undoable: boolean;
}

export interface MissionCommitModel {
  summary: string;
  description: string;
  placeholder: string;
  amending: boolean;
  /** Driver-computed, e.g. "Commit 3 files to main". */
  buttonLabel: string;
  canCommit: boolean;
  lastCommit: MissionLastCommit | null;
}

export interface MissionCurrent {
  repo: string;
  repoLabel: string;
  worktree: string;
  worktreeName: string;
  branch: string;
  detached: boolean;
  /** The tree was provisioned moments ago and its ready steps are still running in the daemon. */
  settling: boolean;
}

export interface MissionModel {
  current: MissionCurrent;
  action: MissionActionModel;
  repos: MissionRepoRow[];
  worktrees: MissionWorktreeRow[];
  branches: MissionBranchRow[];
  changes: MissionChangeRow[];
  changedTotal: number;
  stagedTotal: number;
  filter: string;
  diff: MissionDiffModel;
  commit: MissionCommitModel;
  stashCount: number;
  /** One-line transient notice (guard refusals, not-yet-wired). */
  notice: string;
  tab: "changes" | "history";
  history: MissionHistoryModel;
  /** `rt code`'s resolved editor for the current worktree ("Zed"), "" when none resolves. */
  editorLabel: string;
}

export interface SessionHello {
  t: "hello";
  protocol: number;
  version: string;
  views: string[];
}

const SESSION_INTENT_NAMES = [
  "add",
  "restart",
  "stop",
  "focus",
  "tail",
  "quit",
  "open",
  "edit",
  "mission:action",
  "mission:stage",
  "mission:discard",
  "mission:commit",
  "mission:undo",
  "mission:checkout",
  "mission:worktree",
  "mission:repo",
  "mission:select",
  "mission:refresh",
  "mission:tab",
  "mission:history-select",
  "mission:history-file",
  "mission:history-more",
  "mission:menu-action",
] as const;

export interface SessionIntent {
  t: "intent";
  name: (typeof SESSION_INTENT_NAMES)[number];
  entryId?: string;
  open?: boolean;
  command?: string;
  /** Mission intents carry their own shape here; this package never learns it. */
  payload?: unknown;
}

const SESSION_CLOSED_REASONS = ["quit", "cancel", "closed", "error"] as const;

export interface SessionClosed {
  t: "closed";
  reason: (typeof SESSION_CLOSED_REASONS)[number];
  message?: string;
}

export type SessionInbound = SessionHello | SessionIntent | SessionClosed;

// ─── pick ────────────────────────────────────────────────────────────────────

export interface PickSegment {
  text: string;
  tone?: string;
  hex?: string;
  bold?: boolean;
  /** A label segment: the picker pads it to the widest column segment in the list (capped), so the hint after it starts at one shared column on every row. */
  column?: boolean;
}

/** A button-like row: leads with `glyph` (or the picker's generic action glyph) and wears the action tokens instead of the entry ones. */
export type PickRowKind = "action";

export interface PickRow {
  value: string;
  left: PickSegment[];
  right?: PickSegment[];
  match?: string;
  group?: string;
  /** "action": a button-like row (run's "Launch all"). See PickRowKind. */
  kind?: PickRowKind;
  /** An action row's leading icon, a Nerd Font symbol by convention; omitted falls back to the picker's generic action glyph. */
  glyph?: string;
  /** An action row's tone (segment tone vocabulary) for glyph, text and cursor bar; its highlight derives from it. Omitted is the picker's default accent (lav). */
  accent?: string;
  /** The row's expanded tail: while it is the cursor row or hovered, these segments paint in place of everything after its label (the column segment, or the whole left when there is none). */
  detail?: PickSegment[];
  /** Marks a row whose primary action can run with extra arguments; render.go's alt-held with-args chrome keys off this. */
  withArgs?: boolean;
}

export interface PickAction {
  id: string;
  label: string;
  key?: string;
  scope: "item" | "global";
  group?: string;
  primary?: boolean;
  /** True: the picker stays open and reports an event; absent/false: it closes with a result. */
  event?: boolean;
  /** Keeps the action bound and dispatchable but out of the footer keybar legend; the command-tree root sets it on the ctrl-up back action so that key still cancels without advertising a back with nowhere to go. */
  footerHidden?: boolean;
}

export interface PickRequest {
  t: "pick";
  protocol: 1;
  message: string;
  /**
   * "fullscreen" (default) takes the alternate screen: the frame fills the
   * pane, the keybar docks to the bottom, `cap` does not apply, and leaving
   * the screen erases every trace. "inline" keeps the content-anchored
   * renderer (paints where invoked, reserved floor, clears itself on quit).
   */
  layout?: "fullscreen" | "inline";
  breadcrumb?: string[];
  rows: PickRow[];
  actions?: PickAction[];
  multi?: boolean;
  initialValues?: string[];
  initialQuery?: string;
  resumeValue?: string;
  exact?: boolean;
  cap?: number;
  selectedPanel?: boolean;
  /** Faint count-slot text shown while the query is empty (nav's "N folders · M files"); a non-empty query falls back to the cyan matched-count. */
  idleCount?: string;
  /** Faint run appended after the bold breadcrumb segments (nav's non-default sort suffix), so it never reads as another bold segment. */
  crumbSuffix?: string;
  /** Enter on a no-match filter resolves with `{action:"select", value:null, query}` instead of leaving the picker open. */
  acceptNoMatch?: boolean;
  // Opts a breadcrumb segment click into emitting a {action:"crumb",
  // value:"<segment index>"} event; without it a crumb click is inert.
  crumbEvents?: boolean;
}

export interface PickUpdate {
  t: "update";
  rows?: PickRow[];
  message?: string;
  actions?: PickAction[];
  /** Replaces the rendered header (Go renders Breadcrumb, not Message) on an in-place row swap. */
  breadcrumb?: string[];
  /** Patches the empty-query count slot (nav's "N folders · M files"). See PickRequest.idleCount. */
  idleCount?: string;
  /** Patches the faint breadcrumb suffix; rides with `breadcrumb`, so an update carrying a breadcrumb but no suffix clears it. See PickRequest.crumbSuffix. */
  crumbSuffix?: string;
  /** Clears the typed query and re-ranks against the (possibly also-patched) rows. */
  resetQuery?: boolean;
}

export interface PickModal {
  t: "modal";
  message: string;
  rows: PickRow[];
}

export interface PickEvent {
  t: "event";
  action: string;
  value: string | null;
  query: string;
}

export interface PickModalResult {
  t: "modal-result";
  value: string | null;
}

export interface PickResult {
  t: "result";
  action: string;
  value: string | null;
  values?: string[];
  query: string;
}

export function parseSessionLine(line: string): SessionInbound {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    throw new Error(`rt-ui session: not JSON: ${line.slice(0, 120)}`);
  }
  const m = parsed as Record<string, unknown>;
  switch (m?.t) {
    case "hello":
      if (typeof m.protocol !== "number" || !Array.isArray(m.views)) break;
      return { t: "hello", protocol: m.protocol, version: String(m.version ?? ""), views: m.views.map(String) };
    case "intent":
      if (typeof m.name !== "string" || !SESSION_INTENT_NAMES.includes(m.name as SessionIntent["name"])) break;
      return {
        t: "intent",
        name: m.name as SessionIntent["name"],
        ...(typeof m.entryId === "string" ? { entryId: m.entryId } : {}),
        ...(typeof m.open === "boolean" ? { open: m.open } : {}),
        ...(typeof m.command === "string" ? { command: m.command } : {}),
        ...("payload" in m ? { payload: m.payload } : {}),
      };
    case "closed":
      if (typeof m.reason !== "string" || !SESSION_CLOSED_REASONS.includes(m.reason as SessionClosed["reason"])) break;
      return { t: "closed", reason: m.reason as SessionClosed["reason"], ...(typeof m.message === "string" ? { message: m.message } : {}) };
  }
  throw new Error(`rt-ui session: unexpected message ${line.slice(0, 120)}`);
}
