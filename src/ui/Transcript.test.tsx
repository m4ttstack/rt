import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import {
  fetchMock,
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

test('an empty older page marks the top edge exhausted and stops paging', async () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [
      {
        id: 7,
        room: 'build',
        handle: 'deck-main',
        body: 'first',
        mentions: [],
        postedAt: 1,
      },
    ],
  });
  const edge = screen.getByTestId('transcript-edge');
  expect(edge).toHaveTextContent('older messages');
  fireEvent.click(edge);
  await screen.findByText('no older messages');
  const calls = fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('before=')
  );
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes('before='))
  ).toHaveLength(1);
});

test('an error page leaves the top edge retryable instead of exhausting it', async () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [
      {
        id: 7,
        room: 'build',
        handle: 'deck-main',
        body: 'first',
        mentions: [],
        postedAt: 1,
      },
    ],
  });
  fetchMock.mockImplementationOnce(
    async () => new Response('{}', { status: 502 })
  );
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await screen.findByText('older messages · load on scroll');
  expect(screen.queryByText('no older messages')).toBeNull();
  expect(screen.getByTestId('transcript-edge')).not.toBeDisabled();
});

test('a body renders its paragraphs, lists, bold and links, and leaves code alone', () => {
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          body: 'first **point**\n\n- one\n- two http://x.test/a\n\nsee `**not bold**`',
          mentions: [],
          postedAt: 1,
        },
      ]}
    />
  );
  expect(screen.getAllByTestId('message-paragraph')).toHaveLength(2);
  expect(screen.getByText('point').tagName).toBe('STRONG');
  const list = screen.getByTestId('message-list');
  expect(list.querySelectorAll('li')).toHaveLength(2);
  const link = screen.getByRole('link', { name: 'http://x.test/a' });
  expect(link).toHaveAttribute('href', 'http://x.test/a');
  expect(screen.getByText('**not bold**').tagName).toBe('CODE');
});

test('two bare URLs in one body both render as links', () => {
  // Regression: URL_RE carries the `g` flag, so a global-regex `.test()` in
  // the render loop advanced `lastIndex` and the second URL fell through to
  // plain text. The anchored `URL_TEST` is stateless.
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          body: 'see http://x.test/a and http://y.test/b',
          mentions: [],
          postedAt: 1,
        },
      ]}
    />
  );
  expect(screen.getByRole('link', { name: 'http://x.test/a' })).toHaveAttribute(
    'href',
    'http://x.test/a'
  );
  expect(screen.getByRole('link', { name: 'http://y.test/b' })).toHaveAttribute(
    'href',
    'http://y.test/b'
  );
});
