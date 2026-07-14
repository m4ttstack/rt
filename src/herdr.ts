// src/herdr.ts
import { homedir } from "os";
import { join } from "path";

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

export function reviewPrompt(mrUrl: string, statePath: string): string {
  return `/mattstack:mr-board-review ${mrUrl} --state ${statePath}`;
}

export function buildPaneCommand(cwd: string, mrUrl: string, statePath: string): string {
  return `cd ${shellSingleQuote(cwd)} && claude ${shellSingleQuote(reviewPrompt(mrUrl, statePath))}`;
}

export interface LaunchReviewOpts {
  mrUrl: string;
  iid: number;
  cwd: string;
  workspaceLabel: string;
  statePath: string;
}

/** Ensure the reviews workspace, open a fresh labelled tab, and start the review agent in it. */
export async function launchReview(opts: LaunchReviewOpts, runner: HerdrRunner = defaultRunner): Promise<{ tabId: string; workspaceId: string }> {
  let workspaceId = findWorkspaceIdByLabel(await runner(["workspace", "list"]), opts.workspaceLabel);
  if (!workspaceId) {
    const created = parseWorkspaceCreate(await runner(["workspace", "create", "--label", opts.workspaceLabel, "--no-focus"]));
    if (!created) throw new Error("herdr: could not create reviews workspace");
    workspaceId = created.workspaceId;
  }
  const tab = parseTabCreate(await runner(["tab", "create", "--workspace", workspaceId, "--label", `!${opts.iid}`, "--no-focus"]));
  if (!tab) throw new Error("herdr: could not create review tab");
  await runner(["pane", "run", tab.paneId, buildPaneCommand(opts.cwd, opts.mrUrl, opts.statePath)]);
  return { tabId: tab.tabId, workspaceId };
}

export async function focusTab(tabId: string, runner: HerdrRunner = defaultRunner): Promise<void> {
  await runner(["tab", "focus", tabId]);
}
