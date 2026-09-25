/** Pure helpers behind the `?gate=<id>` and `?mr=<url>` deep links -- the DOM
    effect (scroll, flash, strip) that consumes them lives in Board.tsx. */

import type { TabConfig } from '../../config.ts';
import type { BoardMR } from '../../data.ts';
import { filterByTab } from '../../view.ts';
import type { ViewState } from '../../view.ts';

const LINK_PARAMS = ['gate', 'mr'];

/** The `gate` query param, or null when absent or empty. */
export function gateParam(search: string): string | null {
  const value = new URLSearchParams(search).get('gate');
  return value ? value : null;
}

/** The `mr` query param (an MR's web url, already decoded), or null when
    absent or empty. Rows match on the url because an iid alone is ambiguous
    across repos. */
export function mrParam(search: string): string | null {
  const value = new URLSearchParams(search).get('mr');
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

/** A deep link overrides the stored member/tab/slack/drafts filters that
    would otherwise hide the linked MR rather than merely widening them -- a
    notification click has to land, not silently no-op behind whatever the
    viewer last had picked. Member always widens to 'all' (a link carries no
    author context worth preserving); the tab only changes when the current
    one would not show the MR, switching to the first configured tab whose
    filterByTab result includes it; the slack and drafts filters only clear
    when they would otherwise filter the MR out. */
export function viewStateForMr<
  T extends BoardMR & { slack?: { posted?: boolean } | null },
>(
  state: ViewState,
  mrs: T[],
  tabs: TabConfig[],
  rosterUsernames: Set<string>,
  isLinked: (mr: T) => boolean
): ViewState {
  const mr = mrs.find(isLinked);
  if (!mr) return state;

  let next: ViewState = { ...state, member: 'all' };

  const showsLinked = (tab: TabConfig) =>
    filterByTab(mrs, tab, rosterUsernames).some(isLinked);
  const currentTab = tabs.find(t => t.id === next.tab);
  if (!currentTab || !showsLinked(currentTab)) {
    const winningTab = tabs.find(showsLinked);
    if (winningTab) next = { ...next, tab: winningTab.id };
  }

  if (next.slack !== 'all' && !mr.slack?.posted) {
    next = { ...next, slack: 'all' };
  }

  if (next.drafts !== 'all' && mr.isDraft) {
    next = { ...next, drafts: 'all' };
  }

  return next;
}

/** Where a consumed `?gate=<id>` deep link lands: the decision modal when
    the gate still has a queue entry (an answer is owed), else the row
    scroll+flash -- an answered or unknown gate has nothing left to decide,
    so the link degrades to pointing at where it happened. */
export function gateDeepLinkAction(
  entries: Array<{ gate: { gateId: string } }>,
  gateId: string
): 'modal' | 'flash' {
  return entries.some(e => e.gate.gateId === gateId) ? 'modal' : 'flash';
}

/** The title of the group panel that renders the linked row, matched on the
    same key the flash effect queries the DOM by (url for an MR link, iid for
    a gate link), or null when no group holds it. */
export function linkedGroupLabel(
  groups: Array<{
    label: string;
    mrs: Array<{ iid: number; webUrl: string | null }>;
  }>,
  link: { iid: number | null; mrUrl: string | null }
): string | null {
  const { iid, mrUrl } = link;
  const isLinked =
    mrUrl !== null
      ? (m: { webUrl: string | null }) => m.webUrl === mrUrl
      : iid !== null
        ? (m: { iid: number }) => m.iid === iid
        : null;
  if (!isLinked) return null;
  return groups.find(g => g.mrs.some(isLinked))?.label ?? null;
}

/** `search` without its `gate` and `mr` params; every other param rides
    along untouched. */
export function stripDeepLinkParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of LINK_PARAMS) params.delete(name);
  const s = params.toString();
  return s ? `?${s}` : '';
}
