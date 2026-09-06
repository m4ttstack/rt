import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { ChatMessage } from '@mattstack/rt-client';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { BuddiesProvider } from './buddies-context';
import type { RosterBuddy } from './roster-types';
import {
  FakeWebSocket,
  fetchMock,
  installFakeWebSocket,
  installFetchMock,
  longCodeBlockMessage,
  renderTranscriptWithFakeSocket,
  restoreWebSocket,
} from './test-utils';
import { PAGE_SIZE, Transcript } from './Transcript';

/** `count` messages with consecutive ids ending at `lastId`, all today. */
function page(count: number, lastId = count): ChatMessage[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const id = lastId - count + 1 + i;
    return {
      id,
      room: 'build',
      handle: 'fred',
      body: `m${id}`,
      mentions: [],
      postedAt: now - (count - i) * 1000,
    };
  });
}

function olderRequests(): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('before=')
  );
}

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
  // Unread, so read-fold never clips it to its first block: this test is
  // about the fence rendering, not the fold.
  renderWithProviders(
    <Transcript
      room="build"
      messages={[longCodeBlockMessage]}
      unreadCount={1}
    />
  );
  const block = await screen.findByTestId('code-block');
  await waitFor(() => expect(block).toHaveTextContent('Cannot find module'));
  expect(screen.getByTestId('transcript-column')).toBeInTheDocument();
});

test('the author header carries the fleet task line beside the sender', async () => {
  installFakeWebSocket();
  installFetchMock();
  const now = Date.now();
  const jay: RosterBuddy = {
    sessionId: 'jay',
    handle: 'jay',
    baseHandle: 'jay',
    status: 'live',
    repo: 'boxscore',
    branch: 'feat/metrics-hardening',
    paneTitle: 'Boxscore mattstack integration',
    signedInAt: now - 60_000,
    lastSeenAt: now,
    rooms: ['boxscore'],
  };
  renderWithProviders(
    <BuddiesProvider buddies={[jay]} roomMembers={['jay']} now={now} reachable>
      <Transcript
        room="boxscore"
        messages={[
          {
            id: 1,
            room: 'boxscore',
            handle: 'jay',
            body: 'pushed the fix',
            mentions: [],
            postedAt: now,
          },
        ]}
      />
    </BuddiesProvider>
  );
  expect(await screen.findByTestId('doing-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
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
  // Unread, so read-fold never clips this multi-block body to its first
  // paragraph: this test is about the markdown rendering, not the fold.
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={1}
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
  renderTranscriptWithFakeSocket({ room: 'build', messages: page(PAGE_SIZE) });
  const edge = screen.getByTestId('transcript-edge');
  expect(edge).toHaveTextContent('older messages');
  fireEvent.click(edge);
  await screen.findByText('no older messages');
  expect(olderRequests()).toHaveLength(1);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  expect(olderRequests()).toHaveLength(1);
});

test('an error page leaves the top edge retryable instead of exhausting it', async () => {
  renderTranscriptWithFakeSocket({ room: 'build', messages: page(PAGE_SIZE) });
  fetchMock.mockImplementationOnce(
    async () => new Response('{}', { status: 502 })
  );
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await screen.findByText('load older messages');
  expect(screen.queryByText('no older messages')).toBeNull();
  expect(screen.getByTestId('transcript-edge')).not.toBeDisabled();
});

test("after an older page loads, the reader's row stays put while content above it settles", async () => {
  // Folds apply a render after mount and highlighters land later still, so
  // the content above the reader shrinks after the first correction; every
  // ResizeObserver callback is captured (folds make one per message too)
  // and fired by hand to stand in for that settling.
  const callbacks: (() => void)[] = [];
  class CapturingResizeObserver {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    CapturingResizeObserver as unknown as typeof ResizeObserver;
  try {
    renderTranscriptWithFakeSocket({
      room: 'build',
      messages: page(PAGE_SIZE, 60),
    });
    const view = viewOf(screen.getByTestId('transcript-scroll'));
    // The scroll library's own jump to the end lands a frame after mount
    // and would overwrite a stub set any earlier.
    await act(() => new Promise(resolve => setTimeout(resolve, 50)));
    Object.defineProperty(view, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 1000,
    });
    view.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    let rowTop = 40;
    const row = screen.getByTestId('message-31');
    row.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ messages: page(PAGE_SIZE, 30) }),
    } as Response);
    fireEvent.click(screen.getByTestId('transcript-edge'));
    await screen.findByTestId('message-1');
    expect(view.scrollTop).toBe(1000);

    rowTop = -260;
    act(() => {
      for (const callback of callbacks) callback();
    });
    expect(view.scrollTop).toBe(700);
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

test('the older-messages control is a subtle Mantine button, so it reads as clickable', () => {
  renderTranscriptWithFakeSocket({ room: 'build', messages: page(PAGE_SIZE) });
  const edge = screen.getByTestId('transcript-edge');
  expect(edge.tagName).toBe('BUTTON');
  expect(edge).toHaveAttribute('data-variant', 'subtle');
  expect(edge).toHaveTextContent('load older messages');
});

test('an older page shorter than the page size exhausts the edge without another round trip', async () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 40),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ messages: page(3, 10) }),
  } as Response);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await screen.findByText('no older messages');
  expect(screen.getByTestId('message-8')).toBeInTheDocument();
  expect(olderRequests()).toHaveLength(1);
});

test('a first page shorter than the page size opens with the edge already exhausted', () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE - 1),
  });
  const edge = screen.getByTestId('transcript-edge');
  expect(edge).toHaveTextContent('no older messages');
  expect(edge).toBeDisabled();
});

test('the tail refetch and the older fetch each ask for one page', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 60),
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 61 } });
  await screen.findByTestId('message-61');
  const tail = fetchMock.mock.calls.find(
    ([url]) =>
      String(url).includes('/api/chat/messages/build') &&
      !String(url).includes('before=')
  );
  expect(String(tail?.[0])).toContain(`limit=${PAGE_SIZE}`);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await waitFor(() => expect(olderRequests()).toHaveLength(1));
  expect(String(olderRequests()[0]![0])).toContain(`limit=${PAGE_SIZE}`);
});

/** Answers every messages request from one ordered history, paging older
    by `before` and `limit` the way the daemon does. */
function serveHistory(all: ChatMessage[]) {
  installFetchMock();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://chat.test');
    const before = url.searchParams.get('before');
    const limit = Number(url.searchParams.get('limit'));
    const messages = (
      before === null ? all : all.filter(m => m.id < Number(before))
    ).slice(-limit);
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages }),
    } as Response;
  });
}

function recordingScrollIntoView(run: (scrolled: string[]) => Promise<void>) {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  return run(scrolled).finally(() => {
    Element.prototype.scrollIntoView = original;
  });
}

test('a link to a message older than the first page pages back until it is in the list, then scrolls to it', () =>
  recordingScrollIntoView(async scrolled => {
    serveHistory(page(60, 60));
    renderWithProviders(
      <Transcript room="build" messages={page(PAGE_SIZE, 60)} anchor="m-5" />
    );
    await waitFor(() => expect(scrolled).toEqual(['m-5']));
    expect(screen.getByTestId('message-5')).toBeInTheDocument();
    expect(olderRequests()).toHaveLength(1);
  }));

test(
  'anchor paging gives up after ten pages without ever scrolling',
  () =>
    recordingScrollIntoView(async scrolled => {
      serveHistory(page(400, 400));
      renderWithProviders(
        <Transcript room="build" messages={page(PAGE_SIZE, 400)} anchor="m-1" />
      );
      // Ten pages is 330 rendered messages, which CI's runner takes a few
      // seconds over; the default one-second wait gave up after seven.
      await waitFor(() => expect(olderRequests()).toHaveLength(10), {
        timeout: 15_000,
      });
      await act(async () => {});
      expect(olderRequests()).toHaveLength(10);
      expect(scrolled).toEqual([]);
      expect(screen.queryByTestId('message-1')).toBeNull();
    }),
  20_000
);

test('a link into the loaded range that names a missing message never pages', () =>
  recordingScrollIntoView(async scrolled => {
    serveHistory(page(60, 60));
    renderWithProviders(
      <Transcript
        room="build"
        messages={page(PAGE_SIZE, 60).filter(m => m.id !== 45)}
        anchor="m-45"
      />
    );
    await act(async () => {});
    expect(olderRequests()).toHaveLength(0);
    expect(scrolled).toEqual([]);
  }));

function withScrollableView(run: () => void) {
  const proto = HTMLElement.prototype;
  const originals = (['scrollHeight', 'clientHeight'] as const).map(
    name => [name, Object.getOwnPropertyDescriptor(proto, name)] as const
  );
  const isView = (el: unknown) =>
    typeof (el as HTMLElement).className === 'string' &&
    (el as HTMLElement).className.includes('view');
  Object.defineProperty(proto, 'scrollHeight', {
    configurable: true,
    get() {
      return isView(this) ? 1000 : 0;
    },
  });
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get() {
      return isView(this) ? 300 : 0;
    },
  });
  try {
    run();
  } finally {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(proto, name, original);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  }
}

test('opening a room never pages on its own, even when the list is taller than the view', async () => {
  withScrollableView(() => {
    renderTranscriptWithFakeSocket({
      room: 'build',
      messages: page(PAGE_SIZE),
    });
  });
  await act(async () => {});
  expect(olderRequests()).toHaveLength(0);
  expect(screen.getByTestId('transcript-edge')).toHaveTextContent(
    'load older messages'
  );
});

test('scrolling to the top never pages on its own; only the edge button does', async () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 60),
  });
  const view = viewOf(screen.getByTestId('transcript-scroll'));
  scrollTo(view, 500);
  scrollTo(view, 0);
  await act(async () => {});
  expect(olderRequests()).toHaveLength(0);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await waitFor(() => expect(olderRequests()).toHaveLength(1));
  expect(String(olderRequests()[0]![0])).toContain('before=31');
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
    messages: page(PAGE_SIZE, 40),
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

/** A two-block body: `moreLines` for it is always 1 (the second block is
    one line), so a folded one always reads "1 more line". */
function twoBlockMessage(id: number, postedAt = id): ChatMessage {
  return {
    id,
    room: 'build',
    handle: 'fred',
    body: `lead ${id}\n\nsecond ${id}`,
    mentions: [],
    postedAt,
  };
}

test('messages before the read boundary fold to their first block; those from it on render whole', () => {
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={2}
      messages={[1, 2, 3, 4].map(id => twoBlockMessage(id))}
    />
  );
  const read1 = screen.getByTestId('message-1');
  const read2 = screen.getByTestId('message-2');
  const unread3 = screen.getByTestId('message-3');
  const unread4 = screen.getByTestId('message-4');
  expect(read1).not.toHaveTextContent('second 1');
  expect(read2).not.toHaveTextContent('second 2');
  expect(within(read1).getByTestId('read-fold-toggle')).toHaveTextContent(
    '1 more line'
  );
  expect(unread3).toHaveTextContent('second 3');
  expect(unread4).toHaveTextContent('second 4');
  expect(within(unread3).queryByTestId('read-fold-toggle')).toBeNull();
  expect(within(unread4).queryByTestId('read-fold-toggle')).toBeNull();
});

test("a folded message's control toggles only that message, both ways", () => {
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={0}
      messages={[twoBlockMessage(1), twoBlockMessage(2)]}
    />
  );
  const first = screen.getByTestId('message-1');
  const second = screen.getByTestId('message-2');
  // Unfold the first: it reveals its second block, and the control stays,
  // now offering to re-fold.
  fireEvent.click(within(first).getByTestId('read-fold-toggle'));
  expect(first).toHaveTextContent('second 1');
  expect(within(first).getByTestId('read-fold-toggle')).toHaveTextContent(
    'fewer lines'
  );
  // The second is untouched: still folded, still showing "more line(s)".
  expect(second).not.toHaveTextContent('second 2');
  expect(within(second).getByTestId('read-fold-toggle')).toHaveTextContent(
    'more line'
  );
  // Clicking the first again re-folds it.
  fireEvent.click(within(first).getByTestId('read-fold-toggle'));
  expect(first).not.toHaveTextContent('second 1');
  expect(within(first).getByTestId('read-fold-toggle')).toHaveTextContent(
    'more line'
  );
});

test('an undefined unreadCount folds every message', () => {
  renderWithProviders(
    <Transcript room="build" messages={[twoBlockMessage(1)]} />
  );
  expect(screen.getByTestId('message-1')).not.toHaveTextContent('second 1');
});

test('the anchored message renders whole even before the read boundary', () => {
  // jsdom has no scrollIntoView; the anchor effect calls it unconditionally.
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {};
  try {
    renderWithProviders(
      <Transcript
        room="build"
        unreadCount={0}
        anchor="m-1"
        messages={[twoBlockMessage(1), twoBlockMessage(2)]}
      />
    );
    expect(screen.getByTestId('message-1')).toHaveTextContent('second 1');
    expect(screen.getByTestId('message-2')).not.toHaveTextContent('second 2');
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('the app-wide expand-all preference also unfolds read-folded messages', () => {
  window.localStorage.setItem('chat-expand-all', 'true');
  renderWithProviders(
    <Transcript room="build" messages={[twoBlockMessage(1)]} />
  );
  expect(screen.getByTestId('message-1')).toHaveTextContent('second 1');
  expect(screen.queryByTestId('read-fold-toggle')).toBeNull();
});

test('an unread room message with an unanswered @here carries the unclaimed chip', () => {
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={1}
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'fred',
          body: '@here needs eyes on this',
          mentions: [],
          postedAt: Date.now() - 60_000,
        },
      ]}
    />
  );
  expect(screen.getByTestId('unclaimed-chip')).toHaveTextContent(
    '@here · unclaimed'
  );
});

test('a reply to the @here message clears the unclaimed chip', () => {
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={2}
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'fred',
          body: '@here needs eyes on this',
          mentions: [],
          postedAt: 1,
        },
        {
          id: 2,
          room: 'build',
          handle: 'max',
          body: 'on it',
          mentions: [],
          replyTo: 1,
          postedAt: 2,
        },
      ]}
    />
  );
  expect(screen.queryByTestId('unclaimed-chip')).toBeNull();
});

test('a read @here message never carries the unclaimed chip', () => {
  renderWithProviders(
    <Transcript
      room="build"
      unreadCount={0}
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'fred',
          body: '@here needs eyes on this',
          mentions: [],
          postedAt: 1,
        },
      ]}
    />
  );
  expect(screen.queryByTestId('unclaimed-chip')).toBeNull();
});

test('a DM never carries the unclaimed chip, even for an unanswered @here', () => {
  renderWithProviders(
    <Transcript
      room="build"
      isDm
      unreadCount={1}
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'fred',
          body: '@here needs eyes on this',
          mentions: [],
          postedAt: 1,
        },
      ]}
    />
  );
  expect(screen.queryByTestId('unclaimed-chip')).toBeNull();
});
