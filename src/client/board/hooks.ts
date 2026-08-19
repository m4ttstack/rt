import { useCallback, useEffect, useState } from "react";
import { EMPTY_OPTIMISTIC, setQueued, rollback, clearServerTruth, anyActive, type Axis, type OptimisticState } from "./optimistic.ts";
import type { BoardData } from "../types.ts";

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
