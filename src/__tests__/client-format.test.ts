import { test, expect } from "bun:test";
import { ago, cleanTitle, statusReasons, nudgeChipText, peerState } from "../client/board/format.ts";

test("ago buckets minutes, hours, days", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  expect(ago("2026-08-19T11:30:00Z", now)).toBe("30m");
  expect(ago("2026-08-19T02:00:00Z", now)).toBe("10h");
  expect(ago("2026-08-14T12:00:00Z", now)).toBe("5d");
  expect(ago(null, now)).toBe("");
});

test("cleanTitle strips ticket prefix and draft marker", () => {
  expect(cleanTitle("ACME-2369: add the thing")).toBe("add the thing");
  expect(cleanTitle("Draft: ACME-1: x")).toBe("x");
});

test("statusReasons is 'ready to merge' with no blockers", () => {
  expect(statusReasons({ blockers: { any: false }, reviews: { given: 0, required: 0 }, unresolvedThreads: 0 } as never)).toBe("ready to merge");
});

test("nudgeChipText covers every display state", () => {
  expect(nudgeChipText({ display: "requested", reviewer: "a" })).toBe("re-review requested");
  expect(nudgeChipText({ display: "rejected", reviewer: "a", reason: "busy" })).toBe("nudge: busy");
  expect(nudgeChipText({ display: "no-response", reviewer: "a" })).toBe("no response, retry?");
});

test("peerState maps done+outcome, hides unknown statuses", () => {
  const base = { mrUrl: "u", iid: 1, reviewer: "r", updatedAt: 0 };
  expect(peerState({ ...base, status: "reviewing" })).toBe("reviewing");
  expect(peerState({ ...base, status: "done", outcome: "approve" })).toBe("approved");
  expect(peerState({ ...base, status: "someday-new-word" })).toBeNull();
});
