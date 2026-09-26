// @vitest-environment node
import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  ATTENTION_MIN_AGE_MS,
  countsForConsoleBadge,
  runGateMarker,
} from './gate-waiting';

function row(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1',
    subject: 'run:r1',
    kind: 'self-review',
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
    owner: null,
    escalatedAt: null,
    consumedAt: null,
    context: null,
    origin: null,
    ...overrides,
  } as GateRow;
}

describe('runGateMarker', () => {
  it('is blocked for an open or parked gate Matt owns', () => {
    expect(runGateMarker([row()], 'r1')).toBe('blocked');
    expect(
      runGateMarker([row({ status: 'parked', owner: 'human' })], 'r1')
    ).toBe('blocked');
  });
  it('is shepherd for a herd-owned waiting gate', () => {
    expect(runGateMarker([row({ owner: 'herd:h1' })], 'r1')).toBe('shepherd');
  });
  it('prefers blocked when both kinds wait on one run', () => {
    expect(
      runGateMarker(
        [row({ id: 'a', owner: 'herd:h1' }), row({ id: 'b', kind: 'plan' })],
        'r1'
      )
    ).toBe('blocked');
  });
  it('is null for answered gates and other runs', () => {
    expect(runGateMarker([row({ status: 'answered' })], 'r1')).toBeNull();
    expect(runGateMarker([row({ subject: 'run:other' })], 'r1')).toBeNull();
    expect(runGateMarker(undefined, 'r1')).toBeNull();
  });
});

describe('countsForConsoleBadge', () => {
  const now = 10_000_000;

  it('counts open and parked run gates Matt owns', () => {
    expect(countsForConsoleBadge(row(), now)).toBe(true);
    expect(countsForConsoleBadge(row({ status: 'parked' }), now)).toBe(true);
  });
  it('never counts herd-owned, answered, or non-run gates', () => {
    expect(countsForConsoleBadge(row({ owner: 'herd:h1' }), now)).toBe(false);
    expect(countsForConsoleBadge(row({ status: 'answered' }), now)).toBe(false);
    expect(countsForConsoleBadge(row({ subject: 'mr:https://x' }), now)).toBe(
      false
    );
  });
  it('excludes a young pane-attention gate', () => {
    const openedAt = now - (ATTENTION_MIN_AGE_MS - 1);
    expect(
      countsForConsoleBadge(row({ kind: 'pane-attention', openedAt }), now)
    ).toBe(false);
  });
  it('counts a pane-attention gate at exactly 2 minutes old', () => {
    const openedAt = now - ATTENTION_MIN_AGE_MS;
    expect(
      countsForConsoleBadge(row({ kind: 'pane-attention', openedAt }), now)
    ).toBe(true);
  });
});
