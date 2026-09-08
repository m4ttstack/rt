import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { AgentSignal } from '../agent-signal.ts';
import {
  AgentStatusFeed,
  isAgentStatusTopic,
  PAGE_LIMIT,
  readCursorFile,
  writeCursorFile,
  type AgentStatusFeedIo,
  type JournalEvent,
} from '../agent-status/feed.ts';

const ROOT = '/Users/dev/board';
const MR = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const MR2 = 'https://gitlab.com/acme/webapp/-/merge_requests/4822';
const EMITTED_BASE = 1_700_000_000_000;

function event(
  id: number,
  overrides: Partial<{
    topic: string;
    payload: unknown;
    emittedAt: number;
  }> = {}
): JournalEvent {
  return {
    id,
    topic: 'board/agent-status/review',
    payload: {
      mrUrl: MR,
      iid: 4821,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
      appRoot: ROOT,
    },
    emittedAt: EMITTED_BASE + id,
    ...overrides,
  };
}

/** Same shape as `event`, on a second MR: the feed serializes per mrUrl, so
    the two are the only way to tell blocking from ordering. */
function otherMrEvent(id: number): JournalEvent {
  return event(id, {
    payload: {
      mrUrl: MR2,
      iid: 4822,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
      appRoot: ROOT,
    },
  });
}

interface Harness {
  io: AgentStatusFeedIo;
  feed: AgentStatusFeed;
  handled: AgentSignal[];
  handledAt: number[];
  cursors: number[];
  lists: { after: number; limit: number }[];
  headCalls: number;
  lines: string[];
}

function harness(opts: {
  stored?: number | null;
  head?: number;
  pages?: JournalEvent[][];
  headOk?: boolean;
  listOk?: boolean;
  handle?: (signal: AgentSignal, emittedAt: number) => Promise<void>;
  handleDeadlineMs?: number;
}): Harness {
  const pages = [...(opts.pages ?? [[]])];
  const h: Harness = {
    handled: [],
    handledAt: [],
    cursors: [],
    lists: [],
    headCalls: 0,
    lines: [],
  } as unknown as Harness;
  h.io = {
    eventsHead: async () => {
      h.headCalls++;
      return opts.headOk === false
        ? { ok: false, error: 'daemon down' }
        : { ok: true, data: { cursor: opts.head ?? 100 } };
    },
    eventsList: async (after, limit) => {
      h.lists.push({ after, limit });
      if (opts.listOk === false) return { ok: false, error: 'daemon down' };
      return { ok: true, data: { events: pages.shift() ?? [] } };
    },
    readCursor: () => opts.stored ?? null,
    writeCursor: c => h.cursors.push(c),
    handle:
      opts.handle ??
      (async (signal, emittedAt) => {
        h.handled.push(signal);
        h.handledAt.push(emittedAt);
      }),
    appRoot: ROOT,
    log: line => h.lines.push(line),
    handleDeadlineMs: opts.handleDeadlineMs,
  };
  h.feed = new AgentStatusFeed(h.io);
  return h;
}

describe('isAgentStatusTopic', () => {
  test('matches the prefix and nothing else', () => {
    expect(isAgentStatusTopic('board/agent-status/review')).toBe(true);
    expect(isAgentStatusTopic('gate/opened/abc')).toBe(false);
    expect(isAgentStatusTopic(undefined)).toBe(false);
  });
});

describe('AgentStatusFeed.catchUp', () => {
  test('first boot seeds the cursor from head and replays nothing', async () => {
    const h = harness({ stored: null, head: 2439 });
    await h.feed.catchUp();
    expect(h.headCalls).toBe(1);
    expect(h.cursors).toEqual([2439]);
    expect(h.lists).toEqual([{ after: 2439, limit: PAGE_LIMIT }]);
    expect(h.handled).toEqual([]);
  });

  test('a stored cursor is used and head is never asked', async () => {
    const h = harness({ stored: 41, pages: [[event(42)]] });
    await h.feed.catchUp();
    expect(h.headCalls).toBe(0);
    expect(h.lists[0]).toEqual({ after: 41, limit: PAGE_LIMIT });
    expect(h.handled.map(s => s.mrUrl)).toEqual([MR]);
  });

  test('handles in id order and advances the cursor after each event', async () => {
    const h = harness({
      stored: 10,
      pages: [[event(11), event(12, { topic: 'board/agent-status/doctor' })]],
    });
    await h.feed.catchUp();
    expect(h.handled.length).toBe(2);
    expect(h.cursors).toEqual([11, 12]);
  });

  test('the handled signal carries no appRoot', async () => {
    const h = harness({ stored: 10, pages: [[event(11)]] });
    await h.feed.catchUp();
    expect(h.handled[0]).toEqual({
      mrUrl: MR,
      iid: 4821,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
    });
  });

  test('the handler receives the event emittedAt', async () => {
    const h = harness({ stored: 10, pages: [[event(11)]] });
    await h.feed.catchUp();
    expect(h.handledAt).toEqual([EMITTED_BASE + 11]);
  });

  test('another board root is skipped and still advances the cursor', async () => {
    const other = event(11);
    (other.payload as { appRoot: string }).appRoot = '/Users/dev/other';
    const h = harness({ stored: 10, pages: [[other, event(12)]] });
    await h.feed.catchUp();
    expect(h.handled.length).toBe(1);
    expect(h.cursors).toEqual([11, 12]);
  });

  test('a foreign root is reported once per root', async () => {
    const stamp = (ev: JournalEvent, root: string): JournalEvent => {
      (ev.payload as { appRoot: string }).appRoot = root;
      return ev;
    };
    const h = harness({
      stored: 10,
      pages: [
        [
          stamp(event(11), '/Users/dev/other'),
          stamp(event(12), '/Users/dev/other'),
          stamp(event(13), '/Users/dev/third'),
        ],
      ],
    });
    await h.feed.catchUp();
    expect(h.handled).toEqual([]);
    expect(h.lines).toEqual([
      `agent-status feed: ignoring frames stamped /Users/dev/other; this board is ${ROOT}`,
      `agent-status feed: ignoring frames stamped /Users/dev/third; this board is ${ROOT}`,
    ]);
  });

  test('a malformed payload is dropped with one line and still advances', async () => {
    const h = harness({
      stored: 10,
      pages: [[event(11, { payload: { nope: true } }), event(12)]],
    });
    await h.feed.catchUp();
    expect(h.handled.length).toBe(1);
    expect(h.cursors).toEqual([11, 12]);
    expect(h.lines).toEqual([
      'agent-status feed: dropped malformed event #11 on board/agent-status/review',
    ]);
  });

  test('a handler throw is logged, the cursor advances, and the next event is still handled', async () => {
    let calls = 0;
    const h = harness({
      stored: 10,
      pages: [[event(11), event(12)]],
      handle: async () => {
        calls++;
        if (calls === 1) throw new Error('slack exploded');
      },
    });
    await h.feed.catchUp();
    expect(calls).toBe(2);
    expect(h.cursors).toEqual([11, 12]);
    expect(h.lines).toEqual([
      `agent-status feed: handler failed on #11 (${MR}): slack exploded`,
    ]);
  });

  test('a handler that throws synchronously is logged and the next event is still handled', async () => {
    let calls = 0;
    const h = harness({
      stored: 10,
      pages: [[event(11), event(12)]],
      handle: (): Promise<void> => {
        calls++;
        if (calls === 1) throw new Error('sync boom');
        return Promise.resolve();
      },
    });
    await h.feed.catchUp();
    expect(calls).toBe(2);
    expect(h.cursors).toEqual([11, 12]);
    expect(h.lines).toEqual([
      `agent-status feed: handler failed on #11 (${MR}): sync boom`,
    ]);
  });

  test('a handler past the deadline is logged and the cursor advances', async () => {
    const slow = new Promise<void>(resolve => setTimeout(resolve, 50));
    const h = harness({
      stored: 10,
      pages: [[event(11), otherMrEvent(12)]],
      handleDeadlineMs: 10,
      handle: async signal => {
        const first = h.handled.length === 0;
        h.handled.push(signal);
        if (first) await slow;
      },
    });
    await h.feed.catchUp();
    expect(h.cursors).toEqual([11, 12]);
    expect(h.lines).toEqual([
      `agent-status feed: handler timed out on #11 (${MR}) after 10ms`,
    ]);
    expect(h.handled.length).toBe(2);
    await slow;
  });

  test('a later event for the same MR waits for a timed-out handler', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    let secondDone: () => void = () => {};
    const second = new Promise<void>(r => {
      secondDone = r;
    });
    const trace: string[] = [];
    let calls = 0;
    const h = harness({
      stored: 10,
      pages: [[event(11), event(12)]],
      handleDeadlineMs: 10,
      handle: async () => {
        const nth = ++calls;
        trace.push(`start ${nth}`);
        if (nth === 1) {
          await gate;
          trace.push('end 1');
          return;
        }
        trace.push('end 2');
        secondDone();
      },
    });
    await h.feed.catchUp();
    expect(h.cursors).toEqual([11, 12]);
    expect(trace).toEqual(['start 1']);
    expect(h.lines).toEqual([
      `agent-status feed: handler timed out on #11 (${MR}) after 10ms`,
      `agent-status feed: handler timed out on #12 (${MR}) after 10ms`,
    ]);
    release();
    await second;
    expect(trace).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  test('a different MR is not blocked by a timed-out handler', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    let firstDone: () => void = () => {};
    const first = new Promise<void>(r => {
      firstDone = r;
    });
    const trace: string[] = [];
    let calls = 0;
    const h = harness({
      stored: 10,
      pages: [[event(11), otherMrEvent(12)]],
      handleDeadlineMs: 10,
      handle: async () => {
        const nth = ++calls;
        trace.push(`start ${nth}`);
        if (nth === 1) {
          await gate;
          trace.push('end 1');
          firstDone();
          return;
        }
        trace.push('end 2');
      },
    });
    await h.feed.catchUp();
    expect(trace).toEqual(['start 1', 'start 2', 'end 2']);
    expect(h.lines).toEqual([
      `agent-status feed: handler timed out on #11 (${MR}) after 10ms`,
    ]);
    release();
    await first;
  });

  test('pages through a full page and stops on a short one', async () => {
    const full = Array.from({ length: PAGE_LIMIT }, (_, i) => event(11 + i));
    const h = harness({ stored: 10, pages: [full, [event(11 + PAGE_LIMIT)]] });
    await h.feed.catchUp();
    expect(h.lists.map(l => l.after)).toEqual([10, 10 + PAGE_LIMIT]);
    expect(h.handled.length).toBe(PAGE_LIMIT + 1);
  });

  test('a journal read failure is logged and the cursor is untouched', async () => {
    const h = harness({ stored: 10, listOk: false });
    await h.feed.catchUp();
    expect(h.cursors).toEqual([]);
    expect(h.lines).toEqual([
      'agent-status feed: journal read failed: daemon down',
    ]);
  });

  test('a head failure on first boot is logged and nothing is read', async () => {
    const h = harness({ stored: null, headOk: false });
    await h.feed.catchUp();
    expect(h.lists).toEqual([]);
    expect(h.cursors).toEqual([]);
    expect(h.lines).toEqual([
      'agent-status feed: cursor seed failed: daemon down',
    ]);
  });

  test('concurrent wake-ups coalesce into one running pass plus one follow-up', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    const h = harness({
      stored: 10,
      pages: [[event(11)], [event(12)], [event(13)]],
      handle: async signal => {
        h.handled.push(signal);
        if (signal.iid === 4821 && h.handled.length === 1) await gate;
      },
    });
    const first = h.feed.catchUp();
    const second = h.feed.catchUp();
    const third = h.feed.catchUp();
    release();
    await Promise.all([first, second, third]);
    expect(h.lists.length).toBe(2);
    expect(h.handled.length).toBe(2);
  });
});

describe('cursor file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'asf-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('round-trips an integer', () => {
    const path = join(dir, 'agent-status-cursor');
    writeCursorFile(path, 2439);
    expect(readCursorFile(path)).toBe(2439);
  });

  test('missing, empty, or garbage reads as null', () => {
    const path = join(dir, 'agent-status-cursor');
    expect(readCursorFile(path)).toBeNull();
    writeFileSync(path, '');
    expect(readCursorFile(path)).toBeNull();
    writeFileSync(path, 'banana');
    expect(readCursorFile(path)).toBeNull();
  });

  test('creates the parent directory on write', () => {
    const path = join(dir, 'state', 'agent-status-cursor');
    writeCursorFile(path, 7);
    expect(readCursorFile(path)).toBe(7);
  });
});
