import { describe, expect, test } from 'bun:test';

import { parseGateCtx } from '../gate-ctx.ts';

const PLAN = {
  'gate-ctx': 'plan@1',
  reviewer: 'renee',
  round: 1,
  threads: { total: 2, blocking: 1 },
  adjudication: 'both valid · fresh-context adjudicated',
};

const POST = {
  'gate-ctx': 'post@1',
  reviewer: 'renee',
  round: 1,
  replies: 2,
  fixes: [{ sha: 'ab12cd3' }],
};

const THREAD = {
  'gate-ctx': 'thread@1',
  author: 'renee',
  severity: 'blocking',
  claim: {
    summary:
      'the retry queue re-enqueues a job that already failed permanently.',
    points: [
      'permanent failures carry retryable: false, but enqueue() never reads it',
      'the other three callers all check it',
    ],
  },
  verdict: { call: 'valid', note: 'confirmed against the checkout' },
  reply: {
    kind: 'verbatim',
    text: 'fixed. enqueue() now drops non-retryable jobs; added a test.',
  },
};

const REPLIES = {
  'gate-ctx': 'replies@1',
  replies: [
    {
      thread: 't-1',
      file: 'queue/enqueue.ts:88',
      verb: 'fix',
      sha: 'ab12cd3',
      text: 'good call. enqueue() now drops non-retryable jobs.',
    },
    {
      thread: 't-2',
      file: 'queue/README.md:12',
      verb: 'reply',
      text: 'agreed on the wording; noted the contract in the doc.',
    },
  ],
};

const j = (v: unknown) => JSON.stringify(v);

describe('valid shapes', () => {
  test('plan@1', () => {
    expect(parseGateCtx(j(PLAN as any))).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      round: 1,
      adjudication: 'both valid · fresh-context adjudicated',
      threads: { total: 2, blocking: 1 },
    });
  });

  test('plan@1 minimal: blocking reads as 0, round and adjudication absent', () => {
    expect(
      parseGateCtx(
        j({ 'gate-ctx': 'plan@1', reviewer: 'renee', threads: { total: 3 } })
      )
    ).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      threads: { total: 3, blocking: 0 },
    });
  });

  test('post@1', () => {
    expect(parseGateCtx(j(POST as any))).toEqual({
      shape: 'post@1',
      reviewer: 'renee',
      round: 1,
      replies: 2,
      fixes: [{ sha: 'ab12cd3' }],
    });
  });

  test('post@1 minimal: fixes reads as empty', () => {
    expect(
      parseGateCtx(j({ 'gate-ctx': 'post@1', reviewer: 'renee', replies: 1 }))
    ).toEqual({ shape: 'post@1', reviewer: 'renee', replies: 1, fixes: [] });
  });

  test('post@1 may carry an adjudication', () => {
    expect(
      parseGateCtx(j({ ...POST, adjudication: 'both conceded' }))
    ).toMatchObject({ shape: 'post@1', adjudication: 'both conceded' });
  });

  test('thread@1', () => {
    expect(parseGateCtx(j(THREAD as any))).toEqual({
      shape: 'thread@1',
      author: 'renee',
      severity: 'blocking',
      claim: THREAD.claim as any,
      verdict: { call: 'valid', note: 'confirmed against the checkout' },
      reply: THREAD.reply as any,
    });
  });

  test('thread@1 minimal: points read as empty, no note, reply none without text', () => {
    expect(
      parseGateCtx(
        j({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'none',
          claim: { summary: 'a summary thread with no ask.' },
          verdict: { call: 'no-ask' },
          reply: { kind: 'none' },
        })
      )
    ).toEqual({
      shape: 'thread@1',
      author: 'renee',
      severity: 'none',
      claim: { summary: 'a summary thread with no ask.', points: [] },
      verdict: { call: 'no-ask' },
      reply: { kind: 'none' },
    });
  });

  test('thread@1 reply none may still carry a string text, which is dropped', () => {
    expect(
      parseGateCtx(j({ ...THREAD, reply: { kind: 'none', text: 'later' } }))
    ).toMatchObject({ reply: { kind: 'none' } });
  });

  test('thread@1 accepts every verdict call in the vocabulary', () => {
    for (const call of [
      'valid',
      'valid-low-value',
      'pushback',
      'needs-clarification',
      'no-ask',
    ] as const)
      expect(
        parseGateCtx(j({ ...THREAD, verdict: { call } } as any))
      ).toMatchObject({ verdict: { call } });
  });

  test('replies@1', () => {
    expect(parseGateCtx(j(REPLIES as any))).toEqual({
      shape: 'replies@1',
      replies: REPLIES.replies as any,
    });
  });

  test('replies@1 with an empty list', () => {
    expect(parseGateCtx(j({ 'gate-ctx': 'replies@1', replies: [] }))).toEqual({
      shape: 'replies@1',
      replies: [],
    });
  });

  test('leading whitespace before the object is fine', () => {
    expect(parseGateCtx(`\n  ${j(PLAN)}`)?.shape).toBe('plan@1');
  });
});

describe('unknown extra keys are accepted and dropped', () => {
  test('top level and nested', () => {
    const parsed = parseGateCtx(
      j({
        ...THREAD,
        extra: 1,
        claim: { ...THREAD.claim, extra: true },
        verdict: { ...THREAD.verdict, extra: 'x' },
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('extra');
    expect((parsed as { claim: object }).claim).not.toHaveProperty('extra');
  });

  test('inside a reply entry and a fix', () => {
    const parsed = parseGateCtx(
      j({
        ...REPLIES,
        replies: [{ ...REPLIES.replies[0], extra: 1 }],
      } as any)
    );
    expect(parsed).not.toBeNull();
    expect((parsed as { replies: object[] }).replies[0]).not.toHaveProperty(
      'extra'
    );
    expect(
      parseGateCtx(j({ ...POST, fixes: [{ sha: 'ab12cd3', note: 'x' }] }))
    ).toMatchObject({ fixes: [{ sha: 'ab12cd3' }] });
  });
});

describe('everything non-conforming returns null', () => {
  const cases: [string, string | undefined][] = [
    ['undefined', undefined],
    ['empty string', ''],
    ['prose', 'MR 87 has 2 unresolved threads. Recommendation below.'],
    ['a review-gate marker blob', '=== thread-1 a.ts:1 -- verdict valid ==='],
    ['malformed JSON', '{"gate-ctx": "plan@1", "reviewer":'],
    ['a JSON array', j([PLAN])],
    ['a JSON string', j('plan@1')],
    ['a JSON number', '42'],
    ['no tag', j({ reviewer: 'renee', threads: { total: 1 } })],
    ['unknown tag', j({ ...PLAN, 'gate-ctx': 'plan@2' })],
    ['non-string tag', j({ ...PLAN, 'gate-ctx': 1 })],
    ['prototype-named tag', j({ ...PLAN, 'gate-ctx': 'toString' })],
    // plan@1
    ['plan: missing reviewer', j({ ...PLAN, reviewer: undefined })],
    ['plan: empty reviewer', j({ ...PLAN, reviewer: '  ' })],
    ['plan: reviewer not a string', j({ ...PLAN, reviewer: 7 })],
    ['plan: missing threads', j({ ...PLAN, threads: undefined })],
    ['plan: threads not an object', j({ ...PLAN, threads: 2 })],
    ['plan: missing threads.total', j({ ...PLAN, threads: { blocking: 1 } })],
    ['plan: threads.total a string', j({ ...PLAN, threads: { total: '2' } })],
    ['plan: threads.total negative', j({ ...PLAN, threads: { total: -1 } })],
    ['plan: threads.total fractional', j({ ...PLAN, threads: { total: 1.5 } })],
    [
      'plan: threads.blocking wrong type',
      j({ ...PLAN, threads: { total: 2, blocking: 'one' } }),
    ],
    ['plan: round zero', j({ ...PLAN, round: 0 })],
    ['plan: round a string', j({ ...PLAN, round: '1' })],
    ['plan: round null', j({ ...PLAN, round: null })],
    ['plan: adjudication not a string', j({ ...PLAN, adjudication: 5 })],
    // post@1
    ['post: missing replies', j({ ...POST, replies: undefined })],
    ['post: replies a string', j({ ...POST, replies: '2' })],
    ['post: fixes not an array', j({ ...POST, fixes: { sha: 'ab12cd3' } })],
    ['post: fix sha not a string', j({ ...POST, fixes: [{ sha: 1 }] })],
    ['post: fix not an object', j({ ...POST, fixes: ['ab12cd3'] })],
    // thread@1
    ['thread: missing author', j({ ...THREAD, author: undefined })],
    ['thread: unknown severity', j({ ...THREAD, severity: 'urgent' })],
    ['thread: missing claim', j({ ...THREAD, claim: undefined })],
    [
      'thread: missing claim.summary',
      j({ ...THREAD, claim: { points: ['a'] } }),
    ],
    [
      'thread: claim.points not an array',
      j({ ...THREAD, claim: { summary: 's', points: 'a' } }),
    ],
    [
      'thread: claim.points with a non-string',
      j({ ...THREAD, claim: { summary: 's', points: [1] } }),
    ],
    ['thread: missing verdict', j({ ...THREAD, verdict: undefined })],
    [
      'thread: unknown verdict.call',
      j({ ...THREAD, verdict: { call: 'maybe' } }),
    ],
    [
      'thread: "invalid" is not in the verdict vocabulary',
      j({ ...THREAD, verdict: { call: 'invalid' } }),
    ],
    [
      'thread: verdict.note not a string',
      j({ ...THREAD, verdict: { call: 'valid', note: 5 } }),
    ],
    ['thread: missing reply', j({ ...THREAD, reply: undefined })],
    ['thread: unknown reply.kind', j({ ...THREAD, reply: { kind: 'draft' } })],
    [
      'thread: verbatim reply without text',
      j({ ...THREAD, reply: { kind: 'verbatim' } }),
    ],
    [
      'thread: direction reply with empty text',
      j({ ...THREAD, reply: { kind: 'direction', text: '' } }),
    ],
    [
      'thread: none reply with a non-string text',
      j({ ...THREAD, reply: { kind: 'none', text: 5 } }),
    ],
    // replies@1
    ['replies: missing list', j({ 'gate-ctx': 'replies@1' })],
    ['replies: list not an array', j({ 'gate-ctx': 'replies@1', replies: {} })],
    [
      'replies: entry missing file',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[1], file: undefined }] }),
    ],
    [
      'replies: entry missing text',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[1], text: undefined }] }),
    ],
    [
      'replies: entry unknown verb',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[1], verb: 'merge' }] }),
    ],
    [
      'replies: entry sha not a string',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[0], sha: 7 }] }),
    ],
    ['replies: entry not an object', j({ ...REPLIES, replies: ['t-1'] })],
  ];
  for (const [name, input] of cases)
    test(name, () => {
      expect(parseGateCtx(input)).toBeNull();
    });
});
