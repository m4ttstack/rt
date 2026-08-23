// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// subscribe's real signature is POSITIONAL -- (onEvent, opts) -- and onEvent
// itself takes (type, data), not one event object. Verified against
// packages/rt-client/src/relay.ts:23.
const handlers: Array<(type: string, data: unknown) => void> = [];
vi.mock('@mattstack/rt-client', () => ({
  subscribe: vi.fn((onEvent: (type: string, data: unknown) => void) => {
    handlers.push(onEvent);
    return () => {};
  }),
}));

const { startRelay } = await import('./ws');

/** The real frame: the daemon broadcasts type "event" with the topic NESTED,
    per lib/daemon/handlers/events.ts -- broadcast("event", { id, topic,
    payload, emittedAt }). The topic is NOT the outer type. */
const runEvent = {
  id: 1,
  topic: 'run-updated',
  payload: { runId: 'run-1' },
  emittedAt: 5,
};

describe('run relay', () => {
  it('republishes a run-updated event to the runs topic', () => {
    const published: Array<[string, string]> = [];
    startRelay((topic, data) => published.push([topic, data]));
    // Each test's own subscribe() call appends a new handler; indexing
    // handlers[0] here would silently fire an earlier test's handler once
    // this suite has more than one test.
    const handler = handlers.at(-1)!;

    handler('event', runEvent);

    expect(published).toEqual([['runs', JSON.stringify(runEvent)]]);
  });

  it('drops every other daemon broadcast', () => {
    const published: Array<[string, string]> = [];
    startRelay((topic, data) => published.push([topic, data]));
    const handler = handlers.at(-1)!;

    // The daemon also broadcasts these on its pollers. Without the filter the
    // board full-refetches the run list on every unrelated daemon tick.
    handler('ports', { some: 'payload' });
    handler('status', { some: 'payload' });
    handler('event', {
      id: 2,
      topic: 'pack-installed',
      payload: {},
      emittedAt: 6,
    });

    expect(published).toEqual([]);
  });

  it('returns the unsubscribe it was handed', () => {
    const stop = startRelay(() => {});

    expect(typeof stop).toBe('function');
  });
});
