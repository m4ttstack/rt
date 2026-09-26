import { describe, expect, test } from 'bun:test';

import type {
  GateRow as FacilityGateRow,
  RtResponse,
  RunDetail,
  RunFieldRow,
} from '@mattstack/rt-client';
import {
  isHumanOwned,
  isLiveRunGate,
  mrUrlFromRun,
  normalizeMrUrl,
  runIdOf,
  RunMrResolver,
} from '../gates/run-mr.ts';

const MR_1 = 'https://gitlab.example.com/acme/webapp/-/merge_requests/101';
const MR_2 = 'https://gitlab.example.com/acme/webapp/-/merge_requests/202';

function gate(overrides: Partial<FacilityGateRow> = {}): FacilityGateRow {
  return {
    id: 'gate-run-1',
    subject: 'run:20260923-100000-aaaa-1111',
    kind: 'clarify',
    questions: [
      { id: 'verify', label: 'How to verify?', multi: false, options: ['a'] },
    ],
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
    owner: 'human',
    escalatedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function field(key: string, value: string, at: number): RunFieldRow {
  return { key, value, produced_by: 'ship', at };
}

function detail(fields: RunFieldRow[]): RunDetail {
  return {
    run: {} as RunDetail['run'],
    stages: [],
    fields,
    decisions: [],
    schemaAhead: false,
  };
}

function ok(data: RunDetail): RtResponse<RunDetail> {
  return { ok: true, data } as RtResponse<RunDetail>;
}

/** A fake `runs:get` over a mutable run table, counting calls per run. */
function fakeRuns(table: Record<string, RunFieldRow[]>) {
  const calls: string[] = [];
  return {
    calls,
    table,
    getRun: async (runId: string): Promise<RtResponse<RunDetail>> => {
      calls.push(runId);
      const fields = table[runId];
      if (!fields)
        return { ok: false, error: 'run not found' } as RtResponse<RunDetail>;
      return ok(detail(fields));
    },
  };
}

describe('runIdOf', () => {
  test('a run: subject yields its run id', () => {
    expect(runIdOf('run:20260923-100000-aaaa-1111')).toBe(
      '20260923-100000-aaaa-1111'
    );
  });

  test('any other subject, or an empty run id, yields null', () => {
    expect(runIdOf(`mr:${MR_1}`)).toBeNull();
    expect(runIdOf('agent:pane-1')).toBeNull();
    expect(runIdOf('run:')).toBeNull();
  });
});

describe('mrUrlFromRun', () => {
  test("reads the run's mr field", () => {
    expect(mrUrlFromRun(detail([field('mr', MR_1, 5)]))).toBe(MR_1);
  });

  test('the latest mr field wins when the run recorded more than one', () => {
    expect(
      mrUrlFromRun(detail([field('mr', MR_2, 9), field('mr', MR_1, 5)]))
    ).toBe(MR_2);
  });

  test('a cleared (-) or missing mr field is no MR', () => {
    expect(mrUrlFromRun(detail([field('mr', '-', 5)]))).toBeNull();
    expect(mrUrlFromRun(detail([field('branch', 'fix-it', 5)]))).toBeNull();
  });

  test('a trailing slash is dropped', () => {
    expect(mrUrlFromRun(detail([field('mr', `${MR_1}/`, 5)]))).toBe(MR_1);
    expect(normalizeMrUrl(`${MR_1}//`)).toBe(MR_1);
  });
});

describe('isHumanOwned / isLiveRunGate', () => {
  test("a human-owned gate, or an escalated herd gate, is the human's", () => {
    expect(isHumanOwned(gate())).toBe(true);
    expect(
      isHumanOwned(gate({ owner: 'herd:acme-batch', escalatedAt: 5 }))
    ).toBe(true);
  });

  test('a herd gate its shepherd still owns, or an owner-less one, is not', () => {
    expect(isHumanOwned(gate({ owner: 'herd:acme-batch' }))).toBe(false);
    expect(isHumanOwned(gate({ owner: null }))).toBe(false);
  });

  test('only an open or parked run gate is live', () => {
    expect(isLiveRunGate(gate())).toBe(true);
    expect(isLiveRunGate(gate({ status: 'parked' }))).toBe(true);
    expect(isLiveRunGate(gate({ status: 'answered' }))).toBe(false);
    expect(isLiveRunGate(gate({ status: 'closed' }))).toBe(false);
    expect(isLiveRunGate(gate({ subject: `mr:${MR_1}` }))).toBe(false);
  });
});

const TTL = { hitMs: 5000, missMs: 1000 };

/** A resolver over `runs` with a hand-set clock and a change counter. */
function resolverFor(runs: ReturnType<typeof fakeRuns>) {
  const state = { clock: 0, changes: 0 };
  const resolver = new RunMrResolver(
    {
      getRun: runs.getRun,
      now: () => state.clock,
      onChange: () => state.changes++,
    },
    TTL
  );
  return { resolver, state };
}

/** Kicks off lookups, lets them land, and reads the links they produced. */
async function settle(resolver: RunMrResolver, rows: FacilityGateRow[]) {
  resolver.links(rows);
  await resolver.settled();
  return resolver.links(rows);
}

describe('RunMrResolver.links', () => {
  test('a live run gate links its run to the MR the run recorded', async () => {
    const runs = fakeRuns({ 'run-a': [field('mr', MR_1, 5)] });
    const { resolver } = resolverFor(runs);
    const links = await settle(resolver, [gate({ subject: 'run:run-a' })]);
    expect([...links]).toEqual([[MR_1, ['run-a']]]);
  });

  test('never waits on the daemon: a hung lookup returns cached links at once', async () => {
    const pending: Array<() => void> = [];
    let changes = 0;
    const resolver = new RunMrResolver({
      getRun: () =>
        new Promise(resolve => {
          pending.push(() => resolve(ok(detail([field('mr', MR_1, 5)]))));
        }),
      onChange: () => changes++,
    });
    const rows = [gate({ subject: 'run:run-a' })];

    const first = resolver.links(rows);
    expect(first).toBeInstanceOf(Map);
    expect(first.size).toBe(0);
    expect(resolver.links(rows).size).toBe(0);
    expect(pending).toHaveLength(1);
    expect(changes).toBe(0);

    pending[0]!();
    await resolver.settled();
    expect(changes).toBe(1);
    expect(resolver.links(rows).get(MR_1)).toEqual(['run-a']);
  });

  test('two runs on one MR both link to it; two gates on one run ask once', async () => {
    const runs = fakeRuns({
      'run-a': [field('mr', MR_1, 5)],
      'run-b': [field('mr', MR_1, 6)],
    });
    const { resolver, state } = resolverFor(runs);
    const links = await settle(resolver, [
      gate({ id: 'g1', subject: 'run:run-a', kind: 'clarify' }),
      gate({ id: 'g2', subject: 'run:run-a', kind: 'ship' }),
      gate({ id: 'g3', subject: 'run:run-b' }),
    ]);
    expect(links.get(MR_1)).toEqual(['run-a', 'run-b']);
    expect(runs.calls.sort()).toEqual(['run-a', 'run-b']);
    expect(state.changes).toBe(2);
  });

  test('a run with no MR, an unknown run, and a throwing daemon link nothing and nudge nobody', async () => {
    const runs = fakeRuns({ 'run-nomr': [field('branch', 'fix-it', 5)] });
    let changes = 0;
    const resolver = new RunMrResolver({
      getRun: async runId => {
        if (runId === 'run-boom') throw new Error('socket closed');
        return runs.getRun(runId);
      },
      onChange: () => changes++,
    });
    const links = await settle(resolver, [
      gate({ id: 'g1', subject: 'run:run-nomr' }),
      gate({ id: 'g2', subject: 'run:run-gone' }),
      gate({ id: 'g3', subject: 'run:run-boom' }),
    ]);
    expect(links.size).toBe(0);
    expect(changes).toBe(0);
  });

  test('gates that are not live never trigger a lookup', async () => {
    const runs = fakeRuns({ 'run-a': [field('mr', MR_1, 5)] });
    const { resolver } = resolverFor(runs);
    const links = await settle(resolver, [
      gate({ id: 'g1', subject: 'run:run-a', status: 'answered' }),
      gate({ id: 'g2', subject: 'run:run-a', status: 'closed' }),
      gate({ id: 'g3', subject: 'run:run-a', owner: 'herd:acme-batch' }),
      gate({ id: 'g4', subject: `mr:${MR_2}` }),
    ]);
    expect(links.size).toBe(0);
    expect(runs.calls).toEqual([]);
  });

  test('a found MR is served from cache until its TTL, then rechecked', async () => {
    const runs = fakeRuns({ 'run-a': [field('mr', MR_1, 5)] });
    const { resolver, state } = resolverFor(runs);
    const rows = [gate({ subject: 'run:run-a' })];
    await settle(resolver, rows);

    state.clock += TTL.hitMs - 1;
    expect(resolver.links(rows).get(MR_1)).toEqual(['run-a']);
    expect(runs.calls).toEqual(['run-a']);

    state.clock += 1;
    expect(resolver.links(rows).get(MR_1)).toEqual(['run-a']);
    await resolver.settled();
    expect(runs.calls).toEqual(['run-a', 'run-a']);
    expect(state.changes).toBe(1);
  });

  test('a recheck follows a run that moved to another MR, or cleared its MR', async () => {
    const runs = fakeRuns({ 'run-a': [field('mr', MR_1, 5)] });
    const { resolver, state } = resolverFor(runs);
    const rows = [gate({ subject: 'run:run-a' })];
    await settle(resolver, rows);

    runs.table['run-a'] = [field('mr', MR_1, 5), field('mr', MR_2, 9)];
    state.clock += TTL.hitMs;
    const moved = await settle(resolver, rows);
    expect([...moved]).toEqual([[MR_2, ['run-a']]]);
    expect(state.changes).toBe(2);

    runs.table['run-a'] = [field('mr', '-', 12)];
    state.clock += TTL.hitMs;
    expect((await settle(resolver, rows)).size).toBe(0);
    expect(state.changes).toBe(3);
  });

  test('a daemon error on a recheck keeps the last known MR', async () => {
    const runs = fakeRuns({ 'run-a': [field('mr', MR_1, 5)] });
    let down = false;
    let clock = 0;
    const resolver = new RunMrResolver(
      {
        getRun: async runId => {
          if (down)
            return {
              ok: false,
              error: 'rt daemon unreachable at /tmp/rt.sock',
            } as RtResponse<RunDetail>;
          return runs.getRun(runId);
        },
        now: () => clock,
      },
      TTL
    );
    const rows = [gate({ subject: 'run:run-a' })];
    await settle(resolver, rows);

    down = true;
    clock += TTL.hitMs;
    expect((await settle(resolver, rows)).get(MR_1)).toEqual(['run-a']);
  });

  test('a miss is retried once its TTL passes, picking up an MR the run recorded since', async () => {
    const runs = fakeRuns({ 'run-a': [field('branch', 'fix-it', 5)] });
    const { resolver, state } = resolverFor(runs);
    const rows = [gate({ subject: 'run:run-a' })];

    expect((await settle(resolver, rows)).size).toBe(0);
    runs.table['run-a'] = [field('mr', MR_1, 9)];
    state.clock += TTL.missMs - 1;
    expect((await settle(resolver, rows)).size).toBe(0);
    expect(runs.calls).toEqual(['run-a']);

    state.clock += 1;
    expect((await settle(resolver, rows)).get(MR_1)).toEqual(['run-a']);
    expect(runs.calls).toEqual(['run-a', 'run-a']);
    expect(state.changes).toBe(1);
  });

  test('a run whose gates settle is forgotten, so it is looked up afresh if one reopens', async () => {
    const runs = fakeRuns({ 'run-a': [field('mr', MR_1, 5)] });
    const { resolver } = resolverFor(runs);
    await settle(resolver, [gate({ subject: 'run:run-a' })]);
    resolver.links([gate({ subject: 'run:run-a', status: 'answered' })]);
    await settle(resolver, [gate({ subject: 'run:run-a' })]);
    expect(runs.calls).toEqual(['run-a', 'run-a']);
  });
});
