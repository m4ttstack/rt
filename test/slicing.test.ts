import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import { WIDE_OUTCOME, W_7D, W_90D } from "./fixtures/outcome.js";

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
