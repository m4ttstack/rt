import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyGateEvent, ensureBridgeRule, GATE_OPENED_BRIDGE_RULE, type GateEventStore, type EventBridgeRule } from "../gates/ingest.ts";
import { gateFilePath, writeGateState, readGateStates, type GateQuestion } from "../gates/store.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const IID = 4821;
const GATE_ID = "gate-1";

const QUESTIONS: GateQuestion[] = [{ id: "q1", label: "Ship it?", multi: false, options: ["yes", "no"] }];

let dir: string;
let store: GateEventStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gi-"));
  store = {
    readGateStates: () => readGateStates(dir),
    writeGateState: (path, patch) => writeGateState(path, patch),
    gateFilePath: (mrUrl) => gateFilePath(mrUrl, dir),
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("applyGateEvent: opened", () => {
  test("creates a new open GateState from the full payload", () => {
    applyGateEvent(store, {
      topic: `board/gate/opened/${GATE_ID}`,
      payload: {
        gateId: GATE_ID,
        kind: "review-post",
        mrUrl: MR_URL,
        iid: IID,
        agentId: "agent-1",
        sessionId: "session-1",
        paneId: "pane-1",
        tabId: "tab-1",
        questions: QUESTIONS,
        openedAt: 1000,
      },
    });

    const state = store.readGateStates().get(MR_URL);
    expect(state).toEqual({
      gateId: GATE_ID,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
      agentId: "agent-1",
      sessionId: "session-1",
      paneId: "pane-1",
      tabId: "tab-1",
    });
  });
});

describe("applyGateEvent: answered", () => {
  test("merges status/answers/answeredBy/answeredAt onto the matching open gate", () => {
    writeGateState(store.gateFilePath(MR_URL), {
      gateId: GATE_ID,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
    });

    applyGateEvent(store, {
      topic: `board/gate/answered/${GATE_ID}`,
      payload: { gateId: GATE_ID, answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 },
    });

    const state = store.readGateStates().get(MR_URL);
    expect(state?.status).toBe("answered");
    expect(state?.answers).toEqual({ q1: "yes" });
    expect(state?.answeredBy).toBe("board-ui");
    expect(state?.answeredAt).toBe(2000);
    // preserved from the open write
    expect(state?.gateId).toBe(GATE_ID);
    expect(state?.mrUrl).toBe(MR_URL);
    expect(state?.questions).toEqual(QUESTIONS);
  });

  test("resolves the file by scanning for the matching gateId, not by topic/mrUrl", () => {
    const otherUrl = "https://gitlab.com/acme/webapp/-/merge_requests/1";
    writeGateState(store.gateFilePath(otherUrl), {
      gateId: "gate-other",
      mrUrl: otherUrl,
      iid: 1,
      kind: "review-post",
      status: "open",
      openedAt: 500,
      questions: QUESTIONS,
    });
    writeGateState(store.gateFilePath(MR_URL), {
      gateId: GATE_ID,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
    });

    applyGateEvent(store, {
      topic: `board/gate/answered/${GATE_ID}`,
      payload: { gateId: GATE_ID, answers: { q1: "no" }, by: "pane", answeredAt: 3000 },
    });

    expect(store.readGateStates().get(MR_URL)?.status).toBe("answered");
    expect(store.readGateStates().get(otherUrl)?.status).toBe("open");
  });
});

describe("applyGateEvent: answered-before-opened", () => {
  test("is tolerated -- no matching open file, no throw, nothing written", () => {
    expect(() =>
      applyGateEvent(store, {
        topic: `board/gate/answered/${GATE_ID}`,
        payload: { gateId: GATE_ID, answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 },
      }),
    ).not.toThrow();
    expect(store.readGateStates().size).toBe(0);
  });
});

describe("applyGateEvent: malformed payload", () => {
  test("a non-object payload is skipped without throwing", () => {
    expect(() => applyGateEvent(store, { topic: `board/gate/opened/${GATE_ID}`, payload: "not an object" })).not.toThrow();
    expect(() => applyGateEvent(store, { topic: `board/gate/opened/${GATE_ID}`, payload: null })).not.toThrow();
    expect(store.readGateStates().size).toBe(0);
  });

  test("an opened payload missing required fields is skipped without throwing", () => {
    expect(() =>
      applyGateEvent(store, { topic: `board/gate/opened/${GATE_ID}`, payload: { gateId: GATE_ID, mrUrl: MR_URL } }),
    ).not.toThrow();
    expect(store.readGateStates().size).toBe(0);
  });

  test("an answered payload with non-object answers is skipped without throwing", () => {
    writeGateState(store.gateFilePath(MR_URL), {
      gateId: GATE_ID,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
    });
    expect(() =>
      applyGateEvent(store, { topic: `board/gate/answered/${GATE_ID}`, payload: { gateId: GATE_ID, answers: "yes" } }),
    ).not.toThrow();
    expect(store.readGateStates().get(MR_URL)?.status).toBe("open");
  });
});

describe("applyGateEvent: non-gate topic", () => {
  test("is ignored without throwing or writing", () => {
    expect(() =>
      applyGateEvent(store, { topic: "project-mrs", payload: { gateId: GATE_ID, mrUrl: MR_URL, iid: IID, questions: QUESTIONS, openedAt: 1 } }),
    ).not.toThrow();
    expect(() => applyGateEvent(store, { topic: "board/gate/opened", payload: {} })).not.toThrow();
    expect(store.readGateStates().size).toBe(0);
  });
});

describe("ensureBridgeRule", () => {
  function fakeIo(initial: EventBridgeRule[]): { read: () => EventBridgeRule[]; write: (next: EventBridgeRule[]) => void; writes: EventBridgeRule[][] } {
    let current = initial;
    const writes: EventBridgeRule[][] = [];
    return {
      read: () => current,
      write: (next) => {
        writes.push(next);
        current = next;
      },
      writes,
    };
  }

  test("absent: appends the gate-opened rule", () => {
    const io = fakeIo([]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([GATE_OPENED_BRIDGE_RULE]);
  });

  test("present: no-ops, no duplicate written", () => {
    const io = fakeIo([GATE_OPENED_BRIDGE_RULE]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(0);
  });

  test("unrelated entries: preserved, gate rule appended alongside them", () => {
    const other: EventBridgeRule = { pattern: "chat/mention/*", category: "chat", title: "mention", message: "{body}" };
    const io = fakeIo([other]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([other, GATE_OPENED_BRIDGE_RULE]);
  });
});
