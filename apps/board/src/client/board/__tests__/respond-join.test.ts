import { expect, test } from 'bun:test';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import type { PostCtx, ReplyEntry } from '../gate-ctx.ts';
import { joinPlan } from '../respond-join.ts';

const thread = (summary: string) =>
  JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'blocking',
    claim: { summary },
    verdict: { call: 'valid' },
    reply: { kind: 'verbatim', text: 'draft' },
  });

function planGate(over: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'plan-1',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-plan',
    label: 'respond gate !87',
    status: 'answered',
    openedAt: 1000,
    context: JSON.stringify({
      'gate-ctx': 'plan@1',
      reviewer: 'renee',
      round: 1,
      threads: { total: 3, blocking: 1 },
    }),
    questions: ['t1', 't2', 't3'].map((id, i) => ({
      id: `thread-${i + 1}`,
      label: `a.ts:${i + 1}`,
      multi: false,
      context: thread(`claim ${id}`),
      options: [`reply:${id}`, `fix:${id}`, `skip:${id}`],
    })),
    answers: {
      'thread-1': 'fix:t1',
      'thread-2': { value: 'reply:t2', note: 'keep it short' },
      'thread-3': 'skip:t3',
    },
    ...over,
  } as GateRow;
}

const POST: PostCtx = {
  shape: 'post@1',
  reviewer: 'renee',
  round: 1,
  replies: 2,
  fixes: [{ sha: 'ab12cd3' }],
};

const REPLIES: ReplyEntry[] = [
  { thread: 't1', file: 'a.ts:1', verb: 'fix', sha: 'ab12cd3', text: 'fixed' },
  { thread: 't2', file: 'a.ts:2', verb: 'reply', text: 'answered' },
];

const OFFERED = ['t1', 't2'];

const mrWith = (gates: GateRow[]) =>
  ({ gates }) as unknown as BoardMRWithReview;

test('joins every plan thread in plan order, with its reply and plan pick', () => {
  const joined = joinPlan(POST, REPLIES, OFFERED, mrWith([planGate()]))!;
  expect(
    joined.map(j => [j.threadId, j.label, j.decided, j.reply?.text])
  ).toEqual([
    ['t1', 'a.ts:1', 'fix', 'fixed'],
    ['t2', 'a.ts:2', 'reply', 'answered'],
    ['t3', 'a.ts:3', 'skip', undefined],
  ]);
  expect(joined[0]!.thread.claim.summary).toBe('claim t1');
});

test('picks the plan gate in the same round, never an older round', () => {
  const round1 = planGate({ gateId: 'plan-r1', openedAt: 1000 });
  const round2 = planGate({
    gateId: 'plan-r2',
    openedAt: 2000,
    context: JSON.stringify({
      'gate-ctx': 'plan@1',
      reviewer: 'renee',
      round: 2,
      threads: { total: 3, blocking: 1 },
    }),
    answers: {
      'thread-1': 'reply:t1',
      'thread-2': 'reply:t2',
      'thread-3': 'skip:t3',
    },
  });
  const inRound2 = joinPlan(
    { ...POST, round: 2 },
    REPLIES,
    OFFERED,
    mrWith([round1, round2])
  )!;
  expect(inRound2[0]!.decided).toBe('reply');
  const inRound1 = joinPlan(POST, REPLIES, OFFERED, mrWith([round1, round2]))!;
  expect(inRound1[0]!.decided).toBe('fix');
});

test('falls back (null) with no plan gate, or when a reply names a thread the plan lacks', () => {
  expect(joinPlan(POST, REPLIES, OFFERED, mrWith([]))).toBeNull();
  expect(joinPlan(POST, REPLIES, OFFERED, undefined)).toBeNull();
  const stray: ReplyEntry[] = [
    ...REPLIES,
    { thread: 'unknown', file: 'b.ts:9', verb: 'reply', text: 'x' },
  ];
  expect(joinPlan(POST, stray, OFFERED, mrWith([planGate()]))).toBeNull();
});

test('an unanswered plan gate still joins; threads with nothing to post carry no pick', () => {
  const joined = joinPlan(
    POST,
    REPLIES,
    OFFERED,
    mrWith([planGate({ status: 'open', answers: undefined })])
  )!;
  expect(joined.map(j => j.decided)).toEqual([undefined, undefined, undefined]);
  expect(joined[2]!.reply).toBeUndefined();
});

test('falls back (null) unless the offered options and the replies match one to one', () => {
  const plan = mrWith([planGate()]);
  expect(joinPlan(POST, REPLIES, ['t1'], plan)).toBeNull();
  expect(joinPlan(POST, REPLIES, ['t1', 't2', 't3'], plan)).toBeNull();
  expect(joinPlan(POST, REPLIES, ['t2', 't1'], plan)).not.toBeNull();
});
