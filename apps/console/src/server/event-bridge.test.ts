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
  it('matches the console contract: pattern, subjectPrefix, templates, click-through url, and human owner', () => {
    expect(consoleBridgeRule('https://console.mattstack')).toEqual({
      pattern: 'gate/opened/*',
      subjectPrefix: 'run:',
      category: 'gate',
      title: '{label}',
      message: '{question}',
      url: 'https://console.mattstack/gates/{id}',
      owner: 'human',
    });
  });
});

describe('installConsoleBridgeRule', () => {
  const rule = consoleBridgeRule('https://console.mattstack');

  it('upserts the url deck resolved into an empty list', async () => {
    const io = fakeIo([]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => 'https://console.local.test',
    });
    expect(io.writes).toEqual([
      [consoleBridgeRule('https://console.local.test')],
    ]);
  });

  it('keeps an existing rule exactly as it is when deck does not answer', async () => {
    const existing = consoleBridgeRule('http://localhost:11011');
    const io = fakeIo([existing]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => null,
    });
    expect(io.writes).toHaveLength(0);
  });

  it('seeds a missing rule with the https console domain when deck does not answer', async () => {
    const io = fakeIo([]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => null,
    });
    expect(io.writes).toEqual([[rule]]);
  });

  it('leaves an identical rule already present untouched, no duplicate written', async () => {
    const io = fakeIo([rule]);
    await installConsoleBridgeRule({
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
