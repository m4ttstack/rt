import { describe, expect, test } from "bun:test";
import type { Commands, GateRow, RtResponse } from "@mattstack/rt-client";
import { answerGate, resumeParkedGate, type AnswerGateIo, type ResumeParkedGateIo } from "../gates/answer.ts";
import type { GateAnswers, GateState } from "../gates/store.ts";
import type { AgentLaunchResult } from "../agent-launch.ts";

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

  test("daemon not-found/closed rejection maps to not-found", async () => {
    const { io } = fakeIo(GATE_ID, () => ({ ok: false, error: `gate ${GATE_ID} not found` }));

    const result = await answerGate(MR_URL, { outcome: "approve" }, io);

    expect(result).toEqual({ kind: "not-found" });
  });

  test("daemon strict-membership/validation rejection maps to invalid, message verbatim", async () => {
    const message = `answers include ids outside gate ${GATE_ID}'s question set (strict membership)`;
    const { io } = fakeIo(GATE_ID, () => ({ ok: false, error: message }));

    const result = await answerGate(MR_URL, { bogus: "yes" } as unknown as GateAnswers, io);

    expect(result).toEqual({ kind: "invalid", reason: message });
  });
});

/** Fakes for the real resumeParkedGate's io, exercised directly (as opposed
    to fakeIo's answer-path stub above) -- resumeParkedGate is no longer
    wired off answerGate (B6 hangs it off the gate/answered event instead),
    but the function itself stays defined and is still tested here in
    isolation ahead of that move. */
interface ResumeIoCalls {
  resumeAgentPane: Array<{ agentId: string; prompt: string; workspaceLabel: string; tabLabel: string }>;
  writeReviewState: Array<{ path: string; patch: unknown }>;
  notify: string[];
  resolveLaunchSkill: Array<{ mrUrl: string; tabId?: string }>;
}

function baseGate(overrides: Partial<GateState> = {}): GateState {
  return {
    gateId: GATE_ID,
    mrUrl: MR_URL,
    iid: 4821,
    kind: "review-post",
    status: "parked",
    openedAt: 1000,
    questions: [{ id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] }],
    ...overrides,
  };
}

function fakeResumeIo(
  result: Partial<AgentLaunchResult> = {},
  resolveLaunchSkill: (mrUrl: string, tabId?: string) => string = () => "acme:board-review",
): { io: ResumeParkedGateIo; calls: ResumeIoCalls } {
  const calls: ResumeIoCalls = { resumeAgentPane: [], writeReviewState: [], notify: [], resolveLaunchSkill: [] };
  const io: ResumeParkedGateIo = {
    resolveLaunchSkill: (mrUrl, tabId) => {
      calls.resolveLaunchSkill.push({ mrUrl, tabId });
      return resolveLaunchSkill(mrUrl, tabId);
    },
    resumeAgentPane: async (opts) => {
      calls.resumeAgentPane.push(opts);
      return {
        agentId: "agent-2", sessionId: "sess-2", paneId: "pane-2", tabId: "tab-2", workspaceId: "ws-2",
        focusedExisting: false,
        ...result,
      };
    },
    writeReviewState: (path, patch) => {
      calls.writeReviewState.push({ path, patch });
    },
    reviewsWorkspace: "reviews",
    notify: (message) => {
      calls.notify.push(message);
    },
  };
  return { io, calls };
}

describe("resumeParkedGate (kept defined for B6; not called from the answer path)", () => {
  test("builds the /board:review prompt with --state and --resumed-gate, resumes the pane, and persists fresh ids", async () => {
    const gate = baseGate({ agentId: "agent-1" });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo();

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    const call = resumeCalls.resumeAgentPane[0]!;
    expect(call.agentId).toBe("agent-1");
    expect(call.workspaceLabel).toBe("reviews");
    expect(call.prompt).toContain("/board:review");
    expect(call.prompt).toContain("--state");
    expect(call.prompt).toContain(`--resumed-gate ${GATE_ID}`);

    expect(resumeCalls.writeReviewState.length).toBe(1);
    expect(resumeCalls.writeReviewState[0]!.patch).toMatchObject({
      status: "reviewing",
      agentId: "agent-2",
      paneId: "pane-2",
      tabId: "tab-2",
      workspaceId: "ws-2",
    });
    expect(resumeCalls.notify.length).toBe(0);
  });

  test("threads the gate's tabId to resolveLaunchSkill, so a tab's reviewSkill override wins over the fallback", async () => {
    const gate = baseGate({ agentId: "agent-1", tabId: "tab-9" });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({}, (mrUrl, tabId) =>
      tabId === "tab-9" ? "acme:tab-override-review" : "acme:board-review",
    );

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resolveLaunchSkill).toEqual([{ mrUrl: MR_URL, tabId: "tab-9" }]);
    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    expect(resumeCalls.resumeAgentPane[0]!.prompt).toContain("--skill acme:tab-override-review");
  });

  test("a focused-existing resume (already-open tab) does not overwrite the review state with blank ids", async () => {
    const gate = baseGate({ agentId: "agent-1" });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({
      agentId: "", sessionId: "", paneId: "", tabId: "", workspaceId: "", focusedExisting: true,
    });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    expect(resumeCalls.writeReviewState.length).toBe(0);
  });

  test("missing agentId notifies instead of resuming, and does not throw", async () => {
    const gate = baseGate();
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo();

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(0);
    expect(resumeCalls.notify).toEqual(["parked gate answered but no agent on file; relaunch from the board"]);
  });
});
