import { describe, expect, test } from "bun:test";
import { answerGate, type AnswerGateIo } from "../gates/answer.ts";
import type { GateAnswers, GateQuestion, GateState } from "../gates/store.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

const QUESTIONS: GateQuestion[] = [
  { id: "tiers", label: "Which tiers?", multi: true, options: ["nit", "must-fix"] },
  { id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] },
];

function baseGate(overrides: Partial<GateState> = {}): GateState {
  return {
    gateId: "gate-1",
    mrUrl: MR_URL,
    iid: 4821,
    kind: "review-post",
    status: "open",
    openedAt: 1000,
    questions: QUESTIONS,
    ...overrides,
  };
}

interface FakeIoCalls {
  eventsEmit: Array<{ topic: string; payload: unknown }>;
  writeGateState: Array<{ path: string; patch: Partial<GateState> & { gateId: string } }>;
  sseNudge: number;
  resumeParkedGate: GateState[];
}

function fakeIo(gate: GateState | undefined, now = 6000): { io: AnswerGateIo; calls: FakeIoCalls } {
  const calls: FakeIoCalls = { eventsEmit: [], writeGateState: [], sseNudge: 0, resumeParkedGate: [] };
  const io: AnswerGateIo = {
    readGateStates: () => (gate ? new Map([[gate.mrUrl, gate]]) : new Map()),
    writeGateState: (path, patch) => {
      calls.writeGateState.push({ path, patch });
    },
    gateFilePath: (mrUrl: string) => `/tmp/fake-gates/${mrUrl.replace(/[^a-z0-9]/gi, "-")}.json`,
    eventsEmit: (async (topic: string, payload?: unknown) => {
      calls.eventsEmit.push({ topic, payload });
      return { ok: true, data: { id: 1 } };
    }) as AnswerGateIo["eventsEmit"],
    sseNudge: () => {
      calls.sseNudge++;
    },
    resumeParkedGate: (g: GateState) => {
      calls.resumeParkedGate.push(g);
    },
    now: () => now,
  };
  return { io, calls };
}

describe("answerGate", () => {
  test("happy path: emits board/gate/answered/<gateId> then merges the gate file", async () => {
    const gate = baseGate();
    const { io, calls } = fakeIo(gate, 7000);
    const answers: GateAnswers = { tiers: ["must-fix"], outcome: "approve" };

    const result = await answerGate(MR_URL, answers, io);

    expect(result).toEqual({ kind: "ok" });

    expect(calls.eventsEmit.length).toBe(1);
    expect(calls.eventsEmit[0]!.topic).toBe(`board/gate/answered/${gate.gateId}`);
    expect(calls.eventsEmit[0]!.payload).toEqual({
      gateId: gate.gateId,
      answers,
      by: "board-ui",
      answeredAt: 7000,
    });

    expect(calls.writeGateState.length).toBe(1);
    expect(calls.writeGateState[0]!.patch).toEqual({
      gateId: gate.gateId,
      status: "answered",
      answers,
      answeredBy: "board-ui",
      answeredAt: 7000,
    });

    expect(calls.sseNudge).toBe(1);
    expect(calls.resumeParkedGate.length).toBe(0);
  });

  test("unknown MR returns a not-found result, no emit/merge", async () => {
    const { io, calls } = fakeIo(undefined);

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "not-found" });
    expect(calls.eventsEmit.length).toBe(0);
    expect(calls.writeGateState.length).toBe(0);
    expect(calls.sseNudge).toBe(0);
  });

  test("double answer (already answered) returns already-answered, no emit/merge", async () => {
    const gate = baseGate({ status: "answered", answers: { outcome: "comment" }, answeredBy: "board-ui", answeredAt: 5000 });
    const { io, calls } = fakeIo(gate);

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "already-answered" });
    expect(calls.eventsEmit.length).toBe(0);
    expect(calls.writeGateState.length).toBe(0);
  });

  test("multi question answered with a bare string (wrong shape) is invalid, no emit/merge", async () => {
    const gate = baseGate();
    const { io, calls } = fakeIo(gate);

    const result = await answerGate(MR_URL, { tiers: "must-fix", outcome: "approve" } as unknown as GateAnswers, io);

    expect(result.kind).toBe("invalid");
    expect(calls.eventsEmit.length).toBe(0);
    expect(calls.writeGateState.length).toBe(0);
  });

  test("unknown question id is invalid, no emit/merge", async () => {
    const gate = baseGate();
    const { io, calls } = fakeIo(gate);

    const result = await answerGate(MR_URL, { bogus: "yes" } as unknown as GateAnswers, io);

    expect(result.kind).toBe("invalid");
    expect(calls.eventsEmit.length).toBe(0);
    expect(calls.writeGateState.length).toBe(0);
  });

  test("single question answered with an array (wrong shape) is invalid, no emit/merge", async () => {
    const gate = baseGate();
    const { io, calls } = fakeIo(gate);

    const result = await answerGate(MR_URL, { outcome: ["approve"] } as unknown as GateAnswers, io);

    expect(result.kind).toBe("invalid");
    expect(calls.eventsEmit.length).toBe(0);
    expect(calls.writeGateState.length).toBe(0);
  });

  test("parked gate: answering it also calls the resumeParkedGate hook", async () => {
    const gate = baseGate({ status: "parked", parkedAt: 4000 });
    const { io, calls } = fakeIo(gate, 8000);
    const answers: GateAnswers = { tiers: [], outcome: "comment" };

    const result = await answerGate(MR_URL, answers, io);

    expect(result).toEqual({ kind: "ok" });
    expect(calls.resumeParkedGate.length).toBe(1);
    expect(calls.resumeParkedGate[0]).toEqual(gate);
    expect(calls.writeGateState[0]!.patch.status).toBe("answered");
  });

  test("open (not parked) gate: resumeParkedGate is never called", async () => {
    const gate = baseGate({ status: "open" });
    const { io, calls } = fakeIo(gate);

    await answerGate(MR_URL, { tiers: [], outcome: "comment" }, io);

    expect(calls.resumeParkedGate.length).toBe(0);
  });
});
