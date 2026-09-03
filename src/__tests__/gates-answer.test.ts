import { describe, expect, test } from "bun:test";
import { answerGate, resumeParkedGate, type AnswerGateIo, type ResumeParkedGateIo } from "../gates/answer.ts";
import type { GateAnswers, GateQuestion, GateState } from "../gates/store.ts";
import type { AgentLaunchResult } from "../agent-launch.ts";

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

/** Fakes for the real resumeParkedGate's sub-io (as opposed to fakeIo's plain
    stub hook above), so these tests exercise the actual resume logic --
    prompt building, resumeAgentPane, and id persistence -- wired in through
    answerGate's injectable resumeParkedGate hook. */
interface ResumeIoCalls {
  resumeAgentPane: Array<{ agentId: string; prompt: string; workspaceLabel: string; tabLabel: string }>;
  writeReviewState: Array<{ path: string; patch: unknown }>;
  notify: string[];
  resolveLaunchSkill: Array<{ mrUrl: string; tabId?: string }>;
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

describe("resumeParkedGate (the real parked-gate resume, wired as answerGate's hook)", () => {
  test("builds the /board:review prompt with --state and --resumed-gate, resumes the pane, and persists fresh ids", async () => {
    const gate = baseGate({ status: "parked", parkedAt: 4000, agentId: "agent-1" });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo();
    const { io, calls } = fakeIo(gate, 8000);
    io.resumeParkedGate = (g) => resumeParkedGate(g, resumeIo, async () => null);

    const result = await answerGate(MR_URL, { tiers: [], outcome: "comment" }, io);

    expect(result).toEqual({ kind: "ok" });
    expect(calls.writeGateState[0]!.patch.status).toBe("answered");

    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    const call = resumeCalls.resumeAgentPane[0]!;
    expect(call.agentId).toBe("agent-1");
    expect(call.workspaceLabel).toBe("reviews");
    expect(call.prompt).toContain("/board:review");
    expect(call.prompt).toContain("--state");
    expect(call.prompt).toContain("--resumed-gate gate-1");

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
    const gate = baseGate({ status: "parked", parkedAt: 4000, agentId: "agent-1", tabId: "tab-9" });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({}, (mrUrl, tabId) =>
      tabId === "tab-9" ? "acme:tab-override-review" : "acme:board-review",
    );

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resolveLaunchSkill).toEqual([{ mrUrl: MR_URL, tabId: "tab-9" }]);
    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    expect(resumeCalls.resumeAgentPane[0]!.prompt).toContain("--skill acme:tab-override-review");
  });

  test("a focused-existing resume (already-open tab) does not overwrite the review state with blank ids", async () => {
    const gate = baseGate({ status: "parked", parkedAt: 4000, agentId: "agent-1" });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({
      agentId: "", sessionId: "", paneId: "", tabId: "", workspaceId: "", focusedExisting: true,
    });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    expect(resumeCalls.writeReviewState.length).toBe(0);
  });

  test("missing agentId notifies instead of resuming, and does not throw", async () => {
    const gate = baseGate({ status: "parked", parkedAt: 4000 });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo();
    const { io, calls } = fakeIo(gate, 8000);
    io.resumeParkedGate = (g) => resumeParkedGate(g, resumeIo, async () => null);

    const result = await answerGate(MR_URL, { tiers: [], outcome: "comment" }, io);

    expect(result).toEqual({ kind: "ok" });
    expect(resumeCalls.resumeAgentPane.length).toBe(0);
    expect(resumeCalls.notify).toEqual(["parked gate answered but no agent on file; relaunch from the board"]);
  });
});
