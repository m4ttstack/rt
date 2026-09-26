import { expect, test } from 'bun:test';

import type { GateQuestion } from '@mattstack/gate-kit';
import {
  isEdited,
  planReplies,
  planTexts,
  postPicks,
  postTally,
  postTexts,
  type PostPick,
} from '../respond-post.ts';

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

const pick = (name: string, id: string, text: string): PostPick => ({
  name,
  threadId: id,
  label: `${id}.ts:1`,
  reply: { thread: id, file: `${id}.ts:1`, verb: 'reply', text },
  post: `post:${id}`,
  resolve: `resolve:${id}`,
  defaults: [`post:${id}`],
});

test('postTexts sends a trimmed edit only for a posting thread whose edit differs', () => {
  const picks = [
    pick('thread-1', 'T1', 'draft one'),
    pick('thread-2', 'T2', 'draft two'),
    pick('thread-3', 'T3', 'draft three'),
  ];
  const selections = {
    'thread-1': ['post:T1'],
    'thread-2': ['resolve:T2'],
    'thread-3': ['post:T3'],
  };
  const texts = {
    'thread-1': '  edited one \n',
    'thread-2': 'held edit',
    'thread-3': ' draft three ',
  };
  expect(postTexts(picks, selections, texts)).toEqual({
    'thread-1': 'edited one',
  });
});

test('postTexts is null when a posting thread was emptied, never when a held one was', () => {
  const picks = [pick('thread-1', 'T1', 'd1'), pick('thread-2', 'T2', 'd2')];
  expect(
    postTexts(
      picks,
      { 'thread-1': ['post:T1'], 'thread-2': [] },
      { 'thread-1': '   ' }
    )
  ).toBeNull();
  expect(
    postTexts(picks, { 'thread-1': [], 'thread-2': [] }, { 'thread-1': '   ' })
  ).toEqual({});
});

test('isEdited ignores surrounding whitespace', () => {
  const p = pick('thread-1', 'T1', 'draft');
  expect(isEdited(p, {})).toBe(false);
  expect(isEdited(p, { 'thread-1': ' draft\n' })).toBe(false);
  expect(isEdited(p, { 'thread-1': 'draft, edited' })).toBe(true);
});

const planQ = (
  n: number,
  id: string,
  kind: 'verbatim' | 'direction',
  text: string
) => ({
  id: `thread-${n}`,
  label: `${id}.ts:1`,
  multi: false,
  context: JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'question',
    claim: { summary: 'a claim' },
    verdict: { call: 'pushback' },
    reply: { kind, text },
  }),
  options: [
    { value: `reply:${id}`, label: 'reply' },
    { value: `fix:${id}`, label: 'fix' },
    { value: `skip:${id}`, label: 'skip' },
  ],
});

test('planReplies lists only verbatim replies, with their reply option', () => {
  const qs = [
    planQ(1, 'T1', 'verbatim', 'draft one'),
    planQ(2, 'T2', 'direction', 'intent'),
  ];
  expect(planReplies(qs)).toEqual([
    {
      name: 'thread-1',
      label: 'T1.ts:1',
      draft: 'draft one',
      value: 'reply:T1',
    },
  ]);
});

test('planTexts sends a trimmed edit only for a reply pick whose edit differs', () => {
  const replies = planReplies([
    planQ(1, 'T1', 'verbatim', 'one'),
    planQ(2, 'T2', 'verbatim', 'two'),
  ]);
  expect(
    planTexts(
      replies,
      { 'thread-1': 'reply:T1', 'thread-2': 'fix:T2' },
      { 'thread-1': ' one, edited ', 'thread-2': 'kept for later' }
    )
  ).toEqual({ 'thread-1': 'one, edited' });
  expect(
    planTexts(replies, { 'thread-1': 'reply:T1' }, { 'thread-1': ' one ' })
  ).toEqual({});
  expect(
    planTexts(replies, { 'thread-1': 'reply:T1' }, { 'thread-1': '  ' })
  ).toBeNull();
  expect(
    planTexts(replies, { 'thread-1': 'skip:T1' }, { 'thread-1': '  ' })
  ).toEqual({});
});
