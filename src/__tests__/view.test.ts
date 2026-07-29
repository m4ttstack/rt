import { describe, expect, test } from "bun:test";
import type { BoardMR } from "../data.ts";
import { filterByMember, sortMRs, groupMRs, commentDot, dataAgeLabel } from "../view.ts";

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

describe("commentDot", () => {
  test("no summary → no dot (fetch skipped/failed)", () => {
    expect(commentDot(undefined)).toBeNull();
  });
  test("nothing unresolved → no dot", () => {
    expect(commentDot({ awaiting: 0, replied: 0, resolved: 3 })).toBeNull();
  });
  test("any thread awaiting the author → amber, action needed", () => {
    expect(commentDot({ awaiting: 1, replied: 0, resolved: 0 })).toEqual({
      cls: "warn",
      title: "1 awaiting your reply",
    });
  });
  test("amber title lists both awaiting and replied counts", () => {
    expect(commentDot({ awaiting: 1, replied: 2, resolved: 0 })).toEqual({
      cls: "warn",
      title: "1 awaiting your reply · 2 you replied to",
    });
  });
  test("all replied, none awaiting → green", () => {
    expect(commentDot({ awaiting: 0, replied: 2, resolved: 0 })).toEqual({
      cls: "ok",
      title: "you've replied to every comment",
    });
  });
  test("resolved threads never force amber", () => {
    expect(commentDot({ awaiting: 0, replied: 1, resolved: 5 })?.cls).toBe("ok");
  });
});

test("dataAgeLabel: fresh, stale, unknown", () => {
  const now = Date.parse("2026-07-29T15:00:00Z");
  expect(dataAgeLabel(now - 60_000, now).stale).toBe(false);
  expect(dataAgeLabel(now - 11 * 60_000, now).stale).toBe(true);
  expect(dataAgeLabel(null, now)).toEqual({ text: "data age unknown", stale: true });
});

test("dataAgeLabel: epoch-zero syncedAt (cold shell record) reads as unknown, not 1:00", () => {
  const now = Date.parse("2026-07-29T15:00:00Z");
  expect(dataAgeLabel(0, now)).toEqual({ text: "data age unknown", stale: true });
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
  test("mechanical blockers (conflicts/ci) do not form their own groups; MRs bucket by review state", () => {
    const list = [
      // conflicts but no review yet -> needs review, not a "conflicts" group
      mr({ iid: 1, blockers: { hasConflicts: true } as any, reviews: { required: 2, given: 0, isApproved: false } as any }),
      // ci failing but approved -> still approved
      mr({ iid: 2, blockers: { pipelineFailing: true } as any, reviews: { required: 2, given: 2, isApproved: true } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["needs review", "approved"]);
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

  test("all comments resolved, not approved: 'comments resolved', not 'needs review'", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 0, threadSummary: { awaiting: 0, replied: 0, resolved: 3 }, reviews: { required: 2, given: 0, isApproved: false } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["comments resolved"]);
  });

  test("no thread breakdown (never commented) stays 'needs review'", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 0, reviews: { required: 2, given: 0, isApproved: false } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["needs review"]);
  });

  test("still some unresolved: stays 'commented', not 'comments resolved'", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 2, threadSummary: { awaiting: 1, replied: 1, resolved: 4 }, reviews: { required: 2, given: 0, isApproved: false } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["commented"]);
  });

  test("approved outranks all-resolved: approved MR with resolved threads buckets approved", () => {
    const list = [
      mr({ iid: 1, reviewerComments: 0, threadSummary: { awaiting: 0, replied: 0, resolved: 2 }, reviews: { required: 2, given: 2, isApproved: true } as any }),
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["approved"]);
  });

  test("review-state order: changes requested, commented, needs review, comments resolved, approved", () => {
    const list = [
      mr({ iid: 1, blockers: {} as any, reviews: { required: 2, given: 2, isApproved: true } as any }), // approved
      mr({ iid: 2, reviewerComments: 2, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false } as any }), // commented
      mr({ iid: 3, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false } as any }), // needs review
      mr({ iid: 5, reviewerComments: 0, threadSummary: { awaiting: 0, replied: 0, resolved: 1 }, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false } as any }), // comments resolved
      mr({ iid: 4, blockers: {} as any, reviews: { required: 2, given: 0, isApproved: false, reviewers: [{ reviewState: "REQUESTED_CHANGES" }] } as any }), // changes requested
    ];
    const groups = groupMRs(list, "status", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["changes requested", "commented", "needs review", "comments resolved", "approved"]);
  });
});

describe("groupMRs review", () => {
  const reviewed = (iid: number, status?: string) =>
    mr({ iid, ...(status ? { review: { status } } : {}) } as any);

  test("buckets by app-initiated review status, most-active first; unlaunched fall to 'not reviewed'", () => {
    const list = [
      reviewed(1, "done"),
      reviewed(2),
      reviewed(3, "reviewing"),
      reviewed(4, "error"),
      reviewed(5, "queued"),
    ];
    const groups = groupMRs(list, "review", [], NOW);
    expect(groups.map((g) => g.label)).toEqual(["reviewing", "queued", "review ready", "review failed", "not reviewed"]);
  });

  test("collapses MRs sharing a status into one group", () => {
    const list = [reviewed(1, "done"), reviewed(2, "done"), reviewed(3)];
    const groups = groupMRs(list, "review", [], NOW);
    expect(groups.map((g) => [g.label, g.mrs.length])).toEqual([
      ["review ready", 2],
      ["not reviewed", 1],
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
