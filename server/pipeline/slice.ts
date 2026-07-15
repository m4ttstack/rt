import { eligibleForLinearDiscovery } from "../linear/fetch.js";
import type { FetchOutcome } from "./fetch.js";
import type { TimeWindow } from "../../shared/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const within = (iso: string, lo: number, hi: number): boolean => {
  const t = Date.parse(iso);
  return t >= lo && t <= hi;
};

/**
 * Narrow a wide outcome to what a native fetch of `window` would have returned.
 *
 * Each predicate mirrors one fetch site; that correspondence is the correctness
 * argument for slicing, so the mirrored line is named on each. Changing a fetch
 * predicate without changing its mirror here silently desyncs cache from network.
 */
export function sliceOutcome(outcome: FetchOutcome, window: TimeWindow): FetchOutcome {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);

  // Diverges from fetch.ts:153 (`updatedAt >= since`, no upper bound) on purpose: without
  // an upper bound a prior-window slice sees MRs updated during the current window, and
  // the unwindowed revert scan in snapshot.ts:163 then counts reverts from outside it.
  const mrs = outcome.result.mrs.filter((m) => within(m.updatedAt, start, end));

  // Mirrors fetch.ts:317 -- REST updated_after/updated_before.
  const pipelines = outcome.result.pipelines.filter((p) => within(p.createdAt, start, end));

  // Mirrors fetch.ts:371-372 -- bounds widened by a day on each side.
  const pushEvents = outcome.result.pushEvents.filter((e) =>
    within(e.createdAt, start - DAY_MS, end + DAY_MS),
  );

  // Mirrors fetch.ts:62 -- tickets are discovered from in-window MRs eligible for
  // discovery, which is the only thing that has ever scoped them to a window.
  const sourceKeys = new Set(
    mrs.filter(eligibleForLinearDiscovery).map((m) => `${m.projectPath}!${m.iid}`),
  );
  const linearIssues = (outcome.result.linearIssues ?? []).filter((i) =>
    i.linkedMrs.some((l) => sourceKeys.has(`${l.projectPath}!${l.iid}`)),
  );

  return {
    ...outcome,
    result: { ...outcome.result, mrs, pipelines, pushEvents, linearIssues },
  };
}
