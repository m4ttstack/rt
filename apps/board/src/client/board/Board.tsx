import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GateDomain } from '@mattstack/gate-kit';
import { ICONS, Panel, SideDrawer, ToastHost } from '@mattstack/tui-kit';
import type { TabConfig } from '../../config.ts';
import type { BoardMR } from '../../data.ts';
import { inferRoster } from '../../data.ts';
import type { GateRow } from '../../gates/store.ts';
import { sectionStatus } from '../../sections.ts';
import {
  menuActsOnSelection,
  postableOf,
  selectionOf,
  tabChangeClearsSelection,
} from '../../selection.ts';
import {
  dataAgeLabel,
  filterByDraft,
  filterByMember,
  filterBySlack,
  filterByTab,
  freshnessBanner,
  GROUP_KEYS,
  groupMRs,
  NEEDS_ME_TAB,
  nestStacks,
  parseViewState,
  rosterUsernamesFor,
  serializeViewState,
  sortMRs,
} from '../../view.ts';
import type {
  DraftFilter,
  SlackFilter,
  StackNode,
  ViewState,
} from '../../view.ts';
import { postAction, type ActionResult } from '../api.ts';
import type {
  BoardData,
  BoardMRWithReview,
  DraftInfo,
  RowContext,
  RowMenuState,
  ThemeMode,
} from '../types.ts';
import {
  dispatchRowAction,
  runBulk,
  runOne,
  type LaunchOpts,
  type RowHandlers,
  type RunnerDeps,
} from './action-runner.ts';
import { ActionMenu } from './ActionMenu.tsx';
import { AppLauncher } from './AppLauncher.tsx';
import { AppMark } from './AppMark.tsx';
import { CommentsDrawer } from './CommentsDrawer.tsx';
import { ConfigModal } from './ConfigModal.tsx';
import { Controls, ThemeToggle } from './Controls.tsx';
import type { QueueEntry } from './decision-queue.ts';
import { decidedEntries, useDecisionQueue } from './decision-queue.ts';
import {
  DecisionQueueComplete,
  DecisionQueueModal,
} from './DecisionQueueModal.tsx';
import {
  gateDeepLinkAction,
  gateParam,
  mrForGate,
  stripGateParam,
  viewStateForGate,
} from './deep-link.ts';
import { DraftModal } from './DraftModal.tsx';
import { boardSummary, draftKey, mrLine } from './format.ts';
import {
  useBoardData,
  useLaunchAction,
  useMerging,
  useOptimisticLifecycle,
  useToasts,
} from './hooks.ts';
import { NEED_LABEL, NEED_ORDER, needOf } from './needs-me.ts';
import { overlay, overlayMerging } from './optimistic.ts';
import { RespondModal, ReviewModal } from './ReviewModal.tsx';
import {
  bulkActions,
  type ActionEnv,
  type LaunchFlow,
  type RowAction,
  type RunOpts,
} from './row-actions.ts';
import { RowMenu } from './RowMenu.tsx';
import { RowView } from './RowView.tsx';
import { SelectionBar } from './SelectionBar.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { Sidebar } from './Sidebar.tsx';
import { useStaleTabTitle } from './stale-tab-title.ts';
import { TabBar } from './TabBar.tsx';

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

const THEME_KEY = 'mrs-theme';
const STATE_KEY = 'mrs-view-state';

// A gate stuck on delivery or left execution-unassigned stays in the
// decision queue despite being `answered` -- it still needs a human action
// (focus-pane / retry), and the row's status line only points at the queue,
// which is the one place that action renders.
const needsQueue = (gate: GateRow): boolean =>
  gate.status === 'open' ||
  gate.status === 'parked' ||
  gate.execution === 'unassigned' ||
  gate.delivery?.outcome === 'stuck';

/** The tabs the board shows: the configured ones plus the built-in seat tab
    whenever the board has a seat (never on an "all" board, where nobody's
    move is anybody's). The config editor keeps `data.tabs` alone. */
function boardTabs(d: Pick<BoardData, 'tabs' | 'defaultMember'>): TabConfig[] {
  return d.defaultMember === 'all' ? d.tabs : [...d.tabs, NEEDS_ME_TAB];
}

/** Empty-list copy: the posted-in-slack and hide-drafts chips both persist
    across tabs, so an empty view has to name whichever is on — and how many
    rows it hid — rather than read as "this queue has no work". Slack wins
    when both are on at once; the two firing together to empty a queue is
    rare enough not to earn its own combined phrasing. */
function emptyQueueCopy(
  slackFilter: SlackFilter,
  slackHidden: number,
  draftFilter: DraftFilter,
  draftsHidden: number
): string {
  if (slackFilter === 'posted') {
    const slack = slackHiddenCopy(slackFilter, slackHidden);
    return slack
      ? `Nothing found in slack · ${slack}`
      : 'Nothing found in slack';
  }
  const drafts = draftsHiddenCopy(draftFilter, draftsHidden);
  return drafts
    ? `nothing waiting on review ✓ · ${drafts}`
    : 'nothing waiting on review ✓';
}

function slackHiddenCopy(
  slackFilter: SlackFilter,
  slackHidden: number
): string | null {
  if (slackFilter !== 'posted' || slackHidden === 0) return null;
  return `${slackHidden} item${slackHidden === 1 ? '' : 's'} hidden`;
}

function draftsHiddenCopy(
  draftFilter: DraftFilter,
  draftsHidden: number
): string | null {
  if (draftFilter !== 'hide' || draftsHidden === 0) return null;
  return `${draftsHidden} draft${draftsHidden === 1 ? '' : 's'} hidden`;
}

/** The sidebar counts every row for a member, including the ones the slack
    and drafts chips filter out, so a trimmed list has to say what it hid or
    the two numbers read as disagreeing. */
function hiddenRowsNote(
  slackFilter: SlackFilter,
  slackHidden: number,
  draftFilter: DraftFilter,
  draftsHidden: number
): string | null {
  const parts = [
    slackHiddenCopy(slackFilter, slackHidden),
    draftsHiddenCopy(draftFilter, draftsHidden),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// Module scope, not inline in useLaunchAction's call below: an inline arrow
// is a new function every render, which breaks the memo chain running
// through launch, runner, runRowAction and rowHandlers.
const resumeReviewFailureMessage = (
  result: ActionResult,
  mr: BoardMR
): string =>
  `resume review failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`;
const resumeRespondFailureMessage = (
  result: ActionResult,
  mr: BoardMR
): string =>
  `resume respond failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`;

// ── board ──────────────────────────────────────────────────────────────────

export function Board() {
  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode) ?? 'system'
  );

  // View state (member/group/sort). Members are validated once data arrives.
  const [state, setState] = useState<ViewState>(() => {
    let stored: Partial<ViewState> | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    } catch {
      stored = null;
    }
    return parseViewState(location.search, stored, []);
  });
  const validatedOnce = useRef(false);
  // The iid a `?gate=<id>` deep link resolved to on first load, consumed by
  // the scroll/flash/strip effect below once that row has actually rendered.
  const [gateDeepLink, setGateDeepLink] = useState<{
    iid: number | null;
    gateId: string;
  } | null>(null);

  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };
  const update = (patch: Partial<ViewState>) => {
    const clearsSelection = tabChangeClearsSelection(patch, state.tab);
    // Each tab has its own roster (a codeowners tab's is inferred from the rows
    // in view), so a member picked on one tab usually does not exist on the
    // next: carrying it over would land on an empty board. The seat tab's
    // whole point is its grouping by need, so it opens grouped that way and
    // leaves that grouping behind on the way out.
    const entersSeat = patch.tab === NEEDS_ME_TAB.id && state.tab !== patch.tab;
    const leavesSeat =
      patch.tab !== undefined &&
      patch.tab !== NEEDS_ME_TAB.id &&
      state.tab === NEEDS_ME_TAB.id;
    const next = {
      ...state,
      ...patch,
      ...(clearsSelection ? { member: 'all' } : {}),
      ...(entersSeat && !patch.group ? { group: 'needs' as const } : {}),
      ...(leavesSeat && state.group === 'needs'
        ? { group: 'age' as const }
        : {}),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    history.replaceState(
      null,
      '',
      serializeViewState(next) || location.pathname
    );
    setState(next);
    if (clearsSelection) setSelected(new Set());
  };

  // Re-resolve the view state's member against the roster the instant real
  // data arrives: on the first load, that's URL/localStorage/defaultMember
  // resolved against the now-known roster; on every later load, just drop a
  // member who's no longer on the (visible) roster. Passed into useBoardData
  // (rather than a separate effect keyed on `data`) so it runs in the same
  // batch as setData -- see that hook's doc comment. Deliberately empty deps:
  // it only closes over the (stable) validatedOnce ref and setState.
  const onData = useCallback((d: BoardData) => {
    const usernames = d.members.map(m => m.username);
    if (!validatedOnce.current) {
      validatedOnce.current = true;
      let stored: Partial<ViewState> | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
      } catch {
        stored = null;
      }
      // Tab validated once here, same as member -- never re-derived from the
      // URL on later polls, so a live tab pick survives the 60s refresh cycle.
      // Two passes because the member's valid set depends on which tab wins:
      // a codeowners tab's roster is its own authors, so a stored pick there
      // would otherwise be dropped as "not on the team" on every reload.
      const tabs = boardTabs(d);
      const tabIds = tabs.map(t => t.id);
      const firstPass = parseViewState(
        location.search,
        stored,
        usernames,
        d.defaultMember,
        tabIds
      );
      const tab = tabs.find(t => t.id === firstPass.tab) ?? tabs[0];
      const validMembers = [...rosterUsernamesFor(d.mrs, tab, usernames, tabs)];
      let resolved = parseViewState(
        location.search,
        stored,
        validMembers,
        d.defaultMember,
        tabIds
      );
      const gateId = gateParam(location.search);
      const linkedIid = gateId ? mrForGate(d.mrs, gateId) : null;
      if (linkedIid !== null) {
        // The stored/URL filters resolved above may hide the linked MR (wrong
        // tab, a member pick, "posted only") -- a deep link has to land, so
        // widen whatever would otherwise keep the row off-screen.
        resolved = viewStateForGate(
          resolved,
          d.mrs,
          tabs,
          new Set(usernames),
          linkedIid
        );
        setGateDeepLink({ iid: linkedIid, gateId: gateId! });
      } else if (
        gateId &&
        (d.queueExtras ?? []).some(g => g.gateId === gateId)
      ) {
        // A human-owned gate with no MR row (a pane-attention gate) has no
        // row to widen filters for or flash, but it can still open the modal.
        setGateDeepLink({ iid: null, gateId });
      }
      // Landing on the seat tab without a grouping in the URL means its own
      // grouping; a grouping the user picked there rides in the URL.
      if (
        resolved.tab === NEEDS_ME_TAB.id &&
        !new URLSearchParams(location.search).has('group')
      )
        resolved = { ...resolved, group: 'needs' };
      setState(resolved);
    } else {
      // Validated against the ACTIVE TAB's roster: a codeowners tab's is
      // inferred from the rows in view, so checking the config roster alone
      // would drop a legitimately picked author on the next poll.
      setState(prev => {
        // A tab dropped in the settings modal must not linger as the active
        // id, or re-adding one with that id would silently jump to it.
        const tabs = boardTabs(d);
        const tab = tabs.find(t => t.id === prev.tab) ?? tabs[0]!;
        const next = tab.id === prev.tab ? prev : { ...prev, tab: tab.id };
        if (next.member === 'all') return next;
        return rosterUsernamesFor(d.mrs, tab, usernames, tabs).has(next.member)
          ? next
          : { ...next, member: 'all' };
      });
    }
  }, []);

  // Data fetching (initial load, 60s poll, visibilitychange, SSE, the scoped
  // 15s member poll, and refreshNow) all live in useBoardData now. See that
  // hook's doc comment for why the fast-poll-while-active interval stays here
  // instead -- it needs `data` (this hook's own output) to compute the
  // predicate it would need to take as an argument.
  const { data, loadError, load, refreshNow, refreshing, setData } =
    useBoardData(state.member, onData);

  // Selection for the multi-copy bar, keyed by webUrl so it survives the
  // refresh poll and every member/group/sort change. Deliberately not
  // persisted: a reload should not hand you yesterday's selection.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelect = useCallback((webUrl: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(webUrl)) next.add(webUrl);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const [showSettings, setShowSettings] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Row action menu (right-click) and transient toasts.
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  // The MR whose saved review is open in the modal, if any.
  const [reviewModal, setReviewModal] = useState<BoardMRWithReview | null>(
    null
  );
  // The MR whose saved respond adjudication is open in the modal, if any.
  const [respondModal, setRespondModal] = useState<BoardMRWithReview | null>(
    null
  );
  // The held draft open in its drawer, if any, and the drafts already acted on
  // this session (optimistic — the next /data.json pull drops resolved drafts).
  const [draftModal, setDraftModal] = useState<{
    mr: BoardMRWithReview;
    draft: DraftInfo;
  } | null>(null);
  const [draftResolved, setDraftResolved] = useState<
    ReadonlyMap<string, 'posted' | 'dismissed'>
  >(new Map());
  const openDraft = useCallback(
    (mr: BoardMRWithReview, draft: DraftInfo) => setDraftModal({ mr, draft }),
    []
  );
  const [commentsFor, setCommentsFor] = useState<BoardMR | null>(null);
  const { toasts, addToast } = useToasts();

  // A drawer action succeeded: swap the chip to its resolved state, close the
  // drawer, and confirm with a toast (the board's transient-confirmation form).
  const handleDraftResolved = useCallback(
    (outcome: 'posted' | 'dismissed') => {
      if (!draftModal) return;
      const { mr, draft } = draftModal;
      setDraftResolved(prev =>
        new Map(prev).set(draftKey(mr.webUrl ?? '', draft.kind), outcome)
      );
      setDraftModal(null);
      addToast(
        outcome === 'posted'
          ? `held note posted to !${mr.iid}`
          : `held note dismissed on !${mr.iid}`
      );
    },
    [draftModal, addToast]
  );

  const applyHidden = useCallback((username: string, hidden: boolean) => {
    setData(prev =>
      prev
        ? {
            ...prev,
            // Predict what the reload will send, so nothing flickers when it lands:
            // a checked-out member's MRs aren't fetched, so they have no count.
            allMembers: prev.allMembers.map(m =>
              m.username === username
                ? { ...m, hidden, count: hidden ? null : m.count }
                : m
            ),
          }
        : prev
    );
  }, []);

  // Check a member in/out. The box flips locally first and never waits on the
  // network: the POST is quick, but the reload behind it refetches the team from
  // GitLab (~25s, since a checked-in member's MRs aren't in the snapshot). The
  // board catches up when that lands; a failed POST flips the box back.
  const toggleMember = useCallback(
    (username: string, hidden: boolean) => {
      applyHidden(username, hidden);
      postAction('/settings', { username, hidden }).then(result => {
        if (!result.ok) {
          applyHidden(username, !hidden);
          addToast(`could not check ${username} ${hidden ? 'out' : 'in'}`);
          return;
        }
        load();
      });
    },
    [applyHidden, load, addToast]
  );

  // Optimistic review/respond/doctor state: show a "queued" badge the instant
  // a launch is requested, before the server's state file round-trips back
  // via /data.json. Cleared per MR once the server reports real status for
  // that axis.
  const optimisticLifecycle = useOptimisticLifecycle(data);
  const merging = useMerging(data);

  const openRowMenu = useCallback((e: React.MouseEvent, mr: BoardMR) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, mr });
  }, []);

  // Six "launch a pane" flows collapse onto useLaunchAction: claim optimistic
  // queued state (skipped for resume, whose axis is null), toast, POST, and
  // reconcile on the answer. See launch-flow.ts's runLaunchFlow for the
  // shared shape; note is folded into `extra` since JSON.stringify already
  // drops it when undefined, matching every one of today's payloads.
  const launchReview = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 'launching review',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const reReviewAction = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 're-reviewing',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const respondAction = useLaunchAction({
    axis: 'respond',
    path: '/respond',
    verbing: 'launching response',
    noun: 'response',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const doctorAction = useLaunchAction({
    axis: 'doctor',
    path: '/doctor',
    verbing: 'calling doctor',
    noun: 'doctor',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  // Resume actions: axis null means useLaunchAction's setQueued/rollback are
  // no-ops, matching today's handleResume (which never claimed a badge before
  // the reload settled). Bespoke failureMessage restores handleResume's own
  // failure wording, including the server's response text when it sends one
  // (e.g. "no session id on file") -- the shared default failure toast has no
  // way to carry that detail.
  const resumeReviewAction = useLaunchAction({
    axis: null,
    path: '/review',
    verbing: 'resuming review',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
    failureMessage: resumeReviewFailureMessage,
  });
  const resumeRespondAction = useLaunchAction({
    axis: null,
    path: '/respond',
    verbing: 'resuming respond',
    noun: 'respond',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
    failureMessage: resumeRespondFailureMessage,
  });

  // Each flow's payload lives here once: the row menu, the bulk menu, the
  // status line's verbs and the decision queue all launch through it.
  const launch = useCallback(
    (flow: LaunchFlow, mr: BoardMR, opts: LaunchOpts = {}) => {
      const { note, intent, quiet } = opts;
      switch (flow) {
        case 'review':
          return launchReview(mr, { tabId: state.tab }, note, intent, quiet);
        case 're-review':
          return reReviewAction(
            mr,
            { reReview: true, tabId: state.tab },
            note,
            undefined,
            quiet
          );
        case 'resume-review':
          return resumeReviewAction(
            mr,
            { resume: true },
            note,
            undefined,
            quiet
          );
        case 'respond':
          return respondAction(mr, {}, note, intent, quiet);
        case 'resume-respond':
          return resumeRespondAction(
            mr,
            { resume: true },
            note,
            undefined,
            quiet
          );
        case 'doctor':
          return doctorAction(mr, {}, note, intent, quiet);
        case 'rebase-local':
          // The doctor chassis scoped to a checkout rebase: the fallback when
          // the GitLab-side rebase can't (conflicts) or didn't work.
          return doctorAction(mr, { mode: 'rebase' }, note, undefined, quiet);
      }
    },
    [
      launchReview,
      reReviewAction,
      resumeReviewAction,
      respondAction,
      resumeRespondAction,
      doctorAction,
      state.tab,
    ]
  );
  const handleLaunch = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('review', mr, { note, intent }),
    [launch]
  );
  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) => void launch('re-review', mr, { note }),
    [launch]
  );
  const handleRespond = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('respond', mr, { note, intent }),
    [launch]
  );
  const handleDoctor = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('doctor', mr, { note, intent }),
    [launch]
  );
  const handleResumeRespond = useCallback(
    (mr: BoardMR, note?: string) => void launch('resume-respond', mr, { note }),
    [launch]
  );

  // A gate's "focus pane" escape hatch: jump into whichever domain's pane
  // opened the gate, via the exact same launch endpoint a fresh launch from
  // the row would use -- the server-side dedup (existing tabId + in-flight
  // status) re-focuses that pane, and the focus intent makes a gone pane a
  // refusal rather than a fresh launch, so this never invents a distinct
  // focus call.
  const handleFocusPane = useCallback(
    (mr: BoardMR, domain: GateDomain) =>
      void launch(
        domain === 'review' || domain === 'respond' ? domain : 'doctor',
        mr,
        { intent: 'focus' }
      ),
    [launch]
  );

  // The status line's clear verb: tombstones the dead run daemon-side
  // regardless of whether an attention gate exists to resume from.
  const handleClearOrphan = useCallback(
    (agentId: string) => {
      postAction('/reconciler/clear', { agentId }).then(result => {
        if (!result.ok) {
          addToast(`could not clear the executor (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  // Dismiss a failed lane's line from the row (B8). The lane keeps its state
  // and its report; the stamp only outranks it until something writes the
  // lane again, so this is a "stop telling me" and never a delete.
  const handleDismissLane = useCallback(
    (mr: BoardMR, lane: 'review' | 'respond' | 'doctor') => {
      if (!mr.webUrl) return;
      postAction('/dismiss', { mrUrl: mr.webUrl, lane }).then(result => {
        if (!result.ok) {
          addToast(`could not dismiss the ${lane} line (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  // Row menu's "never diagnose this stack" toggle. Turning it on mutes
  // auto-doctor for this MR and every descendant (server-enforced) and
  // clears whatever's currently on this row; turning it off just clears the
  // flag, it never re-launches anything.
  const handleStandDown = useCallback(
    (mr: BoardMR, on: boolean) => {
      if (!mr.webUrl) return;
      postAction('/triage/stand-down', {
        mrUrl: mr.webUrl,
        iid: mr.iid,
        on,
      }).then(result => {
        if (!result.ok) {
          addToast(
            `could not ${on ? 'stand down' : 're-enable'} auto-doctor (${result.status})`
          );
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  // The row's own note (B10). One row's editor is open at a time; saving
  // writes through and reloads, so the band renders from the stored note
  // rather than from what was typed.
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const handleSaveNote = useCallback(
    (mr: BoardMR, text: string) => {
      if (!mr.webUrl) return;
      setNoteEditing(null);
      postAction('/note', { mrUrl: mr.webUrl, text }).then(result => {
        if (!result.ok) {
          addToast(`could not save the note on !${mr.iid} (${result.status})`);
          return;
        }
        load();
      });
    },
    [addToast, load]
  );

  const handleCopy = useCallback(
    (mr: BoardMR) => {
      const text = data
        ? mrLine(mr, data.slackTemplates)
        : (mr.webUrl ?? mr.title);
      navigator.clipboard?.writeText(text).then(
        () => addToast(`copied !${mr.iid} for slack`),
        () => {}
      );
    },
    [addToast, data]
  );

  const [postingSummary, setPostingSummary] = useState(false);

  const handlePostSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`posting !${mr.iid} to slack…`);
      postAction('/slack/post', { mrUrls: [mr.webUrl] }).then(result => {
        if (!result.ok)
          return addToast(
            `slack post failed for !${mr.iid} (${result.status})`
          );
        addToast(
          result.body?.linked
            ? `!${mr.iid} already in slack — linked`
            : `posted !${mr.iid} to slack`
        );
        load();
      });
    },
    [addToast, load]
  );

  /** `onPosted` runs only when the message actually landed -- the selection bar
      uses it to clear the selection, and a failed post must leave the selection
      intact so the user can retry. */
  const handlePostSummary = useCallback(
    (mrs: BoardMR[], header?: string, onPosted?: () => void) => {
      const urls = mrs.map(m => m.webUrl).filter((u): u is string => !!u);
      if (!urls.length) return;
      setPostingSummary(true);
      addToast(
        `posting ${urls.length} MR${urls.length === 1 ? '' : 's'} to slack…`
      );
      postAction(
        '/slack/post',
        header ? { mrUrls: urls, header } : { mrUrls: urls }
      )
        .then(result => {
          const body: unknown = result.body;
          if (!result.ok)
            return addToast(
              `slack post failed (${result.status})${typeof body === 'string' ? `: ${body}` : ''}`
            );
          addToast(
            `posted ${urls.length} MR${urls.length === 1 ? '' : 's'} to slack`
          );
          onPosted?.();
          load();
        })
        .finally(() => setPostingSummary(false));
    },
    [addToast, load]
  );

  const runner: RunnerDeps = useMemo(
    () => ({
      post: (path, payload) => postAction(path, payload),
      launch,
      addToast,
      reload: fresh => void load(fresh),
      merging: { start: merging.start, fail: merging.fail },
    }),
    [launch, addToast, load, merging.start, merging.fail]
  );
  const rowHandlers: RowHandlers = useMemo(
    () => ({
      copy: handleCopy,
      note: mr => setNoteEditing(mr.webUrl ?? null),
      open: url => window.open(url, '_blank', 'noopener'),
      viewReport: (mr, lane) =>
        (lane === 'review' ? setReviewModal : setRespondModal)(
          mr as BoardMRWithReview
        ),
      dismiss: handleDismissLane,
      standDown: handleStandDown,
      postSlack: handlePostSlack,
    }),
    [handleCopy, handleDismissLane, handleStandDown, handlePostSlack]
  );
  const runRowAction = useCallback(
    (action: RowAction, mr: BoardMR, opts: RunOpts) =>
      dispatchRowAction(action.request, mr, opts, runner, rowHandlers),
    [runner, rowHandlers]
  );

  // Poll faster while a review, response, or doctor run is active, or a fired
  // merge waits to leave, so the row updates promptly instead of waiting for
  // the normal 60s cadence.
  // Stays here rather than inside useBoardData -- see that hook's doc comment.
  const fastPoll = optimisticLifecycle.active || merging.merging.size > 0;
  useEffect(() => {
    if (!fastPoll) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => clearInterval(t);
  }, [fastPoll, load]);

  // The pure filter/group/sort pipeline (overlay -> tabFiltered ->
  // filterBySlack(filterByMember(...)) -> groupMRs(...).map(sortMRs...)),
  // hoisted above the loading guard below and memoized so it has exactly one
  // source of truth: the render body reads its fields instead of
  // recomputing them, and the decision queue below reads the same `groups`
  // the rows actually render -- header count and queue order can never drift
  // from what's on screen. Sitting above the guard (rather than after it,
  // where `groups` used to live) is what lets this and useDecisionQueue be
  // called unconditionally, as every hook in this component must be: a
  // render where `data` is still null must call exactly the hooks it always
  // calls, never fewer.
  const boardView = useMemo(() => {
    if (!data) return null;
    const total = data.members.reduce((n, m) => n + m.count, 0);
    const now = Date.now();
    const self = data.defaultMember === 'all' ? null : data.defaultMember;
    const tabs = boardTabs(data);
    // tabs is always non-empty (server falls back to IMPLICIT_TABS);
    // state.tab itself may briefly lag on the very first render before
    // onData's validation pass lands, so fall back to the first tab rather
    // than trust it blindly.
    const activeTab = tabs.find(t => t.id === state.tab) ?? tabs[0]!;
    const isCodeownersTab = activeTab.source.kind === 'codeowners';
    const isSeatTab = activeTab.source.kind === 'needs-me';
    // A codeowners tab's "who counts as roster" set for excludeMembers.
    const rosterUsernames = new Set(data.members.map(m => m.username));
    // Server state wins; otherwise show an optimistic "queued" badge if pending.
    const mrs = overlayMerging(
      overlay(data.mrs, optimisticLifecycle.state),
      merging.merging
    );
    const need = (mr: BoardMRWithReview) =>
      self === null ? null : needOf(mr, self, now, draftResolved);
    const needsMe = (rows: BoardMRWithReview[]) =>
      rows.filter(mr => need(mr) !== null);
    const tabFiltered = isSeatTab
      ? needsMe(filterByTab(mrs, activeTab, rosterUsernames, tabs))
      : filterByTab(mrs, activeTab, rosterUsernames, tabs);
    // The seat tab's count shows on the tab strip from every tab.
    const needsMeCount =
      self === null
        ? null
        : needsMe(filterByTab(mrs, NEEDS_ME_TAB, rosterUsernames, tabs)).length;
    // Codeowners and seat tabs bypass member filtering entirely (and the
    // sidebar that drives it) -- their rows are scoped by section or by
    // need, not by roster author, and may come from outside the team. Inferring
    // a roster from the rows in view keeps the author filter (and the settings
    // gears that live in this panel) available.
    const inferred = isCodeownersTab || isSeatTab;
    const roster = inferred ? inferRoster(tabFiltered) : data.members;
    const rosterTotal = inferred ? tabFiltered.length : total;
    // A stored "posted" pick with slack unconfigured would hide every row
    // behind a control that isn't rendered, so the filter only bites when
    // there are refs to filter on.
    const slackFilter = data.slackEnabled ? state.slack : 'all';
    // Drafts never appear at all on an "all" board (buildBoard drops every
    // draft when there's no single defaultMember to own one), so the same
    // guard keeps a stored "hide" pick from doing anything on a board where
    // the chip isn't rendered.
    const draftFilter: DraftFilter =
      data.defaultMember !== 'all' ? state.drafts : 'all';
    const memberFiltered = filterByMember(tabFiltered, state.member);
    const slackFiltered = filterBySlack(memberFiltered, slackFilter);
    const filtered = filterByDraft(slackFiltered, draftFilter);
    const slackHidden = memberFiltered.length - slackFiltered.length;
    const draftsHidden = slackFiltered.length - filtered.length;
    const groups = groupMRs(
      filtered,
      state.group,
      data.members.map(m => m.username),
      now,
      mr => {
        const n = need(mr);
        return n && { label: NEED_LABEL[n], order: NEED_ORDER.indexOf(n) };
      }
    ).map(g => ({
      label: g.label,
      mrs: sortMRs(g.mrs, state.sort),
    }));
    return {
      tabs,
      activeTab,
      isCodeownersTab,
      isSeatTab,
      needsMeCount,
      rosterUsernames,
      mrs,
      tabFiltered,
      roster,
      rosterTotal,
      slackFilter,
      slackHidden,
      draftFilter,
      draftsHidden,
      filtered,
      groups,
    };
  }, [data, optimisticLifecycle.state, merging.merging, state, draftResolved]);

  // Actionable gates on every row the board holds, visible rows first in
  // board order (group order, the group's own sort, stack nesting: exactly
  // what `boardView.groups` renders), then the rows the current tab or
  // filter hides, in the same sort. A decision is owed whichever author is
  // picked, so the queue button never vanishes behind a filter.
  const queueEntries = useMemo(() => {
    if (!boardView) return [];
    const out: QueueEntry[] = [];
    const seen = new Set<BoardMRWithReview>();
    const collectMr = (mr: BoardMRWithReview) => {
      if (seen.has(mr)) return;
      seen.add(mr);
      for (const gate of mr.gates) if (needsQueue(gate)) out.push({ gate, mr });
    };
    const collect = (node: StackNode<BoardMRWithReview>) => {
      collectMr(node.mr);
      node.children.forEach(collect);
    };
    for (const g of boardView.groups) nestStacks(g.mrs).forEach(collect);
    for (const mr of sortMRs(boardView.mrs, state.sort)) collectMr(mr);
    // Human-owned, non-MR gates (queueExtras -- a pane-attention gate is the
    // first kind of these) join the same queue with no `mr` at all.
    for (const gate of data?.queueExtras ?? [])
      if (needsQueue(gate)) out.push({ gate });
    return out;
  }, [boardView, data, state.sort]);
  // Positive answer evidence for the queue's reconcile, from the RAW data:
  // a gate answered on another surface must retire even if its MR is
  // currently filtered out of view.
  const answeredGateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const mr of data?.mrs ?? [])
      for (const gate of mr.gates)
        if (gate.status === 'answered') ids.add(gate.gateId);
    for (const gate of data?.queueExtras ?? [])
      if (gate.status === 'answered') ids.add(gate.gateId);
    return ids;
  }, [data]);
  const queue = useDecisionQueue(queueEntries, answeredGateIds);
  const activeGateId = queue.active?.gate.gateId ?? null;
  const retireActiveGate = () => {
    if (activeGateId === null) return;
    queue.noteAnswered(activeGateId);
    void load();
  };

  // `?gate=<id>` deep link: by the time this runs, the linked row and queue
  // entries have already rendered (gateDeepLink is set in the same batch as
  // the data that produced them). history.replaceState strips the param so a
  // refresh doesn't re-open. A gate still owed an answer opens the decision
  // modal at that gate; an answered or unknown one degrades to the row
  // scroll+flash.
  //
  // Deliberately keyed on gateDeepLink alone: this is a one-shot consumption
  // of the link, and re-running it when a poll reshuffles queueEntries would
  // re-scroll or re-open mid-flash. The closure's queueEntries/queue are from
  // the same batch that set gateDeepLink, which is exactly the snapshot the
  // link should act on.
  useEffect(() => {
    if (gateDeepLink === null) return;
    // An empty relative url is a no-op for replaceState (it keeps the
    // current query) -- fall back to the bare pathname, same as update().
    history.replaceState(
      null,
      '',
      stripGateParam(location.search) || location.pathname
    );
    if (gateDeepLinkAction(queueEntries, gateDeepLink.gateId) === 'modal') {
      queue.openAt(gateDeepLink.gateId);
      setGateDeepLink(null);
      return;
    }
    const row =
      gateDeepLink.iid === null
        ? null
        : document.querySelector(
            `[data-mr-iid="${CSS.escape(String(gateDeepLink.iid))}"]`
          );
    if (!row) {
      setGateDeepLink(null);
      return;
    }
    row.scrollIntoView({ block: 'center' });
    row.classList.add('tui-row-flash');
    // Resetting gateDeepLink changes this effect's own dependency, which
    // re-runs its cleanup -- doing that synchronously here would clearTimeout
    // the flash removal before it ever fires. Reset it from inside the
    // timeout instead, once the flash has actually been removed.
    const t = setTimeout(() => {
      row.classList.remove('tui-row-flash');
      setGateDeepLink(null);
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot link consumption; see above
  }, [gateDeepLink]);

  const now = Date.now();
  const freshness = data
    ? freshnessBanner({
        fetchError: data.fetchError,
        dataSyncedAt: data.dataSyncedAt,
        syncError: data.syncError,
        now,
      })
    : null;
  useStaleTabTitle(freshness !== null);

  if (!data) {
    return (
      <p className="tui-loading">
        {loadError ? '✗ failed to load board data' : 'fetching…'}
      </p>
    );
  }

  const {
    tabs,
    activeTab,
    isCodeownersTab,
    isSeatTab,
    needsMeCount,
    rosterUsernames,
    mrs,
    tabFiltered,
    roster,
    rosterTotal,
    slackFilter,
    slackHidden,
    draftFilter,
    draftsHidden,
    filtered,
    groups,
  } = boardView!;

  const hiddenNote = hiddenRowsNote(
    slackFilter,
    slackHidden,
    draftFilter,
    draftsHidden
  );
  const dataAge = dataAgeLabel(data.dataSyncedAt, now);
  // Both known and the board asks for more history than rt actually syncs --
  // config drift the board can't self-correct, so it needs to be visible.
  const windowMismatch =
    data.scopeWindowDays !== null && data.staleAfterDays > data.scopeWindowDays
      ? `board shows ${data.staleAfterDays} days but rt syncs ${data.scopeWindowDays} days... align configs`
      : null;

  const activeSection =
    activeTab.source.kind === 'codeowners'
      ? sectionStatus(activeTab.source.section, data.scopeKnownSections)
      : null;
  const unknownTabs = data.tabs.flatMap(t =>
    t.source.kind === 'codeowners' &&
    sectionStatus(t.source.section, data.scopeKnownSections).unknown
      ? [t.id]
      : []
  );
  // A wrong name is not "still syncing": the unknown state owns the tab.
  const tabSyncing =
    activeTab.source.kind === 'codeowners' &&
    !activeSection?.unknown &&
    data.scopeUncoveredSections.includes(activeTab.source.section);
  const activeMember =
    state.member !== 'all'
      ? (roster.find(m => m.username === state.member) ?? null)
      : null;
  // Show each row's author only when the view mixes authors: the All view
  // grouped by anything but author (where the group header isn't the name),
  // or a codeowners tab, which is never narrowed to one author.
  const showAuthor = state.member === 'all' && state.group !== 'author';
  // Under author grouping the header IS the name, so rows normally drop the
  // author tag -- but a stack pulled to its root's group can carry a
  // co-author's MR under someone else's header. Tag the rows whenever a group
  // turns out to hold more than one author, so nothing is misattributed.
  const showAuthorIn = (g: { mrs: BoardMR[] }) =>
    showAuthor ||
    (state.member === 'all' &&
      new Set(g.mrs.map(m => m.author.username)).size > 1);
  const flatMrs = groups.flatMap(g => g.mrs);
  // Drawn from `mrs`, not `filtered` -- that's what lets a selection span
  // member filters.
  const selectedMrs = selectionOf(mrs, selected);
  const summaryText = boardSummary(flatMrs, data.slackTemplates);
  const postableMrs = postableOf(flatMrs);
  const postableSelected = postableOf(selectedMrs);
  const rowCtx: RowContext = {
    local: data.local,
    self: data.defaultMember === 'all' ? null : data.defaultMember,
    slackTemplates: data.slackTemplates,
    slackEnabled: data.slackEnabled,
    onContext: openRowMenu,
    onOpenReview: setReviewModal,
    onOpenRespond: setRespondModal,
    onOpenDraft: openDraft,
    onOpenComments: setCommentsFor,
    draftResolved,
    onResumeRespond: handleResumeRespond,
    onFocusPane: handleFocusPane,
    onLaunch: handleLaunch,
    onReReview: handleReReview,
    onRespond: handleRespond,
    onDoctor: handleDoctor,
    onOpenGate: queue.openAt,
    selected,
    onToggleSelect: toggleSelect,
    onClearOrphan: handleClearOrphan,
    onMerge: mr => void runOne({ kind: 'mr', action: 'merge' }, mr, runner),
    onDismissLane: handleDismissLane,
    onStandDown: handleStandDown,
    noteEditing,
    onEditNote: setNoteEditing,
    onSaveNote: handleSaveNote,
  };
  const actionEnv: ActionEnv = {
    local: data.local,
    slackEnabled: data.slackEnabled,
    self:
      data.defaultMember && data.defaultMember !== 'all'
        ? data.defaultMember
        : null,
    roster: data.members.map(m => m.username),
    peers: data.peers,
    allMrs: data.mrs,
  };
  // A remote board has no bulk actions (each needs the local server), so a
  // right-click there keeps the row's own menu instead of an empty one.
  const bulkEntries =
    data.local &&
    rowMenu &&
    menuActsOnSelection(rowMenu.mr, selected, selectedMrs.length)
      ? bulkActions(selectedMrs, actionEnv)
      : null;
  const openSettings = () => {
    setMenuOpen(false);
    setShowSettings(true);
  };
  const openConfig = () => {
    setMenuOpen(false);
    setShowConfig(true);
  };
  // Refs go stale between sweeps, so switching the filter on re-checks the
  // board (forced sweep, server-side); the current data filters immediately
  // and newly found rows land on the reload.
  const toggleSlackFilter = () => {
    const next = state.slack === 'posted' ? 'all' : 'posted';
    update({ slack: next });
    if (next !== 'posted' || !data.local) return;
    addToast('refreshing slack status…');
    postAction('/slack/refresh', {}).then(result => {
      if (!result.ok)
        return addToast(`slack refresh failed (${result.status})`);
      addToast('slack status refreshed');
      load();
    });
  };
  // No server refresh needed here: isDraft rides the regular poll, unlike
  // slack status which needs its own out-of-band check.
  const toggleDraftFilter = () => {
    update({ drafts: state.drafts === 'hide' ? 'all' : 'hide' });
  };
  const inferredNote = isCodeownersTab
    ? 'authors in this queue'
    : isSeatTab
      ? 'authors needing you'
      : undefined;
  const controlProps = {
    state,
    update,
    // Grouping by need only means something on the seat tab.
    groupKeys: isSeatTab ? GROUP_KEYS : GROUP_KEYS.filter(k => k !== 'needs'),
    theme,
    pickTheme,
    // The bar owns copy while a selection is live -- its header input has to
    // sit next to the button that consumes it.
    canCopy: filtered.length > 0 && selectedMrs.length === 0,
    summaryText,
    onRefresh: refreshNow,
    refreshing,
    canPostSummary: data.slackEnabled && data.local && postableMrs.length > 0,
    postingSummary,
    onPostSummary: () => handlePostSummary(postableMrs),
    slackFilter: data.slackEnabled
      ? { active: slackFilter === 'posted', toggle: toggleSlackFilter }
      : null,
    // `active` is "drafts are showing", not "the filter is engaged": drafts
    // show by default, so a chip that only lit up once they were hidden read
    // as off in the state the board is normally in.
    draftFilter:
      data.defaultMember !== 'all'
        ? { active: draftFilter === 'all', toggle: toggleDraftFilter }
        : null,
  };

  return (
    <div className="tui tui-app">
      {/* Desktop roster (hidden on mobile, where it moves into the drawer).
          Also hidden on a codeowners tab: it isn't filtered by member, so the
          roster has nothing to drive. */}
      <Sidebar
        members={roster}
        total={rosterTotal}
        active={state.member}
        onPick={member => update({ member })}
        onSettings={openSettings}
        onConfig={openConfig}
        scopeUncovered={data.scopeUncovered}
        note={inferredNote}
        queue={
          queueEntries.length > 0
            ? { count: queueEntries.length, open: queue.openAtStart }
            : null
        }
      />

      <div className="tui-main">
        <header className="tui-header">
          {/* Mobile-only: burger opens the drawer with roster + controls. */}
          <button
            className="tui-burger"
            onClick={() => setMenuOpen(true)}
            aria-label="open menu"
          >
            {ICONS.menu}
          </button>
          <div className="tui-header-title">
            <h1>
              <AppMark />
              <span>{data.title.toLowerCase()}</span>{' '}
              {activeMember && (
                <span className="tui-author">
                  --author @{activeMember.username}
                </span>
              )}
            </h1>
            <p className="tui-sub">
              <span className="tui-comment">
                # {filtered.length} awaiting review · pick one, it opens in
                gitlab
              </span>
            </p>
          </div>
          <div className="tui-controls tui-controls-header">
            <Controls {...controlProps} />
          </div>
          <div className="tui-app-launcher">
            <ThemeToggle theme={theme} pickTheme={pickTheme} />
            <AppLauncher />
          </div>
        </header>

        <TabBar
          tabs={tabs}
          active={state.tab}
          counts={
            needsMeCount === null ? {} : { [NEEDS_ME_TAB.id]: needsMeCount }
          }
          onPick={tab => update({ tab })}
          syncing={tabSyncing}
          unknown={unknownTabs}
        />

        {selectedMrs.length > 0 && (
          <SelectionBar
            selectedMrs={selectedMrs}
            inViewCount={selectionOf(filtered, selected).length}
            templates={data.slackTemplates}
            onClear={clearSelection}
            posting={postingSummary}
            onActions={
              data.local
                ? (x, y) => {
                    const first = selectedMrs[0];
                    if (first) setRowMenu({ x, y, mr: first });
                  }
                : undefined
            }
            slackPost={
              data.slackEnabled && data.local && postableSelected.length > 0
                ? {
                    count: postableSelected.length,
                    // Clear only on success: the posted MRs drop out of
                    // postableSelected, so leaving them checked would sit the
                    // bar there with no post button and read like a bug.
                    send: header =>
                      handlePostSummary(
                        postableSelected,
                        header,
                        clearSelection
                      ),
                  }
                : null
            }
          />
        )}

        {freshness && (
          <div
            className="tui-banner"
            data-intent={freshness.intent === 'bad' ? 'bad' : undefined}
            role="status"
            title={freshness.title}
          >
            {freshness.text}
          </div>
        )}
        {windowMismatch && <div className="tui-banner">⚠ {windowMismatch}</div>}

        {activeTab.source.kind === 'codeowners' && activeSection?.unknown && (
          <div className="tui-banner" data-intent="bad" role="alert">
            ⚠ no CODEOWNERS section "{activeTab.source.section}"
            {activeSection.suggestion && (
              <> · did you mean "{activeSection.suggestion}"?</>
            )}
            <button
              type="button"
              className="tui-banner-btn"
              onClick={openConfig}
            >
              fix in settings
            </button>
          </div>
        )}

        {filtered.length === 0 &&
        !data.fetchError &&
        freshness?.intent !== 'bad' &&
        !activeSection?.unknown ? (
          <p className="tui-empty">
            {emptyQueueCopy(
              slackFilter,
              slackHidden,
              draftFilter,
              draftsHidden
            )}
          </p>
        ) : (
          groups.map(g => (
            <Panel
              key={g.label}
              title={g.label}
              count={g.mrs.length}
              // Pins the LEGACY persistence key: the recipe defaults to its own
              // "tui-panel-collapsed", and switching would orphan every panel a
              // user has already folded up.
              storageKey="mrs-panel-collapsed"
            >
              <RowView
                mrs={g.mrs}
                now={now}
                showAuthor={showAuthorIn(g)}
                ctx={rowCtx}
              />
            </Panel>
          ))
        )}
        {filtered.length > 0 && hiddenNote && (
          <p className="tui-hidden-note">{hiddenNote}</p>
        )}

        <footer
          className={
            dataAge.stale ? 'tui-footer tui-footer-stale' : 'tui-footer'
          }
        >
          {dataAge.text}
        </footer>
      </div>

      {/* Mobile drawer: roster + controls, tucked behind the burger. */}
      {menuOpen && (
        <SideDrawer
          // `side` replaces the two class-name props: it drives the panel's
          // width, border edge, shadow, padding/gap and the overlay's
          // stacking + alignment. The one thing it does NOT carry is this
          // drawer's below-720px-only existence, which is a board layout
          // decision -- style.css keeps that as a two-rule display gate on
          // [data-part="sidedrawer-overlay"][data-side="left"].
          side="left"
          ariaLabel="menu"
          onClose={() => setMenuOpen(false)}
        >
          <div className="tui-drawer-head">
            <span className="tui-modal-title">❯ menu</span>
            <button
              className="tui-modal-x"
              onClick={() => setMenuOpen(false)}
              aria-label="close menu"
            >
              {ICONS.close}
            </button>
          </div>
          <Sidebar
            members={roster}
            total={rosterTotal}
            active={state.member}
            onPick={member => {
              update({ member });
              setMenuOpen(false);
            }}
            onSettings={openSettings}
            onConfig={openConfig}
            scopeUncovered={data.scopeUncovered}
            note={inferredNote}
            queue={
              queueEntries.length > 0
                ? {
                    count: queueEntries.length,
                    open: () => {
                      setMenuOpen(false);
                      queue.openAtStart();
                    },
                  }
                : null
            }
          />
          <div className="tui-drawer-controls">
            <Controls {...controlProps} stacked />
          </div>
        </SideDrawer>
      )}

      {showSettings && (
        <SettingsModal
          members={data.allMembers}
          canInvite={data.canInvite}
          local={data.local}
          peering={data.peering}
          defaultMember={data.defaultMember}
          onToggle={toggleMember}
          onJoined={() => load()}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showConfig && (
        <ConfigModal
          tabs={data.tabs}
          knownSections={data.scopeKnownSections}
          onTabsSaved={() => load()}
          onClose={() => setShowConfig(false)}
          onOpenRoster={() => {
            setShowConfig(false);
            setShowSettings(true);
          }}
        />
      )}

      {rowMenu &&
        (bulkEntries ? (
          <ActionMenu
            x={rowMenu.x}
            y={rowMenu.y}
            subject={`${selectedMrs.length} selected`}
            entries={bulkEntries}
            empty={`nothing fits all ${selectedMrs.length}`}
            onClose={() => setRowMenu(null)}
            onRun={(key, opts) => {
              const entry = bulkEntries.find(e => e.key === key);
              return entry ? runBulk(entry, opts, runner) : undefined;
            }}
          />
        ) : (
          <RowMenu
            menu={rowMenu}
            env={actionEnv}
            onRun={runRowAction}
            onClose={() => setRowMenu(null)}
          />
        ))}

      {reviewModal && (
        <ReviewModal mr={reviewModal} onClose={() => setReviewModal(null)} />
      )}
      {respondModal && (
        <RespondModal mr={respondModal} onClose={() => setRespondModal(null)} />
      )}

      {queue.open && queue.active && activeGateId && (
        <DecisionQueueModal
          key={activeGateId}
          gate={queue.active.gate}
          mr={queue.active.mr}
          position={queue.position}
          states={queue.states}
          nextPeek={queue.nextPeek}
          onClose={queue.close}
          onNext={queue.next}
          onBack={queue.back}
          canBack={queue.canBack}
          canNext={queue.canNext}
          onFocusPane={handleFocusPane}
          onAnswered={retireActiveGate}
          onContinue={retireActiveGate}
          onLostChange={lost => queue.hold(lost ? activeGateId : null)}
          people={
            new Map(
              data.members.flatMap(m =>
                m.name ? [[m.username, m.name] as const] : []
              )
            )
          }
        />
      )}
      {queue.open && queue.complete && (
        <DecisionQueueComplete
          decided={decidedEntries(queue.answeredIds, data, queue.seenEntries)}
          onClose={queue.close}
        />
      )}

      {draftModal && (
        <DraftModal
          mr={draftModal.mr}
          draft={draftModal.draft}
          local={data.local}
          onResolved={handleDraftResolved}
          onClose={() => setDraftModal(null)}
        />
      )}

      {commentsFor && (
        <CommentsDrawer
          mr={
            data.mrs.find(m => !!m.webUrl && m.webUrl === commentsFor.webUrl) ??
            commentsFor
          }
          local={data.local}
          onClose={() => setCommentsFor(null)}
        />
      )}

      <ToastHost toasts={toasts} />
    </div>
  );
}
