import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GateDomain } from '@mattstack/gate-kit';
import {
  Button,
  ICONS,
  Panel,
  SideDrawer,
  ToastHost,
} from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { inferRoster } from '../../data.ts';
import type { MrAction } from '../../mr-action.ts';
import { sectionStatus } from '../../sections.ts';
import {
  postableOf,
  selectionOf,
  tabChangeClearsSelection,
} from '../../selection.ts';
import {
  dataAgeLabel,
  filterByMember,
  filterBySlack,
  filterByTab,
  groupMRs,
  nestStacks,
  parseViewState,
  rosterUsernamesFor,
  serializeViewState,
  sortMRs,
} from '../../view.ts';
import type { StackNode, ViewState } from '../../view.ts';
import { postAction } from '../api.ts';
import type {
  BoardData,
  BoardMRWithReview,
  DraftInfo,
  RowContext,
  RowMenuState,
  ThemeMode,
} from '../types.ts';
import { AppLauncher } from './AppLauncher.tsx';
import { AppMark } from './AppMark.tsx';
import { ConfigModal } from './ConfigModal.tsx';
import { Controls } from './Controls.tsx';
import type { QueueEntry } from './decision-queue.ts';
import { useDecisionQueue } from './decision-queue.ts';
import {
  DecisionQueueComplete,
  DecisionQueueModal,
} from './DecisionQueueModal.tsx';
import {
  gateParam,
  mrForGate,
  stripGateParam,
  viewStateForGate,
} from './deep-link.ts';
import { DraftModal } from './DraftModal.tsx';
import { boardSummary, draftKey, getSlackMarks, mrLine } from './format.ts';
import {
  useBoardData,
  useLaunchAction,
  useOptimisticLifecycle,
  useToasts,
} from './hooks.ts';
import { overlay } from './optimistic.ts';
import { RespondModal, ReviewModal } from './ReviewModal.tsx';
import { RowMenu } from './RowMenu.tsx';
import { RowView } from './RowView.tsx';
import { SelectionBar } from './SelectionBar.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TabBar } from './TabBar.tsx';

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

const THEME_KEY = 'mrs-theme';
const STATE_KEY = 'mrs-view-state';

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
  const [gateDeepLinkIid, setGateDeepLinkIid] = useState<number | null>(null);

  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };
  const update = (patch: Partial<ViewState>) => {
    const clearsSelection = tabChangeClearsSelection(patch, state.tab);
    // Each tab has its own roster (a codeowners tab's is inferred from the rows
    // in view), so a member picked on one tab usually does not exist on the
    // next: carrying it over would land on an empty board.
    const next = {
      ...state,
      ...patch,
      ...(clearsSelection ? { member: 'all' } : {}),
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
      const tabIds = d.tabs.map(t => t.id);
      const firstPass = parseViewState(
        location.search,
        stored,
        usernames,
        d.defaultMember,
        tabIds
      );
      const tab = d.tabs.find(t => t.id === firstPass.tab) ?? d.tabs[0];
      const validMembers = [...rosterUsernamesFor(d.mrs, tab, usernames)];
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
          d.tabs,
          new Set(usernames),
          linkedIid
        );
        setGateDeepLinkIid(linkedIid);
      }
      setState(resolved);
    } else {
      // Validated against the ACTIVE TAB's roster: a codeowners tab's is
      // inferred from the rows in view, so checking the config roster alone
      // would drop a legitimately picked author on the next poll.
      setState(prev => {
        // A tab dropped in the settings modal must not linger as the active
        // id, or re-adding one with that id would silently jump to it.
        const tab = d.tabs.find(t => t.id === prev.tab) ?? d.tabs[0]!;
        const next = tab.id === prev.tab ? prev : { ...prev, tab: tab.id };
        if (next.member === 'all') return next;
        return rosterUsernamesFor(d.mrs, tab, usernames).has(next.member)
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

  const openRowMenu = useCallback((e: React.MouseEvent, mr: BoardMR) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, mr });
  }, []);

  // Six near-identical "launch a pane" actions collapse onto useLaunchAction:
  // claim optimistic queued state (skipped for resume, whose axis is null),
  // toast, POST, and reconcile on the answer. See launch-flow.ts's
  // runLaunchFlow for the shared shape; note is folded into `extra` since
  // JSON.stringify already drops it when undefined, matching every one of
  // today's payloads.
  const launchReview = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 'launching review',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const handleLaunch = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      launchReview(mr, { tabId: state.tab }, note, intent),
    [launchReview, state.tab]
  );

  const reReviewAction = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 're-reviewing',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) =>
      reReviewAction(mr, { reReview: true, tabId: state.tab }, note),
    [reReviewAction, state.tab]
  );

  const respondAction = useLaunchAction({
    axis: 'respond',
    path: '/respond',
    verbing: 'launching response',
    noun: 'response',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const handleRespond = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      respondAction(mr, {}, note, intent),
    [respondAction]
  );

  const doctorAction = useLaunchAction({
    axis: 'doctor',
    path: '/doctor',
    verbing: 'calling doctor',
    noun: 'doctor',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const handleDoctor = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      doctorAction(mr, {}, note, intent),
    [doctorAction]
  );
  // The doctor chassis scoped to a checkout rebase — the fallback when the
  // GitLab-side rebase can't (conflicts) or didn't work.
  const handleRebaseLocal = useCallback(
    (mr: BoardMR, note?: string) => doctorAction(mr, { mode: 'rebase' }, note),
    [doctorAction]
  );

  // GateForm's "focus pane" escape hatch: jump into whichever domain's pane
  // opened the gate, via the exact same launch endpoint a fresh launch from
  // the row would use -- the server-side dedup (existing tabId + in-flight
  // status) re-focuses that pane instead of spawning another, so this never
  // invents a distinct focus call.
  const handleFocusPane = useCallback(
    (mr: BoardMR, domain: GateDomain) => {
      if (domain === 'review') handleLaunch(mr, undefined, 'focus');
      else if (domain === 'respond') handleRespond(mr, undefined, 'focus');
      else handleDoctor(mr, undefined, 'focus');
    },
    [handleLaunch, handleRespond, handleDoctor]
  );

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
    failureMessage: (result, mr) =>
      `resume review failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`,
  });
  const handleResumeReview = useCallback(
    (mr: BoardMR, note?: string) =>
      resumeReviewAction(mr, { resume: true }, note),
    [resumeReviewAction]
  );

  const resumeRespondAction = useLaunchAction({
    axis: null,
    path: '/respond',
    verbing: 'resuming respond',
    noun: 'respond',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
    failureMessage: (result, mr) =>
      `resume respond failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`,
  });
  const handleResumeRespond = useCallback(
    (mr: BoardMR, note?: string) =>
      resumeRespondAction(mr, { resume: true }, note),
    [resumeRespondAction]
  );

  // Ask a peer's board for a re-review of one of our MRs. No optimistic chip:
  // the server writes the sent-nudge file before answering, so the reload right
  // behind this brings back the real state one poll sooner than guessing would.
  // Bespoke (not useLaunchAction): the failure toast prefers the server's own
  // refusal text over a generic status message.
  const handleNudge = useCallback(
    (mr: BoardMR, reviewer: string) => {
      if (!mr.webUrl) return;
      addToast(`requesting re-review of !${mr.iid} from ${reviewer}…`);
      postAction('/nudge', { mrUrl: mr.webUrl, iid: mr.iid, reviewer }).then(
        result => {
          if (!result.ok) {
            // A permanent refusal (409) answers in plain text with the reason
            // the relay gave -- e.g. the reviewer has no board on the
            // switchboard. That's the whole point of the failure, so show it.
            const why = result.text.trim();
            addToast(
              why ||
                `couldn't request re-review for !${mr.iid} (${result.status})`
            );
            return;
          }
          if (result.body?.queued)
            addToast(
              `switchboard unreachable... queued the ask to ${reviewer}`
            );
          load();
        }
      );
    },
    [addToast, load]
  );

  // Flip one of your own MRs between draft and ready. No optimistic state: the
  // flip lives in GitLab, so the row waits for the reload rather than claiming a
  // change the API might have refused.
  const handleDraftState = useCallback(
    (mr: BoardMR, draft: boolean) => {
      if (!mr.webUrl) return;
      const verb = draft ? 'draft' : 'ready';
      addToast(`marking !${mr.iid} ${verb}…`);
      postAction('/draft', { mrUrl: mr.webUrl, iid: mr.iid, draft }).then(
        result => {
          if (!result.ok) {
            addToast(`couldn't mark !${mr.iid} ${verb} (${result.status})`);
            return;
          }
          addToast(
            draft
              ? `!${mr.iid} is back to draft`
              : `!${mr.iid} is ready for review`
          );
          void load(true);
        }
      );
    },
    [addToast, load]
  );

  const handleMrAction = useCallback(
    (mr: BoardMR, action: MrAction) => {
      if (!mr.webUrl) return;
      const wording: Record<MrAction, [pending: string, done: string]> = {
        merge: ['merging', 'merge accepted'],
        rebase: ['rebasing', 'rebase started'],
        setAutoMerge: ['arming auto-merge on', 'auto-merge armed for'],
        cancelAutoMerge: ['canceling auto-merge on', 'auto-merge canceled for'],
      };
      const [pending, done] = wording[action];
      addToast(`${pending} !${mr.iid}…`);
      postAction('/mr/action', {
        mrUrl: mr.webUrl,
        iid: mr.iid,
        action,
      }).then(result => {
        if (!result.ok) {
          addToast(`couldn't ${action} !${mr.iid} (${result.status})`);
          return;
        }
        addToast(`${done} !${mr.iid}`);
        void load(true);
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

  const handleResolveSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`finding slack thread for !${mr.iid}…`);
      postAction('/slack/resolve', { mrUrl: mr.webUrl, iid: mr.iid }).then(
        result => {
          if (!result.ok)
            return addToast(
              `slack lookup failed for !${mr.iid} (${result.status})`
            );
          addToast(
            result.body?.status === 'found'
              ? `found slack thread for !${mr.iid}`
              : `no slack thread found for !${mr.iid}`
          );
          load();
        }
      );
    },
    [addToast, load]
  );

  const handleReactSlack = useCallback(
    (mr: BoardMR, emoji: string, remove: boolean): Promise<string[] | null> => {
      if (!mr.webUrl) return Promise.resolve(null);
      const glyph =
        getSlackMarks().find(m => m.emoji === emoji)?.glyph ?? emoji;
      const verb = remove ? 'unmark' : 'add';
      return postAction('/slack/react', {
        mrUrl: mr.webUrl,
        emoji,
        remove,
      }).then(result => {
        if (!result.ok) {
          addToast(
            `couldn't ${verb} ${glyph} for !${mr.iid} (${result.status})`
          );
          return null;
        }
        addToast(`${remove ? 'unmarked' : 'marked'} ${glyph} on !${mr.iid}`);
        load();
        return result.body?.reactions ?? null;
      });
    },
    [addToast, load]
  );

  // Poll faster while a review, response, or doctor run is active, so the
  // badge updates promptly instead of waiting for the normal 60s cadence.
  // Stays here rather than inside useBoardData -- see that hook's doc comment.
  useEffect(() => {
    if (!optimisticLifecycle.active) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => clearInterval(t);
  }, [optimisticLifecycle.active, load]);

  // `?gate=<id>` deep link: by the time this runs, the linked row has already
  // rendered (gateDeepLinkIid is set in the same batch as the data that
  // produced it). history.replaceState strips the param so a refresh doesn't
  // re-scroll.
  useEffect(() => {
    if (gateDeepLinkIid === null) return;
    const row = document.querySelector(
      `[data-mr-iid="${CSS.escape(String(gateDeepLinkIid))}"]`
    );
    // An empty relative url is a no-op for replaceState (it keeps the
    // current query) -- fall back to the bare pathname, same as update().
    history.replaceState(
      null,
      '',
      stripGateParam(location.search) || location.pathname
    );
    if (!row) {
      setGateDeepLinkIid(null);
      return;
    }
    row.scrollIntoView({ block: 'center' });
    row.classList.add('tui-row-flash');
    // Resetting gateDeepLinkIid changes this effect's own dependency, which
    // re-runs its cleanup -- doing that synchronously here would clearTimeout
    // the flash removal before it ever fires. Reset it from inside the
    // timeout instead, once the flash has actually been removed.
    const t = setTimeout(() => {
      row.classList.remove('tui-row-flash');
      setGateDeepLinkIid(null);
    }, 2000);
    return () => clearTimeout(t);
  }, [gateDeepLinkIid]);

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
    // data.tabs is always non-empty (server falls back to IMPLICIT_TABS);
    // state.tab itself may briefly lag on the very first render before
    // onData's validation pass lands, so fall back to the first tab rather
    // than trust it blindly.
    const activeTab = data.tabs.find(t => t.id === state.tab) ?? data.tabs[0]!;
    const isCodeownersTab = activeTab.source.kind === 'codeowners';
    // A codeowners tab's "who counts as roster" set for excludeMembers.
    const rosterUsernames = new Set(data.members.map(m => m.username));
    // Server state wins; otherwise show an optimistic "queued" badge if pending.
    const mrs = overlay(data.mrs, optimisticLifecycle.state);
    const tabFiltered = filterByTab(mrs, activeTab, rosterUsernames);
    // Codeowners tabs bypass member filtering entirely (and the sidebar that
    // drives it) -- the queue is scoped by section, not by roster author.
    // A codeowners tab lists other teams' MRs, so the configured roster has
    // nothing to drive there. Inferring one from the rows in view keeps the
    // author filter (and the settings gears that live in this panel) available.
    const roster = isCodeownersTab ? inferRoster(tabFiltered) : data.members;
    const rosterTotal = isCodeownersTab ? tabFiltered.length : total;
    // A stored "posted" pick with slack unconfigured would hide every row
    // behind a control that isn't rendered, so the filter only bites when
    // there are refs to filter on.
    const slackFilter = data.slackEnabled ? state.slack : 'all';
    const filtered = filterBySlack(
      filterByMember(tabFiltered, state.member),
      slackFilter
    );
    const groups = groupMRs(
      filtered,
      state.group,
      data.members.map(m => m.username),
      Date.now()
    ).map(g => ({
      label: g.label,
      mrs: sortMRs(g.mrs, state.sort),
    }));
    return {
      activeTab,
      isCodeownersTab,
      rosterUsernames,
      mrs,
      tabFiltered,
      roster,
      rosterTotal,
      slackFilter,
      filtered,
      groups,
    };
  }, [data, optimisticLifecycle.state, state]);

  // Actionable gates on VISIBLE rows only, in board order: group order, then
  // the group's own sort, then stack nesting -- exactly the order and scope
  // `boardView.groups` renders, since it's the same array.
  const queueEntries = useMemo(() => {
    if (!boardView) return [];
    const out: QueueEntry[] = [];
    const collect = (node: StackNode) => {
      const mr = node.mr as BoardMRWithReview;
      for (const gate of mr.gates ?? [])
        if (gate.status === 'open' || gate.status === 'parked')
          out.push({ gate, mr });
      node.children.forEach(collect);
    };
    for (const g of boardView.groups) nestStacks(g.mrs).forEach(collect);
    return out;
  }, [boardView]);
  // Positive answer evidence for the queue's reconcile, from the RAW data:
  // a gate answered on another surface must retire even if its MR is
  // currently filtered out of view.
  const answeredGateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const mr of data?.mrs ?? [])
      for (const gate of mr.gates ?? [])
        if (gate.status === 'answered') ids.add(gate.gateId);
    return ids;
  }, [data]);
  const queue = useDecisionQueue(queueEntries, answeredGateIds);
  const activeGateId = queue.active?.gate.gateId ?? null;

  if (!data) {
    return (
      <p className="tui-loading">
        {loadError ? '✗ failed to load board data' : 'fetching…'}
      </p>
    );
  }

  const {
    activeTab,
    isCodeownersTab,
    rosterUsernames,
    mrs,
    tabFiltered,
    roster,
    rosterTotal,
    slackFilter,
    filtered,
    groups,
  } = boardView!;

  const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);
  const now = Date.now();
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
  const postableMrs = postableOf(flatMrs as BoardMRWithReview[]);
  const postableSelected = postableOf(selectedMrs as BoardMRWithReview[]);
  // One context object threaded through RowView and RowMenu — the
  // board-owned bits every row/menu needs that aren't specific to one MR.
  const rowCtx: RowContext = {
    local: data.local,
    slackTemplates: data.slackTemplates,
    slackEnabled: data.slackEnabled,
    onContext: openRowMenu,
    onOpenReview: setReviewModal,
    onOpenRespond: setRespondModal,
    onOpenDraft: openDraft,
    draftResolved,
    onResumeRespond: handleResumeRespond,
    onFocusPane: handleFocusPane,
    onOpenGate: queue.openAt,
    selected,
    onToggleSelect: toggleSelect,
  };
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
  const controlProps = {
    state,
    update,
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
        note={isCodeownersTab ? 'authors in this queue' : undefined}
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
            {queueEntries.length > 0 && (
              <Button
                type="button"
                className="tui-dq-open"
                variant="light"
                intent="accent"
                size="lg"
                onClick={queue.openAtStart}
              >
                decision queue · {queueEntries.length}
              </Button>
            )}
            <Controls {...controlProps} />
          </div>
          <div className="tui-app-launcher">
            <AppLauncher />
          </div>
        </header>

        <TabBar
          tabs={data.tabs}
          active={state.tab}
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

        {data.fetchError && (
          <div className="tui-banner">
            ⚠ data from {staleMins}m ago — gitlab fetch failing
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
        !activeSection?.unknown ? (
          <p className="tui-empty">
            {slackFilter === 'posted'
              ? 'nothing posted in slack yet'
              : 'nothing waiting on review ✓'}
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
            note={isCodeownersTab ? 'authors in this queue' : undefined}
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

      {rowMenu && (
        <RowMenu
          menu={rowMenu}
          ctx={rowCtx}
          onClose={() => setRowMenu(null)}
          onLaunch={handleLaunch}
          onReReview={handleReReview}
          onCopy={handleCopy}
          onResolveSlack={handleResolveSlack}
          onReactSlack={handleReactSlack}
          onPostSlack={handlePostSlack}
          onRespond={handleRespond}
          canRespond={rowMenu.mr.author.username === data.defaultMember}
          onDoctor={handleDoctor}
          // Doctor is mechanical repair (rebase / CI), so it's offered for anyone's
          // MR that's actually broken — not gated to your own MRs the way respond is.
          canDoctor={
            !!(
              rowMenu.mr.blockers?.pipelineFailing ||
              rowMenu.mr.blockers?.hasConflicts
            )
          }
          onDraftState={handleDraftState}
          // Your own MRs only, both directions. buildBoard already hides other
          // people's drafts, but their ready MRs are on the board, so this gate
          // is what keeps "mark as draft" off them.
          canDraftState={rowMenu.mr.author.username === data.defaultMember}
          onMrAction={handleMrAction}
          onRebaseLocal={handleRebaseLocal}
          onNudge={handleNudge}
          // Your own MRs only: a nudge asks a peer to re-review YOUR work, and
          // the server enforces the same gate (403 "not your MR").
          canNudge={rowMenu.mr.author.username === data.defaultMember}
          onResumeReview={handleResumeReview}
        />
      )}

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
          onSkip={queue.skip}
          onFocusPane={handleFocusPane}
          onAnswered={() => queue.noteAnswered(activeGateId)}
          onContinue={() => queue.noteAnswered(activeGateId)}
          onLostChange={lost => queue.hold(lost ? activeGateId : null)}
        />
      )}
      {queue.open && queue.complete && (
        <DecisionQueueComplete
          answered={queue.answeredCount}
          skipped={queue.skippedCount}
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

      <ToastHost toasts={toasts} />
    </div>
  );
}
