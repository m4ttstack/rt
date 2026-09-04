import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { client, readOrThrow, selectionQuery, type RangeSelection, type RefreshResult } from "../api";
import type { LeaderboardResponse } from "../../shared/types";

const POLL_MS = 750;

export interface RefreshJobHandlers {
  /** A job finished with a result. `startedFor` is the selection it was started for, so the caller can drop a stale result. */
  onDone: (result: LeaderboardResponse, startedFor: RangeSelection) => void;
  onError: (message: string) => void;
}

/**
 * Reimplements the App.tsx job lifecycle (start -> poll /api/refresh/:id -> terminal -> cancel)
 * on react-query. `jobId` is the only state this hook owns: the poll query below both drives
 * the progress bar (its `data.progress`) and, once a poll response leaves "running", hands the
 * terminal result to the caller and clears `jobId` to stop polling.
 */
export function useRefreshJob(handlers: RefreshJobHandlers) {
  const [jobId, setJobId] = useState<string | null>(null);
  // Read from effects/callbacks below without forcing them to depend on a fresh `handlers` identity every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const startedForRef = useRef<RangeSelection | null>(null);
  // Seeds the poll query so its first GET waits POLL_MS (matching the old setTimeout(tick, POLL_MS)) instead of firing immediately.
  const startResultRef = useRef<RefreshResult | null>(null);
  // Closes the gap `jobId !== null` alone can't cover: between a start() call kicking off the
  // POST and that POST resolving into a jobId, `jobId` is still null. A second start() in that
  // window (e.g. a window-refocus refetch re-firing the cold-cache effect while the first POST
  // is still in flight) would overwrite jobId and orphan the first job. Set synchronously before
  // the first await, so a re-entrant call always sees it.
  const startInFlightRef = useRef(false);

  const startMutation = useMutation({
    mutationFn: async (selection: RangeSelection) => {
      const res = await client.api.refresh.$post({ query: selectionQuery(selection) });
      return readOrThrow<RefreshResult>(res, "start refresh");
    },
  });

  const pollQuery = useQuery({
    queryKey: ["refresh", jobId],
    queryFn: async () => {
      const res = await client.api.refresh[":id"].$get({ param: { id: jobId as string } });
      return readOrThrow<RefreshResult>(res, "poll refresh");
    },
    enabled: jobId !== null,
    initialData: () => (jobId !== null ? (startResultRef.current ?? undefined) : undefined),
    staleTime: POLL_MS,
    refetchInterval: (query) => (query.state.data?.status === "running" ? POLL_MS : false),
    refetchIntervalInBackground: true,
    // One attempt per tick, like the old setTimeout(tick, POLL_MS) loop: a failed poll ends the
    // job immediately (below) rather than react-query silently retrying it a few times first.
    retry: false,
  });

  // Terminal states: hand the result to the caller (only if it still matches what's on screen,
  // decided by the caller via `startedFor`) and stop polling. A network/HTTP failure on the poll
  // itself leaves `pollQuery.data` on its last "running" snapshot, so `error` is watched too --
  // otherwise a failed poll would freeze the progress bar instead of surfacing anything.
  useEffect(() => {
    if (pollQuery.error) {
      handlersRef.current.onError((pollQuery.error as Error).message);
      startedForRef.current = null;
      setJobId(null);
      return;
    }
    const status = pollQuery.data;
    if (!status || status.status === "running") return;
    const startedFor = startedForRef.current;
    if (status.status === "done" && status.result && startedFor) {
      handlersRef.current.onDone(status.result, startedFor);
    } else if (status.status === "error") {
      handlersRef.current.onError(status.error ?? "Refresh failed");
    }
    startedForRef.current = null;
    setJobId(null);
  }, [pollQuery.data, pollQuery.error]);

  const start = useCallback(
    async (selection: RangeSelection) => {
      if (jobId !== null || startInFlightRef.current) return;
      startInFlightRef.current = true;
      try {
        const status = await startMutation.mutateAsync(selection);
        startedForRef.current = selection;
        startResultRef.current = status;
        setJobId(status.jobId);
      } catch (e) {
        handlersRef.current.onError((e as Error).message);
      } finally {
        startInFlightRef.current = false;
      }
    },
    [jobId, startMutation],
  );

  const cancel = useCallback(() => {
    if (!jobId) return;
    // Best-effort: a failed cancel shouldn't surface to the user or float an unhandled rejection.
    void client.api.refresh[":id"].cancel.$post({ param: { id: jobId } }).catch((e) => {
      console.warn("cancelRefresh failed", e);
    });
    startedForRef.current = null;
    startResultRef.current = null;
    // Clear local state immediately so the bar disappears without waiting for the next poll;
    // the poll query for the old jobId is orphaned (no longer subscribed to), so a trailing response is inert.
    setJobId(null);
  }, [jobId]);

  return {
    jobId,
    refreshing: jobId !== null,
    progress: jobId !== null ? (pollQuery.data?.progress ?? null) : null,
    start,
    cancel,
  };
}
