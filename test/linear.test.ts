import { describe, expect, it } from "vitest";

import { mapIssue } from "../server/linear/map.js";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import type { RawIssue } from "../server/linear/raw-types.js";
import { FETCH, USERS, WINDOW } from "./fixtures.js";

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

const rawIssue = (overrides: Partial<RawIssue> = {}): RawIssue => ({
  id: "id-1",
  identifier: "ENG-1",
  title: "Some issue",
  url: "https://linear.app/acme/issue/ENG-1",
  state: null,
  ...overrides,
});

describe("mapIssue", () => {
  it("maps a raw issue to a normalized one, attributing to the given user", () => {
    const norm = mapIssue(rawIssue(), "alice", []);
    expect(norm.assignedUser).toBe("alice");
    expect(norm.identifier).toBe("ENG-1");
    expect(norm.title).toBe("Some issue");
    expect(norm.url).toBe("https://linear.app/acme/issue/ENG-1");
    expect(norm.linkedMrs).toEqual([]);
  });

  it("accepts null for the assigned user (e.g. unlinked ticket)", () => {
    const norm = mapIssue(rawIssue(), null, []);
    expect(norm.assignedUser).toBeNull();
  });
});

describe("issuesCompleted metric", () => {
  const snap = computeSnapshot(FETCH, { window: WINDOW, users: USERS, sizeBand: SIZE_BAND });

  it("counts verified tickets attributed to each user", () => {
    // alice: ENG-1 + ENG-2 = 2.
    expect(snap.byUser.alice!.issuesCompleted).toBe(2);
    // bob: ENG-3 = 1.
    expect(snap.byUser.bob!.issuesCompleted).toBe(1);
  });

  it("ignores tickets with a null assigned user", () => {
    // ENG-5 has assignedUser: null — it doesn't count for anyone.
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
