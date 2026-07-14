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
    unresolvedThreads: 0,
    reviewerComments: 0,
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
  test("oldest: oldest last activity (updatedAt) first, nulls last", () => {
    const list = [
      mr({ iid: 1, updatedAt: "2026-07-05T00:00:00Z" }),
      mr({ iid: 2, updatedAt: null }),
      mr({ iid: 3, updatedAt: "2026-07-01T00:00:00Z" }),
    ];
    expect(sortMRs(list, "oldest").map((m) => m.iid)).toEqual([3, 1, 2]);
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
  test("buckets by last activity (updatedAt), by day then week, ordered", () => {
    const list = [
      mr({ iid: 1, updatedAt: daysAgo(0) }),
      mr({ iid: 2, updatedAt: daysAgo(1) }),
      mr({ iid: 3, updatedAt: daysAgo(3) }),
      mr({ iid: 4, updatedAt: daysAgo(9) }),
      mr({ iid: 5, updatedAt: daysAgo(30) }),
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
  test("severity order: conflicts before needs review before approved", () => {
    const list = [
      mr({ iid: 1, blockers: { hasConflicts: false, pipelineFailing: false } as any, reviews: { required: 2, given: 0, isApproved: false } as any }),
      mr({ iid: 2, blockers: { hasConflicts: true } as any }),
      mr({ iid: 3, blockers: {} as any, reviews: { required: 2, given: 2, isApproved: true } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["conflicts", "needs review", "approved"]);
  });

  test("ci failing: blockers.pipelineFailing true buckets separately from conflicts", () => {
    const list = [
      mr({ iid: 1, blockers: { pipelineFailing: true } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["ci failing"]);
  });

  test("partial approvals fold into needs review", () => {
    const list = [
      mr({ iid: 1, blockers: {} as any, reviews: { required: 2, given: 1, isApproved: false } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["needs review"]);
  });

  test("commented: unresolved comments, no formal review, not approved", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 3, reviews: { required: 2, given: 0, isApproved: false } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["commented"]);
  });

  test("changes requested: a reviewer's REQUESTED_CHANGES state buckets separately from comments", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 3, reviews: { required: 2, given: 0, isApproved: false, reviewers: [{ reviewState: "REQUESTED_CHANGES" }] } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["changes requested"]);
  });

  test("approved outranks commented: approved MR with comments still buckets approved", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 3, reviews: { required: 2, given: 2, isApproved: true } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["approved"]);
  });

  test("full severity order with all six buckets present", () => {
    const list = [
      mr({ iid: 1, blockers: {} as any, reviews: { required: 2, given: 2, isApproved: true } as any }), // approved
      mr({ iid: 2, reviewerComments: 2, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false } as any }), // commented
      mr({ iid: 3, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false } as any }), // needs review
      mr({ iid: 4, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false, reviewers: [{ reviewState: "REQUESTED_CHANGES" }] } as any }), // changes requested
      mr({ iid: 5, blockers: { pipelineFailing: true } as any }), // ci failing
      mr({ iid: 6, blockers: { hasConflicts: true } as any }), // conflicts
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "conflicts",
      "ci failing",
      "changes requested",
      "commented",
      "needs review",
      "approved",
    ]);
  });
});

import { parseViewState, serializeViewState, DEFAULT_VIEW } from "../view.ts";

describe("parseViewState", () => {
  const members = ["alice", "bob"];
  test("defaults when nothing provided", () => {
    expect(parseViewState("", null, members)).toEqual(DEFAULT_VIEW);
  });
  test("URL wins over localStorage", () => {
    expect(parseViewState("?member=bob&group=status", { member: "alice", sort: "progress" }, members)).toEqual({
      member: "bob",
      group: "status",
      sort: "progress",
    });
  });
  test("ignores unknown member and invalid group/sort", () => {
    expect(parseViewState("?member=ghost&group=bogus&sort=bogus", null, members)).toEqual(DEFAULT_VIEW);
  });

  test("uses defaultMember when no URL or stored value", () => {
    expect(parseViewState("", null, members, "bob").member).toBe("bob");
  });

  test("falls back to all when defaultMember is not in the valid set", () => {
    expect(parseViewState("", null, members, "ghost").member).toBe("all");
  });

  test("URL still wins over defaultMember", () => {
    expect(parseViewState("?member=alice", null, members, "bob").member).toBe("alice");
  });

  test("stored value still wins over defaultMember", () => {
    expect(parseViewState("", { member: "alice" }, members, "bob").member).toBe("alice");
  });
});

describe("serializeViewState", () => {
  test("omits defaults", () => {
    expect(serializeViewState(DEFAULT_VIEW)).toBe("");
  });
  test("includes non-defaults", () => {
    expect(serializeViewState({ member: "bob", group: "status", sort: "oldest" })).toBe("?member=bob&group=status");
  });
});
