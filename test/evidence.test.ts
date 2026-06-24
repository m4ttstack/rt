import { describe, expect, it } from "vitest";

import { buildUserEvidence, type EvidenceContext } from "../server/metrics/evidence.js";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import { FETCH, USERS, WINDOW } from "./fixtures.js";
import type { NormLinearIssue } from "../server/pipeline/model.js";

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };
const CTX: EvidenceContext = {
  window: WINDOW,
  baseUrl: "https://gitlab.com",
  sizeBand: SIZE_BAND,
  linearMaxIssueAgeDays: 90,
};

const snap = computeSnapshot(FETCH, { window: WINDOW, users: USERS, sizeBand: SIZE_BAND, linearMaxIssueAgeDays: 90 });
const alice = snap.byUser.alice!;
const ev = buildUserEvidence(FETCH, "alice", CTX);

describe("buildUserEvidence row counts match the snapshot", () => {
  it("merged-MR-backed counts line up", () => {
    expect(ev.mrsMerged!.rows.length).toBe(alice.mrsMerged);
    expect(ev.additions!.rows.length).toBe(alice.mrsMerged);
    expect(ev.netLines!.rows.length).toBe(alice.mrsMerged);
  });

  it("reviewed / pipelines / coding-days counts line up", () => {
    expect(ev.mrsReviewed!.rows.length).toBe(alice.mrsReviewed);
    expect(ev.pipelines!.rows.length).toBe(alice.pipelines);
    expect(ev.codingDays!.rows.length).toBe(alice.codingDays);
  });

  it("issues done: non-muted rows equal the counted value", () => {
    const counted = ev.issuesCompleted!.rows.filter((r) => !r.muted).length;
    expect(counted).toBe(alice.issuesCompleted);
  });

  it("reverted rows that are NOT muted equal revertedCount", () => {
    const reverted = ev.revertedCount!.rows.filter((r) => !r.muted).length;
    expect(reverted).toBe(alice.revertedCount);
  });
});

describe("buildUserEvidence links and flags", () => {
  it("builds GitLab MR deep links from baseUrl + projectPath + iid", () => {
    // alice's MR1 is iid 1 in org/app.
    expect(ev.mrsMerged!.rows.some((r) => r.href === "https://gitlab.com/org/app/-/merge_requests/1")).toBe(true);
  });

  it("carries the Linear issue url through as the row href", () => {
    expect(ev.issuesCompleted!.rows.every((r) => r.href?.startsWith("https://linear.app/"))).toBe(true);
  });

  it("size-health marks out-of-band MRs as muted", () => {
    // MR2 is +5/-2 = 7 changed lines, below tooSmall (10) -> out of band -> muted.
    const small = ev.sizeHealthPct!.rows.find((r) => r.cells[0] === "!2");
    expect(small?.muted).toBe(true);
  });

  it("latency evidence summarizes p50/p90 over the sampled MRs", () => {
    expect(ev.responseLatencyHours!.summary).toMatch(/p50 .*h · p90 .*h over \d+ MR/);
  });
});

describe("buildUserEvidence stale-issue muting", () => {
  const stale: NormLinearIssue = {
    id: "OLD-1",
    identifier: "OLD-1",
    title: "Ancient backlog",
    url: "https://linear.app/acme/issue/OLD-1",
    assignedUser: "alice",
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2026-05-15T00:00:00.000Z",
    teamKey: "ENG",
  };
  const fetched = { ...FETCH, linearIssues: [...FETCH.linearIssues, stale] };
  const e = buildUserEvidence(fetched, "alice", CTX);

  it("shows the stale issue but mutes it and notes the exclusion", () => {
    const row = e.issuesCompleted!.rows.find((r) => r.cells[0] === "OLD-1");
    expect(row?.muted).toBe(true);
    expect(e.issuesCompleted!.summary).toMatch(/excluded as stale/);
  });
});
