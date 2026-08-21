// src/herdr.ts
import { homedir } from "os";
import { join } from "path";
import { reviewReportPath } from "./review-state.ts";

export type HerdrRunner = (args: string[]) => Promise<string>;

const HERDR_BIN = process.env.HERDR_BIN || join(homedir(), ".local", "bin", "herdr");
const HERDR_SOCKET_PATH = process.env.HERDR_SOCKET_PATH || join(homedir(), ".config", "herdr", "herdr.sock");

/** Runs the herdr CLI and returns stdout. Absolute binary + socket, since the server runs under a minimal launchd env. */
export const defaultRunner: HerdrRunner = async (args) => {
  const proc = Bun.spawn([HERDR_BIN, ...args], {
    env: { ...process.env, HERDR_SOCKET_PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`herdr ${args.join(" ")} failed (${code}): ${err || out}`);
  return out;
};

export function findWorkspaceIdByLabel(listJson: string, label: string): string | null {
  try {
    const list = JSON.parse(listJson) as { result?: { workspaces?: Array<{ workspace_id: string; label: string }> } };
    return list.result?.workspaces?.find((w) => w.label === label)?.workspace_id ?? null;
  } catch {
    return null;
  }
}

export function parseTabCreate(json: string): { tabId: string; paneId: string; workspaceId: string } | null {
  try {
    const r = JSON.parse(json).result;
    const tabId = r?.tab?.tab_id, paneId = r?.root_pane?.pane_id, workspaceId = r?.tab?.workspace_id ?? r?.root_pane?.workspace_id;
    return tabId && paneId ? { tabId, paneId, workspaceId } : null;
  } catch {
    return null;
  }
}

/** Tabs from `herdr tab list`, for label-based dedup. */
export function parseTabList(json: string): Array<{ tabId: string; label: string; workspaceId: string }> {
  try {
    const tabs = JSON.parse(json).result?.tabs;
    if (!Array.isArray(tabs)) return [];
    return tabs
      .map((t: { tab_id?: string; label?: string; workspace_id?: string }) => ({
        tabId: t?.tab_id ?? "",
        label: t?.label ?? "",
        workspaceId: t?.workspace_id ?? "",
      }))
      .filter((t) => t.tabId);
  } catch {
    return [];
  }
}

export function parseWorkspaceCreate(json: string): { workspaceId: string; tabId: string; paneId: string } | null {
  try {
    const r = JSON.parse(json).result;
    const workspaceId = r?.workspace?.workspace_id, tabId = r?.tab?.tab_id, paneId = r?.root_pane?.pane_id;
    return workspaceId && tabId && paneId ? { workspaceId, tabId, paneId } : null;
  } catch {
    return null;
  }
}

/** Wrap a string in single quotes for safe use in a double-and-single-quote shell command. */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Absolute path to the board's status-writer CLI for a given verb. The launched
    skill runs in the target repo's cwd (config.reviewCwd), not the board's, so the
    board passes this path in rather than the skill guessing where the board lives. */
export function statusBinPath(kind: "review" | "respond" | "doctor"): string {
  return join(import.meta.dir, "..", "bin", `${kind}-status.ts`);
}

/** Absolute path to the board's draft-writer CLI (see doctor-draft.ts). */
export function draftBinPath(): string {
  return join(import.meta.dir, "..", "bin", "doctor-draft.ts");
}

export interface SkillPromptOpts {
  mrUrl: string;
  statePath: string;
  /** Absolute path to the board's status-writer CLI (see statusBinPath). */
  statusBin: string;
  /** Domain skill the generic wrapper delegates to, e.g. "myteam:review".
      Omitted when unconfigured — the wrapper then reviews generically on its own. */
  skill?: string;
  /** Review only: absolute path the wrapper writes the full review markdown to. */
  reportPath?: string;
  /** Review only: this is a re-review of an already-reviewed MR. The wrapper
      reads any prior review at reportPath, frames the pass as a re-review, and
      falls back to a normal review if the author hasn't acted on feedback. */
  reReview?: boolean;
  /** Doctor only: repair tier the wrapper announces to the domain skill
      ("api" = no-checkout). Absent = the historical checkout-tier behavior. */
  tier?: string;
  /** Doctor only: enabled fix classes, kebab-case, comma-joined onto the flag. */
  fixClasses?: string[];
  /** Doctor only: absolute path to the board's draft-writer CLI. */
  draftBin?: string;
  /** Free-text instruction from the human who launched the pane, appended to
      the prompt as a trailing paragraph the wrapper skills know to honor. */
  note?: string;
}

/** The trailing paragraph a launch note becomes. The framing tells the wrapper
    (and the domain skill under it) this is direct human instruction, not a flag. */
export function operatorNoteParagraph(note: string): string {
  return `Operator note (from the human who launched this pane): ${note}`;
}

const NOTE_MAX_CHARS = 2000;

/** Validate the optional `note` on a launch request body. Blank/absent notes
    collapse to undefined so callers can thread the result straight through. */
export function parseLaunchNote(body: unknown): { ok: true; note?: string } | { ok: false; error: string } {
  const note = (body as { note?: unknown } | null)?.note;
  if (note === undefined || note === null) return { ok: true, note: undefined };
  if (typeof note !== "string") return { ok: false, error: "note must be a string" };
  const trimmed = note.trim();
  if (!trimmed) return { ok: true, note: undefined };
  if (trimmed.length > NOTE_MAX_CHARS) return { ok: false, error: `note too long (max ${NOTE_MAX_CHARS} chars)` };
  return { ok: true, note: trimmed };
}

/** Build the slash-command a launched herdr pane runs. The board injects every
    domain-specific value (skill, its own status-writer path) as a flag,
    so the wrapper skill itself carries no repo or path knowledge. */
function buildSkillPrompt(wrapper: string, o: SkillPromptOpts): string {
  const parts = [`/${wrapper}`, o.mrUrl, "--state", o.statePath, "--status-bin", o.statusBin];
  if (o.reportPath) parts.push("--report", o.reportPath);
  if (o.skill) parts.push("--skill", o.skill);
  if (o.reReview) parts.push("--re-review");
  if (o.tier) parts.push("--tier", o.tier);
  if (o.fixClasses?.length) parts.push("--fix-classes", o.fixClasses.join(","));
  if (o.draftBin) parts.push("--draft-bin", o.draftBin);
  const cmd = parts.join(" ");
  return o.note ? `${cmd}\n\n${operatorNoteParagraph(o.note)}` : cmd;
}

export function reviewPrompt(o: SkillPromptOpts): string {
  return buildSkillPrompt("mr-board:review", o);
}

export function respondPrompt(o: SkillPromptOpts): string {
  return buildSkillPrompt("mr-board:respond", o);
}

export function doctorPrompt(o: SkillPromptOpts): string {
  return buildSkillPrompt("mr-board:doctor", o);
}

/** The command a pane starts claude with. config.claudeCommand replaces plain
    "claude" verbatim (trusted operator config, e.g. a cswap wrapper that pins
    the account); empty/absent keeps the historical behavior. */
function claudeInvocation(claudeCommand?: string): string {
  return claudeCommand?.trim() || "claude";
}

/** Shell command that cd's into cwd and starts claude with the given prompt. */
export function buildPaneCommand(cwd: string, prompt: string, claudeCommand?: string): string {
  return `cd ${shellSingleQuote(cwd)} && ${claudeInvocation(claudeCommand)} ${shellSingleQuote(prompt)}`;
}

/** Shell command that cd's into cwd and resumes an existing claude session. With
    no prompt, claude drops the user into the interactive continuation; with one,
    claude resumes and sends it as the first message (used by re-review). */
export function buildResumePaneCommand(cwd: string, sessionId: string, prompt?: string, claudeCommand?: string): string {
  const base = `cd ${shellSingleQuote(cwd)} && ${claudeInvocation(claudeCommand)} --resume ${shellSingleQuote(sessionId)}`;
  return prompt ? `${base} ${shellSingleQuote(prompt)}` : base;
}

/** Directive sent into a resumed review session to re-review after the author
    responded. The session already holds the prior review, so this points it at
    the new activity and tells it to fall back to a full review if the author
    hasn't acted on any feedback. */
export function reReviewResumePrompt(iid: number): string {
  return [
    `This is a RE-REVIEW of !${iid}, which you already reviewed.`,
    `The author should have responded to your feedback since then — replied to or`,
    `resolved comment threads, and/or pushed new commits. First check whether the`,
    `author actually acted on your prior feedback. If they did, re-review: for each`,
    `comment you raised, was it adequately addressed, and are the new changes sound?`,
    `If NO action has been taken on your feedback since your last review, say so`,
    `explicitly ("no author action found since last review") and fall back to a`,
    `normal full review of the MR. Emit status via the status-bin exactly as before`,
    `(reviewing now, done with the human's chosen outcome at the end), and follow the`,
    `same posting gates — do not approve or post on your own.`,
  ].join(" ");
}

export interface LaunchPaneOpts {
  mrUrl: string;
  iid: number;
  cwd: string;
  workspaceLabel: string;
  statePath: string;
  /** Domain skill the launched wrapper delegates to (resolveLaunchSkill's result). */
  skill?: string;
  /** Command that starts claude in the pane (config.claudeCommand). Empty/absent = "claude". */
  claudeCommand?: string;
  /** Operator note appended to the launched prompt (see operatorNoteParagraph). */
  note?: string;
  /** Review only: launch this review with the re-review framing (see reviewPrompt). */
  reReview?: boolean;
  /** The MR author, shown in the tab label beside the id (a display name like
      "Grace Hopper", or the username). Omitted when the caller doesn't have it. */
  author?: string;
  /** Doctor only: repair tier the wrapper announces to the domain skill
      ("api" = no-checkout). Absent = the historical checkout-tier behavior. */
  tier?: string;
  /** Doctor only: enabled fix classes, kebab-case, comma-joined onto the flag. */
  fixClasses?: string[];
  /** Doctor only: absolute path to the board's draft-writer CLI. */
  draftBin?: string;
}

/** Tab label for an MR pane: the MR id, the author beside it when known, and an
    optional leading glyph (↺ resume, ⟲ re-review) that keeps pane kinds distinct. */
export function mrTabLabel(iid: number, author?: string, prefix?: string): string {
  const core = author ? `!${iid} ${author}` : `!${iid}`;
  return prefix ? `${prefix} ${core}` : core;
}

/** Ensure the named workspace exists, open a labelled tab in it, and run
    `prompt` inside claude in that tab. Shared launcher for review and respond;
    the caller supplies the prompt so each feature keeps its own skill wiring. */
async function launchInWorkspace(
  opts: LaunchPaneOpts,
  paneCommand: string,
  workspaceKind: string,
  tabLabel: string,
  runner: HerdrRunner,
): Promise<{ tabId: string; workspaceId: string }> {
  const workspaceId = findWorkspaceIdByLabel(await runner(["workspace", "list"]), opts.workspaceLabel);
  if (!workspaceId) {
    // A freshly created workspace already comes with an initial tab + pane. Reuse
    // that tab (rename it, run in its pane) instead of opening a second one, which
    // would leave the blank initial tab orphaned beside the work tab.
    const created = parseWorkspaceCreate(await runner(["workspace", "create", "--label", opts.workspaceLabel, "--no-focus"]));
    if (!created) throw new Error(`herdr: could not create ${workspaceKind} workspace`);
    await runner(["tab", "rename", created.tabId, tabLabel]);
    await runner(["pane", "run", created.paneId, paneCommand]);
    return { tabId: created.tabId, workspaceId: created.workspaceId };
  }
  // Dedup: if a tab with this exact label is already open in the workspace, focus
  // it instead of opening a duplicate (re-clicking resume/review/etc.). We do NOT
  // re-run the pane command — the existing tab already holds that work.
  const openTab = parseTabList(await runner(["tab", "list", "--workspace", workspaceId])).find(
    (t) => t.workspaceId === workspaceId && t.label === tabLabel,
  );
  if (openTab) {
    await runner(["tab", "focus", openTab.tabId]);
    return { tabId: openTab.tabId, workspaceId };
  }
  const tab = parseTabCreate(await runner(["tab", "create", "--workspace", workspaceId, "--label", tabLabel, "--no-focus"]));
  if (!tab) throw new Error(`herdr: could not create ${workspaceKind} tab`);
  await runner(["pane", "run", tab.paneId, paneCommand]);
  return { tabId: tab.tabId, workspaceId };
}

export async function launchReview(opts: LaunchPaneOpts, runner: HerdrRunner = defaultRunner): Promise<{ tabId: string; workspaceId: string }> {
  const prompt = reviewPrompt({
    mrUrl: opts.mrUrl,
    statePath: opts.statePath,
    statusBin: statusBinPath("review"),
    reportPath: reviewReportPath(opts.statePath),
    skill: opts.skill,
    reReview: opts.reReview,
    note: opts.note,
  });
  const tabLabel = mrTabLabel(opts.iid, opts.author, opts.reReview ? "⟲" : undefined);
  return launchInWorkspace(opts, buildPaneCommand(opts.cwd, prompt, opts.claudeCommand), "review", tabLabel, runner);
}

/** Start the MR-response skill in a fresh herdr tab under the responses workspace. */
export async function launchRespond(opts: LaunchPaneOpts, runner: HerdrRunner = defaultRunner): Promise<{ tabId: string; workspaceId: string }> {
  const prompt = respondPrompt({
    mrUrl: opts.mrUrl,
    statePath: opts.statePath,
    statusBin: statusBinPath("respond"),
    skill: opts.skill,
    note: opts.note,
  });
  return launchInWorkspace(opts, buildPaneCommand(opts.cwd, prompt, opts.claudeCommand), "respond", mrTabLabel(opts.iid, opts.author), runner);
}

/** Start the MR-doctor skill in a fresh herdr tab under the doctors workspace. */
export async function launchDoctor(opts: LaunchPaneOpts, runner: HerdrRunner = defaultRunner): Promise<{ tabId: string; workspaceId: string }> {
  const prompt = doctorPrompt({
    mrUrl: opts.mrUrl,
    statePath: opts.statePath,
    statusBin: statusBinPath("doctor"),
    skill: opts.skill,
    tier: opts.tier,
    fixClasses: opts.fixClasses,
    draftBin: opts.draftBin,
    note: opts.note,
  });
  return launchInWorkspace(opts, buildPaneCommand(opts.cwd, prompt, opts.claudeCommand), "doctor", mrTabLabel(opts.iid, opts.author), runner);
}

/** Resume an existing session in a new pane under the given workspace. The tab is
    labelled with a leading glyph (default `↺`) so a resumed pane is visually
    distinct from a fresh launch when the workspace has both. An optional `prompt`
    is sent as the first message (re-review uses this to direct the resumed
    session); `tabPrefix` overrides the glyph (e.g. `⟲` for a re-review resume). */
export async function launchResume(
  opts: LaunchPaneOpts & { sessionId: string; workspaceKind: string; prompt?: string; tabPrefix?: string },
  runner: HerdrRunner = defaultRunner,
): Promise<{ tabId: string; workspaceId: string }> {
  return launchInWorkspace(
    opts,
    buildResumePaneCommand(opts.cwd, opts.sessionId, opts.prompt, opts.claudeCommand),
    opts.workspaceKind,
    mrTabLabel(opts.iid, opts.author, opts.tabPrefix ?? "↺"),
    runner,
  );
}

/** Back-compat alias for old imports. Prefer LaunchPaneOpts. */
export type LaunchReviewOpts = LaunchPaneOpts;

export async function focusTab(tabId: string, runner: HerdrRunner = defaultRunner): Promise<void> {
  await runner(["tab", "focus", tabId]);
}
