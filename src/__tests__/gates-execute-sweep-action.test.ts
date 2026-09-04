import { describe, expect, test } from "bun:test";
import { executeSweepAction, type ExecuteSweepActionIo } from "../gates/execute-sweep-action.ts";
import type { SweepAction } from "../gates/sweep.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

function makeIo(parkResult: { ok: true } | { ok: false; error: string }): ExecuteSweepActionIo & {
  calls: string[];
  closed: string[];
  reviewWrites: unknown[];
  logs: string[];
} {
  const calls: string[] = [];
  const closed: string[] = [];
  const reviewWrites: unknown[] = [];
  const logs: string[] = [];
  return {
    calls,
    closed,
    reviewWrites,
    logs,
    gatePark: async (payload) => {
      calls.push(`gatePark(${payload.id})`);
      return parkResult.ok
        ? { ok: true, data: { ok: true as const } }
        : { ok: false, error: parkResult.error };
    },
    closeTab: async (tabId: string) => {
      calls.push(`closeTab(${tabId})`);
      closed.push(tabId);
    },
    writeReviewState: (_path, patch) => { reviewWrites.push(patch); },
    reviewFilePath: (mrUrl) => `/reviews/${mrUrl}.json`,
    now: () => 5000,
    graceMinutes: 90,
    log: (message) => { logs.push(message); },
    logError: (message) => { logs.push(message); },
  };
}

describe("executeSweepAction", () => {
  test("park action calls gatePark before closeTab, and logs on success", async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual(["gatePark(gate-1)", "closeTab(tab-1)"]);
    expect(io.closed).toEqual(["tab-1"]);
    expect(io.logs).toHaveLength(1);
    expect(io.logs[0]).toContain("gate-1");
  });

  test("park action with no tabId calls gatePark but never closeTab", async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual(["gatePark(gate-1)"]);
    expect(io.closed).toEqual([]);
  });

  test("park action skips closeTab and logs once when gatePark reports not-open", async () => {
    const io = makeIo({ ok: false, error: "not-open" });
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1", gateId: "gate-1" };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual(["gatePark(gate-1)"]);
    expect(io.closed).toEqual([]);
    expect(io.logs).toHaveLength(1);
    expect(io.logs[0]).toContain("not-open");
  });

  test("park action with no gateId is a no-op", async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = { kind: "park", mrUrl: MR_URL, tabId: "tab-1" };
    await executeSweepAction(action, io);
    expect(io.calls).toEqual([]);
    expect(io.closed).toEqual([]);
  });

  test("close-missed-done action always closes the tab and writes done, no gate re-read guard", async () => {
    const io = makeIo({ ok: true });
    const action: SweepAction = { kind: "close-missed-done", mrUrl: MR_URL, tabId: "tab-2" };
    await executeSweepAction(action, io);
    expect(io.closed).toEqual(["tab-2"]);
    expect(io.reviewWrites).toEqual([{ status: "done", tabId: "" }]);
  });
});
