import { describe, expect, test } from 'vitest';

import { gateAnswerPayload, groupThreadOptions } from '@mattstack/gate-kit';
import type { GateOption, GateQuestion } from '@mattstack/rt-client';

describe('groupThreadOptions (per-thread grouping)', () => {
  test('groups bare reply/fix/skip options by token, ordering verbs reply/fix/skip regardless of input order', () => {
    const options: GateOption[] = [
      'skip:t1',
      'fix:t1',
      'reply:t1',
      'fix:t2',
      'skip:t2',
      'reply:t2',
    ];
    const groups = groupThreadOptions(options);
    expect(groups).toEqual([
      {
        token: 't1',
        heading: 't1',
        entries: [
          { verb: 'reply', value: 'reply:t1', option: 'reply:t1' },
          { verb: 'fix', value: 'fix:t1', option: 'fix:t1' },
          { verb: 'skip', value: 'skip:t1', option: 'skip:t1' },
        ],
      },
      {
        token: 't2',
        heading: 't2',
        entries: [
          { verb: 'reply', value: 'reply:t2', option: 'reply:t2' },
          { verb: 'fix', value: 'fix:t2', option: 'fix:t2' },
          { verb: 'skip', value: 'skip:t2', option: 'skip:t2' },
        ],
      },
    ]);
  });

  test("derives the heading from a labeled option's 'verb · <thread text>' suffix", () => {
    const options: GateOption[] = [
      { value: 'reply:7080da2fcf93c1a2', label: 'reply · api.ts:42' },
      { value: 'fix:7080da2fcf93c1a2', label: 'fix · api.ts:42' },
      { value: 'skip:7080da2fcf93c1a2', label: 'skip · api.ts:42' },
      { value: 'reply:a1b2c3d4e5f60718', label: 'reply · README.md:3' },
      { value: 'fix:a1b2c3d4e5f60718', label: 'fix · README.md:3' },
      { value: 'skip:a1b2c3d4e5f60718', label: 'skip · README.md:3' },
    ];
    const groups = groupThreadOptions(options);
    expect(groups?.map(g => g.heading)).toEqual(['api.ts:42', 'README.md:3']);
  });

  test('returns null for a single thread -- 2+ distinct tokens are required', () => {
    expect(groupThreadOptions(['reply:t1', 'fix:t1', 'skip:t1'])).toBeNull();
  });

  test("returns null when any option doesn't parse as reply/fix/skip:<token>", () => {
    const options: GateOption[] = ['reply:t1', 'fix:t1', 'approve'];
    expect(groupThreadOptions(options)).toBeNull();
  });

  test('returns null when one token is missing a verb, even if every token is missing the same one', () => {
    // t1 has all three; t2 is missing skip -- a partial group must not render.
    expect(
      groupThreadOptions([
        'reply:t1',
        'fix:t1',
        'skip:t1',
        'reply:t2',
        'fix:t2',
      ])
    ).toBeNull();
    // Both tokens consistently missing skip is still incomplete, not a smaller valid set.
    expect(
      groupThreadOptions(['reply:t1', 'fix:t1', 'reply:t2', 'fix:t2'])
    ).toBeNull();
  });

  test('returns null when a token has a duplicated verb instead of the missing one', () => {
    // t1: reply, fix, fix -- three options, but only two distinct verbs (skip missing, fix doubled).
    const options: GateOption[] = [
      'reply:t1',
      'fix:t1',
      'fix:t1',
      'reply:t2',
      'fix:t2',
      'skip:t2',
    ];
    expect(groupThreadOptions(options)).toBeNull();
  });

  test('returns null for an unrelated verb, like a tiers or outcome question', () => {
    expect(groupThreadOptions(['nit', 'must-fix'])).toBeNull();
    expect(groupThreadOptions(['comment', 'approve'])).toBeNull();
  });

  test('round-trips: submitted values are still the exact option strings, one per thread', () => {
    const questions: GateQuestion[] = [
      {
        id: 'threads-1',
        label: 'Threads',
        multi: true,
        options: [
          'reply:t1',
          'fix:t1',
          'skip:t1',
          'reply:t2',
          'fix:t2',
          'skip:t2',
        ],
      },
    ];
    const payload = gateAnswerPayload(questions, {
      'threads-1': ['fix:t1', 'skip:t2'],
    });
    expect(payload).toEqual({
      answers: { 'threads-1': ['fix:t1', 'skip:t2'] },
    });
  });
});
