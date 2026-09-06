import type { ChatMessage, RoomSummary } from '@mattstack/rt-client';
import { expect, test } from 'vitest';

import { buildInbox, excerptFor } from './inbox';

function msg(
  over: Partial<ChatMessage> & { id: number; body: string }
): ChatMessage {
  return {
    room: 'rt',
    handle: 'jay',
    mentions: [],
    postedAt: over.id * 1000,
    ...over,
  };
}

const room = (over: Partial<RoomSummary> & { room: string }): RoomSummary => ({
  memberCount: 3,
  unread: 0,
  mentions: 0,
  ...over,
});

test('a message mentioning matt lands in needsYou as a mention', () => {
  const rt = room({ room: 'rt', unread: 1 });
  const m = msg({
    id: 10,
    body: '@matt can you look at this',
    mentions: ['matt'],
  });
  const inbox = buildInbox([rt], new Map([['rt', [m]]]), 'matt');
  expect(inbox.needsYou).toMatchObject([{ messageId: 10, reason: 'mention' }]);
  expect(inbox.openAsks).toEqual([]);
});

test('an agent message in a matt DM lands in needsYou as a dm-turn', () => {
  const dm = room({
    room: 'dm-x',
    unread: 1,
    kind: 'dm',
    participants: { a: 'jay', b: 'matt' },
  });
  const m = msg({
    id: 20,
    room: 'dm-x',
    handle: 'jay',
    body: 'ready for review',
  });
  const inbox = buildInbox([dm], new Map([['dm-x', [m]]]), 'matt');
  expect(inbox.needsYou).toMatchObject([{ messageId: 20, reason: 'dm-turn' }]);
});

test("matt's own message in his DM is not a dm-turn", () => {
  const dm = room({
    room: 'dm-x',
    unread: 1,
    kind: 'dm',
    participants: { a: 'jay', b: 'matt' },
  });
  const m = msg({ id: 21, room: 'dm-x', handle: 'matt', body: 'on it' });
  const inbox = buildInbox([dm], new Map([['dm-x', [m]]]), 'matt');
  expect(inbox.needsYou).toEqual([]);
});

test('a message that both mentions matt and is a DM turn counts once, as a mention', () => {
  const dm = room({
    room: 'dm-x',
    unread: 1,
    kind: 'dm',
    participants: { a: 'jay', b: 'matt' },
  });
  const m = msg({
    id: 22,
    room: 'dm-x',
    handle: 'jay',
    body: '@matt ping',
    mentions: ['matt'],
  });
  const inbox = buildInbox([dm], new Map([['dm-x', [m]]]), 'matt');
  expect(inbox.needsYou).toHaveLength(1);
  expect(inbox.needsYou[0]?.reason).toBe('mention');
});

test('an @here message with no later reply is an open ask', () => {
  const rt = room({ room: 'rt', unread: 1 });
  const m = msg({ id: 30, body: '@here can someone check main' });
  const inbox = buildInbox([rt], new Map([['rt', [m]]]), 'matt');
  expect(inbox.openAsks).toMatchObject([{ messageId: 30, reason: 'open-ask' }]);
});

test('an @here message answered by a later reply is excluded', () => {
  const rt = room({ room: 'rt', unread: 2 });
  const ask = msg({ id: 40, body: '@here can someone check main' });
  const reply = msg({ id: 41, handle: 'kai', body: 'on it', replyTo: 40 });
  const inbox = buildInbox([rt], new Map([['rt', [ask, reply]]]), 'matt');
  expect(inbox.openAsks).toEqual([]);
  expect(inbox.needsYou).toEqual([]);
  expect(inbox.elsewhere).toEqual([
    { room: 'rt', kind: 'room', unread: 2, mentions: 0 },
  ]);
});

test('a DM never produces an open ask, even with @here in the body', () => {
  const dm = room({
    room: 'dm-x',
    unread: 1,
    kind: 'dm',
    participants: { a: 'jay', b: 'kai' },
  });
  const m = msg({ id: 50, room: 'dm-x', body: '@here anyone around' });
  const inbox = buildInbox([dm], new Map([['dm-x', [m]]]), 'matt');
  expect(inbox.openAsks).toEqual([]);
  expect(inbox.elsewhere).toEqual([
    { room: 'dm-x', kind: 'dm', unread: 1, mentions: 0 },
  ]);
});

test('messages before the cursor never reach the builder, so they never produce a card', () => {
  // buildInbox trusts pagesByRoom as already narrowed to unread; a message
  // that mentions matt but sits outside that narrowed page (as an old,
  // already-read message would) is simply absent from the input.
  const rt = room({ room: 'rt', unread: 1 });
  const unread = msg({ id: 61, body: 'just chatting, nothing needed' });
  const inbox = buildInbox([rt], new Map([['rt', [unread]]]), 'matt');
  expect(inbox.needsYou.some(c => c.messageId === 60)).toBe(false);
  expect(inbox.needsYou).toEqual([]);
});

test('unread messages that become no card are counted into elsewhere, per room', () => {
  const skills = room({ room: 'skills', unread: 3, mentions: 0 });
  const messages = [
    msg({ id: 70, room: 'skills', body: 'building the pipeline' }),
    msg({ id: 71, room: 'skills', body: 'still going' }),
    msg({ id: 72, room: 'skills', body: 'green now' }),
  ];
  const inbox = buildInbox([skills], new Map([['skills', messages]]), 'matt');
  expect(inbox.elsewhere).toEqual([
    { room: 'skills', kind: 'room', unread: 3, mentions: 0 },
  ]);
});

test('elsewhere counts the full unread total, not just what was fetched', () => {
  const rt = room({ room: 'rt', unread: 120, mentions: 0 });
  const messages = [msg({ id: 80, body: 'one of the fifty fetched' })];
  const inbox = buildInbox([rt], new Map([['rt', messages]]), 'matt');
  expect(inbox.elsewhere).toEqual([
    { room: 'rt', kind: 'room', unread: 120, mentions: 0 },
  ]);
});

test('a room with zero remaining unread is omitted from elsewhere entirely', () => {
  const rt = room({ room: 'rt', unread: 1 });
  const m = msg({ id: 90, body: '@matt look', mentions: ['matt'] });
  const inbox = buildInbox([rt], new Map([['rt', [m]]]), 'matt');
  expect(inbox.elsewhere).toEqual([]);
});

test('rooms with zero unread are skipped entirely', () => {
  const rt = room({ room: 'rt', unread: 0 });
  const inbox = buildInbox([rt], new Map(), 'matt');
  expect(inbox.needsYou).toEqual([]);
  expect(inbox.openAsks).toEqual([]);
  expect(inbox.elsewhere).toEqual([]);
});

test('a DM missing its participants is skipped as malformed', () => {
  const dm = room({ room: 'dm-broken', unread: 2, kind: 'dm' });
  const m = msg({ id: 100, room: 'dm-broken', body: 'hello' });
  const inbox = buildInbox([dm], new Map([['dm-broken', [m]]]), 'matt');
  expect(inbox.needsYou).toEqual([]);
  expect(inbox.elsewhere).toEqual([]);
});

test('needsYou and openAsks sort newest first across rooms', () => {
  const rt = room({ room: 'rt', unread: 1 });
  const skills = room({ room: 'skills', unread: 1 });
  const older = msg({
    id: 110,
    room: 'rt',
    body: '@matt first',
    mentions: ['matt'],
    postedAt: 100,
  });
  const newer = msg({
    id: 111,
    room: 'skills',
    body: '@matt second',
    mentions: ['matt'],
    postedAt: 200,
  });
  const inbox = buildInbox(
    [rt, skills],
    new Map([
      ['rt', [older]],
      ['skills', [newer]],
    ]),
    'matt'
  );
  expect(inbox.needsYou.map(c => c.messageId)).toEqual([111, 110]);
});

test('excerptFor drops fenced code blocks entirely', () => {
  const body =
    'the fix:\n\n```\nconst x = 1;\nlots of log lines here\n```\n\nships tonight';
  expect(excerptFor(body)).toBe('the fix:');
});

test('excerptFor unwraps inline code and resolves links to their text', () => {
  const body =
    'see `run.ts` and the [tracking ticket](https://example.com/CHAT-5) for details';
  expect(excerptFor(body)).toBe(
    'see run.ts and the tracking ticket for details'
  );
});

test('excerptFor takes only the first paragraph', () => {
  const body = 'first paragraph here.\n\nsecond paragraph, never included.';
  expect(excerptFor(body)).toBe('first paragraph here.');
});

test('excerptFor caps at roughly 200 characters', () => {
  const body = 'x'.repeat(250);
  const out = excerptFor(body);
  expect(out.length).toBeLessThanOrEqual(203);
  expect(out.endsWith('...')).toBe(true);
});
