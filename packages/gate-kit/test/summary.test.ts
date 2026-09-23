import { describe, expect, test } from 'vitest';

import {
  answeredGateSummary,
  type GateSummaryInput,
} from '@mattstack/gate-kit';
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

const postThread = (n: number, t: string): GateQuestion => ({
  id: `thread-${n}`,
  label: `${t}.ts:1`,
  multi: true,
  options: [
    { value: `post:${t}`, label: 'Post' },
    { value: `resolve:${t}`, label: 'Resolve' },
  ],
});

const EDITED_POST_ROW: GateSummaryInput = {
  subject: 'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/87',
  kind: 'respond-post',
  status: 'answered',
  questions: [postThread(1, 'T1'), postThread(2, 'T2'), postThread(3, 'T3')],
  answer: {
    answers: {
      'thread-1': { value: ['post:T1', 'resolve:T1'], text: 'edited reply' },
      'thread-2': ['post:T2'],
      'thread-3': [],
    },
    by: 'board',
    answeredAt: 1,
  },
};

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

  test('per-thread post questions add up across threads: posted, resolved, held', () => {
    const { chip } = answeredGateSummary({
      subject:
        'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/87',
      kind: 'respond-post',
      status: 'answered',
      questions: [
        postThread(1, 'T1'),
        postThread(2, 'T2'),
        postThread(3, 'T3'),
      ],
      answer: {
        answers: {
          'thread-1': ['post:T1', 'resolve:T1'],
          'thread-2': { value: ['resolve:T2'], note: 'stale' },
          'thread-3': [],
        },
        by: 'board',
        answeredAt: 1,
      },
    });
    expect(chip).toBe('respond !87 · 1 posted, 2 resolved, 2 held · by board');
  });

  test('an edited posted thread counts on the chip and carries its text in the detail', () => {
    const { chip, detail } = answeredGateSummary(EDITED_POST_ROW);
    expect(chip).toBe(
      'respond !87 · 2 posted (1 edited), 1 resolved, 1 held · by board'
    );
    expect(detail.find(d => d.id === 'thread-1')!.text).toBe('edited reply');
    expect(detail.find(d => d.id === 'thread-2')!.text).toBeUndefined();
  });

  test('an explicit empty multi answer chips the same nothing-posted marker as the zero-option shape', () => {
    const questions: GateQuestion[] = [
      {
        id: 'tiers',
        label: 'Post which findings?',
        multi: true,
        options: ['Minor', 'Major'],
      },
      REVIEW_QUESTIONS[1]!,
    ];
    const { chip } = answeredGateSummary({
      subject:
        'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/44043',
      kind: 'review-post',
      status: 'answered',
      questions,
      answer: {
        answers: { tiers: [], outcome: 'comment' },
        by: 'pane',
        answeredAt: 1,
      },
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

describe('answeredGateSummary outcome', () => {
  const findingsChunk = (n: number, ids: string[]): GateQuestion => ({
    id: `findings-${n}`,
    label: `Findings, part ${n}`,
    multi: true,
    options: ids.map(id => ({ value: id, label: `[Minor] finding ${id}` })),
  });
  const reviewRow = (
    answers: Record<string, string | string[]>
  ): GateSummaryInput => ({
    subject: MR_SUBJECT,
    kind: 'review-post',
    status: 'answered',
    questions: [
      findingsChunk(1, ['f1', 'f2', 'f3', 'f4']),
      findingsChunk(2, ['f5']),
      REVIEW_QUESTIONS[1]!,
    ],
    answer: { answers, by: 'board', answeredAt: 1 },
  });
  const threadPick = (n: number): GateQuestion => ({
    id: `thread-${n}`,
    label: `queue.ts:${n}`,
    multi: false,
    options: [`reply:t${n}`, `fix:t${n}`, `skip:t${n}`],
  });

  test('a posting gate keeps its pair summary, with no subject head or by suffix', () => {
    const { outcome } = answeredGateSummary(EDITED_POST_ROW);
    expect(outcome).toBe('2 posted (1 edited), 1 resolved, 1 held');
  });

  test('chunked findings count together under the question noun, then the verdict', () => {
    const row = reviewRow({
      'findings-1': ['f1', 'f2', 'f3', 'f4'],
      'findings-2': ['f5'],
      outcome: 'comment',
    });
    expect(answeredGateSummary(row).outcome).toBe('5 findings, comment');
    expect(answeredGateSummary(row).chip).toContain('[Minor] finding f1');
  });

  test('one finding reads singular, and no findings read nothing posted', () => {
    expect(
      answeredGateSummary(
        reviewRow({
          'findings-1': ['f2'],
          'findings-2': [],
          outcome: 'approve',
        })
      ).outcome
    ).toBe('1 finding, approve');
    expect(
      answeredGateSummary(
        reviewRow({ 'findings-1': [], 'findings-2': [], outcome: 'comment' })
      ).outcome
    ).toBe('comment, nothing posted');
  });

  test('the clean review shape keeps its nothing-posted marker', () => {
    const { outcome } = answeredGateSummary({
      subject: MR_SUBJECT,
      kind: 'review-post',
      status: 'answered',
      questions: REVIEW_QUESTIONS,
      answer: { answers: { outcome: 'comment' }, by: 'pane', answeredAt: 1 },
    });
    expect(outcome).toBe('comment, nothing posted');
  });

  test('verb picks across per-thread questions add up, then the single answers', () => {
    const { outcome } = answeredGateSummary({
      subject: MR_SUBJECT,
      kind: 'respond-plan',
      status: 'answered',
      questions: [
        threadPick(1),
        threadPick(2),
        threadPick(3),
        {
          id: 'code-changes',
          label: 'Approve the proposed code changes?',
          multi: false,
          options: ['approve', 'revise', 'skip'],
        },
      ],
      answer: {
        answers: {
          'thread-1': 'fix:t1',
          'thread-2': 'fix:t2',
          'thread-3': 'reply:t3',
          'code-changes': 'approve',
        },
        by: 'board',
        answeredAt: 1,
      },
    });
    expect(outcome).toBe('2 fixes, 1 reply, approve');
  });

  test('a multi of verb picks counts verbs and leaves skips unsaid', () => {
    const { outcome } = answeredGateSummary({
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
    expect(outcome).toBe('1 fix, approved');
  });

  test('a closed row reads its closed reason', () => {
    const { outcome } = answeredGateSummary({
      subject: MR_SUBJECT,
      kind: 'respond-plan',
      status: 'closed',
      closedReason: 'superseded',
      questions: RESPOND_QUESTIONS,
      answer: null,
    });
    expect(outcome).toBe('superseded');
  });
});
