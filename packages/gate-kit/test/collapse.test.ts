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
    expect(effectiveSelections('respond-plan', questions, withFix)).toBe(
      withFix
    );
  });

  test('effectiveSelections passes non-respond kinds through untouched', () => {
    const selections = { 'threads-1': ['reply:t1'] };
    expect(effectiveSelections('review-post', questions, selections)).toBe(
      selections
    );
  });

  test('a multi code-changes question gets an array sentinel, and gateAnswerPayload accepts it', () => {
    const multiQuestions = [questions[0]!, { ...questions[1]!, multi: true }];
    const selections = { 'threads-1': ['reply:t1'] };
    expect(
      effectiveSelections('respond-plan', multiQuestions, selections)
    ).toEqual({
      'threads-1': ['reply:t1'],
      'code-changes': [CODE_CHANGES_SENTINEL],
    });
    const payload = gateAnswerPayload(
      multiQuestions,
      effectiveSelections('respond-plan', multiQuestions, selections)
    );
    expect(payload).toEqual({
      answers: {
        'threads-1': ['reply:t1'],
        'code-changes': [CODE_CHANGES_SENTINEL],
      },
    });
  });

  test('the single-select case still yields the bare string sentinel', () => {
    expect(effectiveSelections('respond-plan', questions, {})).toEqual({
      [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL,
    });
  });
});

/**
 * Pins the shipped BOARD-23 shape: one single-select question per thread
 * (`thread-<n>`, positional, never a join key) offering `reply:<threadId>` /
 * `fix:<threadId>` / `skip:<threadId>`, plus the single-select code-changes
 * question. The collapse must key off VALUES (a `fix:` prefix anywhere in
 * the selections) and never off question ids -- the rename case below is
 * the test that would catch a regression to id-keying.
 */
describe('respond collapse over per-thread single-select questions (BOARD-23)', () => {
  const perThreadQuestions = [
    {
      id: 'thread-1',
      label: 'reply · api.ts:42',
      multi: false,
      options: ['reply:t1', 'fix:t1', 'skip:t1'],
    },
    {
      id: 'thread-2',
      label: 'reply · README.md:3',
      multi: false,
      options: ['reply:t2', 'fix:t2', 'skip:t2'],
    },
    {
      id: 'code-changes',
      label: 'Approve the proposed code changes?',
      multi: false,
      options: ['approve', 'revise', 'skip'],
    },
  ];

  test('a fix: on any thread question shows code-changes', () => {
    expect(
      codeChangesHidden('respond-plan', perThreadQuestions, {
        'thread-1': 'reply:t1',
        'thread-2': 'fix:t2',
      })
    ).toBe(false);
  });

  test('all reply, or all skip, hides code-changes -- and effectiveSelections injects the sentinel', () => {
    const allReply = { 'thread-1': 'reply:t1', 'thread-2': 'reply:t2' };
    expect(codeChangesHidden('respond-plan', perThreadQuestions, allReply)).toBe(
      true
    );
    expect(
      effectiveSelections('respond-plan', perThreadQuestions, allReply)
    ).toEqual({ ...allReply, 'code-changes': CODE_CHANGES_SENTINEL });

    const allSkip = { 'thread-1': 'skip:t1', 'thread-2': 'skip:t2' };
    expect(codeChangesHidden('respond-plan', perThreadQuestions, allSkip)).toBe(
      true
    );
    expect(
      effectiveSelections('respond-plan', perThreadQuestions, allSkip)
    ).toEqual({ ...allSkip, 'code-changes': CODE_CHANGES_SENTINEL });
  });

  test('renaming the thread question ids changes nothing -- the collapse is value-keyed, never id-keyed', () => {
    const renamed = [
      { ...perThreadQuestions[0]!, id: 'threadA' },
      { ...perThreadQuestions[1]!, id: 'threadB' },
      perThreadQuestions[2]!,
    ];

    const allReplyRenamed = { threadA: 'reply:t1', threadB: 'reply:t2' };
    expect(codeChangesHidden('respond-plan', renamed, allReplyRenamed)).toBe(
      true
    );

    const oneFixRenamed = { threadA: 'reply:t1', threadB: 'fix:t2' };
    expect(codeChangesHidden('respond-plan', renamed, oneFixRenamed)).toBe(
      false
    );
  });
});
