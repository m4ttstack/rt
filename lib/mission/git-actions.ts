import { scrubGitEnv } from "../../packages/git-core/src/exec.ts";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";

export type ActionKind =
  | "fetch"
  | "pull"
  | "pull-rebase"
  | "push"
  | "force-push"
  | "publish-branch"
  | "publish-repo"
  | "detached"
  | "busy";

export interface ActionState {
  kind: ActionKind;
  title: string;
  meta: string;
  ahead: number;
  behind: number;
}

export interface ActionResult {
  ok: boolean;
  detail: string;
}

function formatFetchMeta(lastFetchedAt: string | null): string {
  if (lastFetchedAt === null) return "Never fetched";
  const diffMs = Math.max(0, Date.now() - new Date(lastFetchedAt).getTime());
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Last fetched just now";
  if (minutes < 60) return `Last fetched ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last fetched ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Last fetched ${days} day${days === 1 ? "" : "s"} ago`;
}

// Selection order is GHD parity, not priority-by-convenience: busy freezes
// the display before anything else is even inspected, and a diverged repo
// always renders as Pull-with-both-counts -- there is deliberately no
// combined pull-then-push state.
export function deriveAction(input: {
  badge: GitWorktreeBadge;
  remoteName: string | null;
  detached: boolean;
  unborn: boolean;
  pullRebase: boolean;
  forcePushRecommended: boolean;
  busy: boolean;
}): ActionState {
  const { badge, remoteName, detached, unborn, pullRebase, forcePushRecommended, busy } = input;
  const ahead = badge.ahead ?? 0;
  const behind = badge.behind ?? 0;
  const meta = formatFetchMeta(badge.lastFetchedAt);

  if (busy) return { kind: "busy", title: "Working", meta, ahead, behind };
  if (remoteName === null) return { kind: "publish-repo", title: "Publish repository", meta, ahead, behind };
  if (unborn) return { kind: "fetch", title: "Fetch origin", meta, ahead, behind };
  if (detached) return { kind: "detached", title: "Detached HEAD", meta, ahead, behind };
  if (badge.upstream === null) return { kind: "publish-branch", title: "Publish branch", meta, ahead, behind };
  if (ahead === 0 && behind === 0) return { kind: "fetch", title: "Fetch origin", meta, ahead, behind };
  if (forcePushRecommended) return { kind: "force-push", title: "Force push origin", meta, ahead, behind };
  if (behind > 0) {
    return pullRebase
      ? { kind: "pull-rebase", title: "Pull origin with rebase", meta, ahead, behind }
      : { kind: "pull", title: "Pull origin", meta, ahead, behind };
  }
  return { kind: "push", title: "Push origin", meta, ahead, behind };
}

function lastStderrLine(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines[lines.length - 1]! : "";
}

async function spawnGit(cwd: string, args: string[]): Promise<ActionResult> {
  // Scrubbed so an inherited GIT_DIR/GIT_WORK_TREE (e.g. from a git hook)
  // cannot redirect this action at a repo other than the one named by cwd.
  const proc = Bun.spawn(["git", ...args], { cwd, env: scrubGitEnv(), stdout: "pipe", stderr: "pipe" });
  const [, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) return { ok: false, detail: lastStderrLine(err) };
  return { ok: true, detail: "" };
}

// getRemoteDefaultBranch's local-first path (mission's own interactive
// resolve, see its doc comment) trusts refs/remotes/<remote>/HEAD, which a
// plain fetch does not refresh once set -- it can go stale after the
// server's default branch is renamed. Fetch/pull already pay the network
// cost here, so riding this along closes that staleness window for free.
// Best-effort only: a failure (offline, no permission to write the ref)
// must never surface as this action's own failure.
async function refreshDefaultBranchSymref(cwd: string, remote: string): Promise<void> {
  try {
    await spawnGit(cwd, ["remote", "set-head", remote, "-a"]);
  } catch { /* self-heal only; never fails the action it rides along with */ }
}

/** Publishing a repository needs a name and visibility first, so it runs through publishRepo, never here. */
export type RunnableAction = Exclude<ActionKind, "publish-repo">;

export async function runAction(
  cwd: string,
  kind: RunnableAction,
  opts: { remote?: string; branch: string | null },
): Promise<ActionResult> {
  const remote = opts.remote ?? "origin";
  switch (kind) {
    case "busy":
      return { ok: false, detail: "an action is already in progress" };
    case "detached":
      return { ok: false, detail: "cannot run a remote action while checked out on a commit, not a branch" };
    case "fetch": {
      const result = await spawnGit(cwd, ["fetch", "--quiet", remote]);
      if (result.ok) await refreshDefaultBranchSymref(cwd, remote);
      return result;
    }
    case "pull": {
      const result = await spawnGit(cwd, ["pull", remote]);
      if (result.ok) await refreshDefaultBranchSymref(cwd, remote);
      return result;
    }
    case "pull-rebase": {
      const result = await spawnGit(cwd, ["pull", "--rebase", remote]);
      if (result.ok) await refreshDefaultBranchSymref(cwd, remote);
      return result;
    }
    case "push":
      return spawnGit(cwd, ["push", remote]);
    case "force-push":
      return spawnGit(cwd, ["push", "--force-with-lease", remote]);
    case "publish-branch":
      if (!opts.branch) return { ok: false, detail: "no branch to publish" };
      return spawnGit(cwd, ["push", "-u", remote, opts.branch]);
  }
}

/**
 * GitHub Desktop's Publish Repository through the GitHub CLI: creates the
 * repo (`name` may be `owner/name` for an organization), adds it as origin,
 * and pushes. `gh` is a parameter so tests can stand in for it.
 */
export async function publishRepo(
  cwd: string,
  opts: { name: string; private: boolean },
  gh = "gh",
): Promise<ActionResult> {
  const args = ["repo", "create", opts.name, opts.private ? "--private" : "--public", "--source", cwd, "--remote", "origin", "--push"];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([gh, ...args], { cwd, env: scrubGitEnv(), stdout: "pipe", stderr: "pipe" });
  } catch {
    return { ok: false, detail: "publishing a repository needs the GitHub CLI (gh)" };
  }
  const [, err, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  if (code !== 0) return { ok: false, detail: lastStderrLine(err) };
  return { ok: true, detail: "" };
}
