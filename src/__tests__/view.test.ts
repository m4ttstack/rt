import { describe, expect, test } from "bun:test";
import type { BoardMR } from "../data.ts";
import { filterByMember, sortMRs, groupMRs } from "../view.ts";

function mr(overrides: Partial<BoardMR>): BoardMR {
  return {
    iid: 1,
    title: "MR",
    author: { id: "x", username: "alice", name: "Alice", avatarUrl: null },
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    pipelineState: "none",
    reviews: { required: 2, given: 0, isApproved: false },
    blockers: {},
    ...overrides,
  } as unknown as BoardMR;
}

describe("filterByMember", () => {
  const list = [mr({ iid: 1, author: { username: "alice" } as any }), mr({ iid: 2, author: { username: "bob" } as any })];
  test("all returns everything", () => {
    expect(filterByMember(list, "all")).toHaveLength(2);
  });
  test("filters to one member", () => {
    expect(filterByMember(list, "bob").map((m) => m.iid)).toEqual([2]);
  });
});

describe("sortMRs", () => {
  test("oldest: oldest createdAt first, nulls last", () => {
    const list = [
      mr({ iid: 1, createdAt: "2026-07-05T00:00:00Z" }),
      mr({ iid: 2, createdAt: null }),
      mr({ iid: 3, createdAt: "2026-07-01T00:00:00Z" }),
    ];
    expect(sortMRs(list, "oldest").map((m) => m.iid)).toEqual([3, 1, 2]);
  });

  test("pipeline: failed, running, none, passed", () => {
    const list = [
      mr({ iid: 1, pipelineState: "passed" }),
      mr({ iid: 2, pipelineState: "failed" }),
      mr({ iid: 3, pipelineState: "none" }),
      mr({ iid: 4, pipelineState: "running" }),
    ];
    expect(sortMRs(list, "pipeline").map((m) => m.iid)).toEqual([2, 4, 3, 1]);
  });

  test("progress: highest approval ratio first", () => {
    const list = [
      mr({ iid: 1, reviews: { required: 2, given: 0, isApproved: false } as any }),
      mr({ iid: 2, reviews: { required: 2, given: 2, isApproved: true } as any }),
      mr({ iid: 3, reviews: { required: 2, given: 1, isApproved: false } as any }),
    ];
    expect(sortMRs(list, "progress").map((m) => m.iid)).toEqual([2, 3, 1]);
  });

  test("does not mutate input", () => {
    const list = [mr({ iid: 1, createdAt: "2026-07-05T00:00:00Z" }), mr({ iid: 2, createdAt: "2026-07-01T00:00:00Z" })];
    sortMRs(list, "oldest");
    expect(list.map((m) => m.iid)).toEqual([1, 2]);
  });
});

const NOW = Date.parse("2026-07-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("groupMRs age", () => {
  test("buckets by day then week, ordered", () => {
    const list = [
      mr({ iid: 1, createdAt: daysAgo(0) }),
      mr({ iid: 2, createdAt: daysAgo(1) }),
      mr({ iid: 3, createdAt: daysAgo(3) }),
      mr({ iid: 4, createdAt: daysAgo(9) }),
      mr({ iid: 5, createdAt: daysAgo(30) }),
    ];
    const groups = groupMRs(list, "age", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "3 days ago", "Last week", "Older"]);
  });
});

describe("groupMRs author", () => {
  test("one group per member in config order, skips empty", () => {
    const list = [
      mr({ iid: 1, author: { username: "bob", name: "Bob" } as any }),
      mr({ iid: 2, author: { username: "alice", name: "Alice" } as any }),
    ];
    const groups = groupMRs(list, "author", ["alice", "bob", "carol"], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Alice", "Bob"]);
  });
});

describe("groupMRs status", () => {
  test("severity order: conflicts, ci failing, needs review, in review, approved", () => {
    const list = [
      mr({ iid: 1, blockers: { hasConflicts: false, pipelineFailing: false } as any, reviews: { required: 2, given: 0, isApproved: false } as any }),
      mr({ iid: 2, blockers: { hasConflicts: true } as any }),
      mr({ iid: 3, blockers: {} as any, reviews: { required: 2, given: 2, isApproved: true } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["conflicts", "needs review", "approved"]);
  });
});

describe("groupMRs pipeline", () => {
  test("order failed, running, none, passed", () => {
    const list = [
      mr({ iid: 1, pipelineState: "passed" }),
      mr({ iid: 2, pipelineState: "failed" }),
      mr({ iid: 3, pipelineState: "none" }),
    ];
    const groups = groupMRs(list, "pipeline", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["pipeline failed", "no pipeline", "pipeline passed"]);
  });
});
