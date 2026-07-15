import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import { WIDE_OUTCOME, W_7D, W_90D } from "./fixtures/outcome.js";
import { sliceOutcome } from "../server/pipeline/slice.js";
import { W_7D_PRIOR } from "./fixtures/outcome.js";

const OPTS = {
  users: ["alice", "bob"],
  sizeBand: { tooSmall: 10, tooLarge: 400 },
  doneStates: [] as string[],
  extraBotPatterns: [] as string[],
  excludeFilePatterns: [] as string[],
  ignoredMrs: [] as string[],
};

describe("characterization: metric output is pinned", () => {
  it("90d snapshot over the wide outcome", () => {
    const snap = computeSnapshot(WIDE_OUTCOME.result, { window: W_90D, ...OPTS });
    expect(snap).toMatchInlineSnapshot(`
      {
        "approvalsAvailable": true,
        "byUser": {
          "alice": {
            "additions": 350,
            "codingDays": 3,
            "currentStreak": 1,
            "deletions": 70,
            "issuesCompleted": 2,
            "longestStreak": 1,
            "mrsMerged": 7,
            "mrsReviewed": 0,
            "pipelineStatus": {
              "canceled": 0,
              "failed": 1,
              "other": 0,
              "success": 2,
            },
            "pipelines": 3,
            "reciprocity": 0,
            "responseLatencyHours": {
              "p50": null,
              "p90": null,
            },
            "revertRate": 0.143,
            "revertedCount": 1,
            "reviewDepth": 0,
            "reviewLatencyHours": {
              "p50": 2,
              "p90": 2,
            },
            "sizeHealthPct": 1,
          },
          "bob": {
            "additions": 0,
            "codingDays": 0,
            "currentStreak": 0,
            "deletions": 0,
            "issuesCompleted": 0,
            "longestStreak": 0,
            "mrsMerged": 0,
            "mrsReviewed": 1,
            "pipelineStatus": {
              "canceled": 0,
              "failed": 0,
              "other": 0,
              "success": 0,
            },
            "pipelines": 0,
            "reciprocity": 1,
            "responseLatencyHours": {
              "p50": 2,
              "p90": 2,
            },
            "revertRate": 0,
            "revertedCount": 0,
            "reviewDepth": 1,
            "reviewLatencyHours": {
              "p50": null,
              "p90": null,
            },
            "sizeHealthPct": 0,
          },
        },
      }
    `);
  });

  it("7d snapshot over the wide outcome (pre-slice baseline)", () => {
    const snap = computeSnapshot(WIDE_OUTCOME.result, { window: W_7D, ...OPTS });
    expect(snap).toMatchInlineSnapshot(`
      {
        "approvalsAvailable": true,
        "byUser": {
          "alice": {
            "additions": 200,
            "codingDays": 1,
            "currentStreak": 1,
            "deletions": 40,
            "issuesCompleted": 2,
            "longestStreak": 1,
            "mrsMerged": 4,
            "mrsReviewed": 0,
            "pipelineStatus": {
              "canceled": 0,
              "failed": 1,
              "other": 0,
              "success": 1,
            },
            "pipelines": 2,
            "reciprocity": 0,
            "responseLatencyHours": {
              "p50": null,
              "p90": null,
            },
            "revertRate": 0.25,
            "revertedCount": 1,
            "reviewDepth": 0,
            "reviewLatencyHours": {
              "p50": 2,
              "p90": 2,
            },
            "sizeHealthPct": 1,
          },
          "bob": {
            "additions": 0,
            "codingDays": 0,
            "currentStreak": 0,
            "deletions": 0,
            "issuesCompleted": 0,
            "longestStreak": 0,
            "mrsMerged": 0,
            "mrsReviewed": 1,
            "pipelineStatus": {
              "canceled": 0,
              "failed": 0,
              "other": 0,
              "success": 0,
            },
            "pipelines": 0,
            "reciprocity": 1,
            "responseLatencyHours": {
              "p50": 2,
              "p90": 2,
            },
            "revertRate": 0,
            "revertedCount": 0,
            "reviewDepth": 1,
            "reviewLatencyHours": {
              "p50": null,
              "p90": null,
            },
            "sizeHealthPct": 0,
          },
        },
      }
    `);
  });
});

describe("sliceOutcome", () => {
  const sliced = sliceOutcome(WIDE_OUTCOME, W_7D);

  it("keeps MRs updated on/after the window start and drops older ones", () => {
    expect(sliced.result.mrs.map((m) => m.iid).sort()).toEqual([1, 2, 4, 5]);
  });

  it("keeps pipelines created inside the window", () => {
    expect(sliced.result.pipelines).toHaveLength(2);
  });

  it("keeps push events inside the window's +/-1d pad, mirroring the fetch", () => {
    expect(sliced.result.pushEvents.map((e) => e.createdAt)).toEqual([
      "2026-07-09T01:00:00.000Z",
      "2026-07-07T12:00:00.000Z",
    ]);
  });

  it("keeps only Linear tickets linked to an in-window MR", () => {
    expect(sliced.result.linearIssues.map((i) => i.identifier)).toEqual(["ENG-1"]);
  });

  it("passes identities and approvalsAvailable through untouched", () => {
    expect(sliced.identities).toEqual(WIDE_OUTCOME.identities);
    expect(sliced.result.approvalsAvailable).toBe(true);
  });

  it("does not mutate the wide outcome", () => {
    expect(WIDE_OUTCOME.result.mrs).toHaveLength(7);
    expect(WIDE_OUTCOME.result.linearIssues).toHaveLength(2);
  });

  it("slices the prior window to a disjoint, non-empty set", () => {
    const prior = sliceOutcome(WIDE_OUTCOME, W_7D_PRIOR);
    expect(prior.result.mrs.map((m) => m.iid)).toContain(7);
  });
});

describe("slicing preserves metric output", () => {
  it("a 7d slice yields the same issuesCompleted a native 7d fetch would", () => {
    const snap = computeSnapshot(sliceOutcome(WIDE_OUTCOME, W_7D).result, { window: W_7D, ...OPTS });
    // The wide outcome scores 2 (ENG-1 + ENG-99) because nothing filters Linear by date.
    // The slice drops ENG-99 with its out-of-window source MR, matching a native 7d fetch.
    expect(snap.byUser.alice!.issuesCompleted).toBe(1);
  });

  it("a 7d slice keeps revertRate at the pinned value", () => {
    const snap = computeSnapshot(sliceOutcome(WIDE_OUTCOME, W_7D).result, { window: W_7D, ...OPTS });
    expect(snap.byUser.alice!.revertRate).toBe(0.25);
  });
});
