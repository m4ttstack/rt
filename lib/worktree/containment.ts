import { isAncestorAsync, remoteDefaultRef, remoteRefExists, runGit } from "./git-async.ts";
import { childEnv } from "../subprocess.ts";

export type Containment = "in-default" | "on-remote" | "patch-identical" | "none";

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
 * patch); they still pass through the MR-sha ancestry check in dispose.
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
): Promise<boolean> {
  if (!(await hasObject(treePath, mrSha)) && !((await fetch(mrSha)) && (await hasObject(treePath, mrSha)))) return false;
  const localMerges = await runGit(treePath, ["rev-list", "--merges", `${defaultRef}..HEAD`]);
  if (localMerges.exitCode !== 0 || localMerges.stdout.trim().length > 0) return false;
  const mrBase = await runGit(treePath, ["merge-base", "HEAD", mrSha]);
  if (mrBase.exitCode !== 0) return false;
  const local = await patchIds(treePath, `${defaultRef}..HEAD`);
  const merged = await patchIds(treePath, `${mrBase.stdout.trim()}..${mrSha}`);
  if (!local || !merged || local.size === 0) return false;
  for (const id of local) if (!merged.has(id)) return false;
  return true;
}

export async function containmentOf(
  treePath: string,
  branch: string | null,
  mr: { state?: string | null; sha?: string | null } | null,
  fetch?: (sha: string) => Promise<boolean>,
): Promise<Containment> {
  const defaultRef = await remoteDefaultRef(treePath);
  if (await isAncestorAsync(treePath, "HEAD", defaultRef)) return "in-default";
  if (branch && (await remoteRefExists(treePath, branch)) && (await isAncestorAsync(treePath, "HEAD", `refs/remotes/origin/${branch}`))) {
    return "on-remote";
  }
  if (mr?.state === "merged" && mr.sha && (await patchIdenticalToMr(treePath, mr.sha, defaultRef, fetch))) return "patch-identical";
  return "none";
}
