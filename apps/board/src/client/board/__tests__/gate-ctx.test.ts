import { describe, expect, test } from 'bun:test';

import { parseGateCtx } from '../gate-ctx.ts';

const PLAN = {
  'gate-ctx': 'plan@1',
  reviewer: 'renee',
  round: 1,
  threads: { total: 2, blocking: 1 },
  adjudication: 'both valid · fresh-context adjudicated',
} as const;

const POST = {
  'gate-ctx': 'post@1',
  reviewer: 'renee',
  round: 1,
  replies: 2,
  fixes: [{ sha: 'ab12cd3' }],
} as const;

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
} as const;

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
} as const;

const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary:
    'mechanism verified against the pinned deps; tests substantiate both criteria.',
  findings: { critical: 0, important: 1, minor: 4 },
  round: 2,
  re_review: true,
  prior: { addressed: 3, still_open: 1 },
} as const;

const FINDING = {
  id: 'f1',
  severity: 'important',
  title: 'retry fix is parity wiring, not a live fix',
  file: 'queue/enqueue.ts:81',
  body: 'the guard only runs on the parity path; the live path still re-enqueues.',
  fix: 'note it is parity wiring in the doc comment',
  evidence: 'enqueue.test.ts: 4 pass, 0 fail',
  disposition: 'new',
} as const;

const FINDINGS = {
  'gate-ctx': 'findings@1',
  findings: [
    FINDING,
    {
      id: 'f2',
      severity: 'minor',
      title: 'test over-specifies the ordering',
      body: 'asserts exact call order where the contract only promises the set.',
    },
  ],
} as const;

const j = (v: unknown) => JSON.stringify(v);

describe('valid shapes', () => {
  test('plan@1', () => {
    expect(parseGateCtx(j(PLAN))).toEqual({
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
    expect(parseGateCtx(j(POST))).toEqual({
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
    expect(parseGateCtx(j(THREAD))).toEqual({
      shape: 'thread@1',
      author: 'renee',
      severity: 'blocking',
      claim: { ...THREAD.claim, points: [...THREAD.claim.points] },
      verdict: { call: 'valid', note: 'confirmed against the checkout' },
      reply: THREAD.reply,
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
      expect(parseGateCtx(j({ ...THREAD, verdict: { call } }))).toMatchObject({
        verdict: { call },
      });
  });

  test('replies@1', () => {
    expect(parseGateCtx(j(REPLIES))).toEqual({
      shape: 'replies@1',
      replies: [...REPLIES.replies],
    });
  });

  test('replies@1 with an empty list', () => {
    expect(parseGateCtx(j({ 'gate-ctx': 'replies@1', replies: [] }))).toEqual({
      shape: 'replies@1',
      replies: [],
    });
  });

  test('review@1', () => {
    expect(parseGateCtx(j(REVIEW))).toEqual({
      shape: 'review@1',
      reviewer: 'renee',
      readiness: 'with-fixes',
      summary: REVIEW.summary,
      findings: { critical: 0, important: 1, minor: 4 },
      round: 2,
      re_review: true,
      prior: { addressed: 3, still_open: 1 },
    });
  });

  test('review@1 minimal: absent severities read 0, re_review reads false, no optional keys', () => {
    expect(
      parseGateCtx(
        j({
          'gate-ctx': 'review@1',
          readiness: 'yes',
          summary: 'clean.',
          findings: {},
        })
      )
    ).toEqual({
      shape: 'review@1',
      readiness: 'yes',
      summary: 'clean.',
      findings: { critical: 0, important: 0, minor: 0 },
      re_review: false,
    });
  });

  test('review@1 accepts every readiness in the engine vocabulary', () => {
    for (const readiness of ['yes', 'no', 'with-fixes'])
      expect(parseGateCtx(j({ ...REVIEW, readiness }))).toMatchObject({
        readiness,
      });
  });

  test('findings@1', () => {
    expect(parseGateCtx(j(FINDINGS))).toEqual({
      shape: 'findings@1',
      findings: [
        { ...FINDING },
        {
          id: 'f2',
          severity: 'minor',
          title: 'test over-specifies the ordering',
          body: 'asserts exact call order where the contract only promises the set.',
        },
      ],
    });
  });

  test('findings@1 accepts every severity and disposition', () => {
    for (const severity of ['critical', 'important', 'minor'])
      for (const disposition of ['new', 'still-open', 'addressed-check'])
        expect(
          parseGateCtx(
            j({
              ...FINDINGS,
              findings: [{ ...FINDING, severity, disposition }],
            })
          )
        ).toMatchObject({ findings: [{ severity, disposition }] });
  });

  test('findings@1 with an empty list', () => {
    expect(parseGateCtx(j({ 'gate-ctx': 'findings@1', findings: [] }))).toEqual(
      { shape: 'findings@1', findings: [] }
    );
  });

  test('leading whitespace before the object is fine', () => {
    expect(parseGateCtx(`\n  ${j(PLAN)}`)?.shape).toBe('plan@1');
  });

  test('a whitespace-only optional string is absent, not preserved', () => {
    expect(parseGateCtx(j({ ...PLAN, adjudication: '   ' }))).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      round: 1,
      threads: { total: 2, blocking: 1 },
    });
    const parsed = parseGateCtx(
      j({ ...FINDINGS, findings: [{ ...FINDING, file: '  ' }] })
    );
    expect(parsed).toEqual({
      shape: 'findings@1',
      findings: [{ ...FINDING, file: undefined }],
    });
    expect(
      parsed?.shape === 'findings@1' && 'file' in parsed.findings[0]!
    ).toBe(false);
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
      })
    );
    expect(parsed).not.toBeNull();
    expect((parsed as { replies: object[] }).replies[0]).not.toHaveProperty(
      'extra'
    );
    expect(
      parseGateCtx(j({ ...POST, fixes: [{ sha: 'ab12cd3', note: 'x' }] }))
    ).toMatchObject({ fixes: [{ sha: 'ab12cd3' }] });
  });

  test('review@1 top level, counts, and prior', () => {
    const parsed = parseGateCtx(
      j({
        ...REVIEW,
        extra: 1,
        findings: { ...REVIEW.findings, nit: 2 },
        prior: { ...REVIEW.prior, extra: true },
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('extra');
    expect((parsed as { findings: object }).findings).not.toHaveProperty('nit');
    expect((parsed as { prior: object }).prior).not.toHaveProperty('extra');
  });

  test('inside a finding entry', () => {
    const parsed = parseGateCtx(
      j({ ...FINDINGS, findings: [{ ...FINDING, extra: 'x' }] })
    );
    expect((parsed as { findings: object[] }).findings[0]).not.toHaveProperty(
      'extra'
    );
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
    // review@1
    ['review: missing readiness', j({ ...REVIEW, readiness: undefined })],
    [
      'review: readiness outside the vocabulary',
      j({ ...REVIEW, readiness: 'ready' }),
    ],
    ['review: readiness a boolean', j({ ...REVIEW, readiness: true })],
    ['review: missing summary', j({ ...REVIEW, summary: undefined })],
    ['review: empty summary', j({ ...REVIEW, summary: ' ' })],
    ['review: missing findings', j({ ...REVIEW, findings: undefined })],
    ['review: findings an array', j({ ...REVIEW, findings: [1, 4] })],
    ['review: a count as a string', j({ ...REVIEW, findings: { minor: '4' } })],
    ['review: a negative count', j({ ...REVIEW, findings: { minor: -1 } })],
    ['review: a fractional count', j({ ...REVIEW, findings: { minor: 1.5 } })],
    ['review: reviewer not a string', j({ ...REVIEW, reviewer: 7 })],
    ['review: round zero', j({ ...REVIEW, round: 0 })],
    ['review: re_review a string', j({ ...REVIEW, re_review: 'true' })],
    ['review: prior null', j({ ...REVIEW, prior: null })],
    [
      'review: prior missing still_open',
      j({ ...REVIEW, prior: { addressed: 3 } }),
    ],
    [
      'review: prior.addressed negative',
      j({ ...REVIEW, prior: { addressed: -1, still_open: 1 } }),
    ],
    // findings@1
    ['findings: missing list', j({ 'gate-ctx': 'findings@1' })],
    [
      'findings: list not an array',
      j({ 'gate-ctx': 'findings@1', findings: {} }),
    ],
    ['findings: entry not an object', j({ ...FINDINGS, findings: ['f1'] })],
    [
      'findings: entry missing id',
      j({ ...FINDINGS, findings: [{ ...FINDING, id: undefined }] }),
    ],
    [
      'findings: entry missing title',
      j({ ...FINDINGS, findings: [{ ...FINDING, title: undefined }] }),
    ],
    [
      'findings: entry missing body',
      j({ ...FINDINGS, findings: [{ ...FINDING, body: undefined }] }),
    ],
    [
      'findings: entry empty body',
      j({ ...FINDINGS, findings: [{ ...FINDING, body: '' }] }),
    ],
    [
      'findings: severity outside the vocabulary',
      j({ ...FINDINGS, findings: [{ ...FINDING, severity: 'nit' }] }),
    ],
    [
      'findings: severity in the label casing',
      j({ ...FINDINGS, findings: [{ ...FINDING, severity: 'Important' }] }),
    ],
    [
      'findings: file not a string',
      j({ ...FINDINGS, findings: [{ ...FINDING, file: 81 }] }),
    ],
    [
      'findings: fix null',
      j({ ...FINDINGS, findings: [{ ...FINDING, fix: null }] }),
    ],
    [
      'findings: evidence not a string',
      j({ ...FINDINGS, findings: [{ ...FINDING, evidence: 7 }] }),
    ],
    [
      'findings: unknown disposition',
      j({ ...FINDINGS, findings: [{ ...FINDING, disposition: 'fixed' }] }),
    ],
  ];
  for (const [name, input] of cases)
    test(name, () => {
      expect(parseGateCtx(input)).toBeNull();
    });
});
