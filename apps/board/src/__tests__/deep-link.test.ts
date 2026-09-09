import { describe, expect, test } from 'bun:test';

import {
  gateParam,
  mrForGate,
  stripGateParam,
  viewStateForGate,
} from '../client/board/deep-link.ts';
import type { TabConfig } from '../config.ts';
import type { BoardMR } from '../data.ts';
import { DEFAULT_VIEW } from '../view.ts';

type GateLinkMR = BoardMR & { slack?: { posted?: boolean } | null };

function mr(overrides: Partial<GateLinkMR>): GateLinkMR {
  return {
    iid: 1,
    title: 'MR',
    author: { id: 'x', username: 'bob', name: 'Bob', avatarUrl: null },
    codeownerSections: [],
    ...overrides,
  } as unknown as GateLinkMR;
}

describe('gateParam', () => {
  test('reads gate from a query string', () => {
    expect(gateParam('?gate=abc123')).toBe('abc123');
  });

  test('reads gate alongside other params', () => {
    expect(gateParam('?member=alice&gate=abc123&tab=mine')).toBe('abc123');
  });

  test('returns null when gate is absent', () => {
    expect(gateParam('?member=alice')).toBeNull();
  });

  test('returns null for an empty search string', () => {
    expect(gateParam('')).toBeNull();
  });

  test('returns null when gate is present but empty', () => {
    expect(gateParam('?gate=')).toBeNull();
  });
});

describe('mrForGate', () => {
  const mrs = [
    { iid: 1, gates: [{ gateId: 'g1' }] },
    { iid: 2, gates: [{ gateId: 'g2' }, { gateId: 'g3' }] },
    { iid: 3 },
  ];

  test('finds the iid whose gates carry the id', () => {
    expect(mrForGate(mrs, 'g1')).toBe(1);
  });

  test('finds the iid among multiple gates on one row', () => {
    expect(mrForGate(mrs, 'g3')).toBe(2);
  });

  test('returns null when no row carries the gate', () => {
    expect(mrForGate(mrs, 'missing')).toBeNull();
  });

  test('returns null when a row has no gates array at all', () => {
    expect(mrForGate(mrs, 'g4')).toBeNull();
  });
});

describe('viewStateForGate', () => {
  const teamTab: TabConfig = {
    id: 'team',
    label: 'Team',
    source: { kind: 'authors' },
  };
  const designTab: TabConfig = {
    id: 'design',
    label: 'Design',
    source: { kind: 'codeowners', section: 'design' },
  };

  test('widens member to all when the current pick hides the row', () => {
    const mrs = [
      mr({
        iid: 1,
        author: { id: 'a', username: 'alice', name: 'Alice', avatarUrl: null },
      }),
      mr({
        iid: 2,
        author: { id: 'b', username: 'bob', name: 'Bob', avatarUrl: null },
      }),
    ];
    const state = { ...DEFAULT_VIEW, tab: 'team', member: 'alice' };
    const result = viewStateForGate(
      state,
      mrs,
      [teamTab],
      new Set(['alice', 'bob']),
      2
    );
    expect(result.member).toBe('all');
    expect(result.tab).toBe('team');
  });

  test('switches to the first tab whose filter carries the linked row', () => {
    const mrs = [
      mr({
        iid: 3,
        author: { id: 'c', username: 'carol', name: 'Carol', avatarUrl: null },
        codeownerSections: ['design'],
      }),
    ];
    // carol isn't on the roster, so the authors tab hides her row entirely.
    const state = { ...DEFAULT_VIEW, tab: 'team' };
    const result = viewStateForGate(
      state,
      mrs,
      [teamTab, designTab],
      new Set(['alice', 'bob']),
      3
    );
    expect(result.tab).toBe('design');
  });

  test('leaves the tab alone when the current one already shows the row', () => {
    const mrs = [
      mr({
        iid: 4,
        author: { id: 'b', username: 'bob', name: 'Bob', avatarUrl: null },
      }),
    ];
    const state = { ...DEFAULT_VIEW, tab: 'team' };
    const result = viewStateForGate(
      state,
      mrs,
      [teamTab, designTab],
      new Set(['bob']),
      4
    );
    expect(result.tab).toBe('team');
  });

  test('clears a posted-only slack filter that would hide the row', () => {
    const mrs = [mr({ iid: 5, slack: { posted: false } })];
    const state = { ...DEFAULT_VIEW, tab: 'team', slack: 'posted' as const };
    const result = viewStateForGate(state, mrs, [teamTab], new Set(['bob']), 5);
    expect(result.slack).toBe('all');
  });

  test('returns state unchanged when no row carries the iid', () => {
    const mrs = [mr({ iid: 6 })];
    const state = { ...DEFAULT_VIEW, tab: 'team', member: 'bob' };
    const result = viewStateForGate(
      state,
      mrs,
      [teamTab],
      new Set(['bob']),
      999
    );
    expect(result).toEqual(state);
  });
});

describe('stripGateParam', () => {
  test('removes gate and leaves other params intact', () => {
    expect(stripGateParam('?member=alice&gate=abc123&tab=mine')).toBe(
      '?member=alice&tab=mine'
    );
  });

  test('returns empty string when gate was the only param', () => {
    expect(stripGateParam('?gate=abc123')).toBe('');
  });

  test('returns the search string unchanged when there is no gate param', () => {
    expect(stripGateParam('?member=alice')).toBe('?member=alice');
  });

  test('returns empty string for an empty search string', () => {
    expect(stripGateParam('')).toBe('');
  });
});
