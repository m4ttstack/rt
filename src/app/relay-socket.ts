import { useEffect, useRef } from 'react';

export type RelayFrame = { topic?: unknown; payload?: unknown };
type Listener = (frame: RelayFrame) => void;
type OpenListener = (reconnect: boolean) => void;

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

const listeners = new Set<Listener>();
const openListeners = new Set<OpenListener>();
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let everOpened = false;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function wanted(): boolean {
  return listeners.size > 0 || openListeners.size > 0;
}

/**
 * One `/ws` connection per page. A frame is a pointer (`{ topic, payload }`),
 * never prose; every subscriber sees every frame and filters by topic
 * itself. After a close the socket comes back on a doubling delay from 1s
 * to 30s; a successful open resets the delay, and the open callbacks learn
 * whether this is a reconnect so the page can refetch what it missed.
 */
function connect() {
  if (socket || !wanted() || typeof window === 'undefined') return;
  const ws = new WebSocket(wsUrl());
  socket = ws;
  ws.onopen = () => {
    const reconnect = everOpened;
    everOpened = true;
    failures = 0;
    for (const cb of openListeners) cb(reconnect);
  };
  ws.onmessage = event => {
    let frame: RelayFrame;
    try {
      frame = JSON.parse(String((event as { data: unknown }).data));
    } catch {
      return;
    }
    for (const listener of listeners) listener(frame);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (!wanted()) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** failures);
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };
  ws.onerror = () => {
    ws.close();
  };
}

function disconnectIfIdle() {
  if (wanted()) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const ws = socket;
  socket = null;
  ws?.close();
}

export function subscribeRelay(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
}

export function onRelayOpen(cb: OpenListener): () => void {
  openListeners.add(cb);
  connect();
  return () => {
    openListeners.delete(cb);
    disconnectIfIdle();
  };
}

/** Tests share this module's singletons across files; each test starts clean. */
export function resetRelayForTests() {
  listeners.clear();
  openListeners.clear();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  socket = null;
  failures = 0;
  everOpened = false;
}

export function useRelayFrames(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeRelay(frame => ref.current(frame)), []);
}

export function useRelayOpen(cb: OpenListener): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onRelayOpen(reconnect => ref.current(reconnect)), []);
}
