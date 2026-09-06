import { describe, expect, it } from "vitest";

import { applyRankings } from "../src/server/metrics/ranking.js";
import { metricByKey, metricRank } from "../src/shared/metrics.js";
import { makeMetrics, makeUser } from "./builders.js";
import type { UserRow } from "../src/shared/types.js";

const rankOf = (u: UserRow, key: Parameters<typeof metricByKey>[0]) =>
  metricRank(u.metrics, metricByKey(key)!);

describe("applyRankings", () => {
  it("ranks higher-is-better metrics, shares ranks on ties, returns the leader", () => {
    const a = makeUser("a", makeMetrics({ mrsMerged: 10 }));
    const b = makeUser("b", makeMetrics({ mrsMerged: 5 }));
    const c = makeUser("c", makeMetrics({ mrsMerged: 5 }));
    const leaders = applyRankings([a, b, c]);

    expect(rankOf(a, "mrsMerged")).toBe(1);
    expect(rankOf(b, "mrsMerged")).toBe(2);
    expect(rankOf(c, "mrsMerged")).toBe(2); // tie shares rank
    expect(leaders.mrsMerged).toBe("a");
  });

  it("ranks lower-is-better metrics (revert rate) ascending", () => {
    const a = makeUser("a", makeMetrics({ revertRate: 0.1 }));
    const b = makeUser("b", makeMetrics({ revertRate: 0.5 }));
    const c = makeUser("c", makeMetrics({ revertRate: 0.0 }));
    const leaders = applyRankings([a, b, c]);

    expect(rankOf(c, "revertRate")).toBe(1); // lowest is best
    expect(rankOf(a, "revertRate")).toBe(2);
    expect(rankOf(b, "revertRate")).toBe(3);
    expect(leaders.revertRate).toBe("c");
  });

  it("treats null distribution values as unranked (nulls last)", () => {
    const a = makeUser("a", makeMetrics({ reviewLatencyHours: 24 }));
    const b = makeUser("b", makeMetrics({ reviewLatencyHours: null }));
    const c = makeUser("c", makeMetrics({ reviewLatencyHours: 10 }));
    const leaders = applyRankings([a, b, c]);

    expect(rankOf(c, "reviewLatencyHours")).toBe(1); // 10h fastest
    expect(rankOf(a, "reviewLatencyHours")).toBe(2);
    expect(rankOf(b, "reviewLatencyHours")).toBeNull(); // no sample
    expect(leaders.reviewLatencyHours).toBe("c");
  });

  it("excludes unresolved users from ranking", () => {
    const a = makeUser("a", makeMetrics({ codingDays: 3 }));
    const ghost = makeUser("ghost", makeMetrics({ codingDays: 99 }), { resolved: false });
    const leaders = applyRankings([a, ghost]);

    expect(rankOf(a, "codingDays")).toBe(1);
    expect(rankOf(ghost, "codingDays")).toBeNull();
    expect(leaders.codingDays).toBe("a"); // not the unresolved ghost despite higher value
  });

  it("when every value is identical, all share rank 1", () => {
    const a = makeUser("a", makeMetrics({ reviewDepth: 0 }));
    const b = makeUser("b", makeMetrics({ reviewDepth: 0 }));
    applyRankings([a, b]);
    expect(rankOf(a, "reviewDepth")).toBe(1);
    expect(rankOf(b, "reviewDepth")).toBe(1);
  });
});
