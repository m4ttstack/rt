import type { GateState } from "./store.ts";
import type { SweepAction } from "./sweep.ts";
import type { ReviewState, ReviewStatus } from "../review-state.ts";

/** Executes one planned sweep action against injected io, so the park
    re-read guard below is unit-testable without touching the real gate
    store, herdr, or review state. server.ts wires the real implementations. */
export interface ExecuteSweepActionIo {
  closeTab(tabId: string): Promise<void>;
  readGateStates(): Map<string, GateState>;
  writeGateState(path: string, patch: Partial<GateState> & { gateId: string }): void;
  gateFilePath(mrUrl: string): string;
  writeReviewState(path: string, patch: Partial<ReviewState> & { status: ReviewStatus }): void;
  reviewFilePath(mrUrl: string): string;
  sseNudge(): void;
  now(): number;
  graceMinutes: number;
  log(message: string): void;
  logError(message: string): void;
}

async function closeTabBestEffort(action: SweepAction, io: ExecuteSweepActionIo): Promise<void> {
  if (!action.tabId) return;
  try {
    await io.closeTab(action.tabId);
  } catch (err) {
    io.logError(`gate sweep: closeTab(${action.tabId}) failed for ${action.mrUrl}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Executes one `planSweep` action. `park` actions re-read the gate's
 * current on-disk state immediately before acting and skip entirely
 * (no closeTab, no writeGateState) when it is no longer `"open"` -- the
 * plan was computed from a snapshot, and by the time this action runs an
 * answer may already have landed (the wrapper's `gate wait` returned and
 * it started posting), so acting on the stale snapshot would closeTab
 * mid-post and stomp the freshly-written `"answered"` status back to
 * `"parked"`. `close-missed-done` carries no such race (a done review's
 * tabId is only ever cleared by this same action) so it needs no guard.
 */
export async function executeSweepAction(action: SweepAction, io: ExecuteSweepActionIo): Promise<void> {
  if (action.kind === "park") {
    if (!action.gateId) return;
    const current = io.readGateStates().get(action.mrUrl);
    if (!current || current.status !== "open") return;

    await closeTabBestEffort(action, io);
    io.writeGateState(io.gateFilePath(action.mrUrl), { gateId: action.gateId, status: "parked", parkedAt: io.now() });
    io.sseNudge();
    io.log(`gate sweep: parked gate ${action.gateId} for ${action.mrUrl} after ${io.graceMinutes}m with no answer`);
    return;
  }

  await closeTabBestEffort(action, io);
  // "" (falsy) rather than omitting the field: writeReviewState merges
  // patch.tabId ?? prev.tabId, so leaving tabId out of the patch would
  // keep the stale id and this action would re-fire every sweep.
  io.writeReviewState(io.reviewFilePath(action.mrUrl), { status: "done", tabId: "" });
  io.log(`gate sweep: closed missed-done review tab for ${action.mrUrl}`);
}
