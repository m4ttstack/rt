import { describe, expect, test } from 'bun:test';

import type { GateRow } from '@mattstack/rt-client';
import type { DoctorState } from '../doctor-state.ts';
import {
  planSweep,
  pruneOffBoardGates,
  type GateSweepStates,
} from '../gates/sweep.ts';
import type { RespondState } from '../respond-state.ts';
import type { ReviewState } from '../review-state.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const OTHER_MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4900';
const GRACE_MS = 90 * 60_000;
const NOW = 10_000_000;

function baseRow(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'gate-1',
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: NOW,
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

function baseReview(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    mrUrl: MR_URL,
    iid: 4821,
    status: 'done',
    startedAt: NOW - 1000,
    updatedAt: NOW - 500,
    ...overrides,
  };
}

function baseRespond(overrides: Partial<RespondState> = {}): RespondState {
  return {
    mrUrl: MR_URL,
    iid: 4821,
    status: 'done',
    startedAt: NOW - 1000,
    updatedAt: NOW - 500,
    ...overrides,
  };
}

function baseDoctor(overrides: Partial<DoctorState> = {}): DoctorState {
  return {
    mrUrl: MR_URL,
    iid: 4821,
    status: 'done',
    startedAt: NOW - 1000,
    updatedAt: NOW - 500,
    ...overrides,
  };
}

function states(overrides: Partial<GateSweepStates> = {}): GateSweepStates {
  return {
    reviews: new Map(),
    responds: new Map(),
    doctors: new Map(),
    ...overrides,
  };
}

describe('planSweep', () => {
  test('a fresh open row (openedAt = now) is untouched', () => {
    const rows = [baseRow({ openedAt: NOW })];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('an aged open review-post row yields a park action, tabId joined from review state', () => {
    const rows = [baseRow({ openedAt: NOW - GRACE_MS - 1 })];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'reviewing', tabId: 'tab-1' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'park',
        domain: 'review',
        mrUrl: MR_URL,
        tabId: 'tab-1',
        gateId: 'gate-1',
      },
    ]);
  });

  test('boundary: exactly graceMs old parks', () => {
    const rows = [baseRow({ openedAt: NOW - GRACE_MS })];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('park');
  });

  test('an aged open row with no matching review state still parks, with no tabId', () => {
    const rows = [baseRow({ openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'park',
        domain: 'review',
        mrUrl: MR_URL,
        tabId: undefined,
        gateId: 'gate-1',
      },
    ]);
  });

  test('an already-answered row never parks again, even when aged', () => {
    const rows = [
      baseRow({ status: 'answered', openedAt: NOW - GRACE_MS - 1 }),
    ];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('an already-parked row never parks again, even when aged', () => {
    const rows = [baseRow({ status: 'parked', openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('an already-closed row never parks, even when aged', () => {
    const rows = [baseRow({ status: 'closed', openedAt: NOW - GRACE_MS - 1 })];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('a non-mr: subject is ignored entirely', () => {
    const rows = [
      baseRow({
        subject: 'peer:some-other-thing',
        openedAt: NOW - GRACE_MS - 1,
      }),
    ];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('an unrecognized kind is skipped entirely, never crashes the sweep', () => {
    const rows = [
      baseRow({ kind: 'some-future-kind', openedAt: NOW - GRACE_MS - 1 }),
    ];
    const actions = planSweep(rows, states(), NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('a done review with a tabId and no open row yields close-missed-done', () => {
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'done', tabId: 'tab-2' })],
      ]),
    });
    const actions = planSweep([], s, NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'close-missed-done',
        domain: 'review',
        mrUrl: MR_URL,
        tabId: 'tab-2',
      },
    ]);
  });

  test('a done review with a tabId but a still-open review-post row does not close-missed-done', () => {
    const rows = [baseRow({ status: 'open', openedAt: NOW })];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'done', tabId: 'tab-2' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('a done review with a parked (not open) row still yields close-missed-done', () => {
    const rows = [baseRow({ status: 'parked', openedAt: NOW - GRACE_MS - 1 })];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'done', tabId: 'tab-2' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    // The parked row is aged too, but its own status is no longer "open" so it never re-parks;
    // the done review with an outstanding tabId still reconciles.
    expect(actions).toContainEqual({
      kind: 'close-missed-done',
      domain: 'review',
      mrUrl: MR_URL,
      tabId: 'tab-2',
    });
    expect(actions).toHaveLength(1);
  });

  test('a done review with no tabId is untouched', () => {
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'done', tabId: undefined })],
      ]),
    });
    const actions = planSweep([], s, NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test("a done review with an already-cleared tabId ('', the merge-trap convention) never re-fires close-missed-done", () => {
    const s = states({
      reviews: new Map([[MR_URL, baseReview({ status: 'done', tabId: '' })]]),
    });
    const actions = planSweep([], s, NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('a non-done review with a tabId is untouched', () => {
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'reviewing', tabId: 'tab-3' })],
      ]),
    });
    const actions = planSweep([], s, NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('combines park and close-missed-done actions across different MRs', () => {
    const rows = [
      baseRow({ subject: `mr:${MR_URL}`, openedAt: NOW - GRACE_MS - 1 }),
    ];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'reviewing', tabId: 'tab-1' })],
        [
          OTHER_MR_URL,
          baseReview({ mrUrl: OTHER_MR_URL, status: 'done', tabId: 'tab-2' }),
        ],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toContainEqual({
      kind: 'park',
      domain: 'review',
      mrUrl: MR_URL,
      tabId: 'tab-1',
      gateId: 'gate-1',
    });
    expect(actions).toContainEqual({
      kind: 'close-missed-done',
      domain: 'review',
      mrUrl: OTHER_MR_URL,
      tabId: 'tab-2',
    });
    expect(actions).toHaveLength(2);
  });

  // ── kind-aware coverage: park and close-missed-done never cross domains ──

  test('an aged open doctor-escalation row parks against the doctor tab, joined from doctor state', () => {
    const rows = [
      baseRow({ kind: 'doctor-escalation', openedAt: NOW - GRACE_MS - 1 }),
    ];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'reviewing', tabId: 'review-tab' })],
      ]),
      doctors: new Map([
        [MR_URL, baseDoctor({ status: 'fixing', tabId: 'doctor-tab' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'park',
        domain: 'doctor',
        mrUrl: MR_URL,
        tabId: 'doctor-tab',
        gateId: 'gate-1',
      },
    ]);
  });

  test('sweep parks an aged doctor row and closes the doctor tab, while a live review gate on the same MR survives', () => {
    const rows = [
      baseRow({
        id: 'gate-review',
        kind: 'review-post',
        status: 'open',
        openedAt: NOW,
      }),
      baseRow({
        id: 'gate-doctor',
        kind: 'doctor-escalation',
        status: 'open',
        openedAt: NOW - GRACE_MS - 1,
      }),
    ];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'reviewing', tabId: 'review-tab' })],
      ]),
      doctors: new Map([
        [MR_URL, baseDoctor({ status: 'fixing', tabId: 'doctor-tab' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'park',
        domain: 'doctor',
        mrUrl: MR_URL,
        tabId: 'doctor-tab',
        gateId: 'gate-doctor',
      },
    ]);
  });

  test('close-missed-done fires for a done review even with an open respond gate on the same MR', () => {
    const rows = [
      baseRow({
        id: 'gate-respond',
        kind: 'respond-plan',
        status: 'open',
        openedAt: NOW,
      }),
    ];
    const s = states({
      reviews: new Map([
        [MR_URL, baseReview({ status: 'done', tabId: 'review-tab' })],
      ]),
      responds: new Map([
        [MR_URL, baseRespond({ status: 'triaging', tabId: 'respond-tab' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'close-missed-done',
        domain: 'review',
        mrUrl: MR_URL,
        tabId: 'review-tab',
      },
    ]);
  });

  test('a done respond with an open respond-post row does not close-missed-done', () => {
    const rows = [
      baseRow({ kind: 'respond-post', status: 'open', openedAt: NOW }),
    ];
    const s = states({
      responds: new Map([
        [MR_URL, baseRespond({ status: 'done', tabId: 'respond-tab' })],
      ]),
    });
    const actions = planSweep(rows, s, NOW, GRACE_MS);
    expect(actions).toEqual([]);
  });

  test('a done doctor with a tabId and no open doctor row yields close-missed-done for the doctor domain', () => {
    const s = states({
      doctors: new Map([
        [MR_URL, baseDoctor({ status: 'done', tabId: 'doctor-tab' })],
      ]),
    });
    const actions = planSweep([], s, NOW, GRACE_MS);
    expect(actions).toEqual([
      {
        kind: 'close-missed-done',
        domain: 'doctor',
        mrUrl: MR_URL,
        tabId: 'doctor-tab',
      },
    ]);
  });

  test('planSweep reports an unknown kind through the callback instead of pure silence', () => {
    const rows = [
      baseRow({ kind: 'mystery-kind', status: 'open', openedAt: 0 }),
    ];
    const s = { reviews: new Map(), responds: new Map(), doctors: new Map() };
    const unknown: string[] = [];
    planSweep(rows, s, 10_000_000, 1, r => unknown.push(r.kind));
    expect(unknown).toEqual(['mystery-kind']);
  });

  test('planSweep never reports an unknown kind that is already answered or closed', () => {
    const rows = [
      baseRow({
        id: 'gate-answered',
        kind: 'mystery-kind',
        status: 'answered',
      }),
      baseRow({ id: 'gate-closed', kind: 'mystery-kind', status: 'closed' }),
    ];
    const s = { reviews: new Map(), responds: new Map(), doctors: new Map() };
    const unknown: string[] = [];
    planSweep(rows, s, 10_000_000, 1, r => unknown.push(r.id));
    expect(unknown).toEqual([]);
  });

  test('planSweep reports a parked unknown kind, not just open', () => {
    const rows = [
      baseRow({ id: 'gate-parked', kind: 'mystery-kind', status: 'parked' }),
    ];
    const s = { reviews: new Map(), responds: new Map(), doctors: new Map() };
    const unknown: string[] = [];
    planSweep(rows, s, 10_000_000, 1, r => unknown.push(r.id));
    expect(unknown).toEqual(['gate-parked']);
  });

  test('planSweep dedups an unknown kind across repeated passes sharing the same seen-set', () => {
    const rows = [
      baseRow({ id: 'gate-mystery', kind: 'mystery-kind', status: 'open' }),
    ];
    const s = { reviews: new Map(), responds: new Map(), doctors: new Map() };
    const seen = new Set<string>();
    const unknown: string[] = [];
    const report = (r: { id: string }) => unknown.push(r.id);
    planSweep(rows, s, 10_000_000, 1, report, seen);
    planSweep(rows, s, 10_000_000, 1, report, seen);
    planSweep(rows, s, 10_000_000, 1, report, seen);
    expect(unknown).toEqual(['gate-mystery']);
  });

  test('planSweep re-reports the same unknown gate id when given a fresh seen-set', () => {
    const rows = [
      baseRow({ id: 'gate-mystery', kind: 'mystery-kind', status: 'open' }),
    ];
    const s = { reviews: new Map(), responds: new Map(), doctors: new Map() };
    const unknown: string[] = [];
    const report = (r: { id: string }) => unknown.push(r.id);
    planSweep(rows, s, 10_000_000, 1, report, new Set());
    planSweep(rows, s, 10_000_000, 1, report, new Set());
    expect(unknown).toEqual(['gate-mystery', 'gate-mystery']);
  });
});

describe('pruneOffBoardGates', () => {
  function makeIo() {
    const calls: Array<{ id: string; reason: string }> = [];
    const errors: string[] = [];
    return {
      calls,
      errors,
      gateClose: async (payload: {
        id: string;
        reason: 'abandoned' | 'superseded' | 'pruned';
      }) => {
        calls.push({ id: payload.id, reason: payload.reason });
        return { ok: true, data: { ok: true as const } };
      },
      logError: (message: string) => {
        errors.push(message);
      },
    };
  }

  test('closes off-board open and parked rows with reason pruned', async () => {
    const rows = [
      baseRow({ id: 'g-open', subject: `mr:${MR_URL}`, status: 'open' }),
      baseRow({
        id: 'g-parked',
        subject: `mr:${OTHER_MR_URL}`,
        status: 'parked',
      }),
    ];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set(), io);
    expect(io.calls).toEqual([
      { id: 'g-open', reason: 'pruned' },
      { id: 'g-parked', reason: 'pruned' },
    ]);
  });

  test('leaves on-board rows untouched', async () => {
    const rows = [
      baseRow({ id: 'g-open', subject: `mr:${MR_URL}`, status: 'open' }),
    ];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set([MR_URL]), io);
    expect(io.calls).toEqual([]);
  });

  test('skips answered and closed rows, even off-board', async () => {
    const rows = [
      baseRow({
        id: 'g-answered',
        subject: `mr:${MR_URL}`,
        status: 'answered',
      }),
      baseRow({
        id: 'g-closed',
        subject: `mr:${OTHER_MR_URL}`,
        status: 'closed',
      }),
    ];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set(), io);
    expect(io.calls).toEqual([]);
  });

  test('skips non-mr: subjects', async () => {
    const rows = [
      baseRow({ id: 'g-peer', subject: 'peer:something', status: 'open' }),
    ];
    const io = makeIo();
    await pruneOffBoardGates(rows, new Set(), io);
    expect(io.calls).toEqual([]);
  });

  test('a rejecting gateClose is logged and the loop continues', async () => {
    const rows = [
      baseRow({ id: 'g-fail', subject: `mr:${MR_URL}`, status: 'open' }),
      baseRow({ id: 'g-ok', subject: `mr:${OTHER_MR_URL}`, status: 'open' }),
    ];
    const calls: string[] = [];
    const errors: string[] = [];
    const io = {
      gateClose: async (payload: {
        id: string;
        reason: 'abandoned' | 'superseded' | 'pruned';
      }) => {
        calls.push(payload.id);
        if (payload.id === 'g-fail') throw new Error('boom');
        return { ok: true, data: { ok: true as const } };
      },
      logError: (message: string) => {
        errors.push(message);
      },
    };
    await expect(
      pruneOffBoardGates(rows, new Set(), io)
    ).resolves.toBeUndefined();
    expect(calls).toEqual(['g-fail', 'g-ok']);
    expect(errors).toHaveLength(1);
  });
});
