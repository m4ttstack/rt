import type { ChatMessage } from '@mattstack/rt-client';
import { expect, test } from 'vitest';

import { isOpenAsk } from './open-ask';

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

test('isOpenAsk is false for a message that never mentions here', () => {
  const m = msg({ id: 120, body: 'just an update' });
  expect(isOpenAsk(m, [])).toBe(false);
});

test('isOpenAsk is true for @here with no reply pointing at it', () => {
  const m = msg({ id: 121, body: '@here anyone free' });
  const other = msg({ id: 122, body: 'unrelated' });
  expect(isOpenAsk(m, [other])).toBe(true);
});

test('isOpenAsk is false once a later message replies to it', () => {
  const m = msg({ id: 123, body: '@here anyone free' });
  const reply = msg({ id: 124, body: 'yep', replyTo: 123 });
  expect(isOpenAsk(m, [reply])).toBe(false);
});
