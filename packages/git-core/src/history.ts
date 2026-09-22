import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import {
  createLogParser,
  extractCoAuthors,
  parseIdentity,
  parseRawUnfoldedTrailers,
} from "./vendor/ghd/log-parse.ts";
import type { Commit } from "./types.ts";

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
