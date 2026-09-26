import { describe, expect, test } from 'bun:test';

import type { GateQuestion } from '@mattstack/gate-kit';
import type { GateRow } from '../../../gates/store.ts';
import type { ReviewCtx } from '../gate-ctx.ts';
import {
  isReviewSheetGate,
  paneContext,
  readReviewGate,
  reviewMeta,
  reviewProse,
  severityTally,
} from '../review-gate.ts';

const j = (v: unknown) => JSON.stringify(v);

const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary: 'the guard only covers the parity path.',
  findings: { important: 1, minor: 2 },
};

const entry = (id: string, severity: string) => ({
  id,
  severity,
  title: `title ${id}`,
  body: `body ${id}`,
});
const findingsCtx = (...entries: object[]) =>
  j({ 'gate-ctx': 'findings@1', findings: entries });
const option = (value: string) => ({
  value,
  label: `[Minor] title ${value}`,
  description: `lib/a.ts:1 · fix ${value}`,
});

function gate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-9',
    subject: 'mr:https://gitlab.example.com/acme/app/-/merge_requests/9',
    kind: 'review-post',
    label: 'review',
    status: 'open',
    openedAt: 1,
    context: j(REVIEW),
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings to !9?',
        multi: true,
        context: findingsCtx(entry('f1', 'important'), entry('f2', 'minor')),
        options: [option('f1'), option('f2')],
      },
      {
        id: 'findings-2',
        label: 'Post which findings to !9?',
        multi: true,
        context: findingsCtx(entry('f3', 'minor')),
        options: [option('f3')],
      },
      {
        id: 'outcome',
        label: 'Verdict on !9',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    ...overrides,
  };
}

function withQuestion(at: number, patch: Partial<GateQuestion>): GateRow {
  const g = gate();
  return {
    ...g,
    questions: g.questions.map((q, i) => (i === at ? { ...q, ...patch } : q)),
  };
}

describe('readReviewGate', () => {
  test('joins every findings chunk to its options by id', () => {
    const read = readReviewGate(gate());
    expect(read?.review.shape).toBe('review@1');
    expect([...read!.findings.keys()]).toEqual(['f1', 'f2', 'f3']);
    expect(read!.findings.get('f3')?.body).toBe('body f3');
  });

  test('a clean review (outcome alone) routes', () => {
    expect(
      isReviewSheetGate(
        gate({
          context: j({ ...REVIEW, findings: {} }),
          questions: [gate().questions[2]!],
        })
      )
    ).toBe(true);
  });

  test('a non-findings question context is never checked', () => {
    expect(isReviewSheetGate(withQuestion(2, { context: 'plain prose' }))).toBe(
      true
    );
  });

  test('an unchunked question named exactly "findings" still joins', () => {
    const g = gate({
      context: j({ ...REVIEW, findings: { important: 1 } }),
      questions: [
        {
          id: 'findings',
          label: 'Post which findings to !9?',
          multi: true,
          context: findingsCtx(entry('f1', 'important')),
          options: [option('f1')],
        },
        gate().questions[2]!,
      ],
    });
    const read = readReviewGate(g);
    expect([...read!.findings.keys()]).toEqual(['f1']);
    expect(isReviewSheetGate(g)).toBe(true);
  });
});

describe('everything else stays in the generic modal', () => {
  const cases: [string, GateRow][] = [
    ['another gate kind', gate({ kind: 'respond-plan' })],
    [
      'a legacy prose gate context over pinned-format options',
      gate({ context: 'Findings: Important (1), Minor (2)' }),
    ],
    ['no gate context', gate({ context: undefined })],
    [
      'a gate context of another shape',
      gate({
        context: j({
          'gate-ctx': 'plan@1',
          reviewer: 'r',
          threads: { total: 1 },
        }),
      }),
    ],
    [
      'a findings chunk with prose context',
      withQuestion(1, { context: 'f3 prose' }),
    ],
    [
      'a findings chunk with no context',
      withQuestion(1, { context: undefined }),
    ],
    [
      'a findings chunk of another shape',
      withQuestion(1, { context: j({ 'gate-ctx': 'replies@1', replies: [] }) }),
    ],
    [
      'an entry with no option',
      withQuestion(1, {
        context: findingsCtx(entry('f3', 'minor'), entry('f9', 'minor')),
      }),
    ],
    [
      'an option with no entry',
      withQuestion(1, { options: [option('f3'), option('f4')] }),
    ],
    [
      'a duplicate entry id in one chunk',
      withQuestion(0, {
        context: findingsCtx(entry('f1', 'important'), entry('f1', 'minor')),
      }),
    ],
    [
      'the same id in two chunks',
      withQuestion(1, {
        context: findingsCtx(entry('f1', 'minor')),
        options: [option('f1')],
      }),
    ],
    [
      'duplicate option values within one chunk',
      withQuestion(0, { options: [option('f1'), option('f1')] }),
    ],
    [
      'summary counts with no findings to back them',
      gate({ questions: [gate().questions[2]!] }),
    ],
    [
      'summary counts that disagree with the joined findings',
      gate({ questions: [gate().questions[0]!, gate().questions[2]!] }),
    ],
    [
      'a second single-choice question',
      gate({
        questions: [
          ...gate().questions,
          { id: 'tone', label: 'Tone', multi: false, options: ['a', 'b'] },
        ],
      }),
    ],
    [
      'a multi beside the findings',
      gate({
        questions: [
          ...gate().questions,
          { id: 'tiers', label: 'Tiers', multi: true, options: ['x', 'y'] },
        ],
      }),
    ],
    [
      'no single-choice question to carry the verdict',
      gate({ questions: gate().questions.slice(0, 2) }),
    ],
    [
      'findings chunks split apart by another question',
      gate({
        questions: [
          gate().questions[0]!,
          gate().questions[2]!,
          gate().questions[1]!,
        ],
      }),
    ],
  ];
  for (const [name, row] of cases)
    test(name, () => {
      expect(readReviewGate(row)).toBeNull();
      expect(isReviewSheetGate(row)).toBe(false);
    });
});

describe('prose helpers', () => {
  const review: ReviewCtx = {
    shape: 'review@1',
    reviewer: 'renee',
    readiness: 'with-fixes',
    summary: 'the guard only covers the parity path.',
    findings: { critical: 0, important: 1, minor: 4 },
    round: 2,
    re_review: true,
    prior: { addressed: 3, still_open: 1 },
  };
  const bare: ReviewCtx = {
    shape: 'review@1',
    readiness: 'yes',
    summary: 'clean.',
    findings: { critical: 0, important: 0, minor: 0 },
    re_review: false,
  };

  test('severityTally names the non-zero severities in order', () => {
    expect(severityTally(review.findings)).toBe('1 important, 4 minor');
    expect(severityTally(bare.findings)).toBe('no findings');
  });

  test('reviewMeta carries reviewer, round, and the prior tally', () => {
    expect(reviewMeta(review)).toBe(
      'renee · round 2 · 3 addressed, 1 still open'
    );
    expect(reviewMeta({ ...review, prior: undefined })).toBe(
      'renee · round 2 · re-review'
    );
    expect(reviewMeta(bare)).toBe('');
  });

  test('reviewProse flattens the summary for a surface with no sheet', () => {
    expect(reviewProse(review)).toBe(
      '**Ready to merge: with fixes** · 1 important, 4 minor\n\n' +
        'renee · round 2 · 3 addressed, 1 still open\n\n' +
        'the guard only covers the parity path.'
    );
    expect(reviewProse(bare)).toBe(
      '**Ready to merge: yes** · no findings\n\nclean.'
    );
  });

  test('paneContext: prose as written, review@1 flattened, other shapes nothing', () => {
    expect(paneContext(undefined)).toBeUndefined();
    expect(paneContext('=== a ===\nprose')).toBe('=== a ===\nprose');
    expect(paneContext(j(REVIEW))).toContain('Ready to merge: with fixes');
    expect(
      paneContext(
        j({ 'gate-ctx': 'plan@1', reviewer: 'r', threads: { total: 1 } })
      )
    ).toBeUndefined();
    expect(paneContext(findingsCtx(entry('f1', 'minor')))).toBeUndefined();
  });
});
