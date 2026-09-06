import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { ChatMessage } from '@mattstack/rt-client';
import { vi } from 'vitest';

import { resetRelayForTests } from './relay-socket';
import { Transcript, type TranscriptProps } from './Transcript';

/**
 * The global `fetch` mock every UI test in this file installs instead of
 * hitting the network. This stands in for the APP's own calls to its `/api`
 * routes (and the transcript's WS-triggered tail refetch) -- never for
 * rt-client, which cannot throw and must never be given a
 * `mockRejectedValue`.
 */
export const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

/**
 * Installs `fetchMock` as `globalThis.fetch`, reset and defaulted to an
 * empty-but-valid JSON response so an un-configured call doesn't throw
 * trying to `.json()` a `vi.fn()`'s default `undefined` return.
 */
export function installFetchMock() {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({}));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

let originalWebSocket: typeof WebSocket | undefined;

/**
 * A minimal `WebSocket` stub. Records every instance created (there is
 * normally exactly one, opened by `Transcript`'s own effect) and exposes no
 * behaviour beyond what the transcript's handler needs: `onmessage` gets
 * assigned by the component, and the test drives it via the returned
 * `pushFrame`, never by dispatching a real socket event.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    /* no-op: nothing to tear down on a stub */
  }
}

/**
 * Swaps `globalThis.WebSocket` for the stub above. Every `Transcript` test
 * should call this (directly, or via `renderTranscriptWithFakeSocket`) --
 * jsdom's own `WebSocket` would otherwise attempt a real connection to a
 * `/ws` nothing is serving.
 */
export function installFakeWebSocket() {
  resetRelayForTests();
  originalWebSocket ??= globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
}

/** Restores the real (or jsdom's) `WebSocket` global. Pair with
    `installFakeWebSocket` in an `afterEach`. */
export function restoreWebSocket() {
  if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
}

export interface RenderTranscriptOptions extends Pick<
  TranscriptProps,
  'room' | 'messages'
> {
  humanHandle?: TranscriptProps['humanHandle'];
  unreadCount?: TranscriptProps['unreadCount'];
  anchor?: TranscriptProps['anchor'];
}

export interface RenderTranscriptResult extends ReturnType<
  typeof renderWithProviders
> {
  /** Simulates the server delivering one relay frame -- the same
      `{ topic, payload }` shape `ws.ts` republishes onto the app's own
      `/ws`. Answers the transcript's tail refetch with a message synthesized
      from the frame's `payload.id`, so the row it triggers has real content
      to render, not just an id. */
  pushFrame: (frame: { topic: string; payload: { id: number } }) => void;
}

/**
 * Renders `<Transcript>` behind a fake socket and a mocked `fetch`, wiring
 * the transcript's own `GET /api/chat/messages/:room` tail refetch to
 * answer with whatever `pushFrame` was last asked to deliver.
 */
export function renderTranscriptWithFakeSocket({
  room,
  messages,
  humanHandle,
  unreadCount,
  anchor,
}: RenderTranscriptOptions): RenderTranscriptResult {
  installFakeWebSocket();

  let tailMessages: ChatMessage[] = [];

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`/api/chat/messages/${room}`)) {
      return jsonResponse({ messages: tailMessages });
    }
    return jsonResponse({});
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const view = renderWithProviders(
    <Transcript
      room={room}
      messages={messages}
      humanHandle={humanHandle}
      unreadCount={unreadCount}
      anchor={anchor}
    />
  );

  function pushFrame(frame: { topic: string; payload: { id: number } }) {
    tailMessages = [
      {
        id: frame.payload.id,
        room,
        handle: 'fixture-agent',
        body: `message ${frame.payload.id}`,
        mentions: [],
        postedAt: Date.now(),
      },
    ];
    const socket = FakeWebSocket.instances.at(-1);
    socket?.onmessage?.({ data: JSON.stringify(frame) });
  }

  return { ...view, pushFrame };
}

/**
 * The Main artboard's own wide stack trace, verbatim enough to prove the
 * `.code` block scrolls inside itself: one 200-column line inside a fenced
 * code block, which is exactly what would widen the page if `overflow-x`
 * were missing.
 */
export const longCodeBlockMessage: ChatMessage = {
  id: 999,
  room: 'build',
  handle: 'board-fix-auth',
  body:
    'heads up: I moved the shared fixture to `test/fixtures/home.ts`.\n' +
    '```\n' +
    `TypeError: Cannot find module "../fixtures/home" ${'-'.repeat(150)}\n` +
    '```',
  mentions: [],
  postedAt: Date.now(),
};

/**
 * jsdom has no layout, so `scrollHeight` is always 0. This stub gives a
 * textarea the one property auto-grow depends on: its scroll height is its
 * line count at `lineHeight` px a line, but never less than the fixed
 * `style.height` it currently has -- the same clamp a real browser applies,
 * and the reason auto-grow must reset the height to `auto` before measuring.
 */
export function stubTextareaScrollHeight(lineHeight = 20) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      const value = this instanceof HTMLTextAreaElement ? this.value : '';
      const content = lineHeight * value.split('\n').length;
      const fixed = parseFloat(this.style.height);
      return Number.isNaN(fixed) ? content : Math.max(fixed, content);
    }
  );
}
