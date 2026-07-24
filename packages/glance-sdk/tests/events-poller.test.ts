/**
 * Unit tests for EventsPoller: event classification and (Task 2) cursor tick
 * logic. fetchEvents is injected, so no network is involved.
 */
import { describe, expect, test } from 'bun:test';
import { classifyEvent, type GitLabEvent, EventsPoller } from '../src/EventsPoller.ts';

function ev(partial: Partial<GitLabEvent>): GitLabEvent {
  return {
    id: 1,
    action_name: 'opened',
    target_type: null,
    target_iid: null,
    created_at: '2026-07-23T12:00:00Z',
    ...partial,
  };
}

describe('classifyEvent', () => {
  test('MergeRequest lifecycle event invalidates mr:<iid>', () => {
    const keys = classifyEvent(ev({ action_name: 'opened', target_type: 'MergeRequest', target_iid: 42 }));
    expect(keys).toEqual([{ kind: 'mr', ref: '42', cause: 'opened' }]);
  });

  test('approval event (target_type MergeRequest) also invalidates mr:<iid>', () => {
    const keys = classifyEvent(ev({ action_name: 'approved', target_type: 'MergeRequest', target_iid: 7 }));
    expect(keys).toEqual([{ kind: 'mr', ref: '7', cause: 'approved' }]);
  });

  test('note on an MR invalidates notes:<iid> and mr:<iid>', () => {
    const keys = classifyEvent(ev({
      action_name: 'commented on',
      target_type: 'Note',
      target_iid: null,
      note: { noteable_type: 'MergeRequest', noteable_iid: 9 },
    }));
    expect(keys).toEqual([
      { kind: 'notes', ref: '9', cause: 'note added' },
      { kind: 'mr', ref: '9', cause: 'note added' },
    ]);
  });

  test('note on an Issue produces no invalidations', () => {
    const keys = classifyEvent(ev({
      action_name: 'commented on',
      target_type: 'Note',
      note: { noteable_type: 'Issue', noteable_iid: 3 },
    }));
    expect(keys).toEqual([]);
  });

  test('push invalidates branch:<ref> and pipelines:*', () => {
    const keys = classifyEvent(ev({
      action_name: 'pushed to',
      push_data: { ref: 'feature/x', ref_type: 'branch', action: 'pushed' },
    }));
    expect(keys).toEqual([
      { kind: 'branch', ref: 'feature/x', cause: 'pushed to' },
      { kind: 'pipelines', ref: '*', cause: 'pushed to feature/x' },
    ]);
  });

  test('branch deletion invalidates branch:<ref> only', () => {
    const keys = classifyEvent(ev({
      action_name: 'deleted',
      push_data: { ref: 'feature/x', ref_type: 'branch', action: 'removed' },
    }));
    expect(keys).toEqual([{ kind: 'branch', ref: 'feature/x', cause: 'deleted' }]);
  });

  test('unrelated event (e.g. joined project) produces nothing', () => {
    const keys = classifyEvent(ev({ action_name: 'joined', target_type: null }));
    expect(keys).toEqual([]);
  });
});

/** fetchEvents stub: serves pages from a fixed newest-first array and records calls. */
function stubFeed(events: GitLabEvent[]) {
  const calls: Array<{ after: string; perPage: number; page: number }> = [];
  const fetchEvents = async (opts: { after: string; perPage: number; page: number }) => {
    calls.push(opts);
    const start = (opts.page - 1) * opts.perPage;
    return events.slice(start, start + opts.perPage);
  };
  return { fetchEvents, calls };
}

describe('EventsPoller.tick', () => {
  test('cold start establishes cursor at max id and fires no invalidations', async () => {
    const { fetchEvents } = stubFeed([
      ev({ id: 30, action_name: 'opened', target_type: 'MergeRequest', target_iid: 5, created_at: '2026-07-23T10:00:00Z' }),
      ev({ id: 20, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4, created_at: '2026-07-23T09:00:00Z' }),
    ]);
    const poller = new EventsPoller({ fetchEvents, perPage: 50 });
    const r = await poller.tick();
    expect(r.coldStart).toBe(true);
    expect(r.invalidations).toEqual([]);
    expect(r.cursor.lastEventId).toBe(30);
    expect(r.cursor.since).toBe('2026-07-23T10:00:00Z');
  });

  test('warm tick reports only events newer than the cursor and advances it', async () => {
    const { fetchEvents } = stubFeed([
      ev({ id: 50, action_name: 'approved', target_type: 'MergeRequest', target_iid: 5, created_at: '2026-07-23T11:00:00Z' }),
      ev({ id: 40, action_name: 'opened', target_type: 'MergeRequest', target_iid: 5, created_at: '2026-07-23T10:30:00Z' }),
      ev({ id: 30, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4, created_at: '2026-07-23T10:00:00Z' }),
    ]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: '2026-07-23T10:00:00Z', lastEventId: 30 },
    });
    const r = await poller.tick();
    expect(r.coldStart).toBe(false);
    expect(r.freshEvents).toBe(2);
    // Two events on the same MR dedup to one key.
    expect(r.invalidations).toEqual([{ kind: 'mr', ref: '5', cause: 'approved' }]);
    expect(r.cursor.lastEventId).toBe(50);
  });

  test('requests use the day BEFORE the cursor date (day-exclusive gotcha)', async () => {
    const { fetchEvents, calls } = stubFeed([]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: '2026-07-23T10:00:00Z', lastEventId: 30 },
    });
    await poller.tick();
    expect(calls[0]!.after).toBe('2026-07-22');
  });

  test('pagination walks until the cursor id is seen, bounded by maxPagesPerTick', async () => {
    // 3 full pages of 2; cursor id sits on page 2, so page 3 is never fetched.
    const { fetchEvents, calls } = stubFeed([
      ev({ id: 60, action_name: 'opened', target_type: 'MergeRequest', target_iid: 6 }),
      ev({ id: 50, action_name: 'opened', target_type: 'MergeRequest', target_iid: 5 }),
      ev({ id: 40, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4 }),
      ev({ id: 30, action_name: 'opened', target_type: 'MergeRequest', target_iid: 3 }),
      ev({ id: 20, action_name: 'opened', target_type: 'MergeRequest', target_iid: 2 }),
      ev({ id: 10, action_name: 'opened', target_type: 'MergeRequest', target_iid: 1 }),
    ]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: '2026-07-23T00:00:00Z', lastEventId: 30 },
      perPage: 2,
      maxPagesPerTick: 5,
    });
    const r = await poller.tick();
    expect(calls.length).toBe(2);
    expect(r.freshEvents).toBe(3); // ids 60, 50, 40
    expect(r.requests).toBe(2);
  });

  test('a short page ends the walk', async () => {
    const { fetchEvents, calls } = stubFeed([
      ev({ id: 40, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4 }),
    ]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: '2026-07-23T00:00:00Z', lastEventId: 30 },
      perPage: 2,
    });
    await poller.tick();
    expect(calls.length).toBe(1);
  });

  test('a failed tick leaves the cursor untouched', async () => {
    const boom = async () => { throw new Error('network down'); };
    const poller = new EventsPoller({
      fetchEvents: boom,
      cursor: { since: '2026-07-23T00:00:00Z', lastEventId: 30 },
    });
    await expect(poller.tick()).rejects.toThrow('network down');
    expect(poller.getCursor()).toEqual({ since: '2026-07-23T00:00:00Z', lastEventId: 30 });
  });
});
