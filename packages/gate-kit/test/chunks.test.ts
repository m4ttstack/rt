import { describe, expect, test } from 'vitest';

import {
  chunkGroupKey,
  collapseChunks,
  splitChunkSelections,
} from '@mattstack/gate-kit';
import type { GateQuestion } from '@mattstack/gate-kit';

const q = (id: string, options: string[], multi = true): GateQuestion => ({
  id,
  label: `Post which findings? (${id})`,
  multi,
  options,
});

describe('chunkGroupKey', () => {
  test('matches <base>-<n> and nothing else', () => {
    expect(chunkGroupKey('findings-1')).toBe('findings');
    expect(chunkGroupKey('findings-12')).toBe('findings');
    expect(chunkGroupKey('findings')).toBeNull();
    expect(chunkGroupKey('outcome')).toBeNull();
    expect(chunkGroupKey('fix-up-2x')).toBeNull();
  });
});

describe('collapseChunks', () => {
  test('merges adjacent numbered multis and keeps others in place', () => {
    const questions = [
      q('findings-1', ['f1', 'f2', 'f3', 'f4']),
      q('findings-2', ['f5', 'f6']),
      q('outcome', ['approve', 'comment'], false),
    ];
    const { questions: out, groups } = collapseChunks(questions);
    expect(out.map(x => x.id)).toEqual(['findings', 'outcome']);
    expect(out[0]!.options).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
    expect(groups.get('findings')).toEqual(['findings-1', 'findings-2']);
  });

  test('a single unchunked question set passes through untouched', () => {
    const questions = [q('tiers', ['Minor'], true)];
    const { questions: out, groups } = collapseChunks(questions);
    expect(out).toEqual(questions);
    expect(groups.size).toBe(0);
  });

  test('non-adjacent chunks sharing a base throw instead of mis-grouping', () => {
    expect(() =>
      collapseChunks([
        q('findings-1', ['f1']),
        q('outcome', ['approve'], false),
        q('findings-2', ['f2']),
      ])
    ).toThrow();
  });

  test('a lone -1 chunk still collapses to its base id', () => {
    const { questions: out, groups } = collapseChunks([
      q('findings-1', ['f1']),
    ]);
    expect(out[0]!.id).toBe('findings');
    expect(groups.get('findings')).toEqual(['findings-1']);
  });
});

describe('splitChunkSelections', () => {
  test('splits the union back by option membership', () => {
    const questions = [
      q('findings-1', ['f1', 'f2', 'f3', 'f4']),
      q('findings-2', ['f5', 'f6']),
    ];
    const { groups } = collapseChunks(questions);
    const split = splitChunkSelections(groups, questions, {
      findings: ['f2', 'f5'],
    });
    expect(split).toEqual({ 'findings-1': ['f2'], 'findings-2': ['f5'] });
  });

  test('empty union answers every chunk with an explicit empty array', () => {
    const questions = [q('findings-1', ['f1']), q('findings-2', ['f2'])];
    const { groups } = collapseChunks(questions);
    expect(splitChunkSelections(groups, questions, { findings: [] })).toEqual({
      'findings-1': [],
      'findings-2': [],
    });
  });

  test('a value in no chunk throws', () => {
    const questions = [q('findings-1', ['f1'])];
    const { groups } = collapseChunks(questions);
    expect(() =>
      splitChunkSelections(groups, questions, { findings: ['zz'] })
    ).toThrow();
  });
});
