import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { AgentLaunchResult } from '../agent-launch.ts';
import { doctorFilePath } from '../doctor-state.ts';
import { GATE_LIST_PAGE_LIMIT, type GateEventFrame } from '../gates/ingest.ts';
import {
  bootResumePass,
  buildResumers,
  handleAnsweredEvent,
  resumeParkedGate,
  type GateResumeEventIo,
  type KindResumeIo,
  type ResumableState,
  type ResumeParkedGateIo,
} from '../gates/resume.ts';
import type { GateState } from '../gates/store.ts';
import { GATE_KINDS } from '../gates/sweep.ts';
import { respondFilePath } from '../respond-state.ts';
import { reviewFilePath } from '../review-state.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const GATE_ID = 'gate-1';
const SUBJECT = `mr:${MR_URL}`;

function baseGate(overrides: Partial<GateState> = {}): GateState {
  return {
    gateId: GATE_ID,
    mrUrl: MR_URL,
    iid: 4821,
    kind: 'review-post',
    status: 'parked',
    openedAt: 1000,
    questions: [
      {
        id: 'outcome',
        label: 'Outcome?',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    ...overrides,
  };
}

// ── Per-domain KindResumeIo fixtures ───────────────────────────────────────
// Each domain owns its own in-memory state map, its own deterministic
// filePath, and its own wrapper name -- proof that resume rebuilds the
// right wrapper/state file per kind, not just per hardcoded review wiring.

interface DomainCalls {
  writeState: Array<{
    path: string;
    patch: Partial<ResumableState> & { status: string };
  }>;
  resolveSkill: Array<{ mrUrl: string; tabId?: string }>;
}

function makeKindIo(opts: {
  wrapper: string;
  workspaceLabel: string;
  resumedStatus: string;
  filePath: (mrUrl: string) => string;
  states: Map<string, ResumableState>;
}): { io: KindResumeIo; calls: DomainCalls } {
  const calls: DomainCalls = { writeState: [], resolveSkill: [] };
  const pathToMrUrl = new Map(
    [...opts.states.keys()].map(mrUrl => [opts.filePath(mrUrl), mrUrl])
  );
  const io: KindResumeIo = {
    readState: mrUrl => opts.states.get(mrUrl),
    writeState: (path, patch) => {
      calls.writeState.push({ path, patch });
      const mrUrl = pathToMrUrl.get(path);
      if (!mrUrl) return;
      const prev = opts.states.get(mrUrl);
      if (prev) opts.states.set(mrUrl, { ...prev, ...patch });
    },
    filePath: opts.filePath,
    resolveSkill: (mrUrl, tabId) => {
      calls.resolveSkill.push({ mrUrl, tabId });
      return `acme:${opts.wrapper}`;
    },
    prompt: async (mrUrl, statePath, skill, resumedGate, resumedGateKind) =>
      `/board:${opts.wrapper} ${mrUrl}\n  --state ${statePath}\n  --skill ${skill}\n  --resumed-gate ${resumedGate}\n  --resumed-gate-kind ${resumedGateKind}`,
    resumedStatus: opts.resumedStatus,
    workspaceLabel: opts.workspaceLabel,
  };
  return { io, calls };
}

function baseReview(overrides: Partial<ResumableState> = {}): ResumableState {
  return {
    mrUrl: MR_URL,
    iid: 4821,
    status: 'reviewing',
    agentId: 'agent-1',
    // Matches facilityRow()'s default id -- the domain's own `gate open`
    // already stamped this before any resume path ever reads it. A test
    // exercising a different (or stale) row id overrides this explicitly.
    gateId: GATE_ID,
    ...overrides,
  };
}

interface ResumeIoCalls {
  resumeAgentPane: Array<{
    agentId: string;
    prompt: string;
    workspaceLabel: string;
    tabLabel: string;
  }>;
  notify: string[];
}

function fakeResumeIo(
  resumers: Partial<Record<string, KindResumeIo>>,
  result: Partial<AgentLaunchResult> = {}
): { io: ResumeParkedGateIo; calls: ResumeIoCalls } {
  const calls: ResumeIoCalls = { resumeAgentPane: [], notify: [] };
  const io: ResumeParkedGateIo = {
    resumers,
    resumeAgentPane: async opts => {
      calls.resumeAgentPane.push(opts);
      return {
        agentId: 'agent-2',
        sessionId: 'sess-2',
        paneId: 'pane-2',
        tabId: 'tab-2',
        workspaceId: 'ws-2',
        focusedExisting: false,
        ...result,
      };
    },
    notify: message => {
      calls.notify.push(message);
    },
  };
  return { io, calls };
}

describe('resumeParkedGate', () => {
  test('review-post: builds the /board:review prompt with --state and --resumed-gate, resumes the pane, and persists fresh ids', async () => {
    const states = new Map([[MR_URL, baseReview()]]);
    const { io: reviewIo, calls: reviewCalls } = makeKindIo({
      wrapper: 'review',
      workspaceLabel: 'reviews',
      resumedStatus: 'reviewing',
      filePath: reviewFilePath,
      states,
    });
    const gate = baseGate({ agentId: 'agent-1' });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({
      'review-post': reviewIo,
    });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    const call = resumeCalls.resumeAgentPane[0]!;
    expect(call.agentId).toBe('agent-1');
    expect(call.workspaceLabel).toBe('reviews');
    expect(call.prompt).toContain('/board:review');
    expect(call.prompt).toContain('--state');
    expect(call.prompt).toContain(`--resumed-gate ${GATE_ID}`);
    // The resumed pane can't discover the kind itself: --state is an opaque
    // handle and `gate wait` returns only the answer.
    expect(call.prompt).toContain('--resumed-gate-kind review-post');

    expect(reviewCalls.writeState.length).toBe(1);
    expect(reviewCalls.writeState[0]!.patch).toMatchObject({
      status: 'reviewing',
      agentId: 'agent-2',
      paneId: 'pane-2',
      tabId: 'tab-2',
      workspaceId: 'ws-2',
    });
    expect(resumeCalls.notify.length).toBe(0);
  });

  test("respond-plan: rebuilds the /board:respond prompt against respond's own state file and workspace, settling into 'implementing'", async () => {
    const states = new Map([[MR_URL, baseReview({ agentId: 'agent-1' })]]);
    const { io: respondIo, calls: respondCalls } = makeKindIo({
      wrapper: 'respond',
      workspaceLabel: 'responds',
      resumedStatus: 'implementing',
      filePath: respondFilePath,
      states,
    });
    const gate = baseGate({ agentId: 'agent-1', kind: 'respond-plan' });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({
      'respond-plan': respondIo,
    });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane[0]!.workspaceLabel).toBe('responds');
    expect(resumeCalls.resumeAgentPane[0]!.prompt).toContain('/board:respond');
    expect(resumeCalls.resumeAgentPane[0]!.prompt).toContain(
      `--resumed-gate ${GATE_ID}`
    );
    expect(respondCalls.writeState[0]!.patch).toMatchObject({
      status: 'implementing',
      agentId: 'agent-2',
    });
  });

  test("doctor-escalation: rebuilds the /board:doctor prompt against doctor's own state file and workspace, settling into 'fixing'", async () => {
    const states = new Map([[MR_URL, baseReview({ agentId: 'agent-1' })]]);
    const { io: doctorIo, calls: doctorCalls } = makeKindIo({
      wrapper: 'doctor',
      workspaceLabel: 'doctors',
      resumedStatus: 'fixing',
      filePath: doctorFilePath,
      states,
    });
    const gate = baseGate({ agentId: 'agent-1', kind: 'doctor-escalation' });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({
      'doctor-escalation': doctorIo,
    });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane[0]!.workspaceLabel).toBe('doctors');
    expect(resumeCalls.resumeAgentPane[0]!.prompt).toContain('/board:doctor');
    expect(resumeCalls.resumeAgentPane[0]!.prompt).toContain(
      `--resumed-gate ${GATE_ID}`
    );
    expect(doctorCalls.writeState[0]!.patch).toMatchObject({
      status: 'fixing',
      agentId: 'agent-2',
    });
  });

  test("threads the gate's tabId to resolveSkill", async () => {
    const states = new Map([[MR_URL, baseReview()]]);
    const { io: reviewIo, calls: reviewCalls } = makeKindIo({
      wrapper: 'review',
      workspaceLabel: 'reviews',
      resumedStatus: 'reviewing',
      filePath: reviewFilePath,
      states,
    });
    const gate = baseGate({ agentId: 'agent-1', tabId: 'tab-9' });
    const { io: resumeIo } = fakeResumeIo({ 'review-post': reviewIo });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(reviewCalls.resolveSkill).toEqual([
      { mrUrl: MR_URL, tabId: 'tab-9' },
    ]);
  });

  test('a focused-existing resume (already-open tab) does not overwrite state with blank ids', async () => {
    const states = new Map([[MR_URL, baseReview()]]);
    const { io: reviewIo, calls: reviewCalls } = makeKindIo({
      wrapper: 'review',
      workspaceLabel: 'reviews',
      resumedStatus: 'reviewing',
      filePath: reviewFilePath,
      states,
    });
    const gate = baseGate({ agentId: 'agent-1' });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo(
      { 'review-post': reviewIo },
      {
        agentId: '',
        sessionId: '',
        paneId: '',
        tabId: '',
        workspaceId: '',
        focusedExisting: true,
      }
    );

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(1);
    expect(reviewCalls.writeState.length).toBe(0);
  });

  test('missing agentId notifies instead of resuming, and does not throw', async () => {
    const states = new Map([[MR_URL, baseReview()]]);
    const { io: reviewIo } = makeKindIo({
      wrapper: 'review',
      workspaceLabel: 'reviews',
      resumedStatus: 'reviewing',
      filePath: reviewFilePath,
      states,
    });
    const gate = baseGate();
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({
      'review-post': reviewIo,
    });

    await resumeParkedGate(gate, resumeIo, async () => null);

    expect(resumeCalls.resumeAgentPane.length).toBe(0);
    expect(resumeCalls.notify).toEqual([
      'parked gate answered but no agent on file; relaunch from the board',
    ]);
  });

  test('a KNOWN kind with no resumers entry throws rather than silently no-oping', async () => {
    const gate = baseGate({ agentId: 'agent-1', kind: 'doctor-escalation' });
    const { io: resumeIo } = fakeResumeIo({});

    await expect(
      resumeParkedGate(gate, resumeIo, async () => null)
    ).rejects.toThrow('doctor-escalation resume not wired');
  });

  test('an UNKNOWN kind (outside GATE_KINDS) logs and skips rather than throwing', async () => {
    const gate = baseGate({ agentId: 'agent-1', kind: 'mystery-kind' });
    const { io: resumeIo, calls: resumeCalls } = fakeResumeIo({});

    await expect(
      resumeParkedGate(gate, resumeIo, async () => null)
    ).resolves.toBe(false);
    expect(resumeCalls.resumeAgentPane.length).toBe(0);
  });
});

// ── handleAnsweredEvent / bootResumePass ───────────────────────────────────

function facilityRow(
  overrides: Partial<FacilityGateRow> = {}
): FacilityGateRow {
  return {
    id: GATE_ID,
    subject: SUBJECT,
    kind: 'review-post',
    questions: [
      {
        id: 'outcome',
        label: 'Outcome?',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    meta: null,
    status: 'answered',
    answer: {
      answers: { outcome: 'approve' },
      by: 'console',
      answeredAt: 9000,
    },
    openedAt: 1000,
    parkedAt: 5000,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    ...overrides,
  };
}

interface EventCalls extends ResumeIoCalls {
  applyRow: FacilityGateRow[];
}

/** In-memory fake standing in for the cache rows, the three domains' state
    files, and a paged `gate:list` -- stateful (writeState mutates the same
    map readState reads from) so the exactly-once dedup is exercised the same
    way the real file-backed round trip would exercise it. */
function fakeEventIo(
  opts: {
    rows?: FacilityGateRow[];
    /** Rows the daemon "actually has", for `handleAnsweredEvent`'s cache-miss
      fallback fetch -- kept separate from `rows` (the cache's own content)
      so a test can model a row the cache never saw. Defaults to `rows`. */
    facilityRows?: FacilityGateRow[];
    review?: Record<string, ResumableState>;
    respond?: Record<string, ResumableState>;
    doctor?: Record<string, ResumableState>;
    pages?: FacilityGateRow[][];
    resumeResult?: Partial<AgentLaunchResult>;
  } = {}
): {
  io: GateResumeEventIo;
  calls: EventCalls;
  review: Map<string, ResumableState>;
  respond: Map<string, ResumableState>;
  doctor: Map<string, ResumableState>;
} {
  const rowsBySubject = new Map<string, FacilityGateRow[]>();
  for (const r of opts.rows ?? []) {
    rowsBySubject.set(r.subject, [...(rowsBySubject.get(r.subject) ?? []), r]);
  }
  const facilityRows = opts.facilityRows ?? opts.rows ?? [];
  const review = new Map(
    Object.entries(opts.review ?? { [MR_URL]: baseReview() })
  );
  const respond = new Map(Object.entries(opts.respond ?? {}));
  const doctor = new Map(Object.entries(opts.doctor ?? {}));

  const calls: EventCalls = { resumeAgentPane: [], notify: [], applyRow: [] };

  const { io: reviewIo } = makeKindIo({
    wrapper: 'review',
    workspaceLabel: 'reviews',
    resumedStatus: 'reviewing',
    filePath: reviewFilePath,
    states: review,
  });
  const { io: respondIo } = makeKindIo({
    wrapper: 'respond',
    workspaceLabel: 'responds',
    resumedStatus: 'implementing',
    filePath: respondFilePath,
    states: respond,
  });
  const { io: doctorIo } = makeKindIo({
    wrapper: 'doctor',
    workspaceLabel: 'doctors',
    resumedStatus: 'fixing',
    filePath: doctorFilePath,
    states: doctor,
  });

  const pages = opts.pages ?? [];

  const io: GateResumeEventIo = {
    resumers: {
      'review-post': reviewIo,
      'respond-plan': respondIo,
      'respond-post': respondIo,
      'doctor-escalation': doctorIo,
    },
    rowsForSubject: subject => rowsBySubject.get(subject) ?? [],
    applyRow: row => {
      calls.applyRow.push(row);
      rowsBySubject.set(row.subject, [
        ...(rowsBySubject.get(row.subject) ?? []).filter(r => r.id !== row.id),
        row,
      ]);
    },
    // Cursor-addressed, not an external running index, so a fresh
    // bootResumePass call re-pages from the start -- exactly like the real
    // facility's gate:list, and the only way a second pass's dedup no-op is
    // actually exercised rather than just running out of mock pages.
    // A `subjectPrefix` other than the boot pass's "mr:" is
    // `handleAnsweredEvent`'s single-subject cache-miss fetch, answered from
    // `facilityRows` instead of the page list.
    gateList: async payload => {
      if (payload.subjectPrefix === 'mr:') {
        const idx = payload.cursor ?? 0;
        const gates = pages[idx] ?? [];
        return {
          ok: true,
          data: { gates, cursor: Math.min(idx + 1, pages.length) },
        };
      }
      const gates = facilityRows.filter(r =>
        r.subject.startsWith(payload.subjectPrefix)
      );
      return {
        ok: true,
        data: { gates, cursor: facilityRows.length > 0 ? 999 : 0 },
      };
    },
    resumeAgentPane: async opts2 => {
      calls.resumeAgentPane.push(opts2);
      return {
        agentId: 'agent-2',
        sessionId: 'sess-2',
        paneId: 'pane-2',
        tabId: 'tab-2',
        workspaceId: 'ws-2',
        focusedExisting: false,
        ...opts.resumeResult,
      };
    },
    notify: message => {
      calls.notify.push(message);
    },
  };
  return { io, calls, review, respond, doctor };
}

const noSkillLookup = async () => null;

describe('handleAnsweredEvent', () => {
  test('a console-answered (non-board-endpoint) parked review-post gate resumes through the event path', async () => {
    const row = facilityRow();
    const { io, calls, review } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: {
        id: GATE_ID,
        subject: SUBJECT,
        answers: { outcome: 'approve' },
        by: 'console',
        answeredAt: 9000,
      },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.resumeAgentPane[0]!.agentId).toBe('agent-1');
    expect(review.get(MR_URL)?.resumedGateId).toBe(GATE_ID);
  });

  test('a respond-plan answered+parked gate resumes through the event path, and the dedup marker lands on RESPOND state, not review state', async () => {
    const row = facilityRow({ kind: 'respond-plan' });
    const { io, calls, review, respond } = fakeEventIo({
      rows: [row],
      review: {},
      respond: { [MR_URL]: baseReview({ status: 'implementing' }) },
    });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.resumeAgentPane[0]!.prompt).toContain('/board:respond');
    expect(respond.get(MR_URL)?.resumedGateId).toBe(GATE_ID);
    expect(review.get(MR_URL)).toBeUndefined();
  });

  test('a doctor-escalation answered+parked gate resumes through the event path against doctor state', async () => {
    const row = facilityRow({ kind: 'doctor-escalation' });
    const { io, calls, doctor } = fakeEventIo({
      rows: [row],
      review: {},
      doctor: { [MR_URL]: baseReview({ status: 'fixing' }) },
    });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.resumeAgentPane[0]!.prompt).toContain('/board:doctor');
    expect(doctor.get(MR_URL)?.resumedGateId).toBe(GATE_ID);
  });

  test('a failed pane dispatch does not mark the dedup, and the next event retries', async () => {
    const row = facilityRow();
    const { io, calls, review } = fakeEventIo({ rows: [row] });
    const realResume = io.resumeAgentPane;
    let failNext = true;
    io.resumeAgentPane = async opts => {
      if (failNext) {
        failNext = false;
        throw new Error('rt daemon unreachable');
      }
      return realResume(opts);
    };
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await expect(
      handleAnsweredEvent(frame, io, noSkillLookup)
    ).resolves.toBeUndefined();
    expect(review.get(MR_URL)?.resumedGateId).toBeUndefined();

    await handleAnsweredEvent(frame, io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1);
    expect(review.get(MR_URL)?.resumedGateId).toBe(GATE_ID);
  });

  test('an open (never-parked) gate answered does not resume', async () => {
    const row = facilityRow({ parkedAt: null });
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });

  test('missing agentId on the tracked state notifies instead of resuming, does not mark the dedup, and stays retryable once the agentId is restored', async () => {
    const row = facilityRow();
    const { io, calls, review } = fakeEventIo({
      rows: [row],
      review: { [MR_URL]: baseReview({ agentId: undefined }) },
    });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await expect(
      handleAnsweredEvent(frame, io, noSkillLookup)
    ).resolves.toBeUndefined();

    expect(calls.resumeAgentPane.length).toBe(0);
    expect(calls.notify).toEqual([
      'parked gate answered but no agent on file; relaunch from the board',
    ]);
    expect(review.get(MR_URL)?.resumedGateId).toBeUndefined();

    review.set(MR_URL, { ...review.get(MR_URL)!, agentId: 'agent-1' });
    await handleAnsweredEvent(frame, io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1);
    expect(review.get(MR_URL)?.resumedGateId).toBe(GATE_ID);
  });

  test('an unknown kind (outside GATE_KINDS) logs and skips rather than throwing', async () => {
    const row = facilityRow({ kind: 'mystery-kind' });
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await expect(
      handleAnsweredEvent(frame, io, noSkillLookup)
    ).resolves.toBeUndefined();
    expect(calls.resumeAgentPane.length).toBe(0);
  });

  test('a non-answered topic is a no-op', async () => {
    const row = facilityRow({ status: 'parked', parkedAt: 5000, answer: null });
    const { io, calls } = fakeEventIo({ rows: [row] });
    const frame: GateEventFrame = {
      topic: `gate/parked/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });
});

describe('exactly-once dedup across boot passes and the event path', () => {
  test('two consecutive bootResumePass runs resume exactly once; the event path after that is also a no-op', async () => {
    const row = facilityRow();
    const { io, calls } = fakeEventIo({ pages: [[row]] });

    await bootResumePass(io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1);

    await bootResumePass(io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1); // still one -- the second pass no-ops

    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };
    io.rowsForSubject = () => [row];
    await handleAnsweredEvent(frame, io, noSkillLookup);
    expect(calls.resumeAgentPane.length).toBe(1); // event after the boot-pass resume also no-ops
  });
});

describe('bootResumePass', () => {
  test('pages gateList to exhaustion (limit 200) and resumes every missed answered-parked gate found', async () => {
    const mrUrlB = 'https://gitlab.com/acme/webapp/-/merge_requests/9001';
    const rowA = facilityRow();
    const rowB = facilityRow({ id: 'gate-2', subject: `mr:${mrUrlB}` });
    // A full first page (limit rows) so the paging loop's "partial page ends
    // it" rule doesn't stop before page two -- the fillers are `open` rows,
    // which resumeIfMissed skips on its first line.
    const filler = Array.from({ length: GATE_LIST_PAGE_LIMIT - 1 }, (_, i) =>
      facilityRow({
        id: `filler-${i}`,
        subject: `mr:https://gitlab.com/acme/webapp/-/merge_requests/${9100 + i}`,
        status: 'open',
        parkedAt: null,
      })
    );
    const { io, calls } = fakeEventIo({
      pages: [[rowA, ...filler], [rowB]],
      review: {
        [MR_URL]: baseReview(),
        [mrUrlB]: baseReview({
          mrUrl: mrUrlB,
          iid: 9001,
          agentId: 'agent-9',
          gateId: 'gate-2',
        }),
      },
    });

    await bootResumePass(io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(2);
    expect(calls.resumeAgentPane.map(c => c.agentId).sort()).toEqual([
      'agent-1',
      'agent-9',
    ]);
  });

  test('regression: a non-zero cursor on the last page never spins forever -- a repeat call with 0 rows and the same cursor terminates the pass', async () => {
    const { io, calls } = fakeEventIo({ review: { [MR_URL]: baseReview() } });
    let callCount = 0;
    io.gateList = async payload => {
      callCount++;
      const fullPage = Array.from({ length: GATE_LIST_PAGE_LIMIT }, (_, i) =>
        facilityRow({ id: `f-${i}`, status: 'open', parkedAt: null })
      );
      if (!payload.cursor)
        return { ok: true, data: { gates: fullPage, cursor: 9000 } };
      return { ok: true, data: { gates: [], cursor: 9000 } };
    };

    await bootResumePass(io, noSkillLookup);

    expect(callCount).toBe(2);
    expect(calls.resumeAgentPane.length).toBe(0);
  });

  test("an unwired-kind throw for one row doesn't stop later rows in the same page from resuming (per-row isolation)", async () => {
    const mrUrlB = 'https://gitlab.com/acme/webapp/-/merge_requests/9002';
    const throwing = facilityRow({ id: 'gate-throws', kind: 'mystery-kind' });
    const rowB = facilityRow({ id: 'gate-2', subject: `mr:${mrUrlB}` });
    const { io, calls } = fakeEventIo({
      pages: [[throwing, rowB]],
      review: {
        [MR_URL]: baseReview({ gateId: 'gate-throws' }),
        [mrUrlB]: baseReview({
          mrUrl: mrUrlB,
          iid: 9002,
          agentId: 'agent-9',
          gateId: 'gate-2',
        }),
      },
    });

    await expect(bootResumePass(io, noSkillLookup)).resolves.toBeUndefined();

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.resumeAgentPane[0]!.agentId).toBe('agent-9');
  });

  test('resumes only the state-tracked gate id (review domain); a stale answered+parked row left over from an earlier round on the same MR is skipped', async () => {
    const rowOld = facilityRow({ id: 'gate-old' });
    const rowCurrent = facilityRow({ id: 'gate-current' });
    const { io, calls, review } = fakeEventIo({
      pages: [[rowOld, rowCurrent]],
      review: { [MR_URL]: baseReview({ gateId: 'gate-current' }) },
    });

    await bootResumePass(io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(review.get(MR_URL)?.resumedGateId).toBe('gate-current');
  });

  test('resumes only the state-tracked gate id -- the guard generalizes to a non-review domain (respond)', async () => {
    const rowOld = facilityRow({ id: 'gate-old', kind: 'respond-plan' });
    const rowCurrent = facilityRow({
      id: 'gate-current',
      kind: 'respond-plan',
    });
    const { io, calls, respond } = fakeEventIo({
      pages: [[rowOld, rowCurrent]],
      review: {},
      respond: { [MR_URL]: baseReview({ gateId: 'gate-current' }) },
    });

    await bootResumePass(io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(respond.get(MR_URL)?.resumedGateId).toBe('gate-current');
  });
});

describe('handleAnsweredEvent cache-miss fallback', () => {
  test('an answered frame for an id the cache never saw resumes via a direct daemon fetch, and applies the fetched row into the cache', async () => {
    const row = facilityRow();
    const { io, calls } = fakeEventIo({ rows: [], facilityRows: [row] });
    const frame: GateEventFrame = {
      topic: `gate/answered/${GATE_ID}`,
      payload: { id: GATE_ID, subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(1);
    expect(calls.applyRow.map(r => r.id)).toEqual([GATE_ID]);
  });

  test('an answered frame whose id differs from every cached row for that subject is a no-op when the daemon has nothing matching either', async () => {
    const cachedRow = facilityRow({ id: 'gate-cached' });
    const { io, calls } = fakeEventIo({ rows: [cachedRow] });
    const frame: GateEventFrame = {
      topic: 'gate/answered/gate-other',
      payload: { id: 'gate-other', subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });

  test('resumes only the state-tracked gate id even on the live event path -- a stale answered+parked frame is a no-op', async () => {
    const rowOld = facilityRow({ id: 'gate-old' });
    const { io, calls } = fakeEventIo({
      rows: [rowOld],
      review: { [MR_URL]: baseReview({ gateId: 'gate-current' }) },
    });
    const frame: GateEventFrame = {
      topic: 'gate/answered/gate-old',
      payload: { id: 'gate-old', subject: SUBJECT },
    };

    await handleAnsweredEvent(frame, io, noSkillLookup);

    expect(calls.resumeAgentPane.length).toBe(0);
  });
});

describe('buildResumers', () => {
  // Proof that dropping a kind from the real wiring (server.ts's
  // gateResumeIo) fails a test instead of the whole suite passing silently
  // -- buildResumers is generated from GATE_KINDS, so this test only needs
  // to walk that same list rather than hardcode the kind names itself.
  function stubKindIo(label: string): KindResumeIo {
    return {
      readState: () => undefined,
      writeState: () => {},
      filePath: () => label,
      resolveSkill: () => label,
      prompt: async () => label,
      resumedStatus: label,
      workspaceLabel: label,
    };
  }

  test('every known gate kind resolves to a resumer', () => {
    const review = stubKindIo('review');
    const respond = stubKindIo('respond');
    const doctor = stubKindIo('doctor');
    const resumers = buildResumers({ review, respond, doctor });

    for (const kind of GATE_KINDS) {
      expect(resumers[kind]).toBeDefined();
    }
  });

  test('routes each kind to the domain domainForKind maps it to', () => {
    const review = stubKindIo('review');
    const respond = stubKindIo('respond');
    const doctor = stubKindIo('doctor');
    const resumers = buildResumers({ review, respond, doctor });

    expect(resumers['review-post']).toBe(review);
    expect(resumers['respond-plan']).toBe(respond);
    expect(resumers['respond-post']).toBe(respond);
    expect(resumers['doctor-escalation']).toBe(doctor);
  });

  test('an unknown kind has no resumer', () => {
    const review = stubKindIo('review');
    const respond = stubKindIo('respond');
    const doctor = stubKindIo('doctor');
    const resumers = buildResumers({ review, respond, doctor });

    expect(resumers['never-registered']).toBeUndefined();
  });
});
