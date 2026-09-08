// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import {
  gateDraftKey,
  useGateDraft,
  type GateDraft,
} from '@mattstack/gate-kit/react';

const DRAFT: GateDraft = {
  selections: { outcome: 'pass', flags: ['lint'] },
  notes: { outcome: 'ran twice' },
  item: 'flags',
};

afterEach(() => {
  localStorage.clear();
});

describe('useGateDraft', () => {
  test('keys the draft by gate id under the gate-kit:draft prefix', () => {
    expect(gateDraftKey('g1')).toBe('gate-kit:draft:g1');
  });

  test('save then a fresh mount restores; initial is null before any save', () => {
    const first = renderHook(() => useGateDraft('g1', true));
    expect(first.result.current.initial).toBeNull();
    act(() => first.result.current.save(DRAFT));
    expect(JSON.parse(localStorage.getItem(gateDraftKey('g1'))!)).toEqual(
      DRAFT
    );
    const second = renderHook(() => useGateDraft('g1', true));
    expect(second.result.current.initial).toEqual(DRAFT);
    expect(
      renderHook(() => useGateDraft('g2', true)).result.current.initial
    ).toBeNull();
  });

  test('clear removes the entry and an empty draft is not persisted', () => {
    const { result } = renderHook(() => useGateDraft('g1', true));
    act(() => result.current.save(DRAFT));
    act(() => result.current.clear());
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
    act(() =>
      result.current.save({
        selections: { flags: [] },
        notes: { outcome: '  ' },
        item: 'flags',
      })
    );
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
  });

  test('a disabled hook neither restores nor saves, and going disabled clears what is stored', () => {
    localStorage.setItem(gateDraftKey('g1'), JSON.stringify(DRAFT));
    const closed = renderHook(() => useGateDraft('g1', false));
    expect(closed.result.current.initial).toBeNull();
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
    act(() => closed.result.current.save(DRAFT));
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();

    const open = renderHook(
      ({ enabled }: { enabled: boolean }) => useGateDraft('g1', enabled),
      { initialProps: { enabled: true } }
    );
    act(() => open.result.current.save(DRAFT));
    expect(localStorage.getItem(gateDraftKey('g1'))).not.toBeNull();
    open.rerender({ enabled: false });
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
  });

  test('a malformed stored value reads as no draft, and unknown value shapes are dropped', () => {
    localStorage.setItem(gateDraftKey('g1'), '{not json');
    expect(
      renderHook(() => useGateDraft('g1', true)).result.current.initial
    ).toBeNull();
    localStorage.setItem(
      gateDraftKey('g1'),
      JSON.stringify({ selections: {}, notes: {}, item: 3 })
    );
    expect(
      renderHook(() => useGateDraft('g1', true)).result.current.initial
    ).toBeNull();
    localStorage.setItem(
      gateDraftKey('g1'),
      JSON.stringify({
        selections: { outcome: 'pass', bad: 1 },
        notes: { outcome: 'x', bad: 2 },
        item: null,
      })
    );
    expect(
      renderHook(() => useGateDraft('g1', true)).result.current.initial
    ).toEqual({
      selections: { outcome: 'pass' },
      notes: { outcome: 'x' },
      item: null,
    });
  });

  test('an unavailable localStorage degrades to no draft: read, save, and clear never throw', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage'
    );
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage disabled');
      },
    });
    try {
      const { result } = renderHook(() => useGateDraft('g1', true));
      expect(result.current.initial).toBeNull();
      expect(() => act(() => result.current.save(DRAFT))).not.toThrow();
      expect(() => act(() => result.current.clear())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
  });

  test('a storage that rejects writes (quota) degrades the same way', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage'
    );
    const rejecting = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: rejecting,
    });
    try {
      const { result } = renderHook(() => useGateDraft('g1', true));
      expect(() => act(() => result.current.save(DRAFT))).not.toThrow();
      expect(() => act(() => result.current.clear())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
