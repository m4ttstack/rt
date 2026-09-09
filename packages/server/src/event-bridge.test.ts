import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

import {
  deckAppUrl,
  ensureEventBridgeRule,
  type EventBridgeRule,
} from './event-bridge';

const BOARD_RULE: EventBridgeRule = {
  pattern: 'gate/opened/*',
  subjectPrefix: 'mr:',
  category: 'gate',
  title: '{label}',
  message: '{question}',
  url: 'https://board.localhost/?gate={id}',
};

/** A read/write pair backed by one mutable slot, the way the real settings
    store behaves (a write is visible to the next read) -- ensureEventBridgeRule's
    verify-after-write pass depends on that, so a mock that ignores writes
    would misreport every call as a lost race. */
function fakeStore(initial: EventBridgeRule[]): {
  read: () => EventBridgeRule[];
  write: (next: EventBridgeRule[]) => void;
  writes: EventBridgeRule[][];
} {
  let current = initial;
  const writes: EventBridgeRule[][] = [];
  return {
    read: () => current,
    write: next => {
      writes.push(next);
      current = next;
    },
    writes,
  };
}

test('ensureEventBridgeRule appends when the rule identity is absent', () => {
  const store = fakeStore([]);
  ensureEventBridgeRule(store.read, store.write, BOARD_RULE);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toEqual([BOARD_RULE]);
});

test('ensureEventBridgeRule is a no-op when an identical rule already exists', () => {
  const store = fakeStore([{ ...BOARD_RULE }]);
  ensureEventBridgeRule(store.read, store.write, BOARD_RULE);
  expect(store.writes).toHaveLength(0);
});

test('ensureEventBridgeRule replaces in place when the identity matches but the body differs', () => {
  const stale: EventBridgeRule = { ...BOARD_RULE, title: 'stale title' };
  const other: EventBridgeRule = {
    pattern: 'run/opened/*',
    subjectPrefix: 'run:',
    category: 'run',
    title: 'x',
    message: 'y',
  };
  const store = fakeStore([other, stale]);
  ensureEventBridgeRule(store.read, store.write, BOARD_RULE);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toEqual([other, BOARD_RULE]);
});

test('ensureEventBridgeRule leaves a same-pattern different-subjectPrefix rule alone and appends', () => {
  const consoleRule: EventBridgeRule = {
    ...BOARD_RULE,
    subjectPrefix: 'run:',
    url: 'https://console.localhost/gates/{id}',
  };
  const store = fakeStore([consoleRule]);
  ensureEventBridgeRule(store.read, store.write, BOARD_RULE);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toEqual([consoleRule, BOARD_RULE]);
});

test('ensureEventBridgeRule drops replacePatterns entries when installing', () => {
  const legacy: EventBridgeRule = {
    pattern: 'board/gate/opened/*',
    category: 'gate',
    title: '{label}',
    message: '{subject}',
  };
  const store = fakeStore([legacy]);
  ensureEventBridgeRule(store.read, store.write, BOARD_RULE, {
    replacePatterns: ['board/gate/opened/*'],
  });
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toEqual([BOARD_RULE]);
});

test('ensureEventBridgeRule drops a same-pattern legacy rule with no subjectPrefix when the incoming rule carries one', () => {
  // The exact body the released board wrote before subjectPrefix existed --
  // an absent prefix matches every subject in rt, so it double-notifies
  // alongside a newly installed scoped rule unless it is absorbed.
  const legacyCatchAll: EventBridgeRule = {
    pattern: 'gate/opened/*',
    category: 'gate',
    title: '{label}',
    message: '{subject}',
  };
  const store = fakeStore([legacyCatchAll]);
  ensureEventBridgeRule(store.read, store.write, BOARD_RULE);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toEqual([BOARD_RULE]);
});

test('ensureEventBridgeRule retries once when a stale read after write shows the rule missing', () => {
  const writes: EventBridgeRule[][] = [];
  const write = (next: EventBridgeRule[]) => writes.push(next);
  let readCalls = 0;
  // First read (before the write): empty. Second read (the verify pass,
  // simulating a concurrent writer's stale snapshot): still empty, as if
  // the just-completed write never landed.
  const read = () => {
    readCalls++;
    return [] as EventBridgeRule[];
  };
  ensureEventBridgeRule(read, write, BOARD_RULE);
  expect(readCalls).toBe(2);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual([BOARD_RULE]);
  expect(writes[1]).toEqual([BOARD_RULE]);
});

test('ensureEventBridgeRule does not retry when the verify read shows the rule present', () => {
  const writes: EventBridgeRule[][] = [];
  const write = (next: EventBridgeRule[]) => writes.push(next);
  let readCalls = 0;
  const read = () => {
    readCalls++;
    // Second call (the verify pass) sees the write that just landed.
    return readCalls === 1 ? [] : [BOARD_RULE];
  };
  ensureEventBridgeRule(read, write, BOARD_RULE);
  expect(readCalls).toBe(2);
  expect(writes).toHaveLength(1);
});

function tempStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'event-bridge-test-'));
}

function fakeStatusFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

test('deckAppUrl returns the matching row url on the happy path', async () => {
  const dir = tempStateDir();
  try {
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ port: 4123, pid: 1 })
    );
    const fetchImpl = fakeStatusFetch(200, {
      apps: [
        { name: 'other', url: 'https://other.mattstack' },
        { name: 'board', url: 'https://board.mattstack' },
      ],
    });
    const url = await deckAppUrl('board', 'http://localhost:9999', {
      stateDir: dir,
      fetch: fetchImpl,
    });
    expect(url).toBe('https://board.mattstack');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4123/api/v1/status',
      { signal: expect.any(AbortSignal) }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deckAppUrl returns the fallback when api.json is missing', async () => {
  const dir = tempStateDir();
  try {
    const url = await deckAppUrl('board', 'http://localhost:9999', {
      stateDir: dir,
      fetch: fakeStatusFetch(200, { apps: [] }),
    });
    expect(url).toBe('http://localhost:9999');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deckAppUrl returns the fallback when fetch throws', async () => {
  const dir = tempStateDir();
  try {
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ port: 4123, pid: 1 })
    );
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const url = await deckAppUrl('board', 'http://localhost:9999', {
      stateDir: dir,
      fetch: fetchImpl,
    });
    expect(url).toBe('http://localhost:9999');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deckAppUrl returns the fallback when the row url is null', async () => {
  const dir = tempStateDir();
  try {
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ port: 4123, pid: 1 })
    );
    const fetchImpl = fakeStatusFetch(200, {
      apps: [{ name: 'board', url: null }],
    });
    const url = await deckAppUrl('board', 'http://localhost:9999', {
      stateDir: dir,
      fetch: fetchImpl,
    });
    expect(url).toBe('http://localhost:9999');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deckAppUrl returns the fallback when the row is missing', async () => {
  const dir = tempStateDir();
  try {
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ port: 4123, pid: 1 })
    );
    const fetchImpl = fakeStatusFetch(200, {
      apps: [{ name: 'console', url: 'https://console.mattstack' }],
    });
    const url = await deckAppUrl('board', 'http://localhost:9999', {
      stateDir: dir,
      fetch: fetchImpl,
    });
    expect(url).toBe('http://localhost:9999');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deckAppUrl returns the fallback on a non-200 response', async () => {
  const dir = tempStateDir();
  try {
    writeFileSync(
      join(dir, 'api.json'),
      JSON.stringify({ port: 4123, pid: 1 })
    );
    const url = await deckAppUrl('board', 'http://localhost:9999', {
      stateDir: dir,
      fetch: fakeStatusFetch(500, { error: 'boom' }),
    });
    expect(url).toBe('http://localhost:9999');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
