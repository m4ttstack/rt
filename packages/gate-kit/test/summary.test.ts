import { describe, expect, test } from 'vitest';

import { answeredGateSummary } from '@mattstack/gate-kit';
import type { GateQuestion } from '@mattstack/rt-client';

const MR_SUBJECT =
  'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/44058';

const REVIEW_QUESTIONS: GateQuestion[] = [
  { id: 'tiers', label: 'Post which findings?', multi: true, options: [] },
  {
    id: 'outcome',
    label: 'Verdict',
    multi: false,
    options: ['comment', 'approve'],
  },
];

const RESPOND_QUESTIONS: GateQuestion[] = [
  {
    id: 'threads-1',
    label: 'Threads',
    multi: true,
    options: [
      'reply:t1aaaaaaaaaaaaaa',
      'fix:t1aaaaaaaaaaaaaa',
      'skip:t1aaaaaaaaaaaaaa',
      'reply:t2bbbbbbbbbbbbbb',
      'fix:t2bbbbbbbbbbbbbb',
      'skip:t2bbbbbbbbbbbbbb',
    ],
  },
  {
    id: 'code-changes',
    label: 'Approve the proposed code changes?',
    multi: false,
    options: [{ value: 'approve', label: 'approved' }, 'revise', 'skip'],
  },
];

describe('answeredGateSummary chip', () => {
  test('a clean review chip: answered fragments first, then the zero-option marker', () => {
    const { chip } = answeredGateSummary({
      subject:
        'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/44043',
      kind: 'review-post',
      status: 'answered',
      questions: REVIEW_QUESTIONS,
      answer: { answers: { outcome: 'comment' }, by: 'pane', answeredAt: 1 },
    });
    expect(chip).toBe('review !44043 · comment, nothing posted');
  });

  test('a respond chip counts non-skip thread verbs, renders labels, and names a non-pane decider', () => {
    const { chip } = answeredGateSummary({
      subject: MR_SUBJECT,
      kind: 'respond-plan',
      status: 'answered',
      questions: RESPOND_QUESTIONS,
      answer: {
        answers: {
          'threads-1': ['fix:t1aaaaaaaaaaaaaa', 'skip:t2bbbbbbbbbbbbbb'],
          'code-changes': 'approve',
        },
        by: 'board',
        answeredAt: 2,
      },
    });
    expect(chip).toBe('respond !44058 · 1 fix, approved · by board');
  });

  test('plural verb counts and the all-skipped collapse', () => {
    const base = {
      subject: MR_SUBJECT,
      kind: 'respond-plan',
      status: 'answered',
      questions: [RESPOND_QUESTIONS[0]!],
    };
    expect(
      answeredGateSummary({
        ...base,
        answer: {
          answers: {
            'threads-1': ['fix:t1aaaaaaaaaaaaaa', 'fix:t2bbbbbbbbbbbbbb'],
          },
          by: 'pane',
          answeredAt: 1,
        },
      }).chip
    ).toBe('respond !44058 · 2 fixes');
    expect(
      answeredGateSummary({
        ...base,
        answer: {
          answers: {
            'threads-1': ['skip:t1aaaaaaaaaaaaaa', 'skip:t2bbbbbbbbbbbbbb'],
          },
          by: 'pane',
          answeredAt: 1,
        },
      }).chip
    ).toBe('respond !44058 · all skipped');
  });

  test('an unregistered kind falls back to the kind itself, and a run subject to a short run ref', () => {
    const { chip } = answeredGateSummary({
      subject: 'run:0123456789abcdef',
      kind: 'self-review',
      status: 'answered',
      questions: [
        {
          id: 'outcome',
          label: 'What happened?',
          multi: false,
          options: ['pass', 'fail'],
        },
      ],
      answer: { answers: { outcome: 'pass' }, by: 'pane', answeredAt: 1 },
    });
    expect(chip).toBe('self-review run 01234567 · pass');
  });

  test('non-verb multi answers list their labels instead of counting', () => {
    const { chip } = answeredGateSummary({
      subject: 'run:r1',
      kind: 'self-review',
      status: 'answered',
      questions: [
        {
          id: 'flags',
          label: 'Any flags?',
          multi: true,
          options: ['lint', 'types'],
        },
      ],
      answer: {
        answers: { flags: ['lint', 'types'] },
        by: 'pane',
        answeredAt: 1,
      },
    });
    expect(chip).toBe('self-review run r1 · lint, types');
  });

  test('closed rows chip their closedReason in place of answers', () => {
    const base = {
      subject: MR_SUBJECT,
      kind: 'respond-plan',
      status: 'closed',
      questions: RESPOND_QUESTIONS,
      answer: null,
    };
    expect(
      answeredGateSummary({ ...base, closedReason: 'superseded' }).chip
    ).toBe('respond !44058 · superseded');
    expect(answeredGateSummary({ ...base, closedReason: null }).chip).toBe(
      'respond !44058 · closed'
    );
  });
});

describe('answeredGateSummary detail', () => {
  test('detail rows carry labels with titles, notes, and the decider', () => {
    const { detail } = answeredGateSummary({
      subject: MR_SUBJECT,
      kind: 'respond-plan',
      status: 'answered',
      questions: RESPOND_QUESTIONS,
      answer: {
        answers: {
          'threads-1': { value: ['fix:t1aaaaaaaaaaaaaa'], note: 'CI first' },
          'code-changes': 'approve',
        },
        by: 'board',
        answeredAt: 99,
      },
    });
    expect(detail).toEqual([
      {
        id: 'threads-1',
        question: 'Threads',
        answers: [{ text: 'fix · t1aaaaaa', title: 'fix:t1aaaaaaaaaaaaaa' }],
        note: 'CI first',
        decidedBy: 'board',
        at: 99,
      },
      {
        id: 'code-changes',
        question: 'Approve the proposed code changes?',
        answers: [{ text: 'approved', title: 'approve' }],
        decidedBy: 'board',
        at: 99,
      },
    ]);
  });

  test('a question missing from the answers renders a placeholder row, never throws', () => {
    const { detail } = answeredGateSummary({
      kind: 'review-post',
      status: 'closed',
      closedReason: 'superseded',
      questions: REVIEW_QUESTIONS,
      answer: null,
    });
    expect(detail).toEqual([
      {
        id: 'tiers',
        question: 'Post which findings?',
        answers: [{ text: '(none)' }],
        decidedBy: null,
        at: null,
      },
      {
        id: 'outcome',
        question: 'Verdict',
        answers: [{ text: '(none)' }],
        decidedBy: null,
        at: null,
      },
    ]);
  });

  test('a recommended label strips the suffix from both the chip and the detail text', () => {
    const { chip, detail } = answeredGateSummary({
      subject: 'run:r1',
      kind: 'self-review',
      status: 'answered',
      questions: [
        {
          id: 'outcome',
          label: 'What happened?',
          multi: false,
          options: [
            { value: 'approve', label: 'Approve (recommended)' },
            { value: 'comment', label: 'Comment' },
          ],
        },
      ],
      answer: { answers: { outcome: 'approve' }, by: 'pane', answeredAt: 1 },
    });
    expect(chip).toBe('self-review run r1 · Approve');
    expect(chip).not.toContain('recommended');
    expect(detail[0]!.answers).toEqual([
      { text: 'Approve', title: 'approve', recommended: true },
    ]);
  });
});
