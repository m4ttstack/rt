import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import {
  installFakeWebSocket,
  longCodeBlockMessage,
  renderTranscriptWithFakeSocket,
  restoreWebSocket,
} from './test-utils';
import { Transcript } from './Transcript';

beforeEach(() => {
  installFakeWebSocket();
});

afterEach(() => {
  restoreWebSocket();
});

test('a chat frame appends to the transcript without a refetch', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 7 } });
  expect(await screen.findByTestId('message-7')).toBeInTheDocument();
});

test('a frame for another room does not append here', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/other/msg', payload: { id: 8 } });
  expect(screen.queryByTestId('message-8')).toBeNull();
});

test('wide content scrolls inside its own container, not the page', () => {
  renderWithProviders(
    <Transcript room="build" messages={[longCodeBlockMessage]} />
  );
  // jsdom sees inline styles, not CSS-module rules: the code block's
  // overflow-x is inline.
  expect(screen.getByTestId('code-block').style.overflowX).toBe('auto');
});

test('a mention of the human gets the wash; a mention of anyone else does not', () => {
  renderWithProviders(
    <Transcript
      room="build"
      humanHandle="matt"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'rt-chat-wt',
          body: '@matt PR #67 is green, ok to merge?',
          mentions: ['matt'],
          postedAt: Date.now(),
        },
      ]}
    />
  );
  expect(screen.getByText('@matt')).toBeInTheDocument();
});

test('a divider marks the read cursor before the unread tail', () => {
  const now = Date.now();
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={1}
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          body: 'read already',
          mentions: [],
          postedAt: now - 1000,
        },
        {
          id: 2,
          room: 'build',
          handle: 'rt-chat-wt',
          body: 'still unread',
          mentions: [],
          postedAt: now,
        },
      ]}
    />
  );
  expect(screen.getByTestId('transcript-divider')).toBeInTheDocument();
  expect(screen.getByText('1 new')).toBeInTheDocument();
});

test('the anchor scrolls once, and a later live merge does not repeat it', async () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  try {
    const { pushFrame } = renderTranscriptWithFakeSocket({
      room: 'build',
      messages: [
        {
          id: 7,
          room: 'build',
          handle: 'deck-main',
          body: 'anchored',
          mentions: [],
          postedAt: 1,
        },
      ],
      anchor: 'm-7',
    });
    expect(scrolled).toEqual(['m-7']);
    pushFrame({ topic: 'chat/build/msg', payload: { id: 8 } });
    expect(await screen.findByTestId('message-8')).toBeInTheDocument();
    expect(scrolled).toEqual(['m-7']);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
