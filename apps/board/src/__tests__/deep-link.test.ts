import { describe, expect, test } from 'bun:test';

import {
  gateParam,
  mrForGate,
  stripGateParam,
} from '../client/board/deep-link.ts';

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
