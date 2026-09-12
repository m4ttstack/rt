import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { ExecutorView } from '../client/types.ts';
import { joinExecutorOrphans, joinGateExecutors } from '../data.ts';
import {
  buildQueueExtras,
  ingestRelayFrame,
  reconcileAttentionGatesOnBoot,
  type GateCacheTarget,
  type GateReconcileTarget,
} from '../gates/ingest.ts';

function fakeRow(overrides: Partial<FacilityGateRow> = {}): FacilityGateRow {
  return {
    id: 'gate-1',
    subject: 'agent:pane-1',
    kind: 'pane-attention',
    questions: [],
    meta: { agentId: 'agent-1', paneRef: 'pane-1', reason: 'blocked' },
    context: null,
    origin: null,
    status: 'open',
    answer: null,
    openedAt: 1000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    supersededBy: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    owner: 'human',
    escalatedAt: null,
    ...overrides,
  };
}

function executorView(overrides: Partial<ExecutorView> = {}): ExecutorView {
  return {
    agentId: 'agent-1',
    repo: 'acme/webapp',
    subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
    surface: 'herdr',
    sessionId: 'sess-1',
    paneRef: 'pane-1',
    state: 'blocked',
    since: 1000,
    openGateIds: ['gate-1'],
    ...overrides,
  };
}

describe('buildQueueExtras', () => {
  test('a pane-attention gate with owner human lands in queueExtras', () => {
    const row = fakeRow({ owner: 'human' });
    const extras = buildQueueExtras([row]);
    expect(extras).toHaveLength(1);
    expect(extras[0]?.gateId).toBe('gate-1');
    expect(extras[0]?.kind).toBe('pane-attention');
    expect(extras[0]?.subject).toBe('agent:pane-1');
  });

  test('an unescalated herd-owned pane-attention gate is excluded entirely', () => {
    const row = fakeRow({ owner: 'herd:acme', escalatedAt: null });
    expect(buildQueueExtras([row])).toEqual([]);
  });

  test('an escalated herd-owned gate is admitted, marked with escalatedAt', () => {
    const row = fakeRow({ owner: 'herd:acme', escalatedAt: 6000 });
    const extras = buildQueueExtras([row]);
    expect(extras).toHaveLength(1);
    expect(extras[0]?.escalatedAt).toBe(6000);
  });

  test('an escalated herd-owned "mr:"-subject gate stays excluded by prefix', () => {
    const row = fakeRow({
      owner: 'herd:acme',
      escalatedAt: 6000,
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/999',
    });
    expect(buildQueueExtras([row])).toEqual([]);
  });

  test('an owner-less (null) gate is excluded -- only explicit human ownership qualifies', () => {
    const row = fakeRow({ owner: null });
    expect(buildQueueExtras([row])).toEqual([]);
  });

  test('a human-owned "mr:"-subject gate is excluded by prefix, even with no matching MR row', () => {
    // Regression: admission is by subject PREFIX, not by "no MR row
    // currently matches it". An ordinary review-post gate whose MR merged
    // or closed out of the polled snapshot while the gate stayed open must
    // never leak into queueExtras as a non-MR item -- it stays excluded on
    // prefix alone and attaches (or fails to) through the normal MR join.
    const row = fakeRow({
      owner: 'human',
      kind: 'review-post',
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/999',
    });
    expect(buildQueueExtras([row])).toEqual([]);
  });

  test('a human-owned gate of any kind (not just pane-attention) with a non-mr: subject lands in queueExtras', () => {
    const row = fakeRow({
      owner: 'human',
      kind: 'some-other-kind',
      subject: 'agent:pane-9',
    });
    const extras = buildQueueExtras([row]);
    expect(extras).toHaveLength(1);
  });

  test('a closed row never lands in queueExtras', () => {
    const row = fakeRow({
      owner: 'human',
      status: 'closed',
      closedReason: 'abandoned',
    });
    expect(buildQueueExtras([row])).toEqual([]);
  });

  test('an answered row left execution "unassigned" surfaces the field, which is what needsQueue admits it on', () => {
    const row = {
      ...fakeRow({
        owner: 'human',
        status: 'answered',
        answer: { answers: { verdict: 'approve' }, by: 'pane', answeredAt: 5 },
      }),
      // Not on the facility's own typed GateRow yet (SDD
      // executor-reconciler): the daemon already emits this on the wire.
      execution: 'unassigned',
    } as unknown as FacilityGateRow;
    const extras = buildQueueExtras([row]);
    expect(extras).toHaveLength(1);
    expect(extras[0]?.execution).toBe('unassigned');
  });

  test('an answered row stuck on delivery surfaces the delivery field', () => {
    const row = {
      ...fakeRow({
        owner: 'human',
        status: 'answered',
        answer: { answers: { verdict: 'approve' }, by: 'pane', answeredAt: 5 },
      }),
      delivery: { outcome: 'stuck', at: 3000 },
    } as unknown as FacilityGateRow;
    const extras = buildQueueExtras([row]);
    expect(extras).toHaveLength(1);
    expect(extras[0]?.delivery).toEqual({ outcome: 'stuck', at: 3000 });
  });
});

describe('ingestRelayFrame: pane-attention widening', () => {
  function fakeCache(): { target: GateCacheTarget; applied: unknown[] } {
    const applied: unknown[] = [];
    return { target: { applyEvent: frame => applied.push(frame) }, applied };
  }

  test('a pane-attention frame with a non-mr: subject is applied to the cache', () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(
      target,
      {
        topic: 'gate/opened/g1',
        payload: { subject: 'agent:pane-1', kind: 'pane-attention' },
      },
      () => notified++
    );
    expect(applied).toHaveLength(1);
    expect(notified).toBe(1);
  });

  test('a non-attention frame with a non-mr: subject is still ignored', () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(
      target,
      {
        topic: 'gate/opened/g1',
        payload: { subject: 'run:abc', kind: 'self-review' },
      },
      () => notified++
    );
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });

  test('an mr: subject frame is still applied regardless of kind (unchanged behavior)', () => {
    const { target, applied } = fakeCache();
    ingestRelayFrame(
      target,
      {
        topic: 'gate/opened/g1',
        payload: {
          subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
        },
      },
      () => {}
    );
    expect(applied).toHaveLength(1);
  });
});

describe('reconcileAttentionGatesOnBoot', () => {
  test('pages gateList by kind: pane-attention with no subjectPrefix, reconciling gathered rows', async () => {
    const calls: unknown[] = [];
    const list = async (payload: unknown) => {
      calls.push(payload);
      return { ok: true, data: { gates: [fakeRow()], cursor: 1 } };
    };
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = {
      reconcile: rows => reconciled.push(rows),
    };

    await reconcileAttentionGatesOnBoot(list, cache);

    expect(calls).toEqual([
      { kind: 'pane-attention', cursor: undefined, limit: 200 },
    ]);
    expect(reconciled).toEqual([[fakeRow()]]);
  });

  test('a failed page stops paging without throwing', async () => {
    const list = async () => ({ ok: false, error: 'boom' });
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = {
      reconcile: rows => reconciled.push(rows),
    };

    await expect(
      reconcileAttentionGatesOnBoot(list, cache)
    ).resolves.toBeUndefined();
    expect(reconciled).toEqual([[]]);
  });
});

describe('joinGateExecutors', () => {
  test('a gate whose id appears in an executor openGateIds gets that executor state', () => {
    const gates = [{ gateId: 'gate-1', kind: 'review-post' }];
    const [joined] = joinGateExecutors(gates, [executorView()]);
    expect(joined?.executor).toBe('blocked');
  });

  test('a gate with no matching executor is left untouched (no executor field)', () => {
    const gates = [{ gateId: 'gate-2', kind: 'review-post' }];
    const [joined] = joinGateExecutors(gates, [executorView()]);
    expect(joined?.executor).toBeUndefined();
  });

  test('an executor with multiple openGateIds tags every one of them', () => {
    const gates = [
      { gateId: 'gate-1', kind: 'review-post' },
      { gateId: 'gate-2', kind: 'respond-plan' },
    ];
    const [g1, g2] = joinGateExecutors(gates, [
      executorView({ openGateIds: ['gate-1', 'gate-2'], state: 'live' }),
    ]);
    expect(g1?.executor).toBe('live');
    expect(g2?.executor).toBe('live');
  });
});

describe('joinExecutorOrphans', () => {
  test("an ExecutorView with state 'gone' and a subject matching an MR row attaches to that row as orphan", () => {
    const executor = executorView({
      state: 'gone',
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
    });
    const mrs = [
      { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1' },
    ];
    const { mrs: joined, orphans } = joinExecutorOrphans(mrs, [executor]);
    expect(joined[0]?.orphan).toEqual(executor);
    expect(orphans).toEqual([]);
  });

  test("a 'gone' ExecutorView matching no MR row lands in top-level orphans instead", () => {
    const executor = executorView({
      state: 'gone',
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/999',
    });
    const mrs = [
      { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1' },
    ];
    const { mrs: joined, orphans } = joinExecutorOrphans(mrs, [executor]);
    expect(joined[0]?.orphan).toBeUndefined();
    expect(orphans).toEqual([executor]);
  });

  test("a 'hidden' ExecutorView matching an MR row attaches as orphan too", () => {
    const executor = executorView({
      state: 'hidden',
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
    });
    const mrs = [
      { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1' },
    ];
    const { mrs: joined, orphans } = joinExecutorOrphans(mrs, [executor]);
    expect(joined[0]?.orphan).toEqual(executor);
    expect(orphans).toEqual([]);
  });

  test("a 'hidden' ExecutorView matching no MR row is dropped entirely (not in orphans either)", () => {
    const executor = executorView({
      state: 'hidden',
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/999',
    });
    const mrs = [
      { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1' },
    ];
    const { mrs: joined, orphans } = joinExecutorOrphans(mrs, [executor]);
    expect(joined[0]?.orphan).toBeUndefined();
    expect(orphans).toEqual([]);
  });

  test("a 'live' ExecutorView is never treated as an orphan candidate", () => {
    const executor = executorView({
      state: 'live',
      subject: 'mr:https://gitlab.com/acme/webapp/-/merge_requests/1',
    });
    const mrs = [
      { webUrl: 'https://gitlab.com/acme/webapp/-/merge_requests/1' },
    ];
    const { mrs: joined, orphans } = joinExecutorOrphans(mrs, [executor]);
    expect(joined[0]?.orphan).toBeUndefined();
    expect(orphans).toEqual([]);
  });

  test('an MR row with no webUrl is left untouched without throwing', () => {
    const executor = executorView({ state: 'gone', subject: null });
    const mrs = [{ webUrl: null }];
    expect(() => joinExecutorOrphans(mrs, [executor])).not.toThrow();
    const { mrs: joined, orphans } = joinExecutorOrphans(mrs, [executor]);
    expect(joined[0]?.orphan).toBeUndefined();
    // No subject at all -- can't match an MR row, but a "gone" executor
    // still needs surfacing somewhere, so it lands in the top-level
    // orphans leftover (unlike an unmatched "hidden", which really is
    // dropped -- see the "hidden ... matching no MR row" test above).
    expect(orphans).toEqual([executor]);
  });
});
