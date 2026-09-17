import type { ClientContext } from "./client.ts";
import type { LogEntry } from "./types.ts";
import { rawGit, rawGitOk } from "./exec.ts";

// "%x00" in the format string is a directive git expands to a real NUL byte
// in its output (the same trick refs.ts uses for for-each-ref); a commit
// message cannot itself contain a NUL, so this framing has no collision.
const FIELDS = ["%H", "%P", "%an", "%ae", "%aI", "%s", "%b"];
const FIELD_COUNT = FIELDS.length;
const FORMAT = `${FIELDS.join("%x00")}%x00`;

export async function getLog(
  ctx: ClientContext,
  opts: { maxCount?: number; file?: string } = {},
): Promise<LogEntry[]> {
  // An unborn/empty repo has no HEAD to log; short-circuit before running
  // log at all so the result does not depend on git's localized error text.
  // --quiet is required: without it rev-parse exits 128 (fatal) rather than
  // the plain 1 rawGitOk treats as a clean "no" answer.
  if (!(await rawGitOk(ctx.dir, ["rev-parse", "--verify", "--quiet", "HEAD"]))) {
    return [];
  }

  const out = await rawGit(ctx.dir, [
    "log",
    `--format=${FORMAT}`,
    ...(opts.maxCount !== undefined ? ["-n", String(opts.maxCount)] : []),
    ...(opts.file !== undefined ? ["--", opts.file] : []),
  ]);

  const tokens = out.split("\x00");
  // git appends a "\n" after each formatted entry, including the last, so
  // the split leaves a trailing bare "\n" token with no fields after it.
  if (tokens.length > 0 && tokens[tokens.length - 1]!.trim() === "") tokens.pop();

  const entries: LogEntry[] = [];
  for (let i = 0; i < tokens.length; i += FIELD_COUNT) {
    // Every record but the first inherits the previous entry's separator
    // newline as a prefix on its first (sha) field.
    const sha = i === 0 ? tokens[i]! : tokens[i]!.replace(/^\n/, "");
    const parents = tokens[i + 1]!;
    entries.push({
      sha,
      parents: parents === "" ? [] : parents.split(" "),
      authorName: tokens[i + 2]!,
      authorEmail: tokens[i + 3]!,
      authorDate: tokens[i + 4]!,
      subject: tokens[i + 5]!,
      body: tokens[i + 6]!.trimEnd(),
    });
  }
  return entries;
}
