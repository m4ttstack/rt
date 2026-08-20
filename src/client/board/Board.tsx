import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardMR } from "../../data.ts";
import { filterByMember, sortMRs, groupMRs, parseViewState, serializeViewState, dataAgeLabel } from "../../view.ts";
import type { ViewState } from "../../view.ts";
import { selectionOf, postableOf } from "../../selection.ts";
import type {
  DraftInfo,
  BoardMRWithReview,
  BoardData,
  ThemeMode,
  ViewMode,
  RowMenuState,
  RowContext,
} from "../types.ts";
import { getSlackMarks, mrLine, boardSummary, draftKey } from "./format.ts";
import { overlay } from "./optimistic.ts";
import { useOptimisticLifecycle, useToasts, useBoardData, useLaunchAction } from "./hooks.ts";
import { postAction } from "../api.ts";
import { ICONS, Panel, SideDrawer, ToastHost } from "@mattstack/tui-kit";
import { Sidebar } from "./Sidebar.tsx";
import { Controls } from "./Controls.tsx";
import { SelectionBar } from "./SelectionBar.tsx";
import { RowView } from "./RowView.tsx";
import { GridView } from "./GridView.tsx";
import { SettingsModal } from "./SettingsModal.tsx";
import { RowMenu } from "./RowMenu.tsx";
import { ReviewModal } from "./ReviewModal.tsx";
import { DraftModal } from "./DraftModal.tsx";

declare global {
  interface Window {
    __applyTheme: () => void;
  }
}

// ── toggles ────────────────────────────────────────────────────────────────

const THEME_KEY = "mrs-theme";
const VIEW_KEY = "mrs-view";
const STATE_KEY = "mrs-view-state";

// ── board ──────────────────────────────────────────────────────────────────

export function Board() {
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) ?? "rows");
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem(THEME_KEY) as ThemeMode) ?? "system");

  // View state (member/group/sort). Members are validated once data arrives.
  const [state, setState] = useState<ViewState>(() => {
    let stored: Partial<ViewState> | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    } catch {
      stored = null;
    }
    return parseViewState(location.search, stored, []);
  });
  const validatedOnce = useRef(false);

  const pickView = (v: ViewMode) => {
    localStorage.setItem(VIEW_KEY, v);
    setView(v);
  };
  const pickTheme = (m: ThemeMode) => {
    localStorage.setItem(THEME_KEY, m);
    window.__applyTheme();
    setTheme(m);
  };
  const update = (patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
      history.replaceState(null, "", serializeViewState(next) || location.pathname);
      return next;
    });
  };

  // Re-resolve the view state's member against the roster the instant real
  // data arrives: on the first load, that's URL/localStorage/defaultMember
  // resolved against the now-known roster; on every later load, just drop a
  // member who's no longer on the (visible) roster. Passed into useBoardData
  // (rather than a separate effect keyed on `data`) so it runs in the same
  // batch as setData -- see that hook's doc comment. Deliberately empty deps:
  // it only closes over the (stable) validatedOnce ref and setState.
  const onData = useCallback((d: BoardData) => {
    const usernames = d.members.map((m) => m.username);
    if (!validatedOnce.current) {
      validatedOnce.current = true;
      let stored: Partial<ViewState> | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
      } catch {
        stored = null;
      }
      setState(parseViewState(location.search, stored, usernames, d.defaultMember));
    } else {
      setState((prev) => (prev.member === "all" || usernames.includes(prev.member) ? prev : { ...prev, member: "all" }));
    }
  }, []);

  // Data fetching (initial load, 60s poll, visibilitychange, SSE, the scoped
  // 15s member poll, and refreshNow) all live in useBoardData now. See that
  // hook's doc comment for why the fast-poll-while-active interval stays here
  // instead -- it needs `data` (this hook's own output) to compute the
  // predicate it would need to take as an argument.
  const { data, loadError, load, refreshNow, refreshing, setData } = useBoardData(state.member, onData);

  // Selection for the multi-copy bar, keyed by webUrl so it survives the
  // refresh poll and every member/group/sort change. Deliberately not
  // persisted: a reload should not hand you yesterday's selection.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelect = useCallback((webUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(webUrl)) next.add(webUrl);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Row action menu (right-click) and transient toasts.
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  // The MR whose saved review is open in the modal, if any.
  const [reviewModal, setReviewModal] = useState<BoardMRWithReview | null>(null);
  // The held draft open in its drawer, if any, and the drafts already acted on
  // this session (optimistic — the next /data.json pull drops resolved drafts).
  const [draftModal, setDraftModal] = useState<{ mr: BoardMRWithReview; draft: DraftInfo } | null>(null);
  const [draftResolved, setDraftResolved] = useState<ReadonlyMap<string, "posted" | "dismissed">>(new Map());
  const openDraft = useCallback((mr: BoardMRWithReview, draft: DraftInfo) => setDraftModal({ mr, draft }), []);
  const { toasts, addToast } = useToasts();

  // A drawer action succeeded: swap the chip to its resolved state, close the
  // drawer, and confirm with a toast (the board's transient-confirmation form).
  const handleDraftResolved = useCallback(
    (outcome: "posted" | "dismissed") => {
      if (!draftModal) return;
      const { mr, draft } = draftModal;
      setDraftResolved((prev) => new Map(prev).set(draftKey(mr.webUrl ?? "", draft.kind), outcome));
      setDraftModal(null);
      addToast(outcome === "posted" ? `held note posted to !${mr.iid}` : `held note dismissed on !${mr.iid}`);
    },
    [draftModal, addToast],
  );

  const applyHidden = useCallback((username: string, hidden: boolean) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            // Predict what the reload will send, so nothing flickers when it lands:
            // a checked-out member's MRs aren't fetched, so they have no count.
            allMembers: prev.allMembers.map((m) =>
              m.username === username ? { ...m, hidden, count: hidden ? null : m.count } : m,
            ),
          }
        : prev,
    );
  }, []);

  // Check a member in/out. The box flips locally first and never waits on the
  // network: the POST is quick, but the reload behind it refetches the team from
  // GitLab (~25s, since a checked-in member's MRs aren't in the snapshot). The
  // board catches up when that lands; a failed POST flips the box back.
  const toggleMember = useCallback(
    (username: string, hidden: boolean) => {
      applyHidden(username, hidden);
      postAction("/settings", { username, hidden }).then((result) => {
        if (!result.ok) {
          applyHidden(username, !hidden);
          addToast(`could not check ${username} ${hidden ? "out" : "in"}`);
          return;
        }
        load();
      });
    },
    [applyHidden, load, addToast],
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
    axis: "review", path: "/review", verbing: "launching review", noun: "review",
    optimistic: optimisticLifecycle, addToast, reload: load,
  });
  const handleLaunch = useCallback((mr: BoardMR, note?: string) => launchReview(mr, {}, note), [launchReview]);

  const reReviewAction = useLaunchAction({
    axis: "review", path: "/review", verbing: "re-reviewing", noun: "review",
    optimistic: optimisticLifecycle, addToast, reload: load,
  });
  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) => reReviewAction(mr, { reReview: true }, note),
    [reReviewAction],
  );

  const respondAction = useLaunchAction({
    axis: "respond", path: "/respond", verbing: "launching response", noun: "response",
    optimistic: optimisticLifecycle, addToast, reload: load,
  });
  const handleRespond = useCallback((mr: BoardMR, note?: string) => respondAction(mr, {}, note), [respondAction]);

  const doctorAction = useLaunchAction({
    axis: "doctor", path: "/doctor", verbing: "calling doctor", noun: "doctor",
    optimistic: optimisticLifecycle, addToast, reload: load,
  });
  const handleDoctor = useCallback((mr: BoardMR, note?: string) => doctorAction(mr, {}, note), [doctorAction]);

  // Resume actions: axis null means useLaunchAction's setQueued/rollback are
  // no-ops, matching today's handleResume (which never claimed a badge before
  // the reload settled). Bespoke failureMessage restores handleResume's own
  // failure wording, including the server's response text when it sends one
  // (e.g. "no session id on file") -- the shared default failure toast has no
  // way to carry that detail.
  const resumeReviewAction = useLaunchAction({
    axis: null, path: "/review", verbing: "resuming review", noun: "review",
    optimistic: optimisticLifecycle, addToast, reload: load,
    failureMessage: (result, mr) => `resume review failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ""}`,
  });
  const handleResumeReview = useCallback(
    (mr: BoardMR, note?: string) => resumeReviewAction(mr, { resume: true }, note),
    [resumeReviewAction],
  );

  const resumeRespondAction = useLaunchAction({
    axis: null, path: "/respond", verbing: "resuming respond", noun: "respond",
    optimistic: optimisticLifecycle, addToast, reload: load,
    failureMessage: (result, mr) => `resume respond failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ""}`,
  });
  const handleResumeRespond = useCallback(
    (mr: BoardMR, note?: string) => resumeRespondAction(mr, { resume: true }, note),
    [resumeRespondAction],
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
      postAction("/nudge", { mrUrl: mr.webUrl, iid: mr.iid, reviewer }).then((result) => {
        if (!result.ok) {
          // A permanent refusal (409) answers in plain text with the reason
          // the relay gave -- e.g. the reviewer has no board on the
          // switchboard. That's the whole point of the failure, so show it.
          const why = result.text.trim();
          addToast(why || `couldn't request re-review for !${mr.iid} (${result.status})`);
          return;
        }
        if (result.body?.queued) addToast(`switchboard unreachable... queued the ask to ${reviewer}`);
        load();
      });
    },
    [addToast, load],
  );

  // Flip one of your own MRs between draft and ready. No optimistic state: the
  // flip lives in GitLab, so the row waits for the reload rather than claiming a
  // change the API might have refused.
  const handleDraftState = useCallback(
    (mr: BoardMR, draft: boolean) => {
      if (!mr.webUrl) return;
      const verb = draft ? "draft" : "ready";
      addToast(`marking !${mr.iid} ${verb}…`);
      postAction("/draft", { mrUrl: mr.webUrl, iid: mr.iid, draft }).then((result) => {
        if (!result.ok) {
          addToast(`couldn't mark !${mr.iid} ${verb} (${result.status})`);
          return;
        }
        addToast(draft ? `!${mr.iid} is back to draft` : `!${mr.iid} is ready for review`);
        void load(true);
      });
    },
    [addToast, load],
  );

  const handleCopy = useCallback(
    (mr: BoardMR) => {
      const text = data ? mrLine(mr, data.slackTemplates) : mr.webUrl ?? mr.title;
      navigator.clipboard?.writeText(text).then(
        () => addToast(`copied !${mr.iid} for slack`),
        () => {},
      );
    },
    [addToast, data],
  );

  const [postingSummary, setPostingSummary] = useState(false);

  const handlePostSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`posting !${mr.iid} to slack…`);
      postAction("/slack/post", { mrUrls: [mr.webUrl] }).then((result) => {
        if (!result.ok) return addToast(`slack post failed for !${mr.iid} (${result.status})`);
        addToast(result.body?.linked ? `!${mr.iid} already in slack — linked` : `posted !${mr.iid} to slack`);
        load();
      });
    },
    [addToast, load],
  );

  /** `onPosted` runs only when the message actually landed -- the selection bar
      uses it to clear the selection, and a failed post must leave the selection
      intact so the user can retry. */
  const handlePostSummary = useCallback(
    (mrs: BoardMR[], header?: string, onPosted?: () => void) => {
      const urls = mrs.map((m) => m.webUrl).filter((u): u is string => !!u);
      if (!urls.length) return;
      setPostingSummary(true);
      addToast(`posting ${urls.length} MR${urls.length === 1 ? "" : "s"} to slack…`);
      postAction("/slack/post", header ? { mrUrls: urls, header } : { mrUrls: urls })
        .then((result) => {
          const body: unknown = result.body;
          if (!result.ok) return addToast(`slack post failed (${result.status})${typeof body === "string" ? `: ${body}` : ""}`);
          addToast(`posted ${urls.length} MR${urls.length === 1 ? "" : "s"} to slack`);
          onPosted?.();
          load();
        })
        .finally(() => setPostingSummary(false));
    },
    [addToast, load],
  );

  const handleResolveSlack = useCallback(
    (mr: BoardMR) => {
      if (!mr.webUrl) return;
      addToast(`finding slack thread for !${mr.iid}…`);
      postAction("/slack/resolve", { mrUrl: mr.webUrl, iid: mr.iid }).then((result) => {
        if (!result.ok) return addToast(`slack lookup failed for !${mr.iid} (${result.status})`);
        addToast(
          result.body?.status === "found" ? `found slack thread for !${mr.iid}` : `no slack thread found for !${mr.iid}`,
        );
        load();
      });
    },
    [addToast, load],
  );

  const handleReactSlack = useCallback(
    (mr: BoardMR, emoji: string, remove: boolean): Promise<string[] | null> => {
      if (!mr.webUrl) return Promise.resolve(null);
      const glyph = getSlackMarks().find((m) => m.emoji === emoji)?.glyph ?? emoji;
      const verb = remove ? "unmark" : "add";
      return postAction("/slack/react", { mrUrl: mr.webUrl, emoji, remove }).then((result) => {
        if (!result.ok) {
          addToast(`couldn't ${verb} ${glyph} for !${mr.iid} (${result.status})`);
          return null;
        }
        addToast(`${remove ? "unmarked" : "marked"} ${glyph} on !${mr.iid}`);
        load();
        return result.body?.reactions ?? null;
      });
    },
    [addToast, load],
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

  if (!data) {
    return <p className="tui-loading">{loadError ? "✗ failed to load board data" : "fetching…"}</p>;
  }

  const total = data.members.reduce((n, m) => n + m.count, 0);
  const staleMins = Math.round((Date.now() - data.fetchedAt) / 60_000);
  const now = Date.now();
  const dataAge = dataAgeLabel(data.dataSyncedAt, now);
  // Both known and the board asks for more history than rt actually syncs --
  // config drift the board can't self-correct, so it needs to be visible.
  const windowMismatch =
    data.scopeWindowDays !== null && data.staleAfterDays > data.scopeWindowDays
      ? `board shows ${data.staleAfterDays} days but rt syncs ${data.scopeWindowDays} days... align configs`
      : null;

  // Server state wins; otherwise show an optimistic "queued" badge if pending.
  const mrs = overlay(data.mrs, optimisticLifecycle.state);
  const filtered = filterByMember(mrs, state.member);
  const groups = groupMRs(filtered, state.group, data.members.map((m) => m.username), now).map((g) => ({
    label: g.label,
    mrs: sortMRs(g.mrs, state.sort),
  }));
  const activeMember = state.member === "all" ? null : data.members.find((m) => m.username === state.member) ?? null;
  // Show each row's author only when the view mixes authors: the All view
  // grouped by anything but author (where the group header isn't the name).
  const showAuthor = state.member === "all" && state.group !== "author";
  // Under author grouping the header IS the name, so rows normally drop the
  // author tag -- but a stack pulled to its root's group can carry a
  // co-author's MR under someone else's header. Tag the rows whenever a group
  // turns out to hold more than one author, so nothing is misattributed.
  const showAuthorIn = (g: { mrs: BoardMR[] }) =>
    showAuthor || (state.member === "all" && new Set(g.mrs.map((m) => m.author.username)).size > 1);
  const flatMrs = groups.flatMap((g) => g.mrs);
  // Drawn from `mrs`, not `filtered` -- that's what lets a selection span
  // member filters.
  const selectedMrs = selectionOf(mrs, selected);
  const summaryText = boardSummary(flatMrs, data.slackTemplates);
  const postableMrs = postableOf(flatMrs as BoardMRWithReview[]);
  const postableSelected = postableOf(selectedMrs as BoardMRWithReview[]);
  // One context object threaded through RowView, GridView, and RowMenu — the
  // board-owned bits every row/menu needs that aren't specific to one MR.
  const rowCtx: RowContext = {
    local: data.local,
    slackTemplates: data.slackTemplates,
    slackEnabled: data.slackEnabled,
    onContext: openRowMenu,
    onOpenReview: setReviewModal,
    onOpenDraft: openDraft,
    draftResolved,
    onResumeRespond: handleResumeRespond,
    selected,
    onToggleSelect: toggleSelect,
  };
  const openSettings = () => {
    setMenuOpen(false);
    setShowSettings(true);
  };
  const controlProps = {
    state,
    update,
    view,
    pickView,
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
  };

  return (
    <div className={view === "grid" ? "tui tui-wide tui-app" : "tui tui-app"}>
      {/* Desktop roster (hidden on mobile, where it moves into the drawer). */}
      <Sidebar
        members={data.members}
        total={total}
        active={state.member}
        onPick={(member) => update({ member })}
        onSettings={openSettings}
        scopeUncovered={data.scopeUncovered}
      />

      <div className="tui-main">
        <header className="tui-header">
          {/* Mobile-only: burger opens the drawer with roster + controls. */}
          <button className="tui-burger" onClick={() => setMenuOpen(true)} aria-label="open menu">
            {ICONS.menu}
          </button>
          <div className="tui-header-title">
            <h1>
              <span className="tui-prompt">❯</span> {data.title.toLowerCase()}{" "}
              {activeMember && <span className="tui-author">--author @{activeMember.username}</span>}
            </h1>
            <p className="tui-sub">
              <span className="tui-comment"># {filtered.length} awaiting review · pick one, it opens in gitlab</span>
            </p>
          </div>
          <div className="tui-controls tui-controls-header">
            <Controls {...controlProps} />
          </div>
        </header>

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
                    send: (header) => handlePostSummary(postableSelected, header, clearSelection),
                  }
                : null
            }
          />
        )}

        {data.fetchError && <div className="tui-banner">⚠ data from {staleMins}m ago — gitlab fetch failing</div>}
        {windowMismatch && <div className="tui-banner">⚠ {windowMismatch}</div>}

        {filtered.length === 0 && !data.fetchError ? (
          <p className="tui-empty">nothing waiting on review ✓</p>
        ) : (
          groups.map((g) => (
            <Panel
              key={g.label}
              title={g.label}
              count={g.mrs.length}
              // Pins the LEGACY persistence key: the recipe defaults to its own
              // "tui-panel-collapsed", and switching would orphan every panel a
              // user has already folded up.
              storageKey="mrs-panel-collapsed"
            >
              {view === "rows" ? (
                <RowView mrs={g.mrs} now={now} showAuthor={showAuthorIn(g)} ctx={rowCtx} />
              ) : (
                <GridView mrs={g.mrs} now={now} showAuthor={showAuthorIn(g)} ctx={rowCtx} />
              )}
            </Panel>
          ))
        )}

        <footer className={dataAge.stale ? "tui-footer tui-footer-stale" : "tui-footer"}>{dataAge.text}</footer>
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
            <button className="tui-modal-x" onClick={() => setMenuOpen(false)} aria-label="close menu">
              {ICONS.close}
            </button>
          </div>
          <Sidebar
            members={data.members}
            total={total}
            active={state.member}
            onPick={(member) => {
              update({ member });
              setMenuOpen(false);
            }}
            onSettings={openSettings}
            scopeUncovered={data.scopeUncovered}
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
          canDoctor={!!(rowMenu.mr.blockers?.pipelineFailing || rowMenu.mr.blockers?.hasConflicts)}
          onDraftState={handleDraftState}
          // Your own MRs only, both directions. buildBoard already hides other
          // people's drafts, but their ready MRs are on the board, so this gate
          // is what keeps "mark as draft" off them.
          canDraftState={rowMenu.mr.author.username === data.defaultMember}
          onNudge={handleNudge}
          // Your own MRs only: a nudge asks a peer to re-review YOUR work, and
          // the server enforces the same gate (403 "not your MR").
          canNudge={rowMenu.mr.author.username === data.defaultMember}
          onResumeReview={handleResumeReview}
        />
      )}

      {reviewModal && <ReviewModal mr={reviewModal} onClose={() => setReviewModal(null)} />}

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
