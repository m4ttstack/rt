import { describe, expect, test } from "bun:test";
import type { BoardMR } from "../data.ts";
import { filterByMember, sortMRs } from "../view.ts";

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
