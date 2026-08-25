import { describe, expect, it } from 'vitest';

import type { ExplainRowWire, SettingDefWire } from '../../server/settings';
import { analyzeChain, shortValue } from './chain';

function def(over: Partial<SettingDefWire>): SettingDefWire {
  return {
    key: 'rt.example',
    type: 'number',
    scopes: ['user', 'machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Example.',
    hasDefault: true,
    defaultValue: 30,
    ...over,
  };
}

const row = (
  scope: string,
  present: boolean,
  value?: unknown,
  extra?: Partial<ExplainRowWire>
): ExplainRowWire =>
  ({ scope, file: scope === 'default' ? null : `/stores/${scope}.jsonc`, present, ...(present ? { value } : {}), ...extra }) as ExplainRowWire;

describe('analyzeChain: scalar keys have a single winner', () => {
  it('names the strongest present row the winner and lists what it overrode', () => {
    const verdict = analyzeChain(def({}), [
      row('default', true, 30),
      row('user', true, 45),
      row('machine', true, 14),
    ]);

    expect(verdict.kind).toBe('scalar');
    if (verdict.kind !== 'scalar') return;
    expect(verdict.winner?.scope).toBe('machine');
    expect(verdict.overridden.map(r => r.scope)).toEqual(['default', 'user']);
    expect(verdict.sentence).toBe(
      'rt.example is 14 because the machine layer sets it, overriding default, user.'
    );
  });

  it('a default-only chain says so in the sentence', () => {
    const verdict = analyzeChain(def({}), [
      row('default', true, 30),
      row('user', false),
    ]);

    if (verdict.kind !== 'scalar') throw new Error('expected scalar');
    expect(verdict.winner?.scope).toBe('default');
    expect(verdict.sentence).toBe(
      'rt.example is 30 — the registry default; nothing overrides it.'
    );
  });

  it('an entirely unset key without a default is stated, not invented', () => {
    const verdict = analyzeChain(def({ hasDefault: false, defaultValue: null }), [
      row('default', false),
      row('user', false),
    ]);

    if (verdict.kind !== 'scalar') throw new Error('expected scalar');
    expect(verdict.winner).toBeNull();
    expect(verdict.sentence).toBe(
      'rt.example is unset — no layer sets it and the registry declares no default.'
    );
  });

  it('a shadowed (teamLocked) row never wins and never counts as overridden', () => {
    const verdict = analyzeChain(def({}), [
      row('default', true, 30),
      row('user', true, 45, { shadowed: 'teamLocked' }),
    ]);

    if (verdict.kind !== 'scalar') throw new Error('expected scalar');
    expect(verdict.winner?.scope).toBe('default');
    expect(verdict.overridden).toEqual([]);
  });

  it('an invalid row is excluded the same way', () => {
    const verdict = analyzeChain(def({}), [
      row('default', true, 30),
      row('machine', true, 'oops', { invalid: 'expected number, got string' }),
    ]);

    if (verdict.kind !== 'scalar') throw new Error('expected scalar');
    expect(verdict.winner?.scope).toBe('default');
  });

  it('an array key replaces atomically — winner semantics, not a merge', () => {
    const verdict = analyzeChain(
      def({ type: 'array', merge: 'replace', defaultValue: [] }),
      [row('default', true, []), row('user', true, ['a']), row('machine', true, ['b'])]
    );

    expect(verdict.kind).toBe('scalar');
    if (verdict.kind !== 'scalar') return;
    expect(verdict.winner?.scope).toBe('machine');
  });
});

describe('analyzeChain: deep-merged object keys have contributors, no winner', () => {
  it('collects every present valid row as a contributor', () => {
    const verdict = analyzeChain(
      def({ type: 'object', merge: 'deep', defaultValue: {} }),
      [
        row('default', true, {}),
        row('team', true, { a: 1 }),
        row('user', true, { b: 2 }),
        row('machine', false),
      ]
    );

    expect(verdict.kind).toBe('composite');
    if (verdict.kind !== 'composite') return;
    expect(verdict.contributors.map(r => r.scope)).toEqual([
      'default', 'team', 'user',
    ]);
    expect(verdict.sentence).toBe(
      'rt.example deep-merges key by key — 3 layers contribute; there is no single winner.'
    );
  });

  it('a single contributor gets singular layer AND verb agreement', () => {
    const verdict = analyzeChain(
      def({ type: 'object', merge: 'deep', defaultValue: {} }),
      [row('user', true, { a: 1 })]
    );

    expect(verdict.kind).toBe('composite');
    if (verdict.kind !== 'composite') return;
    expect(verdict.sentence).toBe(
      'rt.example deep-merges key by key — 1 layer contributes; there is no single winner.'
    );
  });

  it('two team rows from different files are distinct contributors', () => {
    // A scope can repeat once per cloned team; rows are identified by scope
    // AND file, never scope alone.
    const t1 = { scope: 'team', file: '/teams/a/settings.jsonc', present: true, value: { x: 1 } } as ExplainRowWire;
    const t2 = { scope: 'team', file: '/teams/b/settings.jsonc', present: true, value: { y: 2 } } as ExplainRowWire;
    const verdict = analyzeChain(
      def({ type: 'object', merge: 'deep', hasDefault: false, defaultValue: null }),
      [t1, t2]
    );

    if (verdict.kind !== 'composite') throw new Error('expected composite');
    expect(verdict.contributors).toHaveLength(2);
  });
});

describe('shortValue', () => {
  it('renders scalars as JSON and truncates long values', () => {
    expect(shortValue(14)).toBe('14');
    expect(shortValue('abc')).toBe('"abc"');
    expect(shortValue({ a: 'x'.repeat(60) }).length).toBeLessThanOrEqual(43);
    expect(shortValue({ a: 'x'.repeat(60) }).endsWith('…')).toBe(true);
  });
});
