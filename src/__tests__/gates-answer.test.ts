import { describe, expect, test } from "bun:test";
import type { Commands, GateRow, RtResponse } from "@mattstack/rt-client";
import { answerGate, type AnswerGateIo } from "../gates/answer.ts";
import type { GateAnswers } from "../gates/store.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const GATE_ID = "gate-1";

function baseRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: GATE_ID,
    subject: `mr:${MR_URL}`,
    kind: "review-post",
    questions: [{ id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] }],
    meta: null,
    status: "open",
    answer: null,
    openedAt: 1000,
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

type GateAnswerPayload = Commands["gate:answer"]["payload"];
type GateAnswerData = Commands["gate:answer"]["data"];

interface FakeIoCalls {
  findAnswerableGateId: string[];
  gateAnswer: GateAnswerPayload[];
}

/** `AnswerGateIo` carries only the cache lookup and the facility call --
    there is no emit or resume hook left to wire, so a fake built from this
    interface alone already proves the answer path can't reach either. */
function fakeIo(
  gateId: string | undefined,
  respond: (payload: GateAnswerPayload) => RtResponse<GateAnswerData>,
): { io: AnswerGateIo; calls: FakeIoCalls } {
  const calls: FakeIoCalls = { findAnswerableGateId: [], gateAnswer: [] };
  const io: AnswerGateIo = {
    findAnswerableGateId: (mrUrl) => {
      calls.findAnswerableGateId.push(mrUrl);
      return gateId;
    },
    gateAnswer: async (payload) => {
      calls.gateAnswer.push(payload);
      return respond(payload);
    },
  };
  return { io, calls };
}

describe("answerGate", () => {
  test("resolves the id from the cache and proxies gateAnswer({id, answers, by: 'board'})", async () => {
    const answers: GateAnswers = { outcome: "approve" };
    const { io, calls } = fakeIo(GATE_ID, () => ({ ok: true, data: { row: baseRow({ status: "answered", answer: { answers, by: "board", answeredAt: 7000 } }) } }));

    const result = await answerGate(MR_URL, answers, io);

    expect(result).toEqual({ kind: "ok" });
    expect(calls.findAnswerableGateId).toEqual([MR_URL]);
    expect(calls.gateAnswer).toEqual([{ id: GATE_ID, answers, by: "board" }]);
  });

  test("CAS conflict yields the winning row instead of an error", async () => {
    const winner = baseRow({ status: "answered", answer: { answers: { outcome: "comment" }, by: "board", answeredAt: 6500 } });
    const { io } = fakeIo(GATE_ID, () => ({ ok: true, data: { row: winner, conflict: true } }));

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "conflict", row: winner });
  });

  test("no cached open/parked gate for the MR is not-found without calling the facility", async () => {
    const { io, calls } = fakeIo(undefined, () => {
      throw new Error("gateAnswer should not be called");
    });

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "not-found" });
    expect(calls.gateAnswer.length).toBe(0);
  });

  test("daemon 'not-found' rejection maps to not-found", async () => {
    const { io } = fakeIo(GATE_ID, () => ({ ok: false, error: "not-found" }));

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "not-found" });
  });

  test("daemon 'closed' rejection maps to not-found", async () => {
    const { io } = fakeIo(GATE_ID, () => ({ ok: false, error: "closed" }));

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "not-found" });
  });

  test("daemon strict-membership/validation rejection maps to invalid, message verbatim", async () => {
    const message = `answers include ids outside gate ${GATE_ID}'s question set (strict membership)`;
    const { io } = fakeIo(GATE_ID, () => ({ ok: false, error: message }));

    const result = await answerGate(MR_URL, { bogus: "yes" } as unknown as GateAnswers, io);

    expect(result).toEqual({ kind: "invalid", reason: message });
  });

  test("a validation message that merely echoes the word 'closed' (e.g. an invalid option value) stays 400, not 404", async () => {
    const message = `answer for "outcome" is not one of its options: "closed"`;
    const { io } = fakeIo(GATE_ID, () => ({ ok: false, error: message }));

    const result = await answerGate(MR_URL, { outcome: "closed" } as unknown as GateAnswers, io);

    expect(result).toEqual({ kind: "invalid", reason: message });
  });
});
