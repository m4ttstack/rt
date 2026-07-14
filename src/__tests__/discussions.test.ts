import { describe, expect, test } from "bun:test";
import type { MRDetail } from "@workforge/glance-sdk";
import { summarizeThreads, unresolvedReviewerCount } from "../discussions.ts";

function note(username: string, opts: { resolvable?: boolean; resolved?: boolean; system?: boolean; body?: string } = {}) {
  return {
    id: Math.floor(Math.random() * 1e6),
    body: opts.body ?? "a comment",
    author: { id: `gitlab:user:${username}`, username, name: username, avatarUrl: null },
    createdAt: "2026-07-10T00:00:00Z",
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
