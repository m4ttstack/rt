import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gateOpen, gateWait, gateAnswer, type GateVerbIo } from "../gates/verbs.ts";
import { gateFilePath, writeGateState, type GateState, type GateQuestion } from "../gates/store.ts";
import { statusBinPath } from "../herdr.ts";
import type { RtResponse, Commands } from "@mattstack/rt-client";

type EventsBusEvent = Commands["events:wait"]["data"]["events"][number];

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const IID = 4821;

const QUESTIONS: GateQuestion[] = [
  { id: "tiers", label: "Which tiers?", multi: true, options: ["nit", "must-fix"] },
  { id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] },
];

interface FakeIoCalls {
  eventsEmit: Array<{ topic: string; payload: unknown }>;
  eventsList: Array<{ pattern: string; after?: number; limit?: number }>;
  eventsWait: Array<{ pattern: string; after?: number; waitMs?: number }>;
  eventsHead: number;
}

function fakeIo(overrides: {
  emitOk?: boolean;
  listResults?: Array<RtResponse<{ events: EventsBusEvent[]; cursor: number }>>;
  waitResults?: Array<RtResponse<{ events: EventsBusEvent[]; cursor: number }>>;
  now?: number;
} = {}): { io: GateVerbIo; calls: FakeIoCalls } {
  const calls: FakeIoCalls = { eventsEmit: [], eventsList: [], eventsWait: [], eventsHead: 0 };
  const listResults = overrides.listResults ?? [{ ok: true, data: { events: [], cursor: 0 } }];
  const waitResults = overrides.waitResults ?? [];
  let listIdx = 0;
  let waitIdx = 0;
  const io: GateVerbIo = {
    eventsEmit: (async (topic: string, payload?: unknown) => {
      calls.eventsEmit.push({ topic, payload });
      return { ok: overrides.emitOk ?? true, data: { id: 1 } };
    }) as GateVerbIo["eventsEmit"],
    eventsList: (async (payload: { pattern: string; after?: number; limit?: number }) => {
      calls.eventsList.push(payload);
      const res = listResults[Math.min(listIdx, listResults.length - 1)]!;
      listIdx++;
      return res;
    }) as GateVerbIo["eventsList"],
    eventsWait: (async (payload: { pattern: string; after?: number; waitMs?: number }) => {
      calls.eventsWait.push(payload);
      const res = waitResults[Math.min(waitIdx, waitResults.length - 1)]!;
      waitIdx++;
      return res;
    }) as GateVerbIo["eventsWait"],
    eventsHead: (async () => {
      calls.eventsHead++;
      return { ok: true, data: { cursor: 0 } };
    }) as GateVerbIo["eventsHead"],
    now: () => overrides.now ?? 5000,
  };
  return { io, calls };
}

let dir: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gv-"));
  statePath = join(dir, "review.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      mrUrl: MR_URL,
      iid: IID,
      status: "reviewing",
      agentId: "agent-1",
      sessionId: "session-1",
      paneId: "pane-1",
      tabId: "tab-1",
      startedAt: 1,
      updatedAt: 1,
    }),
  );
  // Gate files live under the real (test-faked) GATE_DIR -- clean up after each test.
  rmSync(gateFilePath(MR_URL), { force: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(gateFilePath(MR_URL), { force: true });
});

describe("gateOpen", () => {
  test("mints a gateId, writes the gate file, and emits the full contract payload", async () => {
    const { io, calls } = fakeIo({ now: 9000 });

    const gateId = await gateOpen(statePath, JSON.stringify(QUESTIONS), io);

    expect(typeof gateId).toBe("string");
    expect(gateId.length).toBeGreaterThan(0);

    expect(calls.eventsEmit.length).toBe(1);
    expect(calls.eventsEmit[0]!.topic).toBe(`board/gate/opened/${gateId}`);
    expect(calls.eventsEmit[0]!.payload).toEqual({
      gateId,
      kind: "review-post",
      mrUrl: MR_URL,
      iid: IID,
      agentId: "agent-1",
      sessionId: "session-1",
      paneId: "pane-1",
      tabId: "tab-1",
      questions: QUESTIONS,
      openedAt: 9000,
    });

    const written = JSON.parse(readFileSync(gateFilePath(MR_URL), "utf8")) as GateState;
    expect(written).toEqual({
      gateId,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 9000,
      questions: QUESTIONS,
      agentId: "agent-1",
      sessionId: "session-1",
      paneId: "pane-1",
      tabId: "tab-1",
    });
  });

  test("malformed --questions JSON throws rather than writing or emitting", async () => {
    const { io, calls } = fakeIo();

    await expect(gateOpen(statePath, "{ not valid json", io)).rejects.toThrow();

    expect(calls.eventsEmit.length).toBe(0);
  });
});

describe("gateWait", () => {
  test("returns immediately from a pre-answered gate file, no events calls", async () => {
    const { io, calls } = fakeIo();
    writeGateState(gateFilePath(MR_URL), {
      gateId: "gate-preanswered",
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "answered",
      openedAt: 1000,
      questions: QUESTIONS,
      answers: { tiers: ["must-fix"], outcome: "comment" },
      answeredBy: "board-ui",
      answeredAt: 2000,
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({ answers: { tiers: ["must-fix"], outcome: "comment" }, by: "board-ui", answeredAt: 2000 });
    expect(calls.eventsList.length).toBe(0);
    expect(calls.eventsWait.length).toBe(0);
  });

  test("returns from a journaled answer (eventsList finds it) without calling eventsWait", async () => {
    const gateId = "gate-journaled";
    writeGateState(gateFilePath(MR_URL), {
      gateId,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
    });
    const answerEvent: EventsBusEvent = {
      id: 42,
      topic: `board/gate/answered/${gateId}`,
      payload: { gateId, answers: { tiers: [], outcome: "approve" }, by: "board-ui", answeredAt: 3000 },
      emittedAt: 3000,
    };
    const { io, calls } = fakeIo({ listResults: [{ ok: true, data: { events: [answerEvent], cursor: 42 } }] });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({ answers: { tiers: [], outcome: "approve" }, by: "board-ui", answeredAt: 3000 });
    expect(calls.eventsList.length).toBe(1);
    expect(calls.eventsList[0]!.pattern).toBe(`board/gate/answered/${gateId}`);
    expect(calls.eventsWait.length).toBe(0);

    const written = JSON.parse(readFileSync(gateFilePath(MR_URL), "utf8")) as GateState;
    expect(written.status).toBe("answered");
    expect(written.answers).toEqual({ tiers: [], outcome: "approve" });
    expect(written.answeredBy).toBe("board-ui");
    expect(written.answeredAt).toBe(3000);
  });

  test("loops one timed-out eventsWait (no events) then returns on the second call", async () => {
    const gateId = "gate-looped";
    writeGateState(gateFilePath(MR_URL), {
      gateId,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
    });
    const answerEvent: EventsBusEvent = {
      id: 43,
      topic: `board/gate/answered/${gateId}`,
      payload: { gateId, answers: { tiers: ["nit"], outcome: "comment" }, by: "board-ui", answeredAt: 4000 },
      emittedAt: 4000,
    };
    const { io, calls } = fakeIo({
      listResults: [{ ok: true, data: { events: [], cursor: 0 } }],
      waitResults: [
        { ok: true, data: { events: [], cursor: 0 } },
        { ok: true, data: { events: [answerEvent], cursor: 43 } },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({ answers: { tiers: ["nit"], outcome: "comment" }, by: "board-ui", answeredAt: 4000 });
    expect(calls.eventsWait.length).toBe(2);
  });
});

describe("gateAnswer", () => {
  test("emits board/gate/answered/<gateId> with by: pane and updates the file", async () => {
    const gateId = "gate-pane";
    writeGateState(gateFilePath(MR_URL), {
      gateId,
      mrUrl: MR_URL,
      iid: IID,
      kind: "review-post",
      status: "open",
      openedAt: 1000,
      questions: QUESTIONS,
    });
    const { io, calls } = fakeIo({ now: 6000 });
    const answers = { tiers: ["must-fix"], outcome: "approve" };

    await gateAnswer(statePath, JSON.stringify(answers), "pane", io);

    expect(calls.eventsEmit.length).toBe(1);
    expect(calls.eventsEmit[0]!.topic).toBe(`board/gate/answered/${gateId}`);
    expect(calls.eventsEmit[0]!.payload).toEqual({ gateId, answers, by: "pane", answeredAt: 6000 });

    const written = JSON.parse(readFileSync(gateFilePath(MR_URL), "utf8")) as GateState;
    expect(written.status).toBe("answered");
    expect(written.answers).toEqual(answers);
    expect(written.answeredBy).toBe("pane");
    expect(written.answeredAt).toBe(6000);
  });
});

describe("bin/gate.ts malformed --questions", () => {
  test("exits nonzero with a stderr message, without ever reaching the events bus", async () => {
    const proc = Bun.spawn([statusBinPath(), "gate", "open", statePath, "--questions", "{ not valid json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).not.toBe(0);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr.length).toBeGreaterThan(0);
  });
});
