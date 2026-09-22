import { describe, expect, test } from "bun:test";
import type { Commit } from "../../../packages/git-core/src/index.ts";
import { AppFileStatusKind } from "../../../packages/git-core/src/index.ts";
import { HistoryStore } from "../history.ts";
import { buildHistoryModel, commitAuthors, formatByline, formatExpandedAuthor } from "../history-model.ts";

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
    expect(model.commits[0]).toEqual({ sha: "s1", shortSha: "s1", summary: "fix it", byline: "Pat", when: "3 hours ago", tags: ["v1"], unpushed: true, selected: true });
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
    expect(model.files).toEqual([{ path: "n.ts", origPath: "o.ts", status: "renamed" }]);
    expect(model.selectedFile).toBe("n.ts");
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
});
