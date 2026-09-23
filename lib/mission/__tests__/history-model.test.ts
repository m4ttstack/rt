import { describe, expect, test } from "bun:test";
import type { Commit } from "../../../packages/git-core/src/index.ts";
import { AppFileStatusKind } from "../../../packages/git-core/src/index.ts";
import { HistoryStore } from "../history.ts";
import { buildHistoryModel, commitAuthors, formatByline, formatExpandedAuthor, formatRelative, historyGroupLabel, historyWhen } from "../history-model.ts";

const NOW = new Date("2026-09-22T12:00:00Z");

function ident(name: string, email: string) {
  return { name, email, date: new Date("2026-09-22T09:00:00Z"), tzOffset: 0 };
}

function commit(over: Partial<Commit> = {}): Commit {
  const author = ident("Pat", "pat@example.com");
  return { sha: "a".repeat(40), shortSha: "aaaaaaa", summary: "fix it", body: "", author, committer: author, parentSHAs: [], trailers: [], tags: [], coAuthors: [], authoredByCommitter: true, isMergeCommit: false, ...over };
}

describe("commitAuthors (GHD getAvatarUsersForCommit without avatars)", () => {
  test("author alone when the committer is the author", () => {
    expect(commitAuthors(commit())).toEqual([{ name: "Pat", email: "pat@example.com" }]);
  });
  test("co-authors follow the author; a distinct committer comes last", () => {
    const c = commit({ coAuthors: [{ name: "Sam", email: "sam@example.com" }], committer: ident("Lee", "lee@example.com"), authoredByCommitter: false });
    expect(commitAuthors(c).map((a) => a.name)).toEqual(["Pat", "Sam", "Lee"]);
  });
  test("the web-flow committer is never listed", () => {
    const c = commit({ committer: ident("GitHub", "noreply@github.com"), authoredByCommitter: false });
    expect(commitAuthors(c).map((a) => a.name)).toEqual(["Pat"]);
  });
  test("a committer who is also a co-author is not repeated", () => {
    const c = commit({ coAuthors: [{ name: "Lee", email: "lee@example.com" }], committer: ident("Lee", "lee@example.com"), authoredByCommitter: false });
    expect(commitAuthors(c).map((a) => a.name)).toEqual(["Pat", "Lee"]);
  });
});

describe("formatByline and formatExpandedAuthor (GHD commit-attribution)", () => {
  test("one, two, and many", () => {
    expect(formatByline([{ name: "A", email: "a@x" }])).toBe("A");
    expect(formatByline([{ name: "A", email: "a@x" }, { name: "B", email: "b@x" }])).toBe("A, B");
    expect(formatByline([{ name: "A", email: "a@x" }, { name: "B", email: "b@x" }, { name: "C", email: "c@x" }])).toBe("3 people");
  });
  test("expanded form falls back to the email when there is no name", () => {
    expect(formatExpandedAuthor({ name: "A", email: "a@x" })).toBe("A <a@x>");
    expect(formatExpandedAuthor({ name: "", email: "a@x" })).toBe("a@x");
  });
});

describe("buildHistoryModel", () => {
  test("rows carry byline, relative time, tags, unpushed, selected", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1", shortSha: "s1", tags: ["v1"] }), commit({ sha: "s2", shortSha: "s2", summary: "" })];
    store.localShas = new Set(["s1"]);
    store.selection = ["s1"];
    const model = buildHistoryModel(store, { now: NOW, loading: false });
    expect(model.commits[0]).toEqual({
      sha: "s1",
      shortSha: "s1",
      summary: "fix it",
      byline: "Pat",
      when: "3 hours ago",
      group: historyGroupLabel(new Date("2026-09-22T09:00:00Z"), NOW),
      tags: ["v1"],
      unpushed: true,
      selected: true,
    });
    expect(model.commits[1]!.unpushed).toBe(false);
    expect(model.commits[1]!.summary).toBe("");
  });

  test("a single selection's header", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1", shortSha: "s1", body: "why\n", tags: ["v1"] })];
    store.selection = ["s1"];
    store.changeset = {
      files: [{ path: "n.ts", status: { kind: AppFileStatusKind.Renamed, oldPath: "o.ts", renameIncludesModifications: true }, commitish: "s1", parentCommitish: "s1^" }],
      linesAdded: 5,
      linesDeleted: 2,
    };
    store.selectedFile = store.changeset.files[0]!;
    const model = buildHistoryModel(store, { now: NOW, loading: false });
    expect(model.header).toEqual({ summary: "fix it", body: "why", byline: "Pat", authors: ["Pat <pat@example.com>"], sha: "s1", shortSha: "s1", linesAdded: 5, linesDeleted: 2, tags: ["v1"], rangeCount: 1, contiguous: true });
    expect(model.files).toEqual([{ path: "n.ts", origPath: "o.ts", status: "renamed", onDisk: false }]);
    expect(model.selectedFile).toBe("n.ts");
  });

  test("file rows carry onDisk from the lookup, by repo-relative path", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1" })];
    store.selection = ["s1"];
    const file = (path: string) => ({ path, status: { kind: AppFileStatusKind.Modified as const }, commitish: "s1", parentCommitish: "s1^" });
    store.changeset = { files: [file("kept.ts"), file("gone.ts")], linesAdded: 0, linesDeleted: 0 };
    const model = buildHistoryModel(store, { now: NOW, loading: false, onDisk: (path) => path === "kept.ts" });
    expect(model.files.map((f) => [f.path, f.onDisk])).toEqual([
      ["kept.ts", true],
      ["gone.ts", false],
    ]);
  });

  test("a range header counts commits and unions authors", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1" }), commit({ sha: "s2", author: ident("Sam", "sam@example.com"), committer: ident("Sam", "sam@example.com") })];
    store.selection = ["s1", "s2"];
    const model = buildHistoryModel(store, { now: NOW, loading: false });
    expect(model.header?.rangeCount).toBe(2);
    expect(model.header?.contiguous).toBe(true);
    expect(model.header?.byline).toBe("Pat, Sam");
  });

  test("nothing selected means no header", () => {
    const model = buildHistoryModel(new HistoryStore(), { now: NOW, loading: true });
    expect(model.header).toBeNull();
    expect(model.loading).toBe(true);
  });

  test("each row carries the date group of its author date", () => {
    const now = new Date(2026, 8, 23, 15);
    const store = new HistoryStore();
    const at = (d: Date) => ({ name: "Pat", email: "pat@example.com", date: d, tzOffset: 0 });
    store.commits = [
      commit({ sha: "s1", author: at(new Date(2026, 8, 23, 9)), committer: at(new Date(2026, 8, 23, 9)) }),
      commit({ sha: "s2", author: at(new Date(2026, 7, 2, 9)), committer: at(new Date(2026, 7, 2, 9)) }),
    ];
    const model = buildHistoryModel(store, { now, loading: false });
    expect(model.commits.map((c) => c.group)).toEqual(["Today", "August 2026"]);
  });
});

// formatRelative takes then minus now, so a past time is negative.
describe("formatRelative (GitHub Desktop's format-relative.ts)", () => {
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const ago = (ms: number) => formatRelative(-ms);

  test("seconds, then minutes from 45 seconds", () => {
    expect(formatRelative(0)).toBe("now");
    expect(ago(44 * SEC)).toBe("44 seconds ago");
    expect(ago(45 * SEC)).toBe("1 minute ago");
  });

  test("minutes, then hours from 45 minutes", () => {
    expect(ago(44 * MIN)).toBe("44 minutes ago");
    expect(ago(45 * MIN)).toBe("1 hour ago");
  });

  test("hours, then days from 24 hours, rounding to the nearest day", () => {
    expect(ago(23 * HOUR)).toBe("23 hours ago");
    expect(ago(24 * HOUR)).toBe("yesterday");
    expect(ago(25 * HOUR)).toBe("yesterday");
    expect(ago(36 * HOUR)).toBe("2 days ago");
  });

  test("days, then months from 30 days", () => {
    expect(ago(29 * DAY)).toBe("29 days ago");
    expect(ago(30 * DAY)).toBe("last month");
  });

  test("months, then years from 18 months", () => {
    expect(ago(17 * 30 * DAY)).toBe("17 months ago");
    expect(ago(18 * 30 * DAY)).toBe("2 years ago");
  });

  test("a future time reads forward", () => {
    expect(formatRelative(2 * HOUR)).toBe("in 2 hours");
  });
});

describe("historyWhen (GitHub Desktop's commit list RelativeTime)", () => {
  const now = new Date(2026, 8, 23, 15);
  const at = (ms: number) => new Date(now.getTime() + ms);

  test("under a minute either way is just now", () => {
    expect(historyWhen(now, now)).toBe("just now");
    expect(historyWhen(at(-59_000), now)).toBe("just now");
    expect(historyWhen(at(59_000), now)).toBe("just now");
  });

  test("past times read relative, however old", () => {
    expect(historyWhen(at(-5 * 60_000), now)).toBe("5 minutes ago");
    expect(historyWhen(new Date(2024, 8, 23, 15), now)).toBe("2 years ago");
  });

  test("more than a minute ahead (clock skew) reads as the absolute date and time", () => {
    // The joiner between date and time ("," or " at") varies with ICU.
    const when = historyWhen(new Date(2026, 8, 23, 17, 5), now);
    expect(when).toStartWith("Sep 23, 2026");
    expect(when).toEndWith("5:05 PM");
  });
});

describe("History rows use formatRelative, agreeing with their date header", () => {
  test("Monday evening seen on Wednesday afternoon is 2 days ago, earlier this week", () => {
    const now = new Date(2026, 8, 23, 15);
    const monday = new Date(2026, 8, 21, 19);
    const store = new HistoryStore();
    const at = { name: "Pat", email: "pat@example.com", date: monday, tzOffset: 0 };
    store.commits = [commit({ sha: "s1", author: at, committer: at })];
    const row = buildHistoryModel(store, { now, loading: false }).commits[0]!;
    expect(row.when).toBe("2 days ago");
    expect(row.group).toBe("Earlier this week");
  });
});

// Every date is built from local calendar fields, so these hold in any
// machine time zone. 2026-09-23 is a Wednesday; its week starts Monday the
// 21st and the previous week Monday the 14th.
describe("historyGroupLabel", () => {
  const wed = new Date(2026, 8, 23, 15);

  test("same local day, including earlier that morning, is Today", () => {
    expect(historyGroupLabel(new Date(2026, 8, 23, 0), wed)).toBe("Today");
    expect(historyGroupLabel(new Date(2026, 8, 23, 14), wed)).toBe("Today");
  });

  test("a date after now (clock skew) reads Today", () => {
    expect(historyGroupLabel(new Date(2026, 8, 23, 18), wed)).toBe("Today");
    expect(historyGroupLabel(new Date(2026, 8, 26, 9), wed)).toBe("Today");
  });

  test("the local day before is Yesterday", () => {
    expect(historyGroupLabel(new Date(2026, 8, 22, 0), wed)).toBe("Yesterday");
    expect(historyGroupLabel(new Date(2026, 8, 22, 23), wed)).toBe("Yesterday");
  });

  test("earlier in a Monday-start week is Earlier this week", () => {
    expect(historyGroupLabel(new Date(2026, 8, 21, 0), wed)).toBe("Earlier this week");
    expect(historyGroupLabel(new Date(2026, 8, 21, 23), wed)).toBe("Earlier this week");
  });

  test("the Sunday before this week's Monday is Last week", () => {
    expect(historyGroupLabel(new Date(2026, 8, 20, 23), wed)).toBe("Last week");
    expect(historyGroupLabel(new Date(2026, 8, 14, 0), wed)).toBe("Last week");
  });

  test("before the previous week's Monday falls to the month", () => {
    expect(historyGroupLabel(new Date(2026, 8, 13, 23), wed)).toBe("September 2026");
    expect(historyGroupLabel(new Date(2026, 7, 31, 9), wed)).toBe("August 2026");
  });

  test("on a Monday, Sunday is Yesterday and the Sunday before is Last week", () => {
    const mon = new Date(2026, 8, 21, 10);
    expect(historyGroupLabel(new Date(2026, 8, 20, 12), mon)).toBe("Yesterday");
    expect(historyGroupLabel(new Date(2026, 8, 19, 12), mon)).toBe("Last week");
    expect(historyGroupLabel(new Date(2026, 8, 14, 0), mon)).toBe("Last week");
    expect(historyGroupLabel(new Date(2026, 8, 13, 23), mon)).toBe("September 2026");
  });

  test("on a Sunday, Monday of the same week is Earlier this week", () => {
    const sun = new Date(2026, 8, 27, 10);
    expect(historyGroupLabel(new Date(2026, 8, 21, 0), sun)).toBe("Earlier this week");
    expect(historyGroupLabel(new Date(2026, 8, 20, 23), sun)).toBe("Last week");
  });

  test("the year boundary: yesterday and last week cross into December", () => {
    const newYear = new Date(2027, 0, 1, 10);
    expect(historyGroupLabel(new Date(2026, 11, 31, 22), newYear)).toBe("Yesterday");
    expect(historyGroupLabel(new Date(2026, 11, 28, 9), newYear)).toBe("Earlier this week");
    expect(historyGroupLabel(new Date(2026, 11, 21, 9), newYear)).toBe("Last week");
    expect(historyGroupLabel(new Date(2026, 11, 20, 9), newYear)).toBe("December 2026");
  });
});
