import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import {
  createLogParser,
  extractCoAuthors,
  parseIdentity,
  parseRawLogWithNumstat,
  parseRawUnfoldedTrailers,
  type CommittedFileChange,
} from "./vendor/ghd/log-parse.ts";
import { AppFileStatusKind } from "./vendor/ghd/types.ts";
import { parseFileDiff } from "./diff-hunks.ts";
import { classifyDiffText } from "./diff-classify.ts";
import { commitDiffSources } from "./diff-sources.ts";
import type { ChangesetData, Commit, DiffReadOpts, StagingDiff } from "./types.ts";

/** GHD's CommitBatchSize (app/src/lib/stores/git-store.ts). */
export const COMMIT_BATCH_SIZE = 100;

const MAX_MESSAGE_CHARS = 100 * 1024;

/** Port of GHD getCommits (app/src/lib/git/log.ts), argument for argument. */
export async function getCommits(
  ctx: ClientContext,
  revisionRange?: string,
  limit?: number,
  skip?: number,
  additionalArgs: ReadonlyArray<string> = [],
): Promise<Commit[]> {
  const { formatArgs, parse } = createLogParser({
    sha: "%H",
    shortSha: "%h",
    summary: "%s",
    body: "%b",
    author: "%an <%ae> %ad",
    committer: "%cn <%ce> %cd",
    parents: "%P",
    trailers: "%(trailers:unfold,only)",
    refs: "%D",
  });

  const args = ["log", "--date=raw"];
  if (limit !== undefined) args.push(`--max-count=${limit}`);
  if (skip !== undefined) args.push(`--skip=${skip}`);
  args.push(...formatArgs, "--no-show-signature", "--no-color", ...additionalArgs);

  // The explicit revision must not inherit an exclusion toggle left active by
  // additionalArgs such as --not --remotes.
  if (revisionRange !== undefined) {
    const isExcludingRevisions = additionalArgs.filter((arg) => arg === "--not").length % 2 === 1;
    if (isExcludingRevisions) args.push("--not");
    args.push("--end-of-options", revisionRange);
  }
  args.push("--");

  // Exit 128 is an unborn HEAD; its stdout is empty, which parses to [].
  const stdout = await rawGit(ctx.dir, args, { okCodes: [128] });

  return parse(stdout).map((commit) => {
    // %D is "HEAD -> main, tag: a, tag: b,c, origin/main": split on ", " so a
    // tag name containing a comma survives.
    const tags = commit.refs.split(", ").flatMap((ref) => (ref.startsWith("tag: ") ? [ref.substring(5)] : []));
    const trailers = parseRawUnfoldedTrailers(commit.trailers, ":");
    const author = parseIdentity(commit.author);
    const committer = parseIdentity(commit.committer);
    const parentSHAs = commit.parents.length > 0 ? commit.parents.split(" ") : [];
    return {
      sha: commit.sha,
      shortSha: commit.shortSha,
      summary: commit.summary.slice(0, MAX_MESSAGE_CHARS),
      body: commit.body.slice(0, MAX_MESSAGE_CHARS),
      author,
      committer,
      parentSHAs,
      trailers,
      tags,
      coAuthors: extractCoAuthors(trailers),
      authoredByCommitter: author.name === committer.name && author.email === committer.email,
      isMergeCommit: parentSHAs.length > 1,
    };
  });
}

/** Port of GHD GitStore.loadLocalCommits (app/src/lib/stores/git-store.ts). */
export async function getLocalCommits(
  ctx: ClientContext,
  branch: { name: string; upstream: string | null } | null,
  skip?: number,
): Promise<Commit[]> {
  if (branch === null) return [];
  if (branch.upstream) {
    return getCommits(ctx, `${branch.upstream}..${branch.name}`, COMMIT_BATCH_SIZE, skip);
  }
  return getCommits(ctx, "HEAD", COMMIT_BATCH_SIZE, skip, ["--not", "--remotes"]);
}

/** git's empty tree object: the parent to diff a root commit against. */
const NULL_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function oldPathArgs(file: CommittedFileChange): string[] {
  return file.status.kind === AppFileStatusKind.Renamed || file.status.kind === AppFileStatusKind.Copied
    ? [file.status.oldPath]
    : [];
}

function isBadRevision(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /bad revision|unknown revision/.test(message);
}

/** GHD buildDiff + diffFromRawDiffOutput: the patch is the last NUL-separated piece of --patch-with-raw -z output. */
function buildCommitDiff(stdout: string, file: CommittedFileChange): StagingDiff {
  if (file.status.submoduleStatus !== undefined) {
    return { path: file.path, kind: "submodule", untracked: false, hunks: [] };
  }
  const patch = stdout.split("\0").at(-1) ?? "";
  const kind = classifyDiffText(patch);
  if (kind !== "text") return { path: file.path, kind, untracked: false, hunks: [] };
  const { hunks, typechange } = parseFileDiff(patch);
  return { path: file.path, kind: "text", untracked: false, hunks, ...(typechange ? { typechange: true as const } : {}) };
}

/** Port of GHD getChangedFiles (app/src/lib/git/log.ts). */
export async function getChangedFiles(ctx: ClientContext, sha: string): Promise<ChangesetData> {
  const stdout = await rawGit(ctx.dir, [
    "log", sha, "-C", "-M", "-m", "-1", "--no-show-signature", "--first-parent",
    "--raw", "--format=format:", "--numstat", "-z", "--",
  ]);
  return parseRawLogWithNumstat(stdout, sha, `${sha}^`);
}

/** Port of GHD getCommitRangeChangedFiles (app/src/lib/git/diff.ts); shas oldest first. */
export async function getCommitRangeChangedFiles(
  ctx: ClientContext,
  shas: ReadonlyArray<string>,
  useNullTreeSHA = false,
): Promise<ChangesetData> {
  if (shas.length === 0) throw new Error("No commits to diff...");
  const oldestCommitRef = useNullTreeSHA ? NULL_TREE_SHA : `${shas[0]}^`;
  const latestCommitRef = shas.at(-1) ?? "";
  try {
    const stdout = await rawGit(ctx.dir, ["diff", oldestCommitRef, latestCommitRef, "-C", "-M", "-z", "--raw", "--numstat", "--"]);
    return parseRawLogWithNumstat(stdout, latestCommitRef, oldestCommitRef);
  } catch (err) {
    if (!useNullTreeSHA && isBadRevision(err)) return getCommitRangeChangedFiles(ctx, shas, true);
    throw err;
  }
}

/** Port of GHD getCommitDiff (app/src/lib/git/diff.ts). */
export async function getCommitDiff(
  ctx: ClientContext,
  file: CommittedFileChange,
  commitish: string,
  opts: DiffReadOpts = {},
): Promise<StagingDiff> {
  const stdout = await rawGit(ctx.dir, [
    "log", commitish, "-m", "-1", "--first-parent", "--patch-with-raw", "--format=", "-z", "--no-color", "-M",
    "--", file.path, ...oldPathArgs(file),
  ]);
  const diff = buildCommitDiff(stdout, file);
  if (!opts.withSources || diff.kind !== "text") return diff;
  return { ...diff, sources: await commitDiffSources(ctx, file, `${commitish}^`, commitish) };
}

/** Port of GHD getCommitRangeDiff (app/src/lib/git/diff.ts); commits oldest first. */
export async function getCommitRangeDiff(
  ctx: ClientContext,
  file: CommittedFileChange,
  commits: ReadonlyArray<string>,
  useNullTreeSHA = false,
  opts: DiffReadOpts = {},
): Promise<StagingDiff> {
  if (commits.length === 0) throw new Error("No commits to diff...");
  const oldestCommitRef = useNullTreeSHA ? NULL_TREE_SHA : `${commits[0]}^`;
  const latestCommit = commits.at(-1) ?? "";
  try {
    const stdout = await rawGit(ctx.dir, [
      "diff", oldestCommitRef, latestCommit, "--patch-with-raw", "--format=", "-z", "--no-color",
      "--", file.path, ...oldPathArgs(file),
    ]);
    const diff = buildCommitDiff(stdout, file);
    if (!opts.withSources || diff.kind !== "text") return diff;
    return { ...diff, sources: await commitDiffSources(ctx, file, oldestCommitRef, latestCommit) };
  } catch (err) {
    if (!useNullTreeSHA && isBadRevision(err)) return getCommitRangeDiff(ctx, file, commits, true, opts);
    throw err;
  }
}
