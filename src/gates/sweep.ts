import type { GateState } from "./store.ts";
import type { ReviewState } from "../review-state.ts";

export interface SweepAction {
  kind: "park" | "close-missed-done";
  mrUrl: string;
  tabId?: string;
  gateId?: string;
}

/**
 * Computes what the periodic sweep should do, given the current gate/review
 * state on disk. Pure: no I/O, no clock reads -- `now` and `graceMs` are
 * both passed in so this is deterministic and unit-testable. The server
 * (src/server.ts) is the only caller that executes the returned actions.
 *
 * - `park`: an `open` gate whose grace window has elapsed. `answered` and
 *   `parked` gates are exempt so a gate never re-parks once it has moved
 *   past `open`.
 * - `close-missed-done`: a `done` review that still carries a `tabId` with
 *   no `open` gate standing over the same MR -- the server missed the
 *   `/review/outcome` call that would normally have closed that tab (a
 *   parked or answered gate, or no gate at all, all count as "not open").
 *   Executing the action clears `tabId` from the review state, so the same
 *   review never re-fires this action.
 */
export function planSweep(
  gates: Map<string, GateState>,
  reviews: Map<string, ReviewState>,
  now: number,
  graceMs: number,
): SweepAction[] {
  const actions: SweepAction[] = [];

  for (const gate of gates.values()) {
    if (gate.status === "open" && now - gate.openedAt >= graceMs) {
      actions.push({ kind: "park", mrUrl: gate.mrUrl, tabId: gate.tabId, gateId: gate.gateId });
    }
  }

  for (const review of reviews.values()) {
    if (review.status !== "done" || !review.tabId) continue;
    const gate = gates.get(review.mrUrl);
    if (gate?.status === "open") continue;
    actions.push({ kind: "close-missed-done", mrUrl: review.mrUrl, tabId: review.tabId });
  }

  return actions;
}
