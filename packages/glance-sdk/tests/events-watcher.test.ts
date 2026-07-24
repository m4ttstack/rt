/**
 * Unit tests for the EventsWatcher loop: delivery, cold-start suppression,
 * degradation + recovery, backoff growth, and dispose. Uses very short
 * intervals with real timers; every wait has a generous ceiling so the
 * ±10% jitter cannot flake the assertions.
 */
import { describe, expect, test } from 'bun:test';
import { startEventsWatcher } from '../src/EventsWatcher.ts';
import type { GitLabEvent } from '../src/EventsPoller.ts';
import type { EventCursor, InvalidationBatch, WatchEventsStatus } from '../src/types.ts';
import type { ForgeLogger } from '../src/logger.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mrEvent(id: number, iid: number): GitLabEvent {
  return {
    id,
    action_name: 'opened',
    target_type: 'MergeRequest',
    target_iid: iid,
    created_at: new Date().toISOString(),
  };
}

describe('startEventsWatcher', () => {
  test('cold start fires onCursor but no invalidations; later events are delivered', async () => {
    let feed: GitLabEvent[] = [mrEvent(10, 1)];
    const batches: InvalidationBatch[] = [];
    const cursors: Array<number | null> = [];
    const dispose = startEventsWatcher(
      async () => feed,
      {
        intervalMs: 20,
        onCursor: (c) => cursors.push(c.lastEventId),
      },
      (b) => batches.push(b),
    );
    await sleep(60); // first tick (cold) has happened
    expect(batches.length).toBe(0);
    expect(cursors).toContain(10);

    feed = [mrEvent(20, 2), mrEvent(10, 1)];
    await sleep(120); // at least one warm tick
    dispose();
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0]!.invalidations).toEqual([{ kind: 'mr', ref: '2', cause: 'opened' }]);
    expect(batches[0]!.cursor.lastEventId).toBe(20);
    expect(typeof batches[0]!.syncedAt).toBe('string');
  });

  test('resumes from a provided cursor without a cold start', async () => {
    const batches: InvalidationBatch[] = [];
    const dispose = startEventsWatcher(
      async () => [mrEvent(20, 2), mrEvent(10, 1)],
      { intervalMs: 20, cursor: { since: null, lastEventId: 10 } },
      (b) => batches.push(b),
    );
    await sleep(80);
    dispose();
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0]!.invalidations).toEqual([{ kind: 'mr', ref: '2', cause: 'opened' }]);
  });

  test('failure degrades with classified cause, recovery goes live, cursor holds', async () => {
    let failWith: unknown = null;
    const statuses: WatchEventsStatus[] = [];
    const batches: InvalidationBatch[] = [];
    let feed: GitLabEvent[] = [mrEvent(20, 2), mrEvent(10, 1)];
    const dispose = startEventsWatcher(
      async () => {
        if (failWith) throw failWith;
        return feed;
      },
      {
        intervalMs: 20,
        cursor: { since: null, lastEventId: 10 },
        onStatus: (s) => statuses.push(s),
      },
      (b) => batches.push(b),
    );
    await sleep(70); // healthy warm tick delivered
    const deliveredBefore = batches.length;
    expect(deliveredBefore).toBeGreaterThanOrEqual(1);

    // Now fail with a duck-typed 429 (shape GitbeakerRequestError uses).
    failWith = Object.assign(new Error('rate limited'), {
      cause: { description: 'Too Many Requests', response: { status: 429, statusText: 'Too Many Requests', headers: { get: () => null } } },
    });
    await sleep(120);
    const degraded = statuses.find((s) => s.state === 'degraded');
    expect(degraded).toBeDefined();
    expect(degraded!.cause).toBe('rate-limited');
    expect(degraded!.nextRetryAt).toBeDefined();

    // Recover; new event arrives while we were blind.
    feed = [mrEvent(30, 3), mrEvent(20, 2), mrEvent(10, 1)];
    failWith = null;
    await sleep(300); // enough for the backed-off retry to fire
    dispose();
    expect(statuses.some((s) => s.state === 'live')).toBe(true);
    const last = batches.at(-1)!;
    expect(last.invalidations.some((k) => k.kind === 'mr' && k.ref === '3')).toBe(true);
  });

  test('backoff grows across consecutive failures', async () => {
    const statuses: WatchEventsStatus[] = [];
    const dispose = startEventsWatcher(
      async () => { throw new Error('boom'); },
      {
        intervalMs: 20,
        cursor: { since: null, lastEventId: 1 },
        onStatus: (s) => statuses.push(s),
      },
      () => {},
    );
    await sleep(400);
    dispose();
    const degraded = statuses.filter((s) => s.state === 'degraded' && s.nextRetryAt);
    expect(degraded.length).toBeGreaterThanOrEqual(2);
    // Later retries are scheduled further out than earlier ones were.
    const first = new Date(degraded[0]!.nextRetryAt!).getTime();
    const later = new Date(degraded.at(-1)!.nextRetryAt!).getTime();
    expect(later).toBeGreaterThan(first);
    // 'boom' has no HTTP shape: classified as network.
    expect(degraded[0]!.cause).toBe('network');
  });

  test('dispose stops the loop', async () => {
    let calls = 0;
    const dispose = startEventsWatcher(
      async () => { calls++; return []; },
      { intervalMs: 20, cursor: { since: null, lastEventId: 1 } },
      () => {},
    );
    await sleep(50);
    dispose();
    const at = calls;
    await sleep(100);
    expect(calls).toBe(at);
    dispose(); // idempotent, must not throw
  });

  test('dispose during an in-flight tick suppresses all callbacks', async () => {
    const batches: InvalidationBatch[] = [];
    const cursors: Array<number | null> = [];
    const statuses: WatchEventsStatus[] = [];
    const dispose = startEventsWatcher(
      async () => {
        await sleep(100);
        return [mrEvent(20, 2), mrEvent(10, 1)];
      },
      {
        intervalMs: 20,
        cursor: { since: null, lastEventId: 10 },
        onCursor: (c) => cursors.push(c.lastEventId),
        onStatus: (s) => statuses.push(s),
      },
      (b) => batches.push(b),
    );
    await sleep(30); // still inside the pending fetch
    dispose();
    await sleep(250); // give the in-flight tick plenty of time to resolve
    expect(batches.length).toBe(0);
    expect(cursors.length).toBe(0);
    expect(statuses.length).toBe(0);
  });

  test('empty cold start still persists the anchor and later events are delivered', async () => {
    let feed: GitLabEvent[] = [];
    const batches: InvalidationBatch[] = [];
    const cursors: EventCursor[] = [];
    const dispose = startEventsWatcher(
      async () => feed,
      {
        intervalMs: 20,
        onCursor: (c) => cursors.push({ ...c }),
      },
      (b) => batches.push(b),
    );
    await sleep(60); // first ~2 ticks: empty feed, cold
    expect(cursors.length).toBeGreaterThanOrEqual(1);
    expect(cursors[0]!.lastEventId).toBeNull();
    expect(typeof cursors[0]!.since).toBe('string');

    // A fresh MR event lands with created_at now (after the anchor).
    feed = [mrEvent(50, 5)];
    await sleep(120);
    dispose();
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(
      batches.some((b) => b.invalidations.some((k) => k.kind === 'mr' && k.ref === '5')),
    ).toBe(true);
  });

  test('a throwing onInvalidations is isolated: no degraded status, loop continues', async () => {
    const statuses: WatchEventsStatus[] = [];
    const batches: InvalidationBatch[] = [];
    const warnCalls: Array<[string, Record<string, unknown> | undefined]> = [];
    const fakeLogger: ForgeLogger = {
      debug() {},
      info() {},
      warn: (msg, meta) => warnCalls.push([msg, meta]),
      error() {},
    };
    let thrown = false;
    let feed: GitLabEvent[] = [mrEvent(20, 2), mrEvent(10, 1)];
    const dispose = startEventsWatcher(
      async () => feed,
      {
        intervalMs: 20,
        cursor: { since: null, lastEventId: 10 },
        onStatus: (s) => statuses.push(s),
      },
      (b) => {
        batches.push(b);
        if (!thrown) {
          thrown = true;
          throw new Error('consumer boom');
        }
      },
      fakeLogger,
    );
    await sleep(70); // first warm tick delivers and onInvalidations throws
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(statuses.some((s) => s.state === 'degraded')).toBe(false);

    // Advance the feed again; the loop must still be alive.
    feed = [mrEvent(30, 3), mrEvent(20, 2), mrEvent(10, 1)];
    await sleep(80);
    dispose();
    expect(statuses.some((s) => s.state === 'degraded')).toBe(false);
    expect(batches.some((b) => b.invalidations.some((k) => k.kind === 'mr' && k.ref === '3'))).toBe(true);
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    expect(warnCalls[0]![0]).toContain('consumer callback threw');
  });
});
