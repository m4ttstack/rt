/** Pure helpers behind the `?gate=<id>` deep link -- the DOM effect (scroll,
    flash, strip) that consumes them lives in Board.tsx. */

import type { TabConfig } from '../../config.ts';
import type { BoardMR } from '../../data.ts';
import { filterByTab } from '../../view.ts';
import type { ViewState } from '../../view.ts';

/** The `gate` query param, or null when absent or empty. */
export function gateParam(search: string): string | null {
  const value = new URLSearchParams(search).get('gate');
  return value ? value : null;
}

/** The iid of the row whose gates carry `gateId`, or null when no row does. */
export function mrForGate(
  mrs: Array<{ iid: number; gates?: Array<{ gateId: string }> }>,
  gateId: string
): number | null {
  const hit = mrs.find(mr => mr.gates?.some(g => g.gateId === gateId));
  return hit ? hit.iid : null;
}

/** A `?gate=<id>` deep link overrides the stored member/tab/slack filters
    that would otherwise hide the linked MR rather than merely widening
    them -- a notification click has to land, not silently no-op behind
    whatever the viewer last had picked. Member always widens to 'all' (a
    link carries no author context worth preserving); the tab only changes
    when the current one would not show the MR, switching to the first
    configured tab whose filterByTab result includes it; the slack filter
    only clears when it would otherwise filter the MR out. */
export function viewStateForGate<
  T extends BoardMR & { slack?: { posted?: boolean } | null },
>(
  state: ViewState,
  mrs: T[],
  tabs: TabConfig[],
  rosterUsernames: Set<string>,
  iid: number
): ViewState {
  const mr = mrs.find(m => m.iid === iid);
  if (!mr) return state;

  let next: ViewState = { ...state, member: 'all' };

  const showsIid = (tab: TabConfig) =>
    filterByTab(mrs, tab, rosterUsernames).some(m => m.iid === iid);
  const currentTab = tabs.find(t => t.id === next.tab);
  if (!currentTab || !showsIid(currentTab)) {
    const winningTab = tabs.find(showsIid);
    if (winningTab) next = { ...next, tab: winningTab.id };
  }

  if (next.slack !== 'all' && !mr.slack?.posted) {
    next = { ...next, slack: 'all' };
  }

  return next;
}

/** `search` without its `gate` param; every other param rides along untouched. */
export function stripGateParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('gate');
  const s = params.toString();
  return s ? `?${s}` : '';
}
