import { describe, expect, it } from 'bun:test';

import { focusPane, type FocusPaneDeps } from '../focus-pane.ts';

function fakeDeps(paneFocusResult: { ok: boolean; error?: string }): {
  deps: FocusPaneDeps;
  paneFocusCalls: Array<{ paneId: string }>;
  focusTabCalls: string[];
} {
  const paneFocusCalls: Array<{ paneId: string }> = [];
  const focusTabCalls: string[] = [];
  const deps: FocusPaneDeps = {
    paneFocus: (async (args: { paneId: string }) => {
      paneFocusCalls.push(args);
      return paneFocusResult;
    }) as FocusPaneDeps['paneFocus'],
    focusTab: (async (tabId: string) => {
      focusTabCalls.push(tabId);
    }) as FocusPaneDeps['focusTab'],
  };
  return { deps, paneFocusCalls, focusTabCalls };
}

describe('focusPane', () => {
  it('paneId present and pane focus succeeds: does not fall back to focusTab', async () => {
    const { deps, paneFocusCalls, focusTabCalls } = fakeDeps({ ok: true });

    const result = await focusPane({ paneId: 'pane-1', tabId: 'tab-1' }, deps);

    expect(paneFocusCalls).toEqual([{ paneId: 'pane-1' }]);
    expect(focusTabCalls.length).toBe(0);
    expect(result).toEqual({ focused: true });
  });

  it("paneId present and pane focus fails: falls back to focusTab with the state's tabId", async () => {
    const { deps, paneFocusCalls, focusTabCalls } = fakeDeps({
      ok: false,
      error: 'no such pane',
    });

    const result = await focusPane({ paneId: 'pane-1', tabId: 'tab-1' }, deps);

    expect(paneFocusCalls).toEqual([{ paneId: 'pane-1' }]);
    expect(focusTabCalls).toEqual(['tab-1']);
    expect(result).toEqual({ focused: true });
  });

  it('no paneId: calls focusTab directly and never calls paneFocus', async () => {
    const { deps, paneFocusCalls, focusTabCalls } = fakeDeps({ ok: true });

    const result = await focusPane({ tabId: 'tab-1' }, deps);

    expect(paneFocusCalls.length).toBe(0);
    expect(focusTabCalls).toEqual(['tab-1']);
    expect(result).toEqual({ focused: true });
  });

  it('pane focus fails and no tabId fallback: resolves focused:false instead of a silent no-op', async () => {
    const { deps, paneFocusCalls, focusTabCalls } = fakeDeps({
      ok: false,
      error: 'no such pane',
    });

    const result = await focusPane({ paneId: 'pane-1' }, deps);

    expect(paneFocusCalls).toEqual([{ paneId: 'pane-1' }]);
    expect(focusTabCalls.length).toBe(0);
    expect(result).toEqual({ focused: false });
  });
});
