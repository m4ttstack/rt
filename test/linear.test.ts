import { describe, expect, it } from "vitest";

import { mapIssue } from "../server/linear/map.js";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import type { RawIssue } from "../server/linear/raw-types.js";
import type { NormLinearIssue } from "../server/pipeline/model.js";
import { FETCH, USERS, WINDOW } from "./fixtures.js";

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

const rawIssue = (overrides: Partial<RawIssue> = {}): RawIssue => ({
  id: "id-1",
  identifier: "ENG-1",
  title: "Some issue",
  url: "https://linear.app/acme/issue/ENG-1",
  createdAt: "2026-05-01T00:00:00.000Z",
  completedAt: "2026-05-10T00:00:00.000Z",
  assignee: { email: "alice@example.com" },
  team: { key: "ENG" },
  ...overrides,
});

describe("mapIssue", () => {
  const userByEmail = { "alice@example.com": "alice", "bob@example.com": "bob" };

  it("resolves the assignee email back to the GitLab username", () => {
    const norm = mapIssue(rawIssue(), userByEmail);
    expect(norm.assignedUser).toBe("alice");
    expect(norm.identifier).toBe("ENG-1");
    expect(norm.teamKey).toBe("ENG");
    expect(norm.completedAt).toBe("2026-05-10T00:00:00.000Z");
  });

  it("matches emails case-insensitively", () => {
    const norm = mapIssue(rawIssue({ assignee: { email: "ALICE@example.com" } }), userByEmail);
    expect(norm.assignedUser).toBe("alice");
  });

  it("leaves unmapped or unassigned issues with a null user (counts for no one)", () => {
    expect(mapIssue(rawIssue({ assignee: { email: "stranger@example.com" } }), userByEmail).assignedUser).toBeNull();
    expect(mapIssue(rawIssue({ assignee: null }), userByEmail).assignedUser).toBeNull();
    expect(mapIssue(rawIssue({ assignee: { email: null } }), userByEmail).assignedUser).toBeNull();
  });

  it("tolerates a missing team", () => {
    expect(mapIssue(rawIssue({ team: null }), userByEmail).teamKey).toBe("");
  });
});

describe("issuesCompleted metric", () => {
  const snap = computeSnapshot(FETCH, { window: WINDOW, users: USERS, sizeBand: SIZE_BAND });

  it("counts only in-window, completed, assignee-mapped issues", () => {
    // alice: ENG-1 + ENG-2 (ENG-4 is out of window). bob: ENG-3 (ENG-6 not completed).
    expect(snap.byUser.alice!.issuesCompleted).toBe(2);
    expect(snap.byUser.bob!.issuesCompleted).toBe(1);
  });

  it("ignores issues with an unmapped assignee", () => {
    // In-window completed rows are ENG-1, ENG-2, ENG-3, ENG-5; ENG-5 has a null user, so
    // only 3 are attributed to anyone.
    const total = snap.byUser.alice!.issuesCompleted + snap.byUser.bob!.issuesCompleted;
    expect(total).toBe(3);
  });

  it("tolerates a FetchResult with no linearIssues field (old cache envelopes)", () => {
    const { linearIssues: _omit, ...legacy } = FETCH;
    const legacySnap = computeSnapshot(legacy as typeof FETCH, {
      window: WINDOW,
      users: USERS,
      sizeBand: SIZE_BAND,
    });
    expect(legacySnap.byUser.alice!.issuesCompleted).toBe(0);
  });
});

describe("issuesCompleted stale-backlog age cap", () => {
  const issue = (
    identifier: string,
    createdAt: string,
    completedAt: string,
  ): NormLinearIssue => ({
    id: identifier,
    identifier,
    title: `Issue ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}`,
    assignedUser: "alice",
    createdAt,
    completedAt,
    teamKey: "ENG",
  });

  // Both completed in-window (May 2026). "fresh" was filed days before; "stale" is an
  // ~16-month-old backlog item bulk-closed in the window (the Doug case).
  const fresh = issue("NEW-1", "2026-05-10T00:00:00.000Z", "2026-05-15T00:00:00.000Z");
  const stale = issue("OLD-1", "2025-01-01T00:00:00.000Z", "2026-05-15T00:00:00.000Z");
  const fetched = { ...FETCH, linearIssues: [fresh, stale] };

  const snap = (linearMaxIssueAgeDays?: number) =>
    computeSnapshot(fetched, { window: WINDOW, users: USERS, sizeBand: SIZE_BAND, linearMaxIssueAgeDays });

  it("excludes issues completed long after creation when a cap is set", () => {
    expect(snap(90).byUser.alice!.issuesCompleted).toBe(1); // fresh only
  });

  it("keeps the stale issue when no cap (or a non-positive cap) is set", () => {
    expect(snap(undefined).byUser.alice!.issuesCompleted).toBe(2);
    expect(snap(0).byUser.alice!.issuesCompleted).toBe(2);
  });

  it("keeps the stale issue when the cap is wide enough to admit it", () => {
    expect(snap(600).byUser.alice!.issuesCompleted).toBe(2); // ~500 days old < 600
  });
});
