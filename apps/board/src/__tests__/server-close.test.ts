import { describe, expect, test } from 'bun:test';

import type { AgentSignal } from '../agent-signal.ts';
import { closeOnDone } from '../close-on-done.ts';

function signal(
  status: string,
  overrides: Partial<AgentSignal> = {}
): AgentSignal {
  return {
    mrUrl: 'https://gitlab.example.com/group/project/-/merge_requests/1',
    iid: 1,
    kind: 'review',
    status,
    ...overrides,
  };
}

describe('closeOnDone', () => {
  test('done with a tabId on file closes that tab and clears it', async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal('done'),
      () => 'tab-1',
      async tabId => {
        closed.push(tabId);
      },
      s => cleared.push(s)
    );
    expect(closed).toEqual(['tab-1']);
    expect(cleared).toHaveLength(1);
  });

  test('done with no tabId on file is a no-op -- close and clear both skipped', async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal('done'),
      () => undefined,
      async tabId => {
        closed.push(tabId);
      },
      s => cleared.push(s)
    );
    expect(closed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  test('error status never closes or clears, even with a tabId on file', async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal('error'),
      () => 'tab-1',
      async tabId => {
        closed.push(tabId);
      },
      s => cleared.push(s)
    );
    expect(closed).toEqual([]);
    expect(cleared).toEqual([]);
  });

  test('a rejecting close is detached and swallowed; the tabId clears immediately, before the close settles', async () => {
    const cleared: AgentSignal[] = [];
    let closeStarted = false;
    closeOnDone(
      signal('done'),
      () => 'tab-1',
      async () => {
        closeStarted = true;
        throw new Error('herdr tab close failed');
      },
      s => cleared.push(s)
    );
    // Synchronous return: the caller (the /agent/status handler) is never
    // blocked on the close, and the tabId is already cleared.
    expect(cleared).toHaveLength(1);
    expect(closeStarted).toBe(true);
    // Let the detached rejection settle -- it must be swallowed, not unhandled.
    await new Promise(r => setTimeout(r, 0));
  });

  test('any other in-flight status never closes or clears', async () => {
    const closed: string[] = [];
    const cleared: AgentSignal[] = [];
    await closeOnDone(
      signal('reviewing'),
      () => 'tab-1',
      async tabId => {
        closed.push(tabId);
      },
      s => cleared.push(s)
    );
    expect(closed).toEqual([]);
    expect(cleared).toEqual([]);
  });
});
