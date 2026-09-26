import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { Member } from '../config.ts';
import type { BoardMR } from '../data.ts';
import { GateCache } from '../gates/cache.ts';
import { decisionBadge, decisionGates } from '../gates/decision.ts';
import { RunMrResolver } from '../gates/run-mr.ts';

const NOW = 10_000_000;
const MR_URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/301';
const RUN_ID = '20260925-090000-aaaa-1111';
const ALICE: Member = { username: 'alice' };

function mr(username: string, webUrl = MR_URL): BoardMR {
  return {
    webUrl,
    author: { id: username, username, name: null, avatarUrl: null },
    codeownerSections: [],
  } as unknown as BoardMR;
}

function row(overrides: Partial<FacilityGateRow>): FacilityGateRow {
  return {
    id: 'g1',
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: NOW - 1000,
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
    context: null,
    origin: null,
    ...overrides,
  } as FacilityGateRow;
}

function cacheOf(...rows: FacilityGateRow[]): GateCache {
  const cache = new GateCache();
  for (const r of rows) cache.applyRow(r);
  return cache;
}

/** A resolver whose `runs:get` already answered: the run recorded MR_URL. */
async function resolvedRunMrs(cache: GateCache): Promise<RunMrResolver> {
  const runMrs = new RunMrResolver({
    getRun: async () =>
      ({
        ok: true,
        data: {
          run: {},
          stages: [],
          fields: [{ key: 'mr', value: MR_URL, produced_by: 'ship', at: 1 }],
          decisions: [],
          schemaAhead: false,
        },
      }) as never,
  });
  runMrs.links(cache.rows());
  await runMrs.settled();
  return runMrs;
}

const runGate = row({ id: 'g-run', subject: `run:${RUN_ID}` });

describe('decisionBadge', () => {
  test('a run gate linked to a visible MR is counted once', async () => {
    const cache = cacheOf(runGate);
    const runMrs = await resolvedRunMrs(cache);

    expect(decisionBadge([mr('alice')], [ALICE], cache, runMrs, NOW)).toEqual({
      count: 1,
      path: '/?gate=g-run',
      ids: ['g-run'],
    });
  });

  test("a run gate linked to a hidden member's MR is not counted", async () => {
    const cache = cacheOf(runGate);
    const runMrs = await resolvedRunMrs(cache);

    expect(decisionBadge([mr('alice')], [], cache, runMrs, NOW)).toEqual({
      count: 0,
    });
  });

  test('counts exactly the open gates the decision queue shows', async () => {
    const cache = cacheOf(
      runGate,
      row({ id: 'g-mr', kind: 'review-plan' }),
      row({
        id: 'g-attention',
        subject: 'agent:a1',
        kind: 'pane-attention',
        openedAt: 0,
      }),
      row({ id: 'g-answered', kind: 'respond-post', status: 'answered' })
    );
    const runMrs = await resolvedRunMrs(cache);
    const mrs = [mr('alice')];

    const queue = decisionGates(mrs, [ALICE], cache, runMrs);
    const shown = [...queue.mrs.flatMap(m => m.gates), ...queue.queueExtras]
      .filter(g => g.status === 'open')
      .map(g => g.gateId)
      .sort();

    expect(shown).toEqual(['g-attention', 'g-mr', 'g-run']);
    expect(decisionBadge(mrs, [ALICE], cache, runMrs, NOW).ids?.sort()).toEqual(
      shown
    );
  });
});
