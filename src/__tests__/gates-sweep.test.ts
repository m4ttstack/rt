import { describe, expect, test } from "bun:test";
import { planSweep } from "../gates/sweep.ts";
import type { GateState } from "../gates/store.ts";
import type { ReviewState } from "../review-state.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const OTHER_MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4900";
const GRACE_MS = 90 * 60_000;
const NOW = 10_000_000;

function baseGate(overrides: Partial<GateState> = {}): GateState {
  return {
    gateId: "gate-1",
    mrUrl: MR_URL,
    iid: 4821,
    kind: "review-post",
    status: "open",
    openedAt: NOW,
    questions: [],
    ...overrides,
  };
}

function baseReview(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    mrUrl: MR_URL,
    iid: 4821,
    status: "done",
    startedAt: NOW - 1000,
    updatedAt: NOW - 500,
    ...overrides,
  };
}

describe("planSweep", () => {
  test("a fresh gate (openedAt = now) is untouched", () => {
    const gates = new Map([[MR_URL, baseGate({ openedAt: NOW })]]);
    const actions = planSweep(gates, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("an aged open gate (now - openedAt >= graceMs) yields a park action", () => {
    const gate = baseGate({ openedAt: NOW - GRACE_MS - 1, tabId: "tab-1" });
    const gates = new Map([[MR_URL, gate]]);
    const actions = planSweep(gates, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([{ kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" }]);
  });

  test("boundary: exactly graceMs old parks", () => {
    const gate = baseGate({ openedAt: NOW - GRACE_MS });
    const gates = new Map([[MR_URL, gate]]);
    const actions = planSweep(gates, new Map(), NOW, GRACE_MS);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("park");
  });

  test("an already-answered gate never parks again, even when aged", () => {
    const gate = baseGate({ status: "answered", openedAt: NOW - GRACE_MS - 1 });
    const gates = new Map([[MR_URL, gate]]);
    const actions = planSweep(gates, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("an already-parked gate never parks again, even when aged", () => {
    const gate = baseGate({ status: "parked", openedAt: NOW - GRACE_MS - 1 });
    const gates = new Map([[MR_URL, gate]]);
    const actions = planSweep(gates, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a done review with a tabId and no open gate yields close-missed-done", () => {
    const review = baseReview({ status: "done", tabId: "tab-2" });
    const reviews = new Map([[MR_URL, review]]);
    const actions = planSweep(new Map(), reviews, NOW, GRACE_MS);
    expect(actions).toEqual([{ kind: "close-missed-done", mrUrl: MR_URL, tabId: "tab-2" }]);
  });

  test("a done review with a tabId but a still-open gate does not close-missed-done", () => {
    const review = baseReview({ status: "done", tabId: "tab-2" });
    const gate = baseGate({ status: "open", openedAt: NOW });
    const actions = planSweep(new Map([[MR_URL, gate]]), new Map([[MR_URL, review]]), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a done review with a parked (not open) gate still yields close-missed-done", () => {
    const review = baseReview({ status: "done", tabId: "tab-2" });
    const gate = baseGate({ status: "parked", openedAt: NOW - GRACE_MS - 1 });
    const actions = planSweep(new Map([[MR_URL, gate]]), new Map([[MR_URL, review]]), NOW, GRACE_MS);
    // The parked gate is aged too, but its own status is no longer "open" so it never re-parks;
    // the done review with an outstanding tabId still reconciles.
    expect(actions).toContainEqual({ kind: "close-missed-done", mrUrl: MR_URL, tabId: "tab-2" });
    expect(actions).toHaveLength(1);
  });

  test("a done review with no tabId is untouched", () => {
    const review = baseReview({ status: "done", tabId: undefined });
    const actions = planSweep(new Map(), new Map([[MR_URL, review]]), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a non-done review with a tabId is untouched", () => {
    const review = baseReview({ status: "reviewing", tabId: "tab-3" });
    const actions = planSweep(new Map(), new Map([[MR_URL, review]]), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("combines park and close-missed-done actions across different MRs", () => {
    const gates = new Map([
      [MR_URL, baseGate({ mrUrl: MR_URL, openedAt: NOW - GRACE_MS - 1, tabId: "tab-1" })],
    ]);
    const reviews = new Map([
      [OTHER_MR_URL, baseReview({ mrUrl: OTHER_MR_URL, status: "done", tabId: "tab-2" })],
    ]);
    const actions = planSweep(gates, reviews, NOW, GRACE_MS);
    expect(actions).toContainEqual({ kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" });
    expect(actions).toContainEqual({ kind: "close-missed-done", mrUrl: OTHER_MR_URL, tabId: "tab-2" });
    expect(actions).toHaveLength(2);
  });
});
