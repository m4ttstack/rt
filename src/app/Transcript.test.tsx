import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  FakeWebSocket,
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
  window.localStorage.removeItem('chat-expand-all');
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

test('a reconnect refetches the tail without a frame', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 1 } });
  expect(await screen.findByText('message 1')).toBeInTheDocument();
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.onopen?.();
  const before = fetchMock.mock.calls.length;
  socket.onopen?.();
  await waitFor(() =>
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
  );
});

test('a fenced block renders as a CodeBlock inside the message, never widening the column', async () => {
  renderWithProviders(
    <Transcript room="build" messages={[longCodeBlockMessage]} />
  );
  const block = await screen.findByTestId('code-block');
  await waitFor(() => expect(block).toHaveTextContent('Cannot find module'));
  expect(screen.getByTestId('transcript-column')).toBeInTheDocument();
});

test('a mention of the human is marked as me; the human’s own post is marked mine', () => {
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
        {
          id: 2,
          room: 'build',
          handle: 'matt',
          body: 'merge it',
          mentions: [],
          postedAt: Date.now(),
        },
      ]}
    />
  );
  const mention = screen.getByText('@matt');
  expect(mention).toHaveAttribute('data-mention', 'matt');
  expect(mention).toHaveAttribute('data-me', 'true');
  expect(screen.getByTestId('message-1')).not.toHaveAttribute('data-mine');
  expect(screen.getByTestId('message-2')).toHaveAttribute('data-mine', 'true');
  expect(screen.getByTestId('message-2')).toHaveTextContent('you');
});

test("each speaker's handle chip carries its own hue, and the human's is accent", () => {
  renderWithProviders(
    <Transcript
      room="build"
      humanHandle="matt"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'fox',
          body: 'first',
          mentions: [],
          postedAt: 1,
        },
        {
          id: 2,
          room: 'build',
          handle: 'max',
          body: 'second',
          mentions: [],
          postedAt: 2,
        },
        {
          id: 3,
          room: 'build',
          handle: 'matt',
          body: 'third',
          mentions: [],
          postedAt: 3,
        },
      ]}
    />
  );
  const chips = screen.getAllByTestId('speaker-chip');
  expect(chips).toHaveLength(3);
  const [foxColor, maxColor, mattColor] = chips.map(chip =>
    chip.style.getPropertyValue('--speaker-hue')
  );
  expect(foxColor).not.toBe(maxColor);
  expect(mattColor).toContain('accent');
});

test('markdown structure reaches the row: paragraphs, a list, code untouched', () => {
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          body: 'first **point**\n\n- one\n- two\n\nsee `**not bold**`',
          mentions: [],
          postedAt: 1,
        },
      ]}
    />
  );
  const body = screen.getByTestId('message-body');
  expect(body.querySelectorAll('p')).toHaveLength(2);
  expect(body.querySelector('strong')).toHaveTextContent('point');
  expect(body.querySelectorAll('li')).toHaveLength(2);
  expect(screen.getByText('**not bold**').tagName).toBe('CODE');
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

test('a notice renders at the edge, above the older-messages row, and without any messages at all', () => {
  const one = [
    {
      id: 1,
      room: 'build',
      handle: 'meg',
      body: 'hi',
      mentions: [],
      postedAt: 1,
    },
  ];
  const { unmount } = renderWithProviders(
    <Transcript
      room="build"
      messages={one}
      notice={<span>invited 2 · acme accepted</span>}
    />
  );
  const notice = screen.getByTestId('transcript-notice');
  expect(notice).toHaveTextContent('invited 2 · acme accepted');
  expect(
    notice.compareDocumentPosition(screen.getByTestId('transcript-edge')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  unmount();
  renderWithProviders(
    <Transcript room="quiet" messages={[]} notice={<span>invited 1</span>} />
  );
  expect(screen.getByTestId('transcript-notice')).toHaveTextContent(
    'invited 1'
  );
});

test('two bare URLs in one body both render as links', () => {
  // remark-gfm autolinks bare URLs; both instances in one body must resolve,
  // not just the first, at the Transcript level (not just inside
  // MessageMarkdown's own suite).
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

test('a day divider sits between messages on different days, never between same-day ones', () => {
  // Today at noon: `Transcript` labels against the real clock, so the
  // fixture must be anchored to the day the test runs, never a fixed date.
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const now = noon.getTime();
  const msg = (id: number, postedAt: number) => ({
    id,
    room: 'build',
    handle: 'fred',
    body: `m${id}`,
    mentions: [],
    postedAt,
  });
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        msg(1, now - 2 * 86_400_000),
        msg(2, now - 2 * 86_400_000 + 60_000),
        msg(3, now - 86_400_000),
        msg(4, now),
      ]}
    />
  );
  const dividers = screen.getAllByTestId('day-divider');
  expect(dividers.map(d => d.getAttribute('aria-label'))).toEqual([
    'Yesterday',
    'Today',
  ]);
  expect(
    screen
      .getByTestId('message-4')
      .querySelector('[title]')
      ?.getAttribute('title')
  ).toBe(new Date(now).toLocaleString());
});

function viewOf(transcript: HTMLElement): HTMLElement {
  return transcript.querySelector<HTMLElement>('[class*="view"]')!;
}

function scrollTo(view: HTMLElement, top: number, height = 1000, client = 300) {
  Object.defineProperty(view, 'scrollHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(view, 'clientHeight', {
    configurable: true,
    value: client,
  });
  Object.defineProperty(view, 'scrollTop', {
    configurable: true,
    writable: true,
    value: top,
  });
  fireEvent.scroll(view);
}

test('the new pill counts live arrivals while scrolled up and goes away at the bottom', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [
      {
        id: 1,
        room: 'build',
        handle: 'fred',
        body: 'first',
        mentions: [],
        postedAt: Date.now(),
      },
    ],
  });
  const view = viewOf(screen.getByTestId('transcript-scroll'));
  expect(screen.queryByTestId('new-pill')).toBeNull();

  scrollTo(view, 100);
  expect(screen.getByTestId('new-pill')).toHaveTextContent('↓ latest');

  pushFrame({ topic: 'chat/build/msg', payload: { id: 7 } });
  await screen.findByTestId('message-7');
  expect(screen.getByTestId('new-pill')).toHaveTextContent('↓ 1 new');

  scrollTo(view, 700);
  expect(screen.queryByTestId('new-pill')).toBeNull();
});

test('loading an older page puts a day divider above what was the first message', async () => {
  const now = Date.now();
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [
      {
        id: 5,
        room: 'build',
        handle: 'fred',
        body: 'new',
        mentions: [],
        postedAt: now,
      },
    ],
  });
  expect(screen.queryByTestId('day-divider')).toBeNull();
  // Queued AFTER the render: `renderTranscriptWithFakeSocket` installs the
  // fetch mock, and the `before=` request is the next call it answers.
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [
        {
          id: 1,
          room: 'build',
          handle: 'fred',
          body: 'old',
          mentions: [],
          postedAt: now - 3 * 86_400_000,
        },
      ],
    }),
  } as Response);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await screen.findByTestId('message-1');
  // Two: one above the loaded page (labelled with message 1's own day,
  // which depends on the clock) and one at the boundary into today.
  const labels = screen
    .getAllByTestId('day-divider')
    .map(d => d.getAttribute('aria-label'));
  expect(labels).toHaveLength(2);
  expect(labels[1]).toBe('Today');
});

function withTallBodies(run: () => void) {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight'
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === 'message-body' ? 900 : 0;
    },
  });
  try {
    run();
  } finally {
    if (original)
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .scrollHeight;
  }
}

const tall = {
  id: 1,
  room: 'build',
  handle: 'fred',
  body: Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'),
  mentions: [],
  postedAt: Date.now(),
};

test('a tall body folds with a show more control, and unfolds on click', async () => {
  withTallBodies(() => {
    renderWithProviders(<Transcript room="build" messages={[tall]} />);
  });
  const fold = screen.getByTestId('message-fold');
  expect(fold).toHaveAttribute('data-folded', 'true');
  fireEvent.click(screen.getByTestId('fold-toggle'));
  expect(fold).toHaveAttribute('data-folded', 'false');
  expect(screen.getByTestId('fold-toggle')).toHaveTextContent('show less');
});

test('the app-wide expand-all preference unfolds a tall body and hides its control', () => {
  window.localStorage.setItem('chat-expand-all', 'true');
  withTallBodies(() => {
    renderWithProviders(<Transcript room="build" messages={[tall]} />);
  });
  expect(screen.getByTestId('message-fold')).toHaveAttribute(
    'data-folded',
    'false'
  );
  expect(screen.queryByTestId('fold-toggle')).not.toBeInTheDocument();
});

test('a body that grows after mount folds, without remounting the message body', () => {
  // The kit's jsdom ResizeObserver polyfill is a no-op (`observe()` never
  // calls back), which is exactly why the fold-on-mount tests never
  // exercised the observer path -- this test stubs a real callback capture
  // in its place, so the async-growth branch (a fenced block's highlighter
  // resolving after mount) gets real coverage: the reflow must both flip
  // the fold AND land on the SAME `message-body` node, since a remount here
  // would drop the observer watching it (see Transcript.tsx's comment on
  // the wrapper's fixed shape).
  let height = 0;
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight'
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === 'message-body'
        ? height
        : 0;
    },
  });

  let observerCallback: (() => void) | undefined;
  class CapturingResizeObserver {
    constructor(callback: () => void) {
      observerCallback = callback;
    }
    observe() {
      /* the callback fires when the test flips `height`, not on observe */
    }
    unobserve() {}
    disconnect() {}
  }
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    CapturingResizeObserver as unknown as typeof ResizeObserver;

  try {
    renderWithProviders(<Transcript room="build" messages={[tall]} />);
    const bodyBefore = screen.getByTestId('message-body');
    expect(screen.queryByTestId('message-fold')).toBeNull();

    height = 900;
    act(() => observerCallback?.());

    expect(screen.getByTestId('message-fold')).toHaveAttribute(
      'data-folded',
      'true'
    );
    expect(screen.getByTestId('message-body')).toBe(bodyBefore);
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalScrollHeight)
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeight
      );
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .scrollHeight;
  }
});

test('the anchored message mounts unfolded; a short body never folds', () => {
  // jsdom has no scrollIntoView; the anchor effect calls it unconditionally.
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {};
  try {
    withTallBodies(() => {
      renderWithProviders(
        <Transcript room="build" messages={[tall]} anchor="m-1" />
      );
    });
    expect(screen.getByTestId('message-fold')).toHaveAttribute(
      'data-folded',
      'false'
    );
  } finally {
    Element.prototype.scrollIntoView = original;
  }
  renderWithProviders(
    <Transcript
      room="other"
      messages={[{ ...tall, id: 2, room: 'other', body: 'short' }]}
    />
  );
  expect(screen.getAllByTestId('message-fold')).toHaveLength(1);
});
