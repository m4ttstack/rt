/// <reference lib="dom" />
import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_OPTIMISTIC, setQueued, rollback, clearServerTruth, anyActive, type Axis, type OptimisticState } from "./optimistic.ts";
import type { BoardData, BoardMRWithReview, Toast } from "../types.ts";
import type { BoardMR } from "../../data.ts";
import { getData, getMember, postAction, type ActionResult } from "../api.ts";
import { setSlackMarks } from "./format.ts";

/** Thin useState/useEffect wrapper over the pure optimistic-lifecycle
    functions: tracks the queued/error-rollback state for the review/respond/
    doctor axes, clears an axis's optimistic entry once the server reports a
    real status for it, and derives the fast-poll predicate. */
export function useOptimisticLifecycle(data: BoardData | null) {
  const [state, setState] = useState<OptimisticState>(EMPTY_OPTIMISTIC);

  // Drop optimistic entries once the server has real state for that axis.
  useEffect(() => {
    if (!data) return;
    setState((s) => clearServerTruth(s, data.mrs));
  }, [data]);

  const queue = useCallback((axis: Axis, url: string) => {
    setState((s) => setQueued(s, axis, url));
  }, []);

  const rollbackOne = useCallback((axis: Axis, url: string) => {
    setState((s) => rollback(s, axis, url));
  }, []);

  const active = anyActive(state, data?.mrs ?? []);

  return { state, setQueued: queue, rollback: rollbackOne, active };
}

/** Transient toast queue: each addToast() call appends one with a fresh id
    and self-removes it after 3.5s. Mechanical extraction of Board's former
    toasts/toastId/addToast block. */
export function useToasts(): { toasts: Toast[]; addToast: (text: string) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const addToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return { toasts, addToast };
}

/** Owns the board's data-fetching mechanics: the initial load plus 60s poll
    and visibilitychange re-poll, the SSE /events push, a scoped single-member
    poll every 15s (skipped for the "all" view), and refreshNow/refreshing for
    the manual refresh button. Mechanical move of Board's former load/
    fetchMember/mergeMember state and effects, now going through getData/
    getMember instead of an inline fetch.

    Judgment call: the fast-poll-while-active interval (poll every 4s while a
    review/respond/doctor run is in flight) stays as a plain useEffect in
    Board.tsx rather than moving in here. That predicate comes from
    useOptimisticLifecycle(data) -- and data is this hook's own output, so
    useBoardData would need its own return value as an input to compute the
    thing it needs as an argument to itself. Resolving that cleanly would mean
    either folding useOptimisticLifecycle's state into this hook (a redesign
    of Task 11's hook, out of scope here) or bridging the value through an
    extra ref+effect (adds a state most likely to introduce ordering bugs).
    Board.tsx keeping that one small effect, wired to this hook's `load`, is
    the same shape of exception the brief already grants the member-poll for
    the same underlying reason: a piece of state that only exists outside this
    hook. Behavior is unchanged from today either way.

    `onData`, if given, runs synchronously right after a successful load sets
    `data` -- Board.tsx uses it to re-resolve the view-state member against
    the fresh roster. That has to happen in the SAME callback as `setData`
    (not a separate `useEffect` keyed on `data`): React batches sibling
    setState calls made in one callback into one render, so both land
    together the instant data arrives -- splitting it into an effect would
    insert an extra render where the board briefly shows the stale ("all")
    member before snapping to the resolved one. Pass a referentially stable
    callback (empty deps) or every effect keyed on `load` below tears down
    and rebuilds on every render. */
export function useBoardData(
  member: string,
  onData?: (d: BoardData) => void,
): {
  data: BoardData | null;
  loadError: boolean;
  load: (fresh?: boolean) => Promise<void>;
  fetchMember: (username: string) => Promise<void>;
  refreshNow: () => void;
  refreshing: boolean;
  // Raw setter, for the one Board-owned optimistic mutation (checking a
  // member in/out) that isn't itself a data-fetch -- mirrors mergeMember's
  // shape but stays a caller concern since it's tied to the settings modal,
  // not board-data mechanics.
  setData: (updater: (prev: BoardData | null) => BoardData | null) => void;
} {
  const [data, setData] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(
    (fresh = false) =>
      getData(fresh)
        .then((d) => {
          if (d.slackEmoji) setSlackMarks(d.slackEmoji);
          setData(d);
          setLoadError(false);
          onData?.(d);
        })
        .catch(() => setLoadError(true)),
    [onData],
  );

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Server push: rt relay events land as SSE nudges; re-pull the board.
  // Polling stays as the fallback when the stream is down.
  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = () => {
      if (!document.hidden) load();
    };
    return () => es.close();
  }, [load]);

  // Merge a scoped (single-member) refresh into the current board: replace that
  // member's rows and update their roster count, leaving everyone else untouched.
  const mergeMember = useCallback((username: string, mrs: BoardMRWithReview[], fetchedAt: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const others = prev.mrs.filter((m) => m.author.username !== username);
      const members = prev.members.map((m) => (m.username === username ? { ...m, count: mrs.length } : m));
      return { ...prev, mrs: [...others, ...mrs], members, fetchedAt };
    });
  }, []);

  const fetchMember = useCallback(
    (username: string) => getMember(username).then((d) => mergeMember(username, d.mrs, d.fetchedAt)),
    [mergeMember],
  );

  // When viewing one person, poll just their MRs every 15s — 1 query instead of
  // the whole team, so a reviewer's comment shows up fast and cheap. The "All"
  // view keeps the slower full poll above.
  useEffect(() => {
    if (member === "all") return;
    const timer = setInterval(() => {
      if (!document.hidden) fetchMember(member).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [member, fetchMember]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = useCallback(() => {
    setRefreshing(true);
    const task = member === "all" ? load(true) : fetchMember(member);
    task.catch(() => {}).finally(() => setRefreshing(false));
  }, [member, load, fetchMember]);

  return { data, loadError, load, fetchMember, refreshNow, refreshing, setData };
}

/** Deps a launch flow needs from its caller: how to POST, how to reflect the
    optimistic queued/rollback state (no-ops for non-optimistic actions like
    resume), how to toast, and how to reload once the server answers. */
export interface LaunchFlowDeps {
  post: (payload: Record<string, unknown>) => Promise<ActionResult>;
  setQueued: () => void;
  rollback: () => void;
  addToast: (t: string) => void;
  reload: () => void;
  verbing: string;
  noun: string;
}

/** The pure shape common to every launch-a-pane action (characterized from
    today's handleLaunch): claim optimistic queued state, toast that it's
    starting, POST, and on the answer either roll back + toast the failure
    status, or toast a "focused an existing tab" note when the server says so
    and reload either way that reflects the server's real state. */
export async function runLaunchFlow(deps: LaunchFlowDeps, mr: BoardMR, extra: Record<string, unknown>): Promise<void> {
  if (!mr.webUrl) return;
  deps.setQueued();
  deps.addToast(`${deps.verbing} for !${mr.iid}…`);
  const result = await deps.post({ mrUrl: mr.webUrl, iid: mr.iid, ...extra });
  if (!result.ok) {
    deps.rollback();
    deps.addToast(`couldn't launch ${deps.noun} for !${mr.iid} (${result.status})`);
    return;
  }
  if (result.body?.focused) deps.addToast(`${deps.noun} already running for !${mr.iid} — focused its tab`);
  deps.reload();
}

/** Closes runLaunchFlow over one action's server path and optimistic axis.
    `axis: null` skips the optimistic queued/rollback entirely -- for resume
    actions, which today never claim a badge before the reload settles. */
export function useLaunchAction(opts: {
  axis: Axis | null;
  path: string;
  verbing: string;
  noun: string;
  optimistic: ReturnType<typeof useOptimisticLifecycle>;
  addToast: (t: string) => void;
  reload: () => void;
}): (mr: BoardMR, extra?: Record<string, unknown>, note?: string) => void {
  const { axis, path, verbing, noun, optimistic, addToast, reload } = opts;
  return useCallback(
    (mr: BoardMR, extra: Record<string, unknown> = {}, note?: string) => {
      const url = mr.webUrl;
      const deps: LaunchFlowDeps = {
        post: (payload) => postAction(path, payload),
        setQueued: axis && url ? () => optimistic.setQueued(axis, url) : () => {},
        rollback: axis && url ? () => optimistic.rollback(axis, url) : () => {},
        addToast,
        reload,
        verbing,
        noun,
      };
      void runLaunchFlow(deps, mr, { ...extra, note });
    },
    [axis, path, verbing, noun, optimistic, addToast, reload],
  );
}
