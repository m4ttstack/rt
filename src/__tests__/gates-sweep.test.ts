import { describe, expect, test } from "bun:test";
import { planSweep, pruneOffBoardGates } from "../gates/sweep.ts";
import type { GateRow } from "@mattstack/rt-client";
import type { ReviewState } from "../review-state.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const OTHER_MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4900";
const GRACE_MS = 90 * 60_000;
const NOW = 10_000_000;

function baseRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: "gate-1",
    subject: `mr:${MR_URL}`,
    kind: "review-post",
    questions: [],
    meta: null,
    status: "open",
    answer: null,
    openedAt: NOW,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
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
  test("a fresh open row (openedAt = now) is untouched", () => {
    const rows = [baseRow({ openedAt: NOW })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("an aged open row (now - openedAt >= graceMs) yields a park action, tabId joined from review state", () => {
    const rows = [baseRow({ openedAt: NOW - GRACE_MS - 1 })];
    const reviews = new Map([[MR_URL, baseReview({ status: "reviewing", tabId: "tab-1" })]]);
    const actions = planSweep(rows, reviews, NOW, GRACE_MS);
    expect(actions).toEqual([{ kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" }]);
  });

  test("boundary: exactly graceMs old parks", () => {
    const rows = [baseRow({ openedAt: NOW - GRACE_MS })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("park");
  });

  test("an aged open row with no matching review state still parks, with no tabId", () => {
    const rows = [baseRow({ openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([{ kind: "park", mrUrl: MR_URL, tabId: undefined, gateId: "gate-1" }]);
  });

  test("an already-answered row never parks again, even when aged", () => {
    const rows = [baseRow({ status: "answered", openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("an already-parked row never parks again, even when aged", () => {
    const rows = [baseRow({ status: "parked", openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("an already-closed row never parks, even when aged", () => {
    const rows = [baseRow({ status: "closed", openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a non-mr: subject is ignored entirely", () => {
    const rows = [baseRow({ subject: "peer:some-other-thing", openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, new Map(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a done review with a tabId and no open row yields close-missed-done", () => {
    const review = baseReview({ status: "done", tabId: "tab-2" });
    const reviews = new Map([[MR_URL, review]]);
    const actions = planSweep([], reviews, NOW, GRACE_MS);
    expect(actions).toEqual([{ kind: "close-missed-done", mrUrl: MR_URL, tabId: "tab-2" }]);
  });

  test("a done review with a tabId but a still-open row does not close-missed-done", () => {
    const review = baseReview({ status: "done", tabId: "tab-2" });
    const rows = [baseRow({ status: "open", openedAt: NOW })];
    const actions = planSweep(rows, new Map([[MR_URL, review]]), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a done review with a parked (not open) row still yields close-missed-done", () => {
    const review = baseReview({ status: "done", tabId: "tab-2" });
    const rows = [baseRow({ status: "parked", openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, new Map([[MR_URL, review]]), NOW, GRACE_MS);
    // The parked row is aged too, but its own status is no longer "open" so it never re-parks;
    // the done review with an outstanding tabId still reconciles.
    expect(actions).toContainEqual({ kind: "close-missed-done", mrUrl: MR_URL, tabId: "tab-2" });
    expect(actions).toHaveLength(1);
  });

  test("a done review with no tabId is untouched", () => {
    const review = baseReview({ status: "done", tabId: undefined });
    const actions = planSweep([], new Map([[MR_URL, review]]), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a non-done review with a tabId is untouched", () => {
    const review = baseReview({ status: "reviewing", tabId: "tab-3" });
    const actions = planSweep([], new Map([[MR_URL, review]]), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("combines park and close-missed-done actions across different MRs", () => {
    const rows = [baseRow({ subject: `mr:${MR_URL}`, openedAt: NOW - GRACE_MS - 1 })];
    const reviews = new Map([
      [MR_URL, baseReview({ status: "reviewing", tabId: "tab-1" })],
      [OTHER_MR_URL, baseReview({ mrUrl: OTHER_MR_URL, status: "done", tabId: "tab-2" })],
    ]);
    const actions = planSweep(rows, reviews, NOW, GRACE_MS);
    expect(actions).toContainEqual({ kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" });
    expect(actions).toContainEqual({ kind: "close-missed-done", mrUrl: OTHER_MR_URL, tabId: "tab-2" });
    expect(actions).toHaveLength(2);
  });
});

describe("pruneOffBoardGates", () => {
  function makeIo() {
    const calls: Array<{ id: string; reason: string }> = [];
    const errors: string[] = [];
    return {
      calls,
      errors,
      gateClose: async (payload: { id: string; reason: "abandoned" | "superseded" | "pruned" }) => {
        calls.push({ id: payload.id, reason: payload.reason });
        return { ok: true, data: { ok: true as const } };
      },
      logError: (message: string) => { errors.push(message); },
    };
  }

  test("closes off-board open and parked rows with reason pruned", async () => {
    const rows = [
      baseRow({ id: "g-open", subject: `mr:${MR_URL}`, status: "open" }),
      baseRow({ id: "g-parked", subject: `mr:${OTHER_MR_URL}`, status: "parked" }),
    ];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set(), io);
    expect(io.calls).toEqual([
      { id: "g-open", reason: "pruned" },
      { id: "g-parked", reason: "pruned" },
    ]);
  });

  test("leaves on-board rows untouched", async () => {
    const rows = [baseRow({ id: "g-open", subject: `mr:${MR_URL}`, status: "open" })];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set([MR_URL]), io);
    expect(io.calls).toEqual([]);
  });

  test("skips answered and closed rows, even off-board", async () => {
    const rows = [
      baseRow({ id: "g-answered", subject: `mr:${MR_URL}`, status: "answered" }),
      baseRow({ id: "g-closed", subject: `mr:${OTHER_MR_URL}`, status: "closed" }),
    ];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set(), io);
    expect(io.calls).toEqual([]);
  });

  test("skips non-mr: subjects", async () => {
    const rows = [baseRow({ id: "g-peer", subject: "peer:something", status: "open" })];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set(), io);
    expect(io.calls).toEqual([]);
  });

  test("a rejecting gateClose is logged and the loop continues", async () => {
    const rows = [
      baseRow({ id: "g-fail", subject: `mr:${MR_URL}`, status: "open" }),
      baseRow({ id: "g-ok", subject: `mr:${OTHER_MR_URL}`, status: "open" }),
    ];
    const calls: string[] = [];
    const errors: string[] = [];
    const io = {
      gateClose: async (payload: { id: string; reason: "abandoned" | "superseded" | "pruned" }) => {
        calls.push(payload.id);
        if (payload.id === "g-fail") throw new Error("boom");
        return { ok: true, data: { ok: true as const } };
      },
      logError: (message: string) => { errors.push(message); },
    };
    await expect(pruneOffBoardGates(rows, new Set(), io)).resolves.toBeUndefined();
    expect(calls).toEqual(["g-fail", "g-ok"]);
    expect(errors).toHaveLength(1);
  });
});
