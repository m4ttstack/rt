import { describe, expect, test } from "bun:test";
import type { GateRow as FacilityGateRow } from "@mattstack/rt-client";
import {
  resumeParkedGate,
  handleAnsweredEvent,
  bootResumePass,
  type ResumeParkedGateIo,
  type GateResumeEventIo,
} from "../gates/resume.ts";
import type { GateState } from "../gates/store.ts";
import type { AgentLaunchResult } from "../agent-launch.ts";
import { reviewFilePath, type ReviewState } from "../review-state.ts";
import type { GateEventFrame } from "../gates/ingest.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const GATE_ID = "gate-1";
const SUBJECT = `mr:${MR_URL}`;

// ── resumeParkedGate (moved from gates-answer.test.ts unchanged) ──────────

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

describe("resumeParkedGate", () => {
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

// ── handleAnsweredEvent / bootResumePass ───────────────────────────────────

function facilityRow(overrides: Partial<FacilityGateRow> = {}): FacilityGateRow {
  return {
    id: GATE_ID,
    subject: SUBJECT,
    kind: "review-post",
    questions: [{ id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] }],
    meta: null,
    status: "answered",
    answer: { answers: { outcome: "approve" }, by: "console", answeredAt: 9000 },
    openedAt: 1000,
    parkedAt: 5000,
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
    status: "reviewing",
    agentId: "agent-1",
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

/** In-memory fake standing in for the cache row, the review-state file, and
    a paged `gate:list` -- stateful (writeReviewState mutates the same map
    readReviewState reads from) so the exactly-once dedup is exercised the
    same way the real file-backed round trip would exercise it. */
function fakeEventIo(opts: {
  rows?: FacilityGateRow[];
  reviews?: Record<string, ReviewState>;
  pages?: FacilityGateRow[][];
  resumeResult?: Partial<AgentLaunchResult>;
} = {}): { io: GateResumeEventIo; calls: ResumeIoCalls; reviews: Map<string, ReviewState> } {
  const rowsBySubject = new Map((opts.rows ?? []).map((r) => [r.subject, r]));
  const reviews = new Map(Object.entries(opts.reviews ?? { [MR_URL]: baseReview() }));
  // reviewFilePath is a pure deterministic slug, so the fake can invert it
  // back to the mrUrl each write targets without guessing at the string.
  const mrUrlByPath = new Map([...reviews.keys()].map((mrUrl) => [reviewFilePath(mrUrl), mrUrl]));
  const calls: ResumeIoCalls = { resumeAgentPane: [], writeReviewState: [], notify: [], resolveLaunchSkill: [] };
  const pages = opts.pages ?? [];

  const io: GateResumeEventIo = {
    gateRow: (subject) => rowsBySubject.get(subject),
    readReviewState: (mrUrl) => reviews.get(mrUrl),
    // Cursor-addressed, not an external running index, so a fresh
    // bootResumePass call re-pages from the start -- exactly like the real
    // facility's gate:list, and the only way a second pass's dedup no-op is
    // actually exercised rather than just running out of mock pages.
    gateList: async (payload) => {
      const idx = payload.cursor ?? 0;
      const gates = pages[idx] ?? [];
      return { ok: true, data: { gates, cursor: idx + 1 < pages.length ? idx + 1 : 0 } };
    },
    resolveLaunchSkill: (mrUrl, tabId) => {
      calls.resolveLaunchSkill.push({ mrUrl, tabId });
      return "acme:board-review";
    },
    resumeAgentPane: async (opts2) => {
      calls.resumeAgentPane.push(opts2);
      return {
        agentId: "agent-2", sessionId: "sess-2", paneId: "pane-2", tabId: "tab-2", workspaceId: "ws-2",
        focusedExisting: false,
        ...opts.resumeResult,
      };
    },
    writeReviewState: (path, patch) => {
      calls.writeReviewState.push({ path, patch });
      const mrUrl = mrUrlByPath.get(path) ?? MR_URL;
      const prev = reviews.get(mrUrl) ?? baseReview({ mrUrl });
      reviews.set(mrUrl, { ...prev, ...patch } as ReviewState);
    },
    reviewsWorkspace: "reviews",
    notify: (message) => {
      calls.notify.push(message);
    },
  };
  return { io, calls, reviews };
}

const noSkillLookup = async () => null;

describe("handleAnsweredEvent", () => {
  test("a console-answered (non-board-endpoint) parked gate resumes through the event path", async () => {
    const row = facilityRow();
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT, answers: { outcome: "approve" }, by: "console", answeredAt: 9000 } };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.resumeAgentPane[0]!.agentId).toBe("agent-1");
    const dedupWrite = calls.writeReviewState.find((c) => (c.patch as { resumedGateId?: string }).resumedGateId === GATE_ID);
    expect(dedupWrite).toBeDefined();
  });

  test("an open (never-parked) gate answered does not resume", async () => {
    const row = facilityRow({ parkedAt: null });
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
    expect(calls.writeReviewState.length).toBe(0);
  });

  test("missing agentId on the tracked review notifies instead of resuming, and does not throw", async () => {
    const row = facilityRow();
    const { io, calls } = fakeEventIo({ rows: [row], reviews: { [MR_URL]: baseReview({ agentId: undefined }) } });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await expect(handleAnsweredEvent(frame, io, noSkillLookup)).resolves.toBeUndefined();

    expect(calls.resumeAgentPane.length).toBe(0);
    expect(calls.notify).toEqual(["parked gate answered but no agent on file; relaunch from the board"]);
  });

  test("a respond-plan answered frame throws the not-wired-until-W3 error rather than silently mishandling it", async () => {
    const row = facilityRow({ kind: "respond-plan" });
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await expect(handleAnsweredEvent(frame, io, noSkillLookup)).rejects.toThrow("respond-plan resume not wired until W3");
    expect(calls.resumeAgentPane.length).toBe(0);
    expect(calls.writeReviewState.length).toBe(0);
  });

  test("a doctor-escalation answered frame throws the not-wired-until-W3 error", async () => {
    const row = facilityRow({ kind: "doctor-escalation" });
    const { io } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await expect(handleAnsweredEvent(frame, io, noSkillLookup)).rejects.toThrow("doctor-escalation resume not wired until W3");
  });

  test("a non-answered topic is a no-op", async () => {
    const row = facilityRow({ status: "parked", parkedAt: 5000, answer: null });
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = { topic: `gate/parked/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });
});

describe("exactly-once dedup across boot passes and the event path", () => {
  test("two consecutive bootResumePass runs resume exactly once; the event path after that is also a no-op", async () => {
    const row = facilityRow();
    const { io, calls } = fakeEventIo({ pages: [[row]] });

    await bootResumePass(io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1);

    await bootResumePass(io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1); // still one -- the second pass no-ops

    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };
    io.gateRow = () => row;
    await handleAnsweredEvent(frame, io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1); // event after the boot-pass resume also no-ops
  });
});

describe("bootResumePass", () => {
  test("pages gateList to exhaustion and resumes every missed answered-parked gate found", async () => {
    const mrUrlB = "https://gitlab.com/acme/webapp/-/merge_requests/9001";
    const rowA = facilityRow();
    const rowB = facilityRow({ id: "gate-2", subject: `mr:${mrUrlB}` });
    const { io, calls } = fakeEventIo({
      pages: [[rowA], [rowB]],
      reviews: { [MR_URL]: baseReview(), [mrUrlB]: baseReview({ mrUrl: mrUrlB, iid: 9001, agentId: "agent-9" }) },
    });

    await bootResumePass(io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(2);
    expect(calls.resumeAgentPane.map((c) => c.agentId).sort()).toEqual(["agent-1", "agent-9"]);
  });
});
