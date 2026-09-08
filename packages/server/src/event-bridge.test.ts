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

test('ensureEventBridgeRule appends when the rule identity is absent', () => {
  const write = vi.fn();
  ensureEventBridgeRule(() => [], write, BOARD_RULE);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith([BOARD_RULE]);
});

test('ensureEventBridgeRule is a no-op when an identical rule already exists', () => {
  const write = vi.fn();
  ensureEventBridgeRule(() => [{ ...BOARD_RULE }], write, BOARD_RULE);
  expect(write).not.toHaveBeenCalled();
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
  const write = vi.fn();
  ensureEventBridgeRule(() => [other, stale], write, BOARD_RULE);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith([other, BOARD_RULE]);
});

test('ensureEventBridgeRule leaves a same-pattern different-subjectPrefix rule alone and appends', () => {
  const consoleRule: EventBridgeRule = {
    ...BOARD_RULE,
    subjectPrefix: 'run:',
    url: 'https://console.localhost/gates/{id}',
  };
  const write = vi.fn();
  ensureEventBridgeRule(() => [consoleRule], write, BOARD_RULE);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith([consoleRule, BOARD_RULE]);
});

test('ensureEventBridgeRule drops replacePatterns entries when installing', () => {
  const legacy: EventBridgeRule = {
    pattern: 'board/gate/opened/*',
    category: 'gate',
    title: '{label}',
    message: '{subject}',
  };
  const write = vi.fn();
  ensureEventBridgeRule(() => [legacy], write, BOARD_RULE, {
    replacePatterns: ['board/gate/opened/*'],
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith([BOARD_RULE]);
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
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4123/api/status');
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
