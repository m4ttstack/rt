import { expect, test } from 'bun:test';

import type { GateQuestion } from '@mattstack/gate-kit';
import { postPicks, postTally } from '../respond-post.ts';

const reply = (thread: string, verb: 'fix' | 'reply') =>
  JSON.stringify({
    'gate-ctx': 'reply@1',
    thread,
    file: `${thread}.ts:1`,
    verb,
    ...(verb === 'fix' ? { sha: 'ab12cd3' } : {}),
    text: `reply for ${thread}`,
  });

const threadQ = (
  n: number,
  thread: string,
  verb: 'fix' | 'reply',
  over: Partial<GateQuestion> = {}
): GateQuestion => ({
  id: `thread-${n}`,
  label: `${thread}.ts:1`,
  multi: true,
  context: reply(thread, verb),
  options: [
    { value: `post:${thread}`, label: 'Post (Recommended)' },
    {
      value: `resolve:${thread}`,
      label: verb === 'fix' ? 'Resolve (Recommended)' : 'Resolve',
    },
  ],
  ...over,
});

const NEXT: GateQuestion = {
  id: 'next',
  label: 'Next',
  multi: false,
  options: ['proceed', 'iterate', 'hold'],
};

test('each thread question yields its pick, with the recommended options as its defaults', () => {
  const picks = postPicks([
    threadQ(1, 'T1', 'fix'),
    threadQ(2, 'T2', 'reply'),
    NEXT,
  ]);
  expect(picks.map(p => [p.name, p.threadId, p.label, p.defaults])).toEqual([
    ['thread-1', 'T1', 'T1.ts:1', ['post:T1', 'resolve:T1']],
    ['thread-2', 'T2', 'T2.ts:1', ['post:T2']],
  ]);
  expect(picks[0]!.reply).toMatchObject({ verb: 'fix', sha: 'ab12cd3' });
  expect(picks[1]!.reply?.text).toBe('reply for T2');
});

test('a thread whose context fell back to prose is still a pick, with no reply entry', () => {
  const [pick] = postPicks([
    threadQ(1, 'T1', 'fix', { context: 'T1.ts:1 FIX · ab12cd3: reply for T1' }),
  ]);
  expect(pick?.threadId).toBe('T1');
  expect(pick?.reply).toBeUndefined();
});

test('a reply context naming another thread is not trusted', () => {
  const [pick] = postPicks([
    threadQ(1, 'T1', 'fix', { context: reply('T9', 'fix') }),
  ]);
  expect(pick?.reply).toBeUndefined();
});

test('anything but a multi with exactly post:<id> and resolve:<id> is not a pick', () => {
  const pair = threadQ(1, 'T1', 'fix');
  expect(postPicks([{ ...pair, multi: false }])).toEqual([]);
  expect(
    postPicks([{ ...pair, options: [...pair.options, 'skip:T1'] }])
  ).toEqual([]);
  expect(postPicks([{ ...pair, options: ['post:T1', 'resolve:T2'] }])).toEqual(
    []
  );
  expect(
    postPicks([
      {
        id: 'replies',
        label: 'Post which replies?',
        multi: true,
        options: ['T1', 'T2'],
      },
    ])
  ).toEqual([]);
});

test('the tally counts threads posting and threads resolving, independently', () => {
  const picks = postPicks([threadQ(1, 'T1', 'fix'), threadQ(2, 'T2', 'reply')]);
  expect(
    postTally(picks, {
      'thread-1': ['post:T1', 'resolve:T1'],
      'thread-2': ['resolve:T2'],
    })
  ).toEqual({ posting: 1, resolving: 2 });
  expect(postTally(picks, { 'thread-1': [], 'thread-2': [] })).toEqual({
    posting: 0,
    resolving: 0,
  });
});
