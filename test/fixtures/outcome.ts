import type { FetchOutcome } from "../../server/pipeline/fetch.js";
import type { NormMr } from "../../server/pipeline/model.js";
import type { TimeWindow } from "../../shared/types.js";

/** All fixture dates are fixed, never relative to now, so output is stable forever. */
export const W_90D: TimeWindow = { start: "2026-04-16T00:00:00.000Z", end: "2026-07-15T00:00:00.000Z", key: "90d" };
export const W_7D: TimeWindow = { start: "2026-07-08T00:00:00.000Z", end: "2026-07-15T00:00:00.000Z", key: "7d" };
/** The prior window of W_7D. Inside W_90D, so it is a slice, never a fetch. */
export const W_7D_PRIOR: TimeWindow = { start: "2026-07-01T00:00:00.000Z", end: "2026-07-08T00:00:00.000Z", key: "7d" };

export function mr(over: Partial<NormMr> & Pick<NormMr, "iid">): NormMr {
  return {
    projectPath: "acme/app",
    authorUsername: "alice",
    state: "merged",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    preparedAt: null,
    mergedAt: "2026-07-09T12:00:00.000Z",
    title: `MR ${over.iid}`,
    sourceBranch: "feat/x",
    description: null,
    labels: [],
    additions: 50,
    deletions: 10,
    fileCount: 2,
    approvedByUsernames: [],
    notes: [],
    diffStats: [{ path: "src/a.ts", additions: 50, deletions: 10 }],
    ...over,
  } as NormMr;
}

/**
 * A 90d-wide outcome. Every field is chosen so that slicing to W_7D exercises a
 * distinct predicate; see the per-item comments.
 */
export const WIDE_OUTCOME: FetchOutcome = {
  result: {
    mrs: [
      // In W_7D by every measure.
      mr({ iid: 1 }),
      // Merged inside W_7D, reviewed by bob inside W_7D.
      mr({
        iid: 2,
        authorUsername: "alice",
        notes: [
          { authorUsername: "bob", createdAt: "2026-07-09T02:00:00.000Z", system: false, inline: true },
          { authorUsername: "bob", createdAt: "2026-07-09T03:00:00.000Z", system: false, inline: false },
        ],
      }),
      // Outside W_7D (May), inside W_90D. Must vanish from a 7d slice.
      mr({ iid: 3, createdAt: "2026-05-02T00:00:00.000Z", updatedAt: "2026-05-03T00:00:00.000Z", mergedAt: "2026-05-03T00:00:00.000Z" }),
      // Revert pair, both in W_7D: iid 5 reverts iid 4.
      mr({ iid: 4, title: "Add widget" }),
      mr({ iid: 5, title: 'Revert "Add widget"' }),
      // Out-of-window MR (June) carrying a Linear ticket. Its ticket must vanish
      // from a 7d slice, since the ticket set is derived from in-window MRs.
      mr({ iid: 6, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z", mergedAt: "2026-06-02T00:00:00.000Z", sourceBranch: "feat/ENG-99-old" }),
      // In W_7D_PRIOR only. Proves the prior slice is non-empty and disjoint from W_7D.
      mr({ iid: 7, createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z", mergedAt: "2026-07-02T12:00:00.000Z" }),
    ],
    pipelines: [
      { projectPath: "acme/app", username: "alice", status: "success", createdAt: "2026-07-09T01:00:00.000Z" },
      { projectPath: "acme/app", username: "alice", status: "failed", createdAt: "2026-07-10T01:00:00.000Z" },
      // Outside W_7D.
      { projectPath: "acme/app", username: "alice", status: "success", createdAt: "2026-05-01T01:00:00.000Z" },
    ],
    pushEvents: [
      { username: "alice", createdAt: "2026-07-09T01:00:00.000Z" },
      // Inside the -1d pad of W_7D (start 07-08), outside the window proper.
      { username: "alice", createdAt: "2026-07-07T12:00:00.000Z" },
      // Outside even the pad.
      { username: "alice", createdAt: "2026-05-01T01:00:00.000Z" },
    ],
    linearIssues: [
      {
        id: "1", identifier: "ENG-1", title: "In window", url: "https://linear.app/x/ENG-1",
        assignedUser: "alice", linkedMrs: [{ iid: 1, projectPath: "acme/app" }],
        stateType: "completed", stateName: "Done",
      },
      {
        id: "2", identifier: "ENG-99", title: "Out of window", url: "https://linear.app/x/ENG-99",
        assignedUser: "alice", linkedMrs: [{ iid: 6, projectPath: "acme/app" }],
        stateType: "completed", stateName: "Done",
      },
    ],
    approvalsAvailable: true,
  },
  identities: {
    alice: { username: "alice", name: "Alice", resolved: true },
    bob: { username: "bob", name: "Bob", resolved: true },
  },
  warnings: [],
};
