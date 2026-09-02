import { describe, expect, it } from "vitest";

import { buildUserEvidence } from "../server/metrics/evidence.js";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import type { FetchResult } from "../server/pipeline/model.js";
import { FETCH, USERS, WINDOW } from "./fixtures.js";

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

// Only MR1 references an ENG ticket (through its source branch), so with a Linear team set
// the merged cohort shrinks and every merged-backed table must shrink with it.
const GATED: FetchResult = {
  ...FETCH,
  mrs: FETCH.mrs.map((m) => (m.iid === 1 ? { ...m, sourceBranch: "eng-1-add-feature-x" } : m)),
};

describe("snapshot and evidence agree when a Linear team gates the merged cohort", () => {
  const opts = { window: WINDOW, sizeBand: SIZE_BAND, linearTeam: "ENG" };
  const snap = computeSnapshot(GATED, { ...opts, users: USERS });

  it("the gate bites in this fixture", () => {
    expect(snap.byUser.alice!.mrsMerged).toBe(1);
    expect(snap.byUser.bob!.mrsMerged).toBe(0);
  });

  for (const u of USERS) {
    it(`${u}: every cohort-backed table has as many rows as the metric counts`, () => {
      const m = snap.byUser[u]!;
      const ev = buildUserEvidence(GATED, u, { ...opts, baseUrl: "https://gitlab.com" });
      expect(ev.mrsMerged!.rows.length).toBe(m.mrsMerged);
      expect(ev.additions!.rows.length).toBe(m.mrsMerged);
      expect(ev.sizeHealthPct!.rows.length).toBe(m.mrsMerged);
      expect(ev.revertedCount!.rows.filter((r) => !r.muted).length).toBe(m.revertedCount);
      expect(ev.mrsReviewed!.rows.length).toBe(m.mrsReviewed);
      expect(ev.pipelines!.rows.length).toBe(m.pipelines);
      expect(ev.codingDays!.rows.length).toBe(m.codingDays);
      expect(ev.issuesCompleted!.rows.length).toBe(m.issuesCompleted);
    });
  }

  it("the merged summary counts the gated cohort, not every merged MR", () => {
    const ev = buildUserEvidence(GATED, "alice", { ...opts, baseUrl: "https://gitlab.com" });
    expect(ev.mrsMerged!.summary).toBe("1 MRs merged");
  });
});
