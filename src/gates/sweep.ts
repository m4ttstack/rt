import type { GateRow } from "@mattstack/rt-client";
import type { ReviewState } from "../review-state.ts";

export interface SweepAction {
  kind: "park" | "close-missed-done";
  mrUrl: string;
  tabId?: string;
  gateId?: string;
}

const MR_SUBJECT_PREFIX = "mr:";

/**
 * Computes what the periodic sweep should do, given a snapshot of the
 * facility's gate rows (GateCache.rows()) and the board's own review state.
 * Pure: no I/O, no clock reads -- `now` and `graceMs` are both passed in so
 * this is deterministic and unit-testable. The server (src/server.ts) is
 * the only caller that executes the returned actions.
 *
 * - `park`: an `open` row whose grace window has elapsed. `answered`,
 *   `parked` and `closed` rows are exempt so a row never re-parks once it
 *   has moved past `open`. The row carries no tabId (that's launch
 *   plumbing the facility doesn't track) -- it's joined from the matching
 *   review state, same join B6's resume path uses.
 * - `close-missed-done`: a `done` review that still carries a `tabId` with
 *   no `open` row standing over the same MR -- the server missed the
 *   `/review/outcome` call that would normally have closed that tab (a
 *   parked, answered or closed row, or no row at all, all count as "not
 *   open"). Executing the action clears `tabId` from the review state, so
 *   the same review never re-fires this action.
 */
export function planSweep(
  rows: GateRow[],
  reviews: Map<string, ReviewState>,
  now: number,
  graceMs: number,
): SweepAction[] {
  const actions: SweepAction[] = [];
  const openMrUrls = new Set<string>();

  for (const row of rows) {
    if (!row.subject.startsWith(MR_SUBJECT_PREFIX)) continue;
    const mrUrl = row.subject.slice(MR_SUBJECT_PREFIX.length);
    if (row.status === "open") {
      openMrUrls.add(mrUrl);
      if (now - row.openedAt >= graceMs) {
        actions.push({ kind: "park", mrUrl, tabId: reviews.get(mrUrl)?.tabId, gateId: row.id });
      }
    }
  }

  for (const review of reviews.values()) {
    if (review.status !== "done" || !review.tabId) continue;
    if (openMrUrls.has(review.mrUrl)) continue;
    actions.push({ kind: "close-missed-done", mrUrl: review.mrUrl, tabId: review.tabId });
  }

  return actions;
}

export interface PruneOffBoardGatesIo {
  gateClose(payload: { id: string; reason: "abandoned" | "superseded" | "pruned" }): Promise<unknown>;
  logError(message: string): void;
}

/** Closes every off-board `mr:` row still `open`/`parked` via the facility.
    Best-effort: a rejecting gateClose (row already left open/parked by the
    time this call lands -- another sweep or the wrapper beat it) is logged
    and skipped, never thrown, so one bad row can't stop the rest of the
    sweep. `answered`/`closed` rows are skipped outright -- their lifecycle
    is already over and the daemon would reject the close anyway. */
export async function pruneOffBoardGates(
  rows: GateRow[],
  onBoard: Set<string>,
  io: PruneOffBoardGatesIo,
): Promise<void> {
  for (const row of rows) {
    if (!row.subject.startsWith(MR_SUBJECT_PREFIX)) continue;
    if (row.status !== "open" && row.status !== "parked") continue;
    const mrUrl = row.subject.slice(MR_SUBJECT_PREFIX.length);
    if (onBoard.has(mrUrl)) continue;
    try {
      await io.gateClose({ id: row.id, reason: "pruned" });
    } catch (err) {
      io.logError(`gate prune: gateClose(${row.id}) failed for ${mrUrl}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
