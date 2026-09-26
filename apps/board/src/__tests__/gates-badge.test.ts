import { describe, expect, test } from 'bun:test';

import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import {
  ATTENTION_MIN_AGE_MS,
  boardBadge,
  countsForBadge,
} from '../gates/badge.ts';
import { GateCache } from '../gates/cache.ts';
import { buildQueueExtras } from '../gates/ingest.ts';
import type { GateRow } from '../gates/store.ts';

const NOW = 10_000_000;

function gate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g1',
    subject: 'mr:https://x/-/merge_requests/1',
    kind: 'review-post',
    label: 'review-post',
    status: 'open',
    openedAt: NOW - 1000,
    questions: [],
    ...overrides,
  };
}

describe('countsForBadge', () => {
  test('open and parked human or unowned gates count', () => {
    expect(countsForBadge(gate(), NOW)).toBe(true);
    expect(countsForBadge(gate({ status: 'parked' }), NOW)).toBe(true);
    expect(countsForBadge(gate({ owner: 'human' }), NOW)).toBe(true);
  });

  test('answered gates never count, even unassigned or stuck', () => {
    expect(countsForBadge(gate({ status: 'answered' }), NOW)).toBe(false);
    expect(
      countsForBadge(gate({ status: 'answered', execution: 'unassigned' }), NOW)
    ).toBe(false);
    expect(
      countsForBadge(
        gate({ status: 'answered', delivery: { outcome: 'stuck', at: 1 } }),
        NOW
      )
    ).toBe(false);
  });

  test('herd-owned gates never count, escalated or not', () => {
    expect(countsForBadge(gate({ owner: 'herd:h1' }), NOW)).toBe(false);
    expect(
      countsForBadge(
        gate({
          owner: 'herd:h1',
          kind: 'pane-attention',
          subject: 'herd:h1/j',
          escalatedAt: 1,
          openedAt: 0,
        }),
        NOW
      )
    ).toBe(false);
  });

  test('pane-attention counts only once it is at least two minutes old', () => {
    const att = { kind: 'pane-attention', subject: 'agent:a1', owner: 'human' };
    expect(
      countsForBadge(
        gate({ ...att, openedAt: NOW - ATTENTION_MIN_AGE_MS + 1 }),
        NOW
      )
    ).toBe(false);
    expect(
      countsForBadge(
        gate({ ...att, openedAt: NOW - ATTENTION_MIN_AGE_MS }),
        NOW
      )
    ).toBe(true);
  });

  test('an open, human-owned run: gate counts; the tray dedupes it against console by id', () => {
    expect(
      countsForBadge(gate({ subject: 'run:r1', owner: 'human' }), NOW)
    ).toBe(true);
  });
});

describe('boardBadge', () => {
  test('reports the ids it counted, once each, oldest first', () => {
    const a = gate({ gateId: 'g-a', openedAt: NOW - 5000 });
    const b = gate({ gateId: 'g-b', openedAt: NOW - 9000, subject: 'run:r1' });
    expect(boardBadge([a, b, a], NOW)).toEqual({
      count: 2,
      path: '/?gate=g-b',
      ids: ['g-b', 'g-a'],
    });
  });

  test('an escalated herd-owned attention gate admitted to queueExtras is not counted', () => {
    const cache = new GateCache();
    cache.applyRow({
      id: 'g-herd',
      subject: 'herd:h1/job1',
      kind: 'pane-attention',
      questions: [],
      meta: null,
      status: 'open',
      answer: null,
      openedAt: 0,
      parkedAt: null,
      closedAt: null,
      closedReason: null,
      agent: null,
      pane: null,
      nudge: null,
      delivery: null,
      released: false,
      supersededBy: null,
      owner: 'herd:h1',
      escalatedAt: 5,
      consumedAt: null,
      context: null,
      origin: null,
    } as FacilityGateRow);
    const extras = buildQueueExtras(cache.rows());
    expect(extras).toHaveLength(1);
    expect(boardBadge(extras, NOW).count).toBe(0);
  });

  test('zero counted gates yields count 0 and no path', () => {
    expect(boardBadge([gate({ status: 'answered' })], NOW)).toEqual({
      count: 0,
    });
  });

  test('path points at the oldest counted gate', () => {
    const badge = boardBadge(
      [
        gate({ gateId: 'newer', openedAt: NOW - 10 }),
        gate({ gateId: 'older id', openedAt: NOW - 500 }),
      ],
      NOW
    );
    expect(badge).toEqual({
      count: 2,
      path: '/?gate=older%20id',
      ids: ['older id', 'newer'],
    });
  });
});
