import { describe, expect, it } from "vitest";

import { buildCorpus, buildUserCohorts } from "../src/server/metrics/cohorts.js";
import { FETCH, mr, WINDOW } from "./fixtures.js";

const OPTS = { window: WINDOW, sizeBand: { tooSmall: 10, tooLarge: 400 } };

describe("buildCorpus", () => {
  it("drops ignored MRs before anything else sees them", () => {
    const corpus = buildCorpus(FETCH, { ...OPTS, ignoredMrs: ["!1"] });
    expect(corpus.mrs.map((m) => m.iid)).toEqual([2, 3, 4]);
  });

  it("tolerates a fetch result with no linearIssues field", () => {
    const { linearIssues: _drop, ...legacy } = FETCH;
    const corpus = buildCorpus(legacy as typeof FETCH, OPTS);
    expect(corpus.linearIssues).toEqual([]);
  });
});

describe("buildUserCohorts for alice", () => {
  const corpus = buildCorpus(FETCH, OPTS);
  const c = buildUserCohorts(corpus, "alice", OPTS);

  it("authoredMerged is her two merged MRs; MR2 is out of the size band", () => {
    expect(c.authoredMerged.map((m) => m.iid)).toEqual([1, 2]);
    expect(c.authoredMerged.map(c.inBand)).toEqual([true, false]);
  });

  it("reverted is the subset later reverted by anyone", () => {
    expect(c.reverted.map((m) => m.iid)).toEqual([1]);
  });

  it("reviewed carries her notes, inline count, and first-response hours on MR3", () => {
    expect(c.reviewed).toHaveLength(1);
    const r = c.reviewed[0]!;
    expect(r.mr.iid).toBe(3);
    expect(r.notes).toHaveLength(3);
    expect(r.inlineCount).toBe(2);
    expect(r.responseHours).toBe(24);
  });

  it("an approval with no notes still counts as reviewed, with no response time", () => {
    const approvedOnly = mr({
      iid: 10,
      authorUsername: "bob",
      title: "Approved, no comment",
      mergedAt: "2026-05-10T00:00:00.000Z",
      approvedByUsernames: ["alice"],
    });
    const soloCorpus = buildCorpus({ ...FETCH, mrs: [approvedOnly] }, OPTS);
    const soloC = buildUserCohorts(soloCorpus, "alice", OPTS);
    expect(soloC.reviewed).toHaveLength(1);
    const r = soloC.reviewed[0]!;
    expect(r.mr.iid).toBe(10);
    expect(r.notes).toEqual([]);
    expect(r.inlineCount).toBe(0);
    expect(r.responseHours).toBeNull();
  });

  it("waited is MR1 with the bot note ignored for first touch", () => {
    expect(c.waited.map((w) => [w.mr.iid, w.waitHours])).toEqual([[1, 26]]);
  });

  it("reviewersOfMine counts bob once for MR1 and excludes the bot", () => {
    expect([...c.reviewersOfMine.entries()]).toEqual([["bob", 1]]);
  });

  it("pipelines, pushes, merges, and issues are windowed and attributed", () => {
    expect(c.pipelines).toHaveLength(2);
    expect(c.pushTimestamps).toHaveLength(5);
    expect(c.mergeTimestamps).toEqual(["2026-05-10T00:00:00.000Z", "2026-05-11T00:00:00.000Z"]);
    expect(c.issues).toEqual({ counted: FETCH.linearIssues!.slice(0, 2), teamExcluded: 0, stateExcluded: 0 });
  });
});

describe("the Linear team gate", () => {
  it("removes merged MRs with no team ticket from authoredMerged", () => {
    const gated = buildCorpus(FETCH, { ...OPTS, linearTeam: "ENG" });
    const c = buildUserCohorts(gated, "alice", { ...OPTS, linearTeam: "ENG" });
    expect(c.authoredMerged).toEqual([]);
  });

  it("tallies issues excluded by team and by state", () => {
    const withNoise = {
      ...FETCH,
      linearIssues: [
        ...FETCH.linearIssues!,
        { ...FETCH.linearIssues![0]!, id: "PLA-9", identifier: "PLA-9" },
        { ...FETCH.linearIssues![0]!, id: "ENG-9", identifier: "ENG-9", stateType: "started", stateName: "In Progress" },
      ],
    };
    const opts = { ...OPTS, linearTeam: "ENG" };
    const c = buildUserCohorts(buildCorpus(withNoise, opts), "alice", opts);
    expect(c.issues.counted.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(c.issues.teamExcluded).toBe(1);
    expect(c.issues.stateExcluded).toBe(1);
  });
});
