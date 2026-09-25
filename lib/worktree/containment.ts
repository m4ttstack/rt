import { branchExistsLocalAsync, isAncestorAsync, remoteDefaultRef, remoteRefExists, runGit } from "./git-async.ts";
import { childEnv } from "../subprocess.ts";

export type Containment = "in-default" | "on-remote" | "in-merged-mr" | "patch-identical" | "none";

const FETCH_TIMEOUT_MS = 60_000;
const PATCH_ID_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 2_000;

async function fetchSha(treePath: string, sha: string): Promise<boolean> {
  const r = await runGit(treePath, ["fetch", "--no-tags", "-q", "origin", sha], { timeoutMs: FETCH_TIMEOUT_MS });
  return r.exitCode === 0;
}

async function hasObject(treePath: string, sha: string): Promise<boolean> {
  return (await runGit(treePath, ["cat-file", "-e", `${sha}^{commit}`])).exitCode === 0;
}

async function runPatchId(treePath: string, input: string): Promise<string | null> {
  const spawn = () =>
    Bun.spawn(["git", "patch-id", "--stable"], { cwd: treePath, env: childEnv(), stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn();
  } catch {
    return null;
  }
  const signal = (sig: "SIGTERM" | "SIGKILL") => {
    try { proc.kill(sig); } catch { /* already exited */ }
  };

  // stdout drains while stdin is written; dispose holds the tree lock, hence the deadline.
  const reading = Promise.all([new Response(proc.stdout).text(), proc.exited]).catch(() => null);
  const run = (async () => {
    try {
      await proc.stdin.write(input);
      await proc.stdin.end();
    } catch {
      signal("SIGKILL");
      return null;
    }
    const settled = await reading;
    return settled && settled[1] === 0 ? settled[0] : null;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS).unref?.();
      resolve(null);
    }, PATCH_ID_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stable patch-ids of `range`, one per commit. */
async function patchIds(treePath: string, range: string): Promise<Set<string> | null> {
  const log = await runGit(treePath, ["log", "-p", "--no-merges", "--format=commit %H", range]);
  if (log.exitCode !== 0) return null;
  const out = await runPatchId(treePath, log.stdout);
  if (out === null) return null;
  return new Set(out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]!));
}

/**
 * Every commit on HEAD that the default branch lacks has a patch-identical
 * twin on the MR side. Squash merges never match (their one commit is a new
 * patch); they still pass through the MR-sha ancestry check in containmentOf.
 * Missing objects fail closed.
 *
 * The MR side ranges from merge-base(HEAD, mrSha), not merge-base(defaultRef,
 * mrSha): once the forge's own merge (a merge commit or a fast-forward) has
 * landed, mrSha is itself an ancestor of defaultRef, collapsing
 * merge-base(defaultRef, mrSha) to mrSha and leaving the range empty. HEAD
 * never moved, so merge-base(HEAD, mrSha) still finds the real fork point.
 *
 * --no-merges on the local side would pass a local merge commit's own diff
 * (a conflict resolution, a file staged only at merge time) through unseen,
 * so any merge commit ahead of defaultRef fails the whole check closed
 * before patch-ids are even compared.
 */
export async function patchIdenticalToMr(
  treePath: string,
  mrSha: string,
  defaultRef: string,
  fetch: (sha: string) => Promise<boolean> = (sha) => fetchSha(treePath, sha),
  tip = "HEAD",
): Promise<boolean> {
  if (!(await hasObject(treePath, mrSha)) && !((await fetch(mrSha)) && (await hasObject(treePath, mrSha)))) return false;
  const localMerges = await runGit(treePath, ["rev-list", "--merges", `${defaultRef}..${tip}`]);
  if (localMerges.exitCode !== 0 || localMerges.stdout.trim().length > 0) return false;
  const mrBase = await runGit(treePath, ["merge-base", tip, mrSha]);
  if (mrBase.exitCode !== 0) return false;
  const local = await patchIds(treePath, `${defaultRef}..${tip}`);
  const merged = await patchIds(treePath, `${mrBase.stdout.trim()}..${mrSha}`);
  if (!local || !merged || local.size === 0) return false;
  for (const id of local) if (!merged.has(id)) return false;
  return true;
}

type MrHead = { state?: string | null; sha?: string | null };

/** Weakest first: a tree is only as contained as its least-contained tip. */
const STRENGTH: Containment[] = ["none", "patch-identical", "in-merged-mr", "on-remote", "in-default"];

/** Every tip dispose drops: HEAD, and the branch it deletes, which need not be checked out. */
async function droppedTips(treePath: string, branch: string | null): Promise<string[]> {
  const tips = ["HEAD"];
  if (branch && (await branchExistsLocalAsync(treePath, branch))) tips.push(`refs/heads/${branch}`);
  return tips;
}

const mergedShaOf = (mr: MrHead | null): string | null => (mr?.state === "merged" && mr.sha ? mr.sha : null);

/**
 * A merged MR proves containment only for the commits it actually merged: a
 * reused branch name can resurface an older lifecycle's merged entry (the
 * cache is branch-keyed, and a by-branch API lookup returns the old MR until
 * a new one opens), and trusting it would dispose committed work the merge
 * never saw. The MR's source head sha settles it: squash/rebase merges
 * rewrite the TARGET, never the source branch, so a tip being an ancestor of
 * `mr.sha` means everything on it reached the MR that merged.
 * No sha (pre-field cache rows) or an unknown sha never covers.
 */
export async function mergedMrCoversTips(treePath: string, branch: string | null, mr: MrHead | null): Promise<boolean> {
  const mergedSha = mergedShaOf(mr);
  if (!mergedSha) return false;
  for (const tip of await droppedTips(treePath, branch)) if (!(await isAncestorAsync(treePath, tip, mergedSha))) return false;
  return true;
}

/**
 * The one "is this work safe to drop" rule: triage offers Dispose on it and
 * dispose's containment guard refuses on it, so the two can never disagree.
 * Every tip dispose drops must be on the default branch, on origin/<branch>,
 * inside a merged MR's source head, or patch-identical to it. The MR checks
 * exist because squash and rebase merges leave local heads diverged from
 * what landed, so every ancestry check against the target reads "unpushed"
 * for work that demonstrably merged. The default branch alone is enough
 * because origin/<branch> outlives a forge's delete-on-merge until a prune.
 * Full refs, so a local branch named `origin/main` can never vouch.
 */
export async function containmentOf(
  treePath: string,
  branch: string | null,
  mr: MrHead | null,
  fetch?: (sha: string) => Promise<boolean>,
): Promise<Containment> {
  const defaultRef = `refs/remotes/${await remoteDefaultRef(treePath)}`;
  const branchRef = branch && (await remoteRefExists(treePath, branch)) ? `refs/remotes/origin/${branch}` : null;
  const mergedSha = mergedShaOf(mr);
  const tipContainment = async (tip: string): Promise<Containment> => {
    if (await isAncestorAsync(treePath, tip, defaultRef)) return "in-default";
    if (branchRef && (await isAncestorAsync(treePath, tip, branchRef))) return "on-remote";
    if (!mergedSha) return "none";
    if (await isAncestorAsync(treePath, tip, mergedSha)) return "in-merged-mr";
    return (await patchIdenticalToMr(treePath, mergedSha, defaultRef, fetch, tip)) ? "patch-identical" : "none";
  };
  let weakest: Containment = "in-default";
  for (const tip of await droppedTips(treePath, branch)) {
    const c = await tipContainment(tip);
    if (STRENGTH.indexOf(c) < STRENGTH.indexOf(weakest)) weakest = c;
    if (weakest === "none") break;
  }
  return weakest;
}
