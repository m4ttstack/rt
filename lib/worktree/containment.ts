import { isAncestorAsync, remoteDefaultRef, remoteRefExists, runGit } from "./git-async.ts";

export type Containment = "in-default" | "on-remote" | "patch-identical" | "none";

const FETCH_TIMEOUT_MS = 60_000;

async function fetchSha(treePath: string, sha: string): Promise<boolean> {
  const r = await runGit(treePath, ["fetch", "--no-tags", "-q", "origin", sha], { timeoutMs: FETCH_TIMEOUT_MS });
  return r.exitCode === 0;
}

async function hasObject(treePath: string, sha: string): Promise<boolean> {
  return (await runGit(treePath, ["cat-file", "-e", `${sha}^{commit}`])).exitCode === 0;
}

/** Stable patch-ids of `range`, one per commit. */
async function patchIds(treePath: string, range: string): Promise<Set<string> | null> {
  const log = await runGit(treePath, ["log", "-p", "--no-merges", "--format=commit %H", range]);
  if (log.exitCode !== 0) return null;
  const proc = Bun.spawn(["git", "patch-id", "--stable"], { cwd: treePath, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  proc.stdin.write(log.stdout);
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  return new Set(out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]!));
}

/**
 * Every commit on HEAD that the default branch lacks has a patch-identical
 * twin between the merge-base and the MR head. Squash merges never match
 * (their one commit is a new patch); they still pass through the MR-sha
 * ancestry check in dispose. Missing objects fail closed.
 */
export async function patchIdenticalToMr(
  treePath: string,
  mrSha: string,
  defaultRef: string,
  fetch: (sha: string) => Promise<boolean> = (sha) => fetchSha(treePath, sha),
): Promise<boolean> {
  if (!(await hasObject(treePath, mrSha)) && !((await fetch(mrSha)) && (await hasObject(treePath, mrSha)))) return false;
  const base = await runGit(treePath, ["merge-base", defaultRef, mrSha]);
  if (base.exitCode !== 0) return false;
  const local = await patchIds(treePath, `${defaultRef}..HEAD`);
  const merged = await patchIds(treePath, `${base.stdout.trim()}..${mrSha}`);
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
