import type { ClientContext } from "./client.ts";
import type { LogEntry } from "./types.ts";

const FORMAT = {
  sha: "%H",
  parents: "%P",
  authorName: "%an",
  authorEmail: "%ae",
  authorDate: "%aI",
  subject: "%s",
  body: "%b",
};

export async function getLog(
  ctx: ClientContext,
  opts: { maxCount?: number; file?: string } = {},
): Promise<LogEntry[]> {
  try {
    const result = await ctx.git.log({
      format: FORMAT,
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
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("does not have any commits yet") || message.includes("unknown revision")) {
      return [];
    }
    throw err;
  }
}
