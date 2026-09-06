import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  onRelayOpen,
  resetRelayForTests,
  subscribeRelay,
  useRelayFrames,
} from './relay-socket';
import {
  FakeWebSocket,
  installFakeWebSocket,
  restoreWebSocket,
} from './test-utils';

beforeEach(() => {
  vi.useFakeTimers();
  installFakeWebSocket();
});

afterEach(() => {
  resetRelayForTests();
  restoreWebSocket();
  vi.useRealTimers();
});

test('every subscriber shares one socket and hears every frame', () => {
  const a = vi.fn();
  const b = vi.fn();
  const offA = subscribeRelay(a);
  const offB = subscribeRelay(b);
  expect(FakeWebSocket.instances).toHaveLength(1);
  FakeWebSocket.instances[0]!.onmessage?.({
    data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 1 } }),
  });
  expect(a).toHaveBeenCalledWith({
    topic: 'chat/build/msg',
    payload: { id: 1 },
  });
  expect(b).toHaveBeenCalledTimes(1);
  FakeWebSocket.instances[0]!.onmessage?.({ data: 'not json' });
  expect(a).toHaveBeenCalledTimes(1);
  offA();
  offB();
});

test('a closed socket reconnects with doubling delays, capped at 30s, and the open callback says so', () => {
  const opened = vi.fn();
  const off = subscribeRelay(() => {});
  const offOpen = onRelayOpen(opened);
  FakeWebSocket.instances[0]!.onopen?.();
  expect(opened).toHaveBeenLastCalledWith(false);

  FakeWebSocket.instances[0]!.onclose?.();
  expect(FakeWebSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(999);
  expect(FakeWebSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(FakeWebSocket.instances).toHaveLength(2);

  FakeWebSocket.instances[1]!.onclose?.();
  vi.advanceTimersByTime(2000);
  expect(FakeWebSocket.instances).toHaveLength(3);
  FakeWebSocket.instances[2]!.onclose?.();
  vi.advanceTimersByTime(4000);
  expect(FakeWebSocket.instances).toHaveLength(4);

  FakeWebSocket.instances[3]!.onopen?.();
  expect(opened).toHaveBeenLastCalledWith(true);
  FakeWebSocket.instances[3]!.onclose?.();
  vi.advanceTimersByTime(1000);
  expect(FakeWebSocket.instances).toHaveLength(5);

  for (let i = 4; i < 12; i++) {
    FakeWebSocket.instances[i]!.onclose?.();
    vi.advanceTimersByTime(30_000);
  }
  expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(12);
  off();
  offOpen();
});

test('the last subscriber leaving closes the socket and stops reconnecting', () => {
  const socketClose = vi.spyOn(FakeWebSocket.prototype, 'close');
  const off = subscribeRelay(() => {});
  off();
  expect(socketClose).toHaveBeenCalled();
  FakeWebSocket.instances[0]!.onclose?.();
  vi.advanceTimersByTime(60_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test('useRelayFrames always calls the latest handler', () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ handler }) => useRelayFrames(handler),
    { initialProps: { handler: first } }
  );
  rerender({ handler: second });
  FakeWebSocket.instances[0]!.onmessage?.({
    data: JSON.stringify({ topic: 'chat/build/msg' }),
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  unmount();
});
