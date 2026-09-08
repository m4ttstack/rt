import { describe, expect, test } from 'vitest';

import {
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
  codeChangesHidden,
  effectiveSelections,
  gateAnswerPayload,
} from '@mattstack/gate-kit';

describe('respond collapse (W4)', () => {
  const questions = [
    {
      id: 'threads-1',
      label: 'Threads',
      multi: true,
      options: ['reply:t1', 'fix:t1', 'skip:t1'],
    },
    {
      id: 'code-changes',
      label: 'Approve the proposed code changes?',
      multi: false,
      options: ['approve', 'revise', 'skip'],
    },
  ];

  test('hidden until a fix: value is selected', () => {
    expect(codeChangesHidden('respond-plan', questions, {})).toBe(true);
    expect(
      codeChangesHidden('respond-plan', questions, {
        'threads-1': ['reply:t1'],
      })
    ).toBe(true);
    expect(
      codeChangesHidden('respond-plan', questions, { 'threads-1': ['fix:t1'] })
    ).toBe(false);
  });

  test('never hidden off respond-plan, without the question, or without the sentinel option', () => {
    expect(codeChangesHidden('review-post', questions, {})).toBe(false);
    expect(codeChangesHidden('respond-plan', [questions[0]!], {})).toBe(false);
    const noSentinel = [
      questions[0]!,
      { ...questions[1]!, options: ['approve', 'revise'] },
    ];
    expect(codeChangesHidden('respond-plan', noSentinel, {})).toBe(false);
  });

  test('a hidden question submits the sentinel through gateAnswerPayload', () => {
    const selections = { 'threads-1': ['reply:t1'] };
    const payload = gateAnswerPayload(
      questions,
      effectiveSelections('respond-plan', questions, selections)
    );
    expect(payload).toEqual({
      answers: {
        'threads-1': ['reply:t1'],
        'code-changes': CODE_CHANGES_SENTINEL,
      },
    });
  });

  test('effectiveSelections merges the sentinel only while hidden', () => {
    expect(effectiveSelections('respond-plan', questions, {})).toEqual({
      [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL,
    });
    const withFix = { 'threads-1': ['fix:t1'] };
    expect(effectiveSelections('respond-plan', questions, withFix)).toBe(withFix);
  });

  test('effectiveSelections passes non-respond kinds through untouched', () => {
    const selections = { 'threads-1': ['reply:t1'] };
    expect(effectiveSelections('review-post', questions, selections)).toBe(
      selections
    );
  });
});
