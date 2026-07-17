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
  /** Review only: slack channel (no #) for the "looking" 👀 signal. */
  channel?: string;
}

/** Build the slash-command a launched herdr pane runs. The board injects every
    domain-specific value (skill, channel, its own status-writer path) as a flag,
    so the wrapper skill itself carries no repo, channel, or path knowledge. */
function buildSkillPrompt(wrapper: string, o: SkillPromptOpts): string {
  const parts = [`/${wrapper}`, o.mrUrl, "--state", o.statePath, "--status-bin", o.statusBin];
  if (o.reportPath) parts.push("--report", o.reportPath);
  if (o.skill) parts.push("--skill", o.skill);
  if (o.channel) parts.push("--channel", o.channel);
  return parts.join(" ");
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

/** Shell command that cd's into cwd and starts claude with the given prompt. */
export function buildPaneCommand(cwd: string, prompt: string): string {
  return `cd ${shellSingleQuote(cwd)} && claude ${shellSingleQuote(prompt)}`;
}

/** Shell command that cd's into cwd and resumes an existing claude session --
    no prompt argument, so claude drops the user into the interactive continuation. */
export function buildResumePaneCommand(cwd: string, sessionId: string): string {
  return `cd ${shellSingleQuote(cwd)} && claude --resume ${shellSingleQuote(sessionId)}`;
}

export interface LaunchPaneOpts {
  mrUrl: string;
  iid: number;
  cwd: string;
  workspaceLabel: string;
  statePath: string;
  /** Domain skill the launched wrapper delegates to (config.reviewSkill etc.). */
  skill?: string;
  /** Review only: slack channel (no #) for the "looking" 👀 signal. */
  channel?: string;
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
  let workspaceId = findWorkspaceIdByLabel(await runner(["workspace", "list"]), opts.workspaceLabel);
  if (!workspaceId) {
    const created = parseWorkspaceCreate(await runner(["workspace", "create", "--label", opts.workspaceLabel, "--no-focus"]));
    if (!created) throw new Error(`herdr: could not create ${workspaceKind} workspace`);
    workspaceId = created.workspaceId;
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
    channel: opts.channel,
  });
  return launchInWorkspace(opts, buildPaneCommand(opts.cwd, prompt), "review", `!${opts.iid}`, runner);
}

/** Start the MR-response skill in a fresh herdr tab under the responses workspace. */
export async function launchRespond(opts: LaunchPaneOpts, runner: HerdrRunner = defaultRunner): Promise<{ tabId: string; workspaceId: string }> {
  const prompt = respondPrompt({
    mrUrl: opts.mrUrl,
    statePath: opts.statePath,
    statusBin: statusBinPath("respond"),
    skill: opts.skill,
  });
  return launchInWorkspace(opts, buildPaneCommand(opts.cwd, prompt), "respond", `!${opts.iid}`, runner);
}

/** Start the MR-doctor skill in a fresh herdr tab under the doctors workspace. */
export async function launchDoctor(opts: LaunchPaneOpts, runner: HerdrRunner = defaultRunner): Promise<{ tabId: string; workspaceId: string }> {
  const prompt = doctorPrompt({
    mrUrl: opts.mrUrl,
    statePath: opts.statePath,
    statusBin: statusBinPath("doctor"),
    skill: opts.skill,
  });
  return launchInWorkspace(opts, buildPaneCommand(opts.cwd, prompt), "doctor", `!${opts.iid}`, runner);
}

/** Resume an existing session in a new pane under the given workspace. The tab
    is labelled with a leading `↺` so a resumed pane is visually distinct from a
    fresh launch when the workspace has both. */
export async function launchResume(
  opts: LaunchPaneOpts & { sessionId: string; workspaceKind: string },
  runner: HerdrRunner = defaultRunner,
): Promise<{ tabId: string; workspaceId: string }> {
  return launchInWorkspace(
    opts,
    buildResumePaneCommand(opts.cwd, opts.sessionId),
    opts.workspaceKind,
    `↺ !${opts.iid}`,
    runner,
  );
}

/** Back-compat alias for old imports. Prefer LaunchPaneOpts. */
export type LaunchReviewOpts = LaunchPaneOpts;

export async function focusTab(tabId: string, runner: HerdrRunner = defaultRunner): Promise<void> {
  await runner(["tab", "focus", tabId]);
}
