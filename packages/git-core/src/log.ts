import type { ClientContext } from "./client.ts";
import type { LogEntry } from "./types.ts";
import { rawGitOk } from "./exec.ts";

const FORMAT = {
  sha: "%H",
  parents: "%P",
  authorName: "%an",
  authorEmail: "%ae",
  authorDate: "%aI",
  subject: "%s",
  body: "%b",
};

// simple-git's default field splitter is " \xF2 ", so a body containing that
// literal sequence corrupts the parse. \x00 is the conventional immune choice
// but cannot appear in a process argv (Bun/Node reject it outright); \x1e
// (ASCII record separator) is argv-safe and just as unlikely in real text.
const SPLITTER = "\x1e";

export async function getLog(
  ctx: ClientContext,
  opts: { maxCount?: number; file?: string } = {},
): Promise<LogEntry[]> {
  // An unborn/empty repo has no HEAD to log; short-circuit before simple-git
  // ever runs so the result does not depend on git's localized error text.
  // --quiet is required: without it rev-parse exits 128 (fatal) rather than
  // the plain 1 rawGitOk treats as a clean "no" answer.
  if (!(await rawGitOk(ctx.dir, ["rev-parse", "--verify", "--quiet", "HEAD"]))) {
    return [];
  }
  try {
    const result = await ctx.git.log({
      format: FORMAT,
      splitter: SPLITTER,
      ...(opts.maxCount !== undefined ? { maxCount: opts.maxCount } : {}),
      ...(opts.file !== undefined ? { file: opts.file } : {}),
    });
    return result.all.map((e) => ({
      sha: e.sha,
      parents: e.parents === "" ? [] : e.parents.split(" "),
      authorName: e.authorName,
      authorEmail: e.authorEmail,
      authorDate: e.authorDate,
      subject: e.subject,
      body: e.body.trimEnd(),
    }));
  } catch (err) {
    // Fallback only: the rev-parse guard above is what carries the
    // empty-repo case now. Kept for a state the guard does not observe.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("does not have any commits yet") || message.includes("unknown revision")) {
      return [];
    }
    throw err;
  }
}
