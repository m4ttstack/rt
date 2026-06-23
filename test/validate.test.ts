import { describe, expect, it } from "vitest";

import { applyRankings } from "../server/metrics/ranking.js";
import { validateLeaderboard } from "../server/metrics/validate.js";
import { makeMetrics, makeResponse, makeUser } from "./builders.js";
import type { LeaderboardResponse } from "../shared/types.js";

/** A well-formed, ranked response (the happy path the evaluator should pass). */
function validResponse(): LeaderboardResponse {
  const a = makeUser("a", makeMetrics({ mrsMerged: 10, revertRate: 0.0, codingDays: 5 }), { isCurrentUser: true });
  const b = makeUser("b", makeMetrics({ mrsMerged: 4, revertRate: 0.3, codingDays: 2 }));
  const users = [a, b];
  const leaders = applyRankings(users);
  return makeResponse(users, { currentUser: "a", leaders });
}

const codes = (res: LeaderboardResponse) => validateLeaderboard(res).issues.map((i) => i.code);

describe("validateLeaderboard", () => {
  it("passes a well-formed ranked response", () => {
    const report = validateLeaderboard(validResponse());
    expect(report.ok).toBe(true);
    expect(report.errors).toBe(0);
  });

  it("catches a leader that is not actually rank 1", () => {
    const res = validResponse();
    res.leaders.mrsMerged = "b"; // a is the real rank-1
    const report = validateLeaderboard(res);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "leader_not_rank1")).toBe(true);
  });

  it("catches a rank-1 user who does not hold the best value", () => {
    const res = validResponse();
    const a = res.users.find((u) => u.username === "a")!;
    a.metrics.mrsMerged.rank = 2; // corrupt: best value but rank 2
    const b = res.users.find((u) => u.username === "b")!;
    b.metrics.mrsMerged.rank = 1; // corrupt: worse value but rank 1
    expect(codes(res)).toContain("best_not_rank1");
    expect(codes(res)).toContain("rank1_not_best");
  });

  it("catches deltas present when hasTrend is false", () => {
    const res = validResponse();
    res.hasTrend = false;
    res.users[0]!.metrics.mrsMerged.delta = 3;
    expect(codes(res)).toContain("trend_delta_without_trend");
  });

  it("warns (not errors) when a metric is uniform across users", () => {
    const res = validResponse(); // reviewDepth is 0 for both users
    const report = validateLeaderboard(res);
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.severity === "warn" && i.code === "metric_uniform")).toBe(true);
  });

  it("flags a current-user mismatch when the flagged row's username differs", () => {
    const res = validResponse();
    res.currentUser = "nobody"; // row "a" is still flagged isCurrentUser
    expect(codes(res)).toContain("current_user_mismatch");
  });

  it("flags current-user absent when no row is flagged", () => {
    const res = validResponse();
    res.users.forEach((u) => (u.isCurrentUser = false));
    expect(codes(res)).toContain("current_user_absent");
  });
});
