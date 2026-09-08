import { describe, expect, test } from 'bun:test';

import {
  ensureEventBridgeRule,
  type EventBridgeRule,
} from '@mattstack/app-server/event-bridge';
import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import {
  boardBridgeRule,
  GATE_LIST_PAGE_LIMIT,
  ingestRelayFrame,
  reconcileGatesOnBoot,
  type GateCacheTarget,
  type GateReconcileTarget,
} from '../gates/ingest.ts';

function fakeCache(): { target: GateCacheTarget; applied: unknown[] } {
  const applied: unknown[] = [];
  return { target: { applyEvent: frame => applied.push(frame) }, applied };
}

function fakeNotify(): { notify: () => void; calls: number } {
  const state = { calls: 0 };
  return { notify: () => state.calls++, calls: state.calls };
}

describe('ingestRelayFrame', () => {
  test('a gate/** frame with an mr: subject applies to the cache and notifies', () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(
      target,
      {
        topic: 'gate/opened/g1',
        payload: {
          subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
        },
      },
      () => notified++
    );
    expect(applied).toHaveLength(1);
    expect(notified).toBe(1);
  });

  test('a gate/** frame with a non-mr: subject is ignored', () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(
      target,
      { topic: 'gate/opened/g1', payload: { subject: 'run:abc123' } },
      () => notified++
    );
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });

  test('a non-gate topic is ignored', () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(
      target,
      {
        topic: 'project-mrs',
        payload: {
          subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
        },
      },
      () => notified++
    );
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });

  test('a malformed payload is ignored without throwing', () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    expect(() =>
      ingestRelayFrame(
        target,
        { topic: 'gate/opened/g1', payload: null },
        () => notified++
      )
    ).not.toThrow();
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });
});

function fakeRow(id: string): FacilityGateRow {
  return {
    id,
    subject: `mr:https://gitlab.com/acme/webapp/-/merge_requests/${id}`,
    kind: 'review-post',
    questions: [],
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
  };
}

type FakeGateListResult =
  | { ok: true; data: { gates: FacilityGateRow[]; cursor: number } }
  | { ok: false; error: string };
type FakeGateListPayload = {
  subjectPrefix: string;
  cursor?: number;
  limit?: number;
};

function manyRows(n: number, offset = 0): FacilityGateRow[] {
  return Array.from({ length: n }, (_, i) => fakeRow(String(offset + i + 1)));
}

describe('reconcileGatesOnBoot', () => {
  test('pages gateList by cursor (limit 200) and reconciles all rows gathered', async () => {
    const calls: FakeGateListPayload[] = [];
    const page1 = manyRows(GATE_LIST_PAGE_LIMIT, 0);
    const page2 = manyRows(3, GATE_LIST_PAGE_LIMIT);
    // Real daemon shape: cursor is non-zero on every page, including the
    // last, partial one -- it becomes the store's max rowid there.
    const list = async (
      payload: FakeGateListPayload
    ): Promise<FakeGateListResult> => {
      calls.push(payload);
      if (!payload.cursor)
        return {
          ok: true,
          data: { gates: page1, cursor: GATE_LIST_PAGE_LIMIT },
        };
      return {
        ok: true,
        data: { gates: page2, cursor: GATE_LIST_PAGE_LIMIT + 3 },
      };
    };
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = {
      reconcile: rows => reconciled.push(rows),
    };

    await reconcileGatesOnBoot(list, cache);

    expect(calls).toEqual([
      { subjectPrefix: 'mr:', cursor: undefined, limit: GATE_LIST_PAGE_LIMIT },
      {
        subjectPrefix: 'mr:',
        cursor: GATE_LIST_PAGE_LIMIT,
        limit: GATE_LIST_PAGE_LIMIT,
      },
    ]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toHaveLength(GATE_LIST_PAGE_LIMIT + 3);
  });

  test('a single partial page (fewer rows than the limit, cursor still non-zero) reconciles once with no further calls', async () => {
    const list = async (): Promise<FakeGateListResult> => ({
      ok: true,
      data: { gates: [fakeRow('1')], cursor: 1 },
    });
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = {
      reconcile: rows => reconciled.push(rows),
    };

    await reconcileGatesOnBoot(list, cache);

    expect(reconciled).toEqual([[fakeRow('1')]]);
  });

  test('regression: a non-zero cursor on the last page never spins forever -- a repeat call with 0 rows and the same cursor terminates the loop', async () => {
    let calls = 0;
    const list = async (
      payload: FakeGateListPayload
    ): Promise<FakeGateListResult> => {
      calls++;
      // A full first page, then the daemon's real "nothing more" shape: 0
      // rows, cursor unchanged from what was just sent.
      if (!payload.cursor)
        return {
          ok: true,
          data: { gates: manyRows(GATE_LIST_PAGE_LIMIT, 0), cursor: 500 },
        };
      return { ok: true, data: { gates: [], cursor: 500 } };
    };
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = {
      reconcile: rows => reconciled.push(rows),
    };

    await reconcileGatesOnBoot(list, cache);

    expect(calls).toBe(2);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toHaveLength(GATE_LIST_PAGE_LIMIT);
  });

  test('a failed page stops paging and reconciles whatever was gathered so far', async () => {
    const list = async (
      payload: FakeGateListPayload
    ): Promise<FakeGateListResult> => {
      if (!payload.cursor)
        return {
          ok: true,
          data: {
            gates: manyRows(GATE_LIST_PAGE_LIMIT, 0),
            cursor: GATE_LIST_PAGE_LIMIT,
          },
        };
      return { ok: false, error: 'boom' };
    };
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = {
      reconcile: rows => reconciled.push(rows),
    };

    await expect(reconcileGatesOnBoot(list, cache)).resolves.toBeUndefined();
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toHaveLength(GATE_LIST_PAGE_LIMIT);
  });
});

describe('boardBridgeRule', () => {
  const BOARD_URL = 'https://board.mattstack';
  const rule = boardBridgeRule(BOARD_URL);

  function fakeIo(initial: EventBridgeRule[]): {
    read: () => EventBridgeRule[];
    write: (next: EventBridgeRule[]) => void;
    writes: EventBridgeRule[][];
  } {
    let current = initial;
    const writes: EventBridgeRule[][] = [];
    return {
      read: () => current,
      write: next => {
        writes.push(next);
        current = next;
      },
      writes,
    };
  }

  test('rule matches the board contract: pattern, subjectPrefix, templates, and click-through url', () => {
    expect(rule).toEqual({
      pattern: 'gate/opened/*',
      subjectPrefix: 'mr:',
      category: 'gate',
      title: '{label}',
      message: '{question}',
      url: `${BOARD_URL}/?gate={id}`,
    });
  });

  test('neither rule present: the gate-opened rule is added', () => {
    const io = fakeIo([]);
    ensureEventBridgeRule(io.read, io.write, rule);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([rule]);
  });

  test('identical rule already present: unchanged, no duplicate written', () => {
    const io = fakeIo([rule]);
    ensureEventBridgeRule(io.read, io.write, rule);
    expect(io.writes).toHaveLength(0);
  });

  test('stale same-identity rule (old {subject} body, no url) is replaced in place', () => {
    const stale: EventBridgeRule = {
      pattern: 'gate/opened/*',
      subjectPrefix: 'mr:',
      category: 'gate',
      title: '{label}',
      message: '{subject}',
    };
    const io = fakeIo([stale]);
    ensureEventBridgeRule(io.read, io.write, rule);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([rule]);
  });

  test('old board/gate/opened/* legacy rule is removed when installing', () => {
    const legacy: EventBridgeRule = {
      pattern: 'board/gate/opened/*',
      category: 'gate',
      title: 'review gate: !{iid}',
      message: '{mrUrl}',
    };
    const io = fakeIo([legacy]);
    ensureEventBridgeRule(io.read, io.write, rule, {
      replacePatterns: ['board/gate/opened/*'],
    });
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([rule]);
  });

  test('unrelated entries are preserved alongside the appended rule', () => {
    const other: EventBridgeRule = {
      pattern: 'chat/mention/*',
      category: 'chat',
      title: 'mention',
      message: '{body}',
    };
    const io = fakeIo([other]);
    ensureEventBridgeRule(io.read, io.write, rule);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([other, rule]);
  });
});
