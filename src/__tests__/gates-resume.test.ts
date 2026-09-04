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
import { GATE_LIST_PAGE_LIMIT, type GateEventFrame } from "../gates/ingest.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const GATE_ID = "gate-1";
const SUBJECT = `mr:${MR_URL}`;

// ── resumeParkedGate (moved from gates-answer.test.ts unchanged) ──────────

interface ResumeIoCalls {
  resumeAgentPane: Array<{ agentId: string; prompt: string; workspaceLabel: string; tabLabel: string }>;
  writeReviewState: Array<{ path: string; patch: unknown }>;
  notify: string[];
  resolveLaunchSkill: Array<{ mrUrl: string; tabId?: string }>;
  applyRow: FacilityGateRow[];
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
  const calls: ResumeIoCalls = { resumeAgentPane: [], writeReviewState: [], notify: [], resolveLaunchSkill: [], applyRow: [] };
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
    // Matches facilityRow()'s default id -- the review's own `gate open`
    // already stamped this before any resume path ever reads it. A test
    // exercising a different (or stale) row id overrides this explicitly.
    gateId: GATE_ID,
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
  /** Rows the daemon "actually has", for `handleAnsweredEvent`'s cache-miss
      fallback fetch (`gateList({subjectPrefix: <exact subject>})`) -- kept
      separate from `rows` (the cache's own content) so a test can model a
      row the cache never saw. Defaults to `rows`, so most tests (where the
      cache already has everything) need not set it. */
  facilityRows?: FacilityGateRow[];
  reviews?: Record<string, ReviewState>;
  pages?: FacilityGateRow[][];
  resumeResult?: Partial<AgentLaunchResult>;
} = {}): { io: GateResumeEventIo; calls: ResumeIoCalls; reviews: Map<string, ReviewState> } {
  const rowsBySubject = new Map((opts.rows ?? []).map((r) => [r.subject, r]));
  const facilityRows = opts.facilityRows ?? opts.rows ?? [];
  const reviews = new Map(Object.entries(opts.reviews ?? { [MR_URL]: baseReview() }));
  // reviewFilePath is a pure deterministic slug, so the fake can invert it
  // back to the mrUrl each write targets without guessing at the string.
  const mrUrlByPath = new Map([...reviews.keys()].map((mrUrl) => [reviewFilePath(mrUrl), mrUrl]));
  const calls: ResumeIoCalls = { resumeAgentPane: [], writeReviewState: [], notify: [], resolveLaunchSkill: [], applyRow: [] };
  const pages = opts.pages ?? [];

  const io: GateResumeEventIo = {
    gateRow: (subject) => rowsBySubject.get(subject),
    applyRow: (row) => {
      calls.applyRow.push(row);
      rowsBySubject.set(row.subject, row);
    },
    readReviewState: (mrUrl) => reviews.get(mrUrl),
    // Cursor-addressed, not an external running index, so a fresh
    // bootResumePass call re-pages from the start -- exactly like the real
    // facility's gate:list, and the only way a second pass's dedup no-op is
    // actually exercised rather than just running out of mock pages.
    // A `subjectPrefix` other than the boot pass's "mr:" is
    // `handleAnsweredEvent`'s single-subject cache-miss fetch, answered from
    // `facilityRows` instead of the page list.
    gateList: async (payload) => {
      if (payload.subjectPrefix === "mr:") {
        const idx = payload.cursor ?? 0;
        const gates = pages[idx] ?? [];
        return { ok: true, data: { gates, cursor: idx + 1 < pages.length ? idx + 1 : 0 } };
      }
      const gates = facilityRows.filter((r) => r.subject.startsWith(payload.subjectPrefix));
      return { ok: true, data: { gates, cursor: 0 } };
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

  test("missing agentId on the tracked review notifies instead of resuming, does not mark the dedup, and stays retryable once the agentId is restored", async () => {
    const row = facilityRow();
    const { io, calls, reviews } = fakeEventIo({ rows: [row], reviews: { [MR_URL]: baseReview({ agentId: undefined }) } });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await expect(handleAnsweredEvent(frame, io, noSkillLookup)).resolves.toBeUndefined();

    expect(calls.resumeAgentPane.length).toBe(0);
    expect(calls.notify).toEqual(["parked gate answered but no agent on file; relaunch from the board"]);
    // The notify-only degrade never resumed anything, so it must not write
    // the resumedGateId dedup marker -- that would block this gate forever.
    expect(calls.writeReviewState.length).toBe(0);

    // Restoring the agentId (e.g. a human relaunches from the board) and
    // re-delivering the same event now DOES resume -- proving the gate was
    // never permanently blocked by the earlier notify-only attempt.
    reviews.set(MR_URL, { ...reviews.get(MR_URL)!, agentId: "agent-1" });
    await handleAnsweredEvent(frame, io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.writeReviewState.some((c) => (c.patch as { resumedGateId?: string }).resumedGateId === GATE_ID)).toBe(true);
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
  test("pages gateList to exhaustion (limit 200) and resumes every missed answered-parked gate found", async () => {
    const mrUrlB = "https://gitlab.com/acme/webapp/-/merge_requests/9001";
    const rowA = facilityRow();
    const rowB = facilityRow({ id: "gate-2", subject: `mr:${mrUrlB}` });
    // A full first page (limit rows) so the paging loop's "partial page ends
    // it" rule doesn't stop before page two -- the fillers are `open` rows,
    // which resumeIfMissed skips on its first line.
    const filler = Array.from({ length: GATE_LIST_PAGE_LIMIT - 1 }, (_, i) =>
      facilityRow({ id: `filler-${i}`, subject: `mr:https://gitlab.com/acme/webapp/-/merge_requests/${9100 + i}`, status: "open", parkedAt: null }),
    );
    const { io, calls } = fakeEventIo({
      pages: [[rowA, ...filler], [rowB]],
      reviews: { [MR_URL]: baseReview(), [mrUrlB]: baseReview({ mrUrl: mrUrlB, iid: 9001, agentId: "agent-9", gateId: "gate-2" }) },
    });

    await bootResumePass(io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(2);
    expect(calls.resumeAgentPane.map((c) => c.agentId).sort()).toEqual(["agent-1", "agent-9"]);
  });

  test("regression: a non-zero cursor on the last page never spins forever -- a repeat call with 0 rows and the same cursor terminates the pass", async () => {
    const { io, calls } = fakeEventIo({ reviews: { [MR_URL]: baseReview() } });
    let callCount = 0;
    io.gateList = async (payload) => {
      callCount++;
      const fullPage = Array.from({ length: GATE_LIST_PAGE_LIMIT }, (_, i) => facilityRow({ id: `f-${i}`, status: "open", parkedAt: null }));
      if (!payload.cursor) return { ok: true, data: { gates: fullPage, cursor: 9000 } };
      return { ok: true, data: { gates: [], cursor: 9000 } };
    };

    await bootResumePass(io, noSkillLookup);

    expect(callCount).toBe(2);
    expect(calls.resumeAgentPane.length).toBe(0);
  });

  test("a not-wired-until-W3 throw for one row doesn't stop later rows in the same page from resuming (per-row isolation)", async () => {
    const mrUrlB = "https://gitlab.com/acme/webapp/-/merge_requests/9002";
    const throwing = facilityRow({ id: "gate-throws", kind: "respond-plan" });
    const rowB = facilityRow({ id: "gate-2", subject: `mr:${mrUrlB}` });
    const { io, calls } = fakeEventIo({
      pages: [[throwing, rowB]],
      reviews: {
        [MR_URL]: baseReview({ gateId: "gate-throws" }),
        [mrUrlB]: baseReview({ mrUrl: mrUrlB, iid: 9002, agentId: "agent-9", gateId: "gate-2" }),
      },
    });

    await expect(bootResumePass(io, noSkillLookup)).resolves.toBeUndefined();

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.resumeAgentPane[0]!.agentId).toBe("agent-9");
  });

  test("resumes only the review-tracked gate id; a stale answered+parked row left over from an earlier review on the same MR is skipped", async () => {
    const rowOld = facilityRow({ id: "gate-old" });
    const rowCurrent = facilityRow({ id: "gate-current" });
    const { io, calls } = fakeEventIo({
      pages: [[rowOld, rowCurrent]],
      reviews: { [MR_URL]: baseReview({ gateId: "gate-current" }) },
    });

    await bootResumePass(io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.writeReviewState.some((c) => (c.patch as { resumedGateId?: string }).resumedGateId === "gate-current")).toBe(true);
    expect(calls.writeReviewState.some((c) => (c.patch as { resumedGateId?: string }).resumedGateId === "gate-old")).toBe(false);
  });
});

describe("handleAnsweredEvent cache-miss fallback", () => {
  test("an answered frame for an id the cache never saw resumes via a direct daemon fetch, and applies the fetched row into the cache", async () => {
    const row = facilityRow();
    const { io, calls } = fakeEventIo({ rows: [], facilityRows: [row] });
    const frame: GateEventFrame = { topic: `gate/answered/${GATE_ID}`, payload: { id: GATE_ID, subject: SUBJECT } };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.applyRow.map((r) => r.id)).toEqual([GATE_ID]);
  });

  test("an answered frame whose id differs from the cache's row for that subject is a no-op when the daemon has nothing matching either", async () => {
    const cachedRow = facilityRow({ id: "gate-cached" });
    const { io, calls } = fakeEventIo({ rows: [cachedRow] });
    const frame: GateEventFrame = { topic: "gate/answered/gate-other", payload: { id: "gate-other", subject: SUBJECT } };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });

  test("resumes only the review-tracked gate id even on the live event path -- a stale answered+parked frame is a no-op", async () => {
    const rowOld = facilityRow({ id: "gate-old" });
    const { io, calls } = fakeEventIo({ rows: [rowOld], reviews: { [MR_URL]: baseReview({ gateId: "gate-current" }) } });
    const frame: GateEventFrame = { topic: "gate/answered/gate-old", payload: { id: "gate-old", subject: SUBJECT } };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });
});
