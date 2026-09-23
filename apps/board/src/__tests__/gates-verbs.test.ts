import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  gatePresentation,
  type Commands,
  type GateRow,
  type RtResponse,
} from '@mattstack/rt-client';
import type { DoctorState } from '../doctor-state.ts';
import {
  gateAnswer,
  gateOpen,
  gateWait,
  parseWaitMaxMs,
  type GateVerbIo,
} from '../gates/verbs.ts';
import { statusBinPath } from '../herdr.ts';
import type { RespondState } from '../respond-state.ts';
import type { ReviewState } from '../review-state.ts';
import {
  dbPathForRoot,
  insertAgentState,
  mintHandle,
  openStateDb,
  readByHandle,
  reportPathForHandle,
} from '../state/index.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const IID = 4821;

const QUESTIONS = [
  {
    id: 'tiers',
    label: 'Which tiers?',
    multi: true,
    options: ['nit', 'must-fix'],
  },
  {
    id: 'outcome',
    label: 'Outcome?',
    multi: false,
    options: ['comment', 'approve'],
  },
];

/** Fills in every GateRow field a fixture doesn't care about, so each test
    only spells the fields its assertions actually depend on. */
function gateRow(overrides: Partial<GateRow> & { id: string }): GateRow {
  return {
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    questions: QUESTIONS,
    meta: null,
    status: 'open',
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
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

interface FakeIoCalls {
  gateAsk: Array<Commands['gate:ask']['payload']>;
  gateWait: Array<Commands['gate:wait']['payload']>;
  gateAnswer: Array<Commands['gate:answer']['payload']>;
}

function fakeIo(
  overrides: {
    openResult?: RtResponse<Commands['gate:ask']['data']>;
    waitResults?: Array<RtResponse<Commands['gate:wait']['data']>>;
    answerResult?: RtResponse<Commands['gate:answer']['data']>;
    /** Advances the fake clock by this much per gateWait call (0 = frozen). */
    msPerWait?: number;
  } = {}
): { io: GateVerbIo; calls: FakeIoCalls } {
  const calls: FakeIoCalls = { gateAsk: [], gateWait: [], gateAnswer: [] };
  const waitResults = overrides.waitResults ?? [];
  let waitIdx = 0;
  let clock = 0;
  const io: GateVerbIo = {
    now: () => clock,
    gateAsk: async payload => {
      calls.gateAsk.push(payload);
      return (
        overrides.openResult ?? {
          ok: true,
          data: {
            id: 'gate-1',
            presentation: 'form',
            subject: `mr:${MR_URL}`,
            supersededId: null,
          },
        }
      );
    },
    gateWait: async payload => {
      calls.gateWait.push(payload);
      clock += overrides.msPerWait ?? 0;
      const res = waitResults[Math.min(waitIdx, waitResults.length - 1)]!;
      waitIdx++;
      return res;
    },
    gateAnswer: async payload => {
      calls.gateAnswer.push(payload);
      return (
        overrides.answerResult ?? {
          ok: true,
          data: { row: gateRow({ id: payload.id }) },
        }
      );
    },
  };
  return { io, calls };
}

let dir: string;
let db: Database;
let statePath: string;

/** Seeds (or fully replaces) the review row the module-level `statePath`
    handle addresses -- gateOpen/gateWait/gateAnswer resolve their own db
    from the handle, so the row has to live in the same file this test's
    `db` points at (see mintHandle's root-derived depth). */
function writeState(patch: Partial<ReviewState> = {}): void {
  insertAgentState(
    'review',
    MR_URL,
    IID,
    {
      mrUrl: MR_URL,
      iid: IID,
      status: 'reviewing',
      agentId: 'agent-1',
      sessionId: 'session-1',
      paneId: 'pane-1',
      tabId: 'tab-1',
      startedAt: 1,
      updatedAt: 1,
      ...patch,
    },
    statePath,
    db
  );
}

function readState(): ReviewState {
  return readByHandle(statePath, db) as ReviewState;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gv-'));
  db = openStateDb(dbPathForRoot(dir), 'cli');
  statePath = mintHandle('review', MR_URL, dir);
  writeState();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gateOpen', () => {
  test('calls the facility with subject mr:<url>, kind review-post, and an !<iid> label', async () => {
    const { io, calls } = fakeIo();

    const gateId = (
      await gateOpen(statePath, 'review-post', JSON.stringify(QUESTIONS), io)
    ).gateId;

    expect(gateId).toBe('gate-1');
    expect(calls.gateAsk.length).toBe(1);
    const payload = calls.gateAsk[0]!;
    expect(payload).toEqual({
      subject: `mr:${MR_URL}`,
      kind: 'review-post',
      questions: QUESTIONS,
      paneId: 'pane-1',
      meta: { label: `review gate !${IID}` },
      origin: { surface: 'board', tabId: 'tab-1' },
    });
  });

  test('persists the returned gateId and gateKind onto review state, leaving other fields untouched', async () => {
    const { io } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'gate-xyz',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });

    await gateOpen(statePath, 'review-post', JSON.stringify(QUESTIONS), io);

    const state = readState();
    expect(state.gateId).toBe('gate-xyz');
    expect(state.gateKind).toBe('review-post');
    expect(state.mrUrl).toBe(MR_URL);
    expect(state.status).toBe('reviewing');
    expect(state.agentId).toBe('agent-1');
  });

  test('malformed --questions JSON throws rather than calling the facility', async () => {
    const { io, calls } = fakeIo();

    await expect(
      gateOpen(statePath, 'review-post', '{ not valid json', io)
    ).rejects.toThrow();

    expect(calls.gateAsk.length).toBe(0);
  });

  test('an unrecognized kind throws rather than calling the facility', async () => {
    const { io, calls } = fakeIo();

    await expect(
      gateOpen(statePath, 'mystery-kind', JSON.stringify(QUESTIONS), io)
    ).rejects.toThrow(/unrecognized kind/);

    expect(calls.gateAsk.length).toBe(0);
  });

  test('a facility failure throws loudly instead of writing a gateId', async () => {
    const { io } = fakeIo({
      openResult: { ok: false, error: 'daemon unreachable' },
    });

    await expect(
      gateOpen(statePath, 'review-post', JSON.stringify(QUESTIONS), io)
    ).rejects.toThrow(/daemon unreachable/);
    expect(readState().gateId).toBeUndefined();
  });

  test('gateId survives an interleaving reviewing-status write (the merge-list trap)', async () => {
    const { io } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'gate-survives',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });
    const { writeReviewState } = await import('../review-state.ts');

    await gateOpen(statePath, 'review-post', JSON.stringify(QUESTIONS), io);
    expect(readState().gateId).toBe('gate-survives');

    // An unrelated status write (e.g. a resume) that doesn't mention gateId
    // must not clobber it -- gateId has to be on writeReviewState's explicit
    // merge-field list, not just settable by the one call that minted it.
    writeReviewState(
      statePath,
      { status: 'reviewing', paneId: 'pane-2' },
      Date.now(),
      db
    );
    expect(readState().gateId).toBe('gate-survives');

    const { io: waitIo, calls: waitCalls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: 'answered',
            row: gateRow({
              id: 'gate-survives',
              status: 'answered',
              answer: {
                answers: { tiers: ['nit'], outcome: 'comment' },
                by: 'board-ui',
                answeredAt: 9000,
              },
            }),
          },
        },
      ],
    });
    const result = await gateWait(statePath, waitIo);

    expect(waitCalls.gateWait[0]!.id).toBe('gate-survives');
    expect(result).toEqual({
      status: 'answered',
      answers: { tiers: ['nit'], outcome: 'comment' },
      by: 'board-ui',
      answeredAt: 9000,
    });
  });

  test('ingests a sibling report on open, so a mid-gate hold can already serve it', async () => {
    const reportPath = reportPathForHandle(statePath);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, '# review\n\nlgtm');
    const { io } = fakeIo();

    await gateOpen(statePath, 'review-post', JSON.stringify(QUESTIONS), io);

    const row = readByHandle(statePath, db) as ReviewState;
    expect(row.reportReady).toBe(true);
    const { readReviewReport } = await import('../review-state.ts');
    expect(readReviewReport(MR_URL, db)).toContain('lgtm');
  });
});

describe('gate verbs: stale pre-upgrade handle', () => {
  test('open/wait/answer fail loudly instead of creating a stray db at a foreign root', async () => {
    const staleRoot = mkdtempSync(join(tmpdir(), 'gv-stale-'));
    const staleHandle = mintHandle('review', MR_URL, staleRoot);
    const { io } = fakeIo();

    await expect(
      gateOpen(staleHandle, 'review-post', JSON.stringify(QUESTIONS), io)
    ).rejects.toThrow(/stale pre-upgrade handle\?/);
    await expect(gateWait(staleHandle, io)).rejects.toThrow(
      /stale pre-upgrade handle\?/
    );
    await expect(
      gateAnswer(staleHandle, JSON.stringify({}), 'pane', io)
    ).rejects.toThrow(/stale pre-upgrade handle\?/);

    rmSync(staleRoot, { recursive: true, force: true });
  });
});

describe("gateOpen: label and writer by kind's domain", () => {
  test("a respond-plan open labels 'respond gate !<iid>' and persists gateId/gateKind onto respond state", async () => {
    const respondPath = mintHandle('respond', MR_URL, dir);
    insertAgentState(
      'respond',
      MR_URL,
      IID,
      {
        mrUrl: MR_URL,
        iid: IID,
        status: 'implementing',
        agentId: 'agent-1',
        startedAt: 1,
        updatedAt: 1,
      },
      respondPath,
      db
    );
    const { io, calls } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'gate-respond',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });

    const gateId = (
      await gateOpen(respondPath, 'respond-plan', JSON.stringify(QUESTIONS), io)
    ).gateId;

    expect(gateId).toBe('gate-respond');
    expect(calls.gateAsk[0]!.meta).toEqual({ label: `respond gate !${IID}` });
    const respondState = readByHandle(respondPath, db) as RespondState;
    expect(respondState.gateId).toBe('gate-respond');
    expect(respondState.gateKind).toBe('respond-plan');
    expect(respondState.status).toBe('implementing');
    // The respond-only fields on the row before this open must survive the
    // write untouched -- proof gateOpen went through writeRespondState's own
    // merge list, not a review-shaped one that would silently drop them.
    expect(respondState.agentId).toBe('agent-1');
  });

  test("a doctor-escalation open labels 'doctor gate !<iid>' and persists gateId/gateKind onto doctor state", async () => {
    const doctorPath = mintHandle('doctor', MR_URL, dir);
    insertAgentState(
      'doctor',
      MR_URL,
      IID,
      {
        mrUrl: MR_URL,
        iid: IID,
        status: 'fixing',
        origin: 'manual',
        startedAt: 1,
        updatedAt: 1,
      },
      doctorPath,
      db
    );
    const { io, calls } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'gate-doctor',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });

    const gateId = (
      await gateOpen(
        doctorPath,
        'doctor-escalation',
        JSON.stringify(QUESTIONS),
        io
      )
    ).gateId;

    expect(gateId).toBe('gate-doctor');
    expect(calls.gateAsk[0]!.meta).toEqual({ label: `doctor gate !${IID}` });
    const doctorState = readByHandle(doctorPath, db) as DoctorState;
    expect(doctorState.gateId).toBe('gate-doctor');
    expect(doctorState.gateKind).toBe('doctor-escalation');
    expect(doctorState.status).toBe('fixing');
    expect(doctorState.origin).toBe('manual');
  });
});

describe('gateWait', () => {
  test('returns the answer once the facility reports answered', async () => {
    writeState({ gateId: 'gate-42' });
    const { io, calls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: 'answered',
            row: gateRow({
              id: 'gate-42',
              status: 'answered',
              answer: {
                answers: { tiers: [], outcome: 'approve' },
                by: 'board-ui',
                answeredAt: 3000,
              },
            }),
          },
        },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({
      status: 'answered',
      answers: { tiers: [], outcome: 'approve' },
      by: 'board-ui',
      answeredAt: 3000,
    });
    expect(calls.gateWait.length).toBe(1);
    expect(calls.gateWait[0]!.id).toBe('gate-42');
  });

  test('registry-status-first: an already-answered gate returns on the first call, no extra looping', async () => {
    writeState({ gateId: 'gate-preanswered' });
    const { io, calls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: 'answered',
            row: gateRow({
              id: 'gate-preanswered',
              status: 'answered',
              answer: {
                answers: { tiers: ['must-fix'], outcome: 'comment' },
                by: 'board-ui',
                answeredAt: 2000,
              },
            }),
          },
        },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({
      status: 'answered',
      answers: { tiers: ['must-fix'], outcome: 'comment' },
      by: 'board-ui',
      answeredAt: 2000,
    });
    expect(calls.gateWait.length).toBe(1);
  });

  test('a timeout re-enters the wait until an answer lands', async () => {
    writeState({ gateId: 'gate-looped' });
    const { io, calls } = fakeIo({
      waitResults: [
        { ok: true, data: { status: 'timeout' } },
        { ok: true, data: { status: 'timeout' } },
        {
          ok: true,
          data: {
            status: 'answered',
            row: gateRow({
              id: 'gate-looped',
              status: 'answered',
              answer: {
                answers: { tiers: ['nit'], outcome: 'comment' },
                by: 'board-ui',
                answeredAt: 4000,
              },
            }),
          },
        },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({
      status: 'answered',
      answers: { tiers: ['nit'], outcome: 'comment' },
      by: 'board-ui',
      answeredAt: 4000,
    });
    expect(calls.gateWait.length).toBe(3);
    expect(calls.gateWait.every(p => p.id === 'gate-looped')).toBe(true);
  });

  test('timeouts past the bounded window return pending instead of looping forever', async () => {
    writeState({ gateId: 'gate-slow' });
    const { io, calls } = fakeIo({
      waitResults: [{ ok: true, data: { status: 'timeout' } }],
      msPerWait: 40_000,
    });

    const result = await gateWait(statePath, io, 90_000);

    expect(result).toEqual({ status: 'pending' });
    // 40s + 40s < 90s deadline, third call crosses it: exactly 3 re-entries.
    expect(calls.gateWait.length).toBe(3);
    // The remaining budget rides into each facility poll, so a single
    // long-poll can never overshoot the window.
    expect(calls.gateWait.map(p => p.waitMs)).toEqual([90_000, 50_000, 10_000]);
  });

  test('a custom max window bounds the wait', async () => {
    writeState({ gateId: 'gate-quick-window' });
    const { io, calls } = fakeIo({
      waitResults: [{ ok: true, data: { status: 'timeout' } }],
      msPerWait: 30_000,
    });

    const result = await gateWait(statePath, io, 25_000);

    expect(result).toEqual({ status: 'pending' });
    expect(calls.gateWait.length).toBe(1);
    expect(calls.gateWait[0]!.waitMs).toBe(25_000);
  });

  test('sessionId flows into the gate:wait payload when the caller passes one', async () => {
    writeState({ gateId: 'gate-with-session' });
    const { io, calls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: 'answered',
            row: gateRow({
              id: 'gate-with-session',
              status: 'answered',
              answer: {
                answers: { tiers: [], outcome: 'approve' },
                by: 'board-ui',
                answeredAt: 1000,
              },
            }),
          },
        },
      ],
    });

    await gateWait(statePath, io, undefined, { sessionId: 'session-abc' });

    expect(calls.gateWait[0]!.sessionId).toBe('session-abc');
  });

  test('sessionId is absent from the gate:wait payload when the caller passes none', async () => {
    writeState({ gateId: 'gate-no-session' });
    const { io, calls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: 'answered',
            row: gateRow({
              id: 'gate-no-session',
              status: 'answered',
              answer: {
                answers: { tiers: [], outcome: 'approve' },
                by: 'board-ui',
                answeredAt: 1000,
              },
            }),
          },
        },
      ],
    });

    await gateWait(statePath, io);

    expect(calls.gateWait[0]!.sessionId).toBeUndefined();
  });

  test('parseWaitMaxMs: absent defaults, valid parses, junk and bare flags reject', () => {
    expect(parseWaitMaxMs([])).toBeUndefined();
    expect(parseWaitMaxMs(['--max-ms', '30000'])).toBe(30_000);
    expect(parseWaitMaxMs(['--max-ms=45000'])).toBe(45_000);
    for (const argv of [
      ['--max-ms', 'abc'],
      ['--max-ms', 'Infinity'],
      ['--max-ms', '-5'],
      ['--max-ms', '0'],
      ['--max-ms'],
      ['--max-ms='],
    ]) {
      expect(() => parseWaitMaxMs(argv)).toThrow('finite positive');
    }
  });

  test('a closed gate surfaces as a clean terminal error instead of hanging', async () => {
    writeState({ gateId: 'gate-closed' });
    const { io } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: 'closed',
            row: gateRow({
              id: 'gate-closed',
              status: 'closed',
              closedReason: 'superseded',
            }),
          },
        },
      ],
    });

    await expect(gateWait(statePath, io)).rejects.toThrow(/closed/);
  });

  test('a facility failure fails loudly instead of treating it as absence', async () => {
    writeState({ gateId: 'gate-fail' });
    const { io } = fakeIo({
      waitResults: [{ ok: false, error: 'daemon unreachable' }],
    });

    await expect(gateWait(statePath, io)).rejects.toThrow(/daemon unreachable/);
  });

  test('no gateId on review state throws rather than waiting on nothing', async () => {
    const { io } = fakeIo();

    await expect(gateWait(statePath, io)).rejects.toThrow(/no gate open/);
  });
});

describe('gateAnswer', () => {
  test('calls gate:answer with by: pane and reports no conflict on a clean win', async () => {
    writeState({ gateId: 'gate-pane' });
    const { io, calls } = fakeIo({
      answerResult: {
        ok: true,
        data: {
          row: gateRow({
            id: 'gate-pane',
            status: 'answered',
            answer: {
              answers: { tiers: ['must-fix'], outcome: 'approve' },
              by: 'pane',
              answeredAt: 6000,
            },
          }),
        },
      },
    });

    const result = await gateAnswer(
      statePath,
      JSON.stringify({ tiers: ['must-fix'], outcome: 'approve' }),
      'pane',
      io
    );

    expect(calls.gateAnswer.length).toBe(1);
    expect(calls.gateAnswer[0]).toEqual({
      id: 'gate-pane',
      answers: { tiers: ['must-fix'], outcome: 'approve' },
      by: 'pane',
    });
    expect(result).toEqual({
      conflict: false,
      answers: { tiers: ['must-fix'], outcome: 'approve' },
      by: 'pane',
      answeredAt: 6000,
    });
  });

  test("a CAS-lost answer reports conflict and returns the winning row's answer, not the loser's", async () => {
    writeState({ gateId: 'gate-race' });
    const { io } = fakeIo({
      answerResult: {
        ok: true,
        data: {
          conflict: true,
          row: gateRow({
            id: 'gate-race',
            status: 'answered',
            answer: {
              answers: { tiers: [], outcome: 'comment' },
              by: 'board-ui',
              answeredAt: 5500,
            },
          }),
        },
      },
    });

    const result = await gateAnswer(
      statePath,
      JSON.stringify({ tiers: ['must-fix'], outcome: 'approve' }),
      'pane',
      io
    );

    expect(result).toEqual({
      conflict: true,
      answers: { tiers: [], outcome: 'comment' },
      by: 'board-ui',
      answeredAt: 5500,
    });
  });

  test('no gateId on review state throws rather than answering nothing', async () => {
    const { io } = fakeIo();

    await expect(
      gateAnswer(statePath, JSON.stringify({}), 'pane', io)
    ).rejects.toThrow(/no gate open/);
  });
});

describe('gateOpen W4 (origin, nudge, presentation, context)', () => {
  const FORM_QUESTIONS = JSON.stringify([
    {
      id: 'outcome',
      label: 'Outcome?',
      multi: false,
      options: ['comment', 'approve'],
    },
  ]);
  const OVER_CAP_QUESTIONS = JSON.stringify([
    {
      id: 'threads-1',
      label: 'Threads',
      multi: true,
      options: ['a', 'b', 'c', 'd', 'e'],
    },
  ]);

  function stateWithPane(dir: string, db: Database): string {
    const statePath = mintHandle('review', MR_URL, dir);
    insertAgentState(
      'review',
      MR_URL,
      IID,
      {
        mrUrl: MR_URL,
        iid: IID,
        status: 'reviewing',
        paneId: 'pane-3',
        tabId: 'tab-3',
        startedAt: 1,
        updatedAt: 1,
      },
      statePath,
      db
    );
    return statePath;
  }

  test("form presentation: origin, paneId, sessionId, and context reach the payload; result.presentation is the facility's", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-verbs-w4-'));
    const db = openStateDb(dbPathForRoot(dir), 'cli');
    const { io, calls } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'g1',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });
    const result = await gateOpen(
      stateWithPane(dir, db),
      'review-post',
      FORM_QUESTIONS,
      io,
      {
        sessionId: 'sess-9',
        worktree: '/tmp/wt',
        context: 'tier counts',
      }
    );
    expect(result).toEqual({ gateId: 'g1', presentation: 'form' });
    const payload = calls.gateAsk[0]!;
    expect(payload.origin).toEqual({
      surface: 'board',
      tabId: 'tab-3',
      worktree: '/tmp/wt',
    });
    expect(payload.paneId).toBe('pane-3');
    expect(payload.sessionId).toBe('sess-9');
    expect(payload.context).toBe('tier counts');
    rmSync(dir, { recursive: true, force: true });
  });

  test('over the option cap: the result presentation is whatever the facility returns, not locally computed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-verbs-w4-'));
    const db = openStateDb(dbPathForRoot(dir), 'cli');
    const { io } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'g2',
          presentation: 'wait',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });
    const result = await gateOpen(
      stateWithPane(dir, db),
      'respond-plan',
      OVER_CAP_QUESTIONS,
      io,
      {
        sessionId: 'sess-9',
        worktree: '/tmp/wt',
      }
    );
    expect(result.presentation).toBe('wait');
    rmSync(dir, { recursive: true, force: true });
  });

  test('oversize context is sent verbatim, not dropped, and the open still succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-verbs-w4-'));
    const db = openStateDb(dbPathForRoot(dir), 'cli');
    const oversized = 'x'.repeat(8193);
    const { io, calls } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'g3',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });
    await gateOpen(stateWithPane(dir, db), 'review-post', FORM_QUESTIONS, io, {
      context: oversized,
    });
    expect(calls.gateAsk[0]!.context).toBe(oversized);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('gateOpen relays contextOmitted', () => {
  const QS = JSON.stringify([
    {
      id: 'outcome',
      label: 'Outcome?',
      multi: false,
      options: ['comment', 'approve'],
    },
  ]);

  async function openWith(data: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'gate-verbs-omitted-'));
    const db = openStateDb(dbPathForRoot(dir), 'cli');
    const handle = mintHandle('respond', MR_URL, dir);
    insertAgentState(
      'respond',
      MR_URL,
      IID,
      {
        mrUrl: MR_URL,
        iid: IID,
        status: 'triaging',
        startedAt: 1,
        updatedAt: 1,
      },
      handle,
      db
    );
    const { io } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'g-om',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
          ...data,
        },
      },
    });
    const result = await gateOpen(handle, 'respond-plan', QS, io);
    rmSync(dir, { recursive: true, force: true });
    return result;
  }

  test('a daemon that dropped the contexts says so in the printed result', async () => {
    const result = await openWith({ contextOmitted: true });
    expect(JSON.stringify(result)).toBe(
      '{"gateId":"g-om","presentation":"form","contextOmitted":true}'
    );
  });

  test('a daemon that kept the contexts adds nothing', async () => {
    const result = await openWith({});
    expect(JSON.stringify(result)).toBe(
      '{"gateId":"g-om","presentation":"form"}'
    );
  });
});

describe('bin/gate.ts malformed --questions', () => {
  test('exits nonzero with a stderr message, without ever reaching the facility', async () => {
    const proc = Bun.spawn(
      [
        statusBinPath(),
        'gate',
        'open',
        statePath,
        '--kind',
        'review-post',
        '--questions',
        '{ not valid json',
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const code = await proc.exited;
    expect(code).not.toBe(0);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe('bin/gate.ts missing --kind', () => {
  test('exits nonzero with a usage message, without ever reaching the facility', async () => {
    const proc = Bun.spawn(
      [
        statusBinPath(),
        'gate',
        'open',
        statePath,
        '--questions',
        JSON.stringify(QUESTIONS),
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const code = await proc.exited;
    expect(code).not.toBe(0);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain('usage: gate open');
    expect(stderr).toContain('--kind');
  });
});

describe('presentation parity (BOARD-31)', () => {
  // The CLI's gate open command prints exactly `JSON.stringify` of gateOpen's
  // return value; the two spawn suites above only cover failure paths, and a
  // success-path spawn would hit the real live rt daemon on this machine, so
  // these assert JSON.stringify(result) directly instead.

  // Computes the returned presentation from the SAME rt-client rule the real
  // daemon runs, over the paneId/sessionId/questions the payload actually
  // carries -- a hard-coded 'form'/'wait' literal here would make the option
  // counts inert, since gateOpen only relays whatever `io.gateAsk` returns.
  function fakeIoWithRealPresentation(id: string): {
    io: GateVerbIo;
    calls: FakeIoCalls;
  } {
    const calls: FakeIoCalls = { gateAsk: [], gateWait: [], gateAnswer: [] };
    const io: GateVerbIo = {
      now: () => 0,
      gateAsk: async payload => {
        calls.gateAsk.push(payload);
        return {
          ok: true,
          data: {
            id,
            presentation: gatePresentation({
              paneId: payload.paneId,
              sessionId: payload.sessionId,
              questions: payload.questions,
            }),
            subject: `mr:${MR_URL}`,
            supersededId: null,
          },
        };
      },
      gateWait: async () => {
        throw new Error('not used in presentation parity tests');
      },
      gateAnswer: async () => {
        throw new Error('not used in presentation parity tests');
      },
    };
    return { io, calls };
  }

  test('unchanged: a question set with every option count at or under 4 yields form', async () => {
    const { io } = fakeIoWithRealPresentation('gate-1');

    const result = await gateOpen(
      statePath,
      'review-post',
      JSON.stringify(QUESTIONS),
      io,
      { sessionId: 'session-1' }
    );

    expect(JSON.stringify(result)).toBe(
      '{"gateId":"gate-1","presentation":"form"}'
    );
  });

  test('unchanged: a question with 5 options yields wait', async () => {
    const fiveOptionQuestions = JSON.stringify([
      {
        id: 'threads',
        label: 'Threads',
        multi: true,
        options: ['a', 'b', 'c', 'd', 'e'],
      },
    ]);
    const { io } = fakeIoWithRealPresentation('gate-2');

    const result = await gateOpen(
      statePath,
      'review-post',
      fiveOptionQuestions,
      io,
      { sessionId: 'session-1' }
    );

    expect(JSON.stringify(result)).toBe(
      '{"gateId":"gate-2","presentation":"wait"}'
    );
  });

  test('delta 1: missing paneId and sessionId now opens as wait instead of the old form-guard refusal', async () => {
    const noPaneDir = mkdtempSync(join(tmpdir(), 'gate-verbs-parity-'));
    const noPaneDb = openStateDb(dbPathForRoot(noPaneDir), 'cli');
    const noPaneState = mintHandle('review', MR_URL, noPaneDir);
    insertAgentState(
      'review',
      MR_URL,
      IID,
      {
        mrUrl: MR_URL,
        iid: IID,
        status: 'reviewing',
        startedAt: 1,
        updatedAt: 1,
      },
      noPaneState,
      noPaneDb
    );
    const { io, calls } = fakeIoWithRealPresentation('gate-wait-only');

    const result = await gateOpen(
      noPaneState,
      'review-post',
      JSON.stringify(QUESTIONS),
      io
    );

    expect(calls.gateAsk[0]!.paneId).toBeUndefined();
    expect(calls.gateAsk[0]!.sessionId).toBeUndefined();
    expect(JSON.stringify(result)).toBe(
      '{"gateId":"gate-wait-only","presentation":"wait"}'
    );

    rmSync(noPaneDir, { recursive: true, force: true });
  });

  test('delta 3: paneId set but no sessionId still opens as wait, the realistic case where CLAUDE_CODE_SESSION_ID is unset', async () => {
    const panedDir = mkdtempSync(join(tmpdir(), 'gate-verbs-parity-'));
    const panedDb = openStateDb(dbPathForRoot(panedDir), 'cli');
    const panedState = mintHandle('review', MR_URL, panedDir);
    insertAgentState(
      'review',
      MR_URL,
      IID,
      {
        mrUrl: MR_URL,
        iid: IID,
        status: 'reviewing',
        startedAt: 1,
        updatedAt: 1,
        paneId: 'pane-1',
      },
      panedState,
      panedDb
    );
    const { io, calls } = fakeIoWithRealPresentation('gate-paned-no-session');

    const result = await gateOpen(
      panedState,
      'review-post',
      JSON.stringify(QUESTIONS),
      io
    );

    expect(calls.gateAsk[0]!.paneId).toBe('pane-1');
    expect(calls.gateAsk[0]!.sessionId).toBeUndefined();
    expect(JSON.stringify(result)).toBe(
      '{"gateId":"gate-paned-no-session","presentation":"wait"}'
    );

    rmSync(panedDir, { recursive: true, force: true });
  });

  test('delta 2: oversized context is sent verbatim, the gate still opens, and the byte-cap warning still fires', async () => {
    const oversized = 'x'.repeat(8193);
    const { io, calls } = fakeIo({
      openResult: {
        ok: true,
        data: {
          id: 'gate-oversized',
          presentation: 'form',
          subject: `mr:${MR_URL}`,
          supersededId: null,
        },
      },
    });
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await gateOpen(
        statePath,
        'review-post',
        JSON.stringify(QUESTIONS),
        io,
        { sessionId: 'session-1', context: oversized }
      );

      expect(calls.gateAsk[0]!.context).toBe(oversized);
      expect(JSON.stringify(result)).toBe(
        '{"gateId":"gate-oversized","presentation":"form"}'
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toContain('8192');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
