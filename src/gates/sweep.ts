import type { GateRow } from "@mattstack/rt-client";
import type { ReviewState } from "../review-state.ts";
import type { RespondState } from "../respond-state.ts";
import type { DoctorState } from "../doctor-state.ts";

/** Which board lifecycle a gate kind's answered-state and tab belong to. */
export type GateDomain = "review" | "respond" | "doctor";

export interface SweepAction {
  kind: "park" | "close-missed-done";
  domain: GateDomain;
  mrUrl: string;
  tabId?: string;
  gateId?: string;
}

/** The three lifecycle maps a sweep pass joins gate rows against, one per
    domain. Keyed by mrUrl, same as `read*States()`. */
export interface GateSweepStates {
  reviews: Map<string, ReviewState>;
  responds: Map<string, RespondState>;
  doctors: Map<string, DoctorState>;
}

const MR_SUBJECT_PREFIX = "mr:";

/** A kind outside this map (present or future) is skipped by the sweep
    entirely -- silently, since an unrecognized kind has no lifecycle map to
    join against and must never crash the sweep for every other row. */
function domainForKind(kind: string): GateDomain | undefined {
  if (kind === "review-post") return "review";
  if (kind === "respond-plan" || kind === "respond-post") return "respond";
  if (kind === "doctor-escalation") return "doctor";
  return undefined;
}

function tabIdFor(domain: GateDomain, mrUrl: string, states: GateSweepStates): string | undefined {
  if (domain === "review") return states.reviews.get(mrUrl)?.tabId;
  if (domain === "respond") return states.responds.get(mrUrl)?.tabId;
  return states.doctors.get(mrUrl)?.tabId;
}

/**
 * Computes what the periodic sweep should do, given a snapshot of the
 * facility's gate rows (GateCache.rows()) and the board's own review/
 * respond/doctor state. Pure: no I/O, no clock reads -- `now` and `graceMs`
 * are both passed in so this is deterministic and unit-testable. The server
 * (src/server.ts) is the only caller that executes the returned actions.
 *
 * - `park`: an `open` row whose grace window has elapsed. `answered`,
 *   `parked` and `closed` rows are exempt so a row never re-parks once it
 *   has moved past `open`. The row carries no tabId (that's launch
 *   plumbing the facility doesn't track) -- it's joined from the matching
 *   state of the row's OWN domain (a doctor row joins the doctor state map,
 *   never the review one), the same join the resume path uses.
 * - `close-missed-done`: a `done` state in some domain that still carries a
 *   `tabId` with no `open` row standing over the same MR IN THAT DOMAIN --
 *   the server missed the outcome call that would normally have closed that
 *   tab (a parked, answered or closed row, or no row at all, all count as
 *   "not open"). A live gate in a DIFFERENT domain never blocks this -- a
 *   done review's missed close fires even while a respond gate is open on
 *   the same MR. Executing the action clears `tabId` from that domain's
 *   state, so the same MR never re-fires this action for that domain.
 */
export function planSweep(
  rows: GateRow[],
  states: GateSweepStates,
  now: number,
  graceMs: number,
): SweepAction[] {
  const actions: SweepAction[] = [];
  const openByDomain: Record<GateDomain, Set<string>> = {
    review: new Set(),
    respond: new Set(),
    doctor: new Set(),
  };

  for (const row of rows) {
    if (!row.subject.startsWith(MR_SUBJECT_PREFIX)) continue;
    const domain = domainForKind(row.kind);
    if (!domain) continue;
    const mrUrl = row.subject.slice(MR_SUBJECT_PREFIX.length);
    if (row.status !== "open") continue;
    openByDomain[domain].add(mrUrl);
    if (now - row.openedAt >= graceMs) {
      actions.push({ kind: "park", domain, mrUrl, tabId: tabIdFor(domain, mrUrl, states), gateId: row.id });
    }
  }

  for (const [mrUrl, review] of states.reviews) {
    if (review.status !== "done" || !review.tabId) continue;
    if (openByDomain.review.has(mrUrl)) continue;
    actions.push({ kind: "close-missed-done", domain: "review", mrUrl, tabId: review.tabId });
  }
  for (const [mrUrl, respond] of states.responds) {
    if (respond.status !== "done" || !respond.tabId) continue;
    if (openByDomain.respond.has(mrUrl)) continue;
    actions.push({ kind: "close-missed-done", domain: "respond", mrUrl, tabId: respond.tabId });
  }
  for (const [mrUrl, doctor] of states.doctors) {
    if (doctor.status !== "done" || !doctor.tabId) continue;
    if (openByDomain.doctor.has(mrUrl)) continue;
    actions.push({ kind: "close-missed-done", domain: "doctor", mrUrl, tabId: doctor.tabId });
  }

  return actions;
}

export interface PruneOffBoardGatesIo {
  gateClose(payload: { id: string; reason: "abandoned" | "superseded" | "pruned" }): Promise<unknown>;
  logError(message: string): void;
}

/** Closes every off-board `mr:` row still `open`/`parked` via the facility,
    across every kind. Best-effort: a rejecting gateClose (row already left
    open/parked by the time this call lands -- another sweep or the wrapper
    beat it) is logged and skipped, never thrown, so one bad row can't stop
    the rest of the sweep. `answered`/`closed` rows are skipped outright --
    their lifecycle is already over and the daemon would reject the close
    anyway. */
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
