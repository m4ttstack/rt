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

  test('tag push invalidates pipelines:* only, no branch key', () => {
    const keys = classifyEvent(ev({
      action_name: 'pushed to',
      push_data: { ref: 'v1.2.3', ref_type: 'tag', action: 'pushed' },
    }));
    expect(keys).toEqual([
      { kind: 'pipelines', ref: '*', cause: 'pushed to v1.2.3' },
    ]);
  });

  test('tag deletion produces no invalidations', () => {
    const keys = classifyEvent(ev({
      action_name: 'deleted',
      push_data: { ref: 'v1.2.3', ref_type: 'tag', action: 'removed' },
    }));
    expect(keys).toEqual([]);
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

  test('empty cold start establishes a time anchor and stays one-shot', async () => {
    let events: GitLabEvent[] = [];
    const fetchEvents = async (opts: { after: string; perPage: number; page: number }) => {
      const start = (opts.page - 1) * opts.perPage;
      return events.slice(start, start + opts.perPage);
    };
    const poller = new EventsPoller({ fetchEvents, perPage: 50 });

    const r1 = await poller.tick();
    expect(r1.coldStart).toBe(true);
    expect(r1.invalidations).toEqual([]);
    expect(r1.cursor.lastEventId).toBeNull();
    expect(typeof r1.cursor.since).toBe('string');
    expect(r1.cursor.since).not.toBeNull();
    const anchorMs = new Date(r1.cursor.since as string).getTime();

    // Feed gains one MR event with created_at LATER than the anchor.
    events = [
      ev({
        id: 99,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_iid: 9,
        created_at: new Date(anchorMs + 1000).toISOString(),
      }),
    ];
    const r2 = await poller.tick();
    expect(r2.coldStart).toBe(false);
    expect(r2.invalidations).toEqual([{ kind: 'mr', ref: '9', cause: 'opened' }]);
    expect(r2.cursor.lastEventId).toBe(99);
  });

  test('timestamp fallback does not deliver events older than the anchor', async () => {
    let events: GitLabEvent[] = [];
    const fetchEvents = async (opts: { after: string; perPage: number; page: number }) => {
      const start = (opts.page - 1) * opts.perPage;
      return events.slice(start, start + opts.perPage);
    };
    const poller = new EventsPoller({ fetchEvents, perPage: 50 });

    const r1 = await poller.tick();
    const anchorMs = new Date(r1.cursor.since as string).getTime();

    // Newest-first: later event first, earlier (pre-anchor) event second.
    events = [
      ev({
        id: 101,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_iid: 11,
        created_at: new Date(anchorMs + 2000).toISOString(),
      }),
      ev({
        id: 100,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_iid: 10,
        created_at: new Date(anchorMs - 2000).toISOString(),
      }),
    ];
    const r2 = await poller.tick();
    expect(r2.freshEvents).toBe(1);
    expect(r2.invalidations).toEqual([{ kind: 'mr', ref: '11', cause: 'opened' }]);
  });

  test('timestamp fallback compares numerically, not lexicographically (offset format)', async () => {
    // Simulate a resumed poller whose persisted cursor.since came from a
    // self-hosted GitLab instance using non-"Z" offset notation (e.g. a
    // "+05:00" instance timezone) -- the general case gitlab.com's own
    // "Z"-only feed never exercises. Fix the cursor directly rather than
    // driving it through a cold tick, so the mismatch is exact.
    const anchor = '2026-07-24T05:00:00+05:00'; // == 2026-07-24T00:00:00Z
    let events: GitLabEvent[] = [];
    const fetchEvents = async (opts: { after: string; perPage: number; page: number }) => {
      const start = (opts.page - 1) * opts.perPage;
      return events.slice(start, start + opts.perPage);
    };
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: anchor, lastEventId: null },
      perPage: 50,
    });

    // A fresh event lands 1 hour later in absolute time (2026-07-24T01:00:00Z)
    // but is reported by the (differently-offset) instance as "+02:00", so
    // its printed hour digits ("03:00:00") are numerically smaller than the
    // anchor's ("05:00:00"). A raw string compare (`e.created_at <= since`)
    // sees "03:00:00+02:00" <= "05:00:00+05:00" and wrongly treats this
    // genuinely-newer event as stale -- exactly the class of bug that
    // lexicographic comparison of mixed-offset ISO strings introduces.
    const offsetCreatedAt = '2026-07-24T03:00:00+02:00'; // == 2026-07-24T01:00:00Z

    // Sanity checks proving the string/numeric orderings actually disagree.
    expect(offsetCreatedAt <= anchor).toBe(true);
    expect(Date.parse(offsetCreatedAt)).toBeGreaterThan(Date.parse(anchor));

    events = [
      ev({
        id: 200,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_iid: 20,
        created_at: offsetCreatedAt,
      }),
    ];
    const r = await poller.tick();
    expect(r.freshEvents).toBe(1);
    expect(r.invalidations).toEqual([{ kind: 'mr', ref: '20', cause: 'opened' }]);
  });

  test('poller constructed with a cursor is never coldStart', async () => {
    const { fetchEvents } = stubFeed([]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: '2026-07-23T10:00:00Z', lastEventId: 10 },
    });
    const r = await poller.tick();
    expect(r.coldStart).toBe(false);
  });

  test('empty cold-start anchor tolerates server clock lagging behind local time', async () => {
    let events: GitLabEvent[] = [];
    const fetchEvents = async (opts: { after: string; perPage: number; page: number }) => {
      const start = (opts.page - 1) * opts.perPage;
      return events.slice(start, start + opts.perPage);
    };
    const poller = new EventsPoller({ fetchEvents, perPage: 50 });

    const wallClockAtColdTick = Date.now();
    const r1 = await poller.tick();
    expect(r1.coldStart).toBe(true);

    // Simulated GitLab clock lag: the event's `created_at` (server-stamped)
    // is 30s BEFORE the local wall clock at the moment the cold tick ran --
    // inside the 60s skew margin. A naive anchor (unpadded "now") would put
    // this event at-or-before `since` and drop it forever.
    events = [
      ev({
        id: 99,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_iid: 9,
        created_at: new Date(wallClockAtColdTick - 30_000).toISOString(),
      }),
    ];
    const r2 = await poller.tick();
    expect(r2.coldStart).toBe(false);
    expect(r2.invalidations).toEqual([{ kind: 'mr', ref: '9', cause: 'opened' }]);
  });

  test('explicit null-null cursor behaves exactly like an omitted cursor (cold start)', async () => {
    let events: GitLabEvent[] = [];
    const fetchEvents = async (opts: { after: string; perPage: number; page: number }) => {
      const start = (opts.page - 1) * opts.perPage;
      return events.slice(start, start + opts.perPage);
    };
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: null, lastEventId: null },
      perPage: 50,
    });

    const r1 = await poller.tick();
    expect(r1.coldStart).toBe(true);
    expect(r1.invalidations).toEqual([]);
    const anchorMs = new Date(r1.cursor.since as string).getTime();

    events = [
      ev({
        id: 30,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_iid: 5,
        created_at: new Date(anchorMs + 1000).toISOString(),
      }),
    ];
    const r2 = await poller.tick();
    expect(r2.coldStart).toBe(false);
    expect(r2.invalidations).toEqual([{ kind: 'mr', ref: '5', cause: 'opened' }]);
  });

  // rt persists cursors with no field-level validation, so once
  // EventCursor.lastEventId widened to `number | string | null` for GitHub, a
  // string-shaped id could reach this GitLab-only poller. Ignoring it is the
  // one unacceptable outcome: the field stays non-null, so the timestamp
  // fallback never switches on, and every event in the `after=` window comes
  // back as a fresh invalidation -- history delivered as news by a watcher
  // that looks healthy. The live U20 flow caught exactly that.
  test('a numeric-string lastEventId dedups like the number it spells', async () => {
    const { fetchEvents } = stubFeed([
      ev({ id: 50, action_name: 'opened', target_type: 'MergeRequest', target_iid: 5, created_at: '2026-07-23T11:00:00Z' }),
      ev({ id: 30, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4, created_at: '2026-07-23T10:00:00Z' }),
    ]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: '2026-07-23T10:00:00Z', lastEventId: '30' } as never,
    });
    const r = await poller.tick();
    expect(r.coldStart).toBe(false);
    expect(r.freshEvents).toBe(1);
    expect(r.invalidations).toEqual([{ kind: 'mr', ref: '5', cause: 'opened' }]);
    expect(r.cursor.lastEventId).toBe(50);
  });

  test('an uninterpretable lastEventId falls back to the timestamp anchor rather than replaying', async () => {
    const { fetchEvents } = stubFeed([
      ev({ id: 50, action_name: 'opened', target_type: 'MergeRequest', target_iid: 5, created_at: '2026-07-23T11:00:00Z' }),
      ev({ id: 30, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4, created_at: '2026-07-23T10:00:00Z' }),
    ]);
    const poller = new EventsPoller({
      fetchEvents,
      // A GitHub node-id-shaped value: parses as JSON, means nothing here.
      cursor: { since: '2026-07-23T10:00:00Z', lastEventId: 'MDEyOklzc3VlQ29t' } as never,
    });
    const r = await poller.tick();
    // The `since` anchor still bounds the tick, so the already-consumed
    // event at the anchor is not re-delivered.
    expect(r.invalidations).toEqual([{ kind: 'mr', ref: '5', cause: 'opened' }]);
  });

  test('a cursor whose only field is an uninterpretable lastEventId cold-starts', async () => {
    const { fetchEvents } = stubFeed([
      ev({ id: 50, action_name: 'opened', target_type: 'MergeRequest', target_iid: 5, created_at: '2026-07-23T11:00:00Z' }),
    ]);
    const poller = new EventsPoller({
      fetchEvents,
      cursor: { since: null, lastEventId: 'not-a-number' } as never,
    });
    const r = await poller.tick();
    expect(r.coldStart).toBe(true);
    expect(r.invalidations).toEqual([]);
  });

  test('cold tick that throws stays cold: a later successful tick still reports coldStart', async () => {
    let shouldThrow = true;
    const fetchEvents = async (_opts: { after: string; perPage: number; page: number }) => {
      if (shouldThrow) throw new Error('network down');
      return [];
    };
    const poller = new EventsPoller({ fetchEvents, perPage: 50 });

    await expect(poller.tick()).rejects.toThrow('network down');

    shouldThrow = false;
    const r = await poller.tick();
    expect(r.coldStart).toBe(true);
    expect(r.invalidations).toEqual([]);
  });
});
