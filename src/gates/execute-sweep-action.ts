import type { Commands, RtResponse } from "@mattstack/rt-client";
import type { SweepAction } from "./sweep.ts";
import type { ReviewState, ReviewStatus } from "../review-state.ts";

export interface ExecuteSweepActionIo {
  gatePark(payload: Commands["gate:park"]["payload"]): Promise<RtResponse<Commands["gate:park"]["data"]>>;
  closeTab(tabId: string): Promise<void>;
  writeReviewState(path: string, patch: Partial<ReviewState> & { status: ReviewStatus }): void;
  reviewFilePath(mrUrl: string): string;
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
 * Executes one `planSweep` action. `park` calls the facility's `gatePark`
 * FIRST -- its CAS (`UPDATE ... WHERE status = 'open'`) is the TOCTOU guard
 * now: the plan was computed from a cache snapshot, and by the time this
 * action runs an answer may already have landed (the wrapper's `gate wait`
 * returned and it started posting). An `ok:false` response means exactly
 * that raced, so closeTab and the review write are both skipped -- acting
 * on the stale snapshot would closeTab mid-post. `close-missed-done`
 * carries no such race (a done review's tabId is only ever cleared by this
 * same action) so it needs no guard.
 */
export async function executeSweepAction(action: SweepAction, io: ExecuteSweepActionIo): Promise<void> {
  if (action.kind === "park") {
    if (!action.gateId) return;
    const result = await io.gatePark({ id: action.gateId });
    if (!result.ok) {
      io.log(`gate sweep: gate ${action.gateId} for ${action.mrUrl} no longer open (${result.error}); skipping park`);
      return;
    }

    await closeTabBestEffort(action, io);
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
