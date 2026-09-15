/**
 * rt mr map: open MRs for a repo joined to the local worktrees holding
 * their branches (RT-147).
 *
 *   rt mr map [--repo <name>] [--json]
 */
import { readProjectMRs } from "../packages/rt-client/src/index.ts";
import { daemonQuery } from "../lib/daemon-client.ts";
import { currentRepoIdentity, resolveRepoArg } from "../lib/repo-arg.ts";
import { joinMrsToWorktrees } from "../lib/mr-map.ts";
import { flagValue } from "../lib/cli-args.ts";
import { explainError } from "./worktree.ts";

interface TreeRow {
  path: string;
  branch: string | null;
}

function fail(json: boolean, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt mr map: ${message}`);
  process.exit(1);
}

export async function mrMap(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const repoArg = flagValue(args, "--repo");
  const repoName = repoArg
    ? await resolveRepoArg(repoArg, (m) => fail(json, m))
    : currentRepoIdentity();
  if (!repoName) fail(json, "no repo, pass --repo <name> or run from inside a registered repo");

  const [mrsRes, treesRes] = await Promise.all([
    readProjectMRs(repoName, 20_000),
    daemonQuery("worktree:list", { repoName }),
  ]);

  if (!mrsRes.ok || !mrsRes.data) fail(json, mrsRes.error ?? "failed to read MRs");
  if (treesRes === null) fail(json, "daemon unavailable, the rt daemon must be running to list worktrees");
  if (!treesRes.ok) fail(json, explainError(treesRes.error ?? "failed to list worktrees"));

  const mrs = Object.values(mrsRes.data.mrs)
    .map((entry) => entry.pr)
    .filter((pr) => pr.state === "opened")
    .map((pr) => ({
      iid: pr.iid,
      title: pr.title,
      sourceBranch: pr.sourceBranch,
      state: pr.state,
      pipelineStatus: pr.pipeline?.status ?? null,
    }));

  const trees = ((treesRes.data?.trees ?? []) as TreeRow[]).map((t) => ({ path: t.path, branch: t.branch }));

  const rows = joinMrsToWorktrees(mrs, trees);

  if (json) {
    console.log(JSON.stringify({ ok: true, rows }));
    return;
  }

  if (rows.length === 0) {
    console.log("no open MRs");
    return;
  }

  const refWidth = Math.max(...rows.map((r) => r.ref.length));
  const branchWidth = Math.max(...rows.map((r) => r.sourceBranch.length));
  for (const row of rows) {
    console.log(`${row.ref.padEnd(refWidth)}  ${row.sourceBranch.padEnd(branchWidth)}  ${row.worktree ?? "NONE"}`);
  }
}
