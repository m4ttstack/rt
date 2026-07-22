import { describe, expect, test } from "bun:test";
import type { MRDetail } from "@workforge/glance-sdk";
import { summarizeThreads, summarizeDiscussions, unresolvedReviewerCount, isBotUsername } from "../discussions.ts";

function note(username: string, opts: { resolvable?: boolean; resolved?: boolean; system?: boolean; body?: string; at?: string } = {}) {
  return {
    id: Math.floor(Math.random() * 1e6),
    body: opts.body ?? "a comment",
    author: { id: `gitlab:user:${username}`, username, name: username, avatarUrl: null },
    createdAt: opts.at ?? "2026-07-10T00:00:00Z",
    system: opts.system ?? false,
    type: "DiscussionNote",
    resolvable: opts.resolvable ?? true,
    resolved: opts.resolved ?? false,
    position: null,
  };
}

function detail(discussions: Array<{ notes: ReturnType<typeof note>[] }>): MRDetail {
  return {
    mrIid: 1,
    repositoryId: "gitlab:42",
    discussions: discussions.map((d, i) => ({ id: `d${i}`, resolvable: null, resolved: null, notes: d.notes })),
  } as unknown as MRDetail;
}

describe("summarizeThreads", () => {
  const AUTHOR = "dorothy";

  test("excludes threads the author started solo (author commenting on their own MR)", () => {
    const d = detail([{ notes: [note("dorothy"), note("dorothy")] }]);
    expect(summarizeThreads(d, AUTHOR)).toEqual([]);
  });

  test("keeps a reviewer thread and marks it awaiting the author", () => {
    const d = detail([{ notes: [note("reviewer", { body: "please fix" })] }]);
    const threads = summarizeThreads(d, AUTHOR);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.status).toBe("awaiting");
  });

  test("marks a reviewer thread the author last replied to as replied", () => {
    const d = detail([{ notes: [note("reviewer"), note("dorothy", { body: "done" })] }]);
    expect(summarizeThreads(d, AUTHOR)[0]!.status).toBe("replied");
  });

  test("marks resolved when the resolvable notes are resolved", () => {
    const d = detail([{ notes: [note("reviewer", { resolved: true })] }]);
    expect(summarizeThreads(d, AUTHOR)[0]!.status).toBe("resolved");
  });

  test("skips system notes and non-resolvable (bot) threads", () => {
    const d = detail([
      { notes: [note("bot", { resolvable: false, body: "linear linkback" })] },
      { notes: [note("someone", { system: true })] },
    ]);
    expect(summarizeThreads(d, AUTHOR)).toEqual([]);
  });

  test("unresolvedReviewerCount counts only non-resolved reviewer threads", () => {
    const d = detail([
      { notes: [note("reviewer", { resolved: true })] }, // resolved
      { notes: [note("reviewer")] }, // awaiting
      { notes: [note("dorothy"), note("dorothy")] }, // author-only, excluded
    ]);
    expect(unresolvedReviewerCount(summarizeThreads(d, AUTHOR))).toBe(1);
  });
});

describe("summarizeDiscussions", () => {
  const AUTHOR = "dorothy";

  test("surfaces general (non-resolvable) MR comments separately from threads", () => {
    const d = detail([
      { notes: [note("reviewer", { body: "please fix" })] }, // resolvable thread
      { notes: [note("dorothy", { resolvable: false, body: "pushed a fix, see abc123" })] }, // general comment
    ]);
    const { threads, comments } = summarizeDiscussions(d, AUTHOR);
    expect(threads).toHaveLength(1);
    expect(comments.map((c) => c.body)).toEqual(["pushed a fix, see abc123"]);
  });

  test("a later author general comment flips an awaiting thread to replied", () => {
    const d = detail([
      { notes: [note("reviewer", { body: "please fix", at: "2026-07-10T00:00:00Z" })] }, // awaiting
      { notes: [note("dorothy", { resolvable: false, body: "done", at: "2026-07-10T05:00:00Z" })] }, // later general comment
    ]);
    const { threads } = summarizeDiscussions(d, AUTHOR);
    expect(threads[0]!.status).toBe("replied");
  });

  test("an author general comment BEFORE the thread does not flip it", () => {
    const d = detail([
      { notes: [note("dorothy", { resolvable: false, body: "heads up", at: "2026-07-10T00:00:00Z" })] }, // earlier general comment
      { notes: [note("reviewer", { body: "new issue", at: "2026-07-10T05:00:00Z" })] }, // later awaiting thread
    ]);
    const { threads } = summarizeDiscussions(d, AUTHOR);
    expect(threads[0]!.status).toBe("awaiting");
  });

  test("drops automated linkback notes (e.g. Linear linkbacks) from general comments", () => {
    const d = detail([
      { notes: [note("bot", { resolvable: false, body: "<!-- linear-linkback --> <details><summary><a href='https://linear.app/x'>ACME-1</a></summary>huge blob</details>" })] },
      { notes: [note("dorothy", { resolvable: false, body: "real comment" })] },
    ]);
    const { comments } = summarizeDiscussions(d, AUTHOR);
    expect(comments.map((c) => c.body)).toEqual(["real comment"]);
  });

  test("a linkback authored by the MR author does not count as a reply", () => {
    const d = detail([
      { notes: [note("reviewer", { body: "please fix", at: "2026-07-10T00:00:00Z" })] }, // awaiting
      { notes: [note("dorothy", { resolvable: false, body: "<!-- linear-linkback --> <details>x</details>", at: "2026-07-10T05:00:00Z" })] },
    ]);
    expect(summarizeDiscussions(d, AUTHOR).threads[0]!.status).toBe("awaiting");
  });

  test("isBotUsername flags service accounts and delimited bot names, not real people", () => {
    expect(isBotUsername("project_1234_bot_abc")).toBe(true);
    expect(isBotUsername("group_9_bot_xyz")).toBe(true);
    expect(isBotUsername("service_account_group_6451920_367c36ac02936601931578db2adf4465")).toBe(true);
    expect(isBotUsername("review-bot")).toBe(true);
    expect(isBotUsername("alert_bot")).toBe(true);
    expect(isBotUsername("ghost")).toBe(true);
    expect(isBotUsername("dorothy")).toBe(false);
    expect(isBotUsername("abbott")).toBe(false); // "bot" mid-word, not a bot
    expect(isBotUsername("m4ttheweric")).toBe(false);
    expect(isBotUsername(null)).toBe(false);
  });

  test("config botUsernames hides a named bot's general comments (username or display name)", () => {
    const d = detail([
      { notes: [note("mr_mr", { resolvable: false, body: "auto note" })] },
      { notes: [note("dorothy", { resolvable: false, body: "real" })] },
    ]);
    // note()'s name === username, so matching either config value drops it.
    expect(summarizeDiscussions(d, AUTHOR, ["mr_mr"]).comments.map((c) => c.body)).toEqual(["real"]);
    expect(summarizeDiscussions(d, AUTHOR, ["MR_MR"]).comments.map((c) => c.body)).toEqual(["real"]); // case-insensitive
    expect(summarizeDiscussions(d, AUTHOR, []).comments.map((c) => c.body)).toEqual(["auto note", "real"]); // not listed → kept
  });

  test("drops general comments authored by a bot", () => {
    const d = detail([
      { notes: [note("release-bot", { resolvable: false, body: "pipeline passed" })] },
      { notes: [note("dorothy", { resolvable: false, body: "real comment" })] },
    ]);
    expect(summarizeDiscussions(d, AUTHOR).comments.map((c) => c.body)).toEqual(["real comment"]);
  });

  test("summarizeThreads still returns just the (flipped) threads", () => {
    const d = detail([{ notes: [note("reviewer", { body: "fix" })] }]);
    expect(summarizeThreads(d, AUTHOR)).toEqual(summarizeDiscussions(d, AUTHOR).threads);
  });
});
