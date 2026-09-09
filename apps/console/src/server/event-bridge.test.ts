// @vitest-environment node
import type { EventBridgeRule } from '@mattstack/app-server/event-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

const { consoleBridgeRule, installConsoleBridgeRule } =
  await import('./event-bridge');
const rt = await import('@mattstack/rt-client');

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeIo(initial: EventBridgeRule[]): {
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

describe('consoleBridgeRule', () => {
  it('matches the console contract: pattern, subjectPrefix, templates, and click-through url', () => {
    expect(consoleBridgeRule('https://console.mattstack')).toEqual({
      pattern: 'gate/opened/*',
      subjectPrefix: 'run:',
      category: 'gate',
      title: '{label}',
      message: '{question}',
      url: 'https://console.mattstack/gates/{id}',
    });
  });
});

describe('installConsoleBridgeRule', () => {
  const rule = consoleBridgeRule('https://console.mattstack');

  it('resolves the url through resolveUrl with the port fallback, then upserts an empty list', async () => {
    const io = fakeIo([]);
    const resolveUrl = vi.fn(async () => 'https://console.mattstack');
    await installConsoleBridgeRule({
      port: 11011,
      read: io.read,
      write: io.write,
      resolveUrl,
    });
    expect(resolveUrl).toHaveBeenCalledWith('http://localhost:11011');
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([rule]);
  });

  it('leaves an identical rule already present untouched, no duplicate written', async () => {
    const io = fakeIo([rule]);
    await installConsoleBridgeRule({
      port: 11011,
      read: io.read,
      write: io.write,
      resolveUrl: async () => 'https://console.mattstack',
    });
    expect(io.writes).toHaveLength(0);
  });

  it('replaces a stale same-identity rule in place, leaving other entries untouched', async () => {
    const board: EventBridgeRule = {
      pattern: 'gate/opened/*',
      subjectPrefix: 'mr:',
      category: 'gate',
      title: '{label}',
      message: '{question}',
      url: 'https://board.mattstack/?gate={id}',
    };
    const stale: EventBridgeRule = {
      pattern: 'gate/opened/*',
      subjectPrefix: 'run:',
      category: 'gate',
      title: '{label}',
      message: '{subject}',
    };
    const io = fakeIo([board, stale]);
    await installConsoleBridgeRule({
      port: 11011,
      read: io.read,
      write: io.write,
      resolveUrl: async () => 'https://console.mattstack',
    });
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([board, rule]);
  });

  it('wires the default read/write through getSetting/setSetting when no overrides are given', async () => {
    vi.mocked(rt.getSetting).mockReturnValue({ value: [], provenance: [] });
    await installConsoleBridgeRule({
      port: 11011,
      resolveUrl: async () => 'https://console.mattstack',
    });
    expect(rt.getSetting).toHaveBeenCalledWith('rt.notify.eventBridges');
    expect(rt.setSetting).toHaveBeenCalledWith(
      'rt.notify.eventBridges',
      [rule],
      'user'
    );
  });
});
