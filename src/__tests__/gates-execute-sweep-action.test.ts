import { describe, expect, test } from "bun:test";
import { executeSweepAction, type ExecuteSweepActionIo } from "../gates/execute-sweep-action.ts";
import type { GateState } from "../gates/store.ts";
import type { SweepAction } from "../gates/sweep.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

function baseGate(overrides: Partial<GateState> = {}): GateState {
  return {
    gateId: "gate-1",
    mrUrl: MR_URL,
    iid: 4821,
    kind: "review-post",
    status: "open",
    openedAt: 1000,
    questions: [],
    ...overrides,
  };
}

function makeIo(gate: GateState | undefined): ExecuteSweepActionIo & {
  closed: string[];
  gateWrites: Array<Partial<GateState> & { gateId: string }>;
  reviewWrites: unknown[];
} {
  const closed: string[] = [];
  const gateWrites: Array<Partial<GateState> & { gateId: string }> = [];
  const reviewWrites: unknown[] = [];
  return {
    closed,
    gateWrites,
    reviewWrites,
    closeTab: async (tabId: string) => { closed.push(tabId); },
    readGateStates: () => (gate ? new Map([[gate.mrUrl, gate]]) : new Map()),
    writeGateState: (_path, patch) => { gateWrites.push(patch); },
    gateFilePath: (mrUrl) => `/gates/${mrUrl}.json`,
    writeReviewState: (_path, patch) => { reviewWrites.push(patch); },
    reviewFilePath: (mrUrl) => `/reviews/${mrUrl}.json`,
    sseNudge: () => {},
    now: () => 5000,
    graceMinutes: 90,
    log: () => {},
    logError: () => {},
  };
}

describe("executeSweepAction", () => {
  test("park action closes the tab and writes parked when the gate is still open at execution time", async () => {
    const io = makeIo(baseGate({ status: "open" }));
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual(["tab-1"]);
    expect(io.gateWrites).toEqual([{ gateId: "gate-1", status: "parked", parkedAt: 5000 }]);
  });

  test("park action is skipped entirely when the gate has already been answered by execution time (TOCTOU)", async () => {
    const io = makeIo(baseGate({ status: "answered" }));
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual([]);
    expect(io.gateWrites).toEqual([]);
  });

  test("park action is skipped when the gate is already parked by execution time", async () => {
    const io = makeIo(baseGate({ status: "parked" }));
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual([]);
    expect(io.gateWrites).toEqual([]);
  });

  test("park action is skipped when the gate has vanished from disk by execution time", async () => {
    const io = makeIo(undefined);
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual([]);
    expect(io.gateWrites).toEqual([]);
  });

  test("close-missed-done action always closes the tab and writes done, no gate re-read guard", async () => {
    const io = makeIo(undefined);
    const action: SweepAction = { kind: "close-missed-done", mrUrl: MR_URL, tabId: "tab-2" };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual(["tab-2"]);
    expect(io.reviewWrites).toEqual([{ status: "done", tabId: "" }]);
  });
});
