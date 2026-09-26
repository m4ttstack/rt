import { Database } from 'bun:sqlite';

import { draftBinPath } from './herdr.ts';
import {
  getStateDb,
  insertAgentState,
  mintHandle,
  pruneStates,
  readStates,
  updateByHandle,
} from './state/index.ts';

/**
 * Doctor lifecycle for MRs with mechanical breakage (CI failing, merge
 * conflicts). The board owns "queued"; the skill emits the middle states.
 * `fixing` and `watching` loop until the branch is green + clean.
 */
export type DoctorStatus =
  | 'queued'
  | 'diagnosing'
  | 'rebasing'
  | 'fixing'
  | 'watching'
  | 'done'
  | 'error';

export type DoctorOrigin = 'auto' | 'manual';

export interface DoctorState {
  mrUrl: string;
  iid: number;
  status: DoctorStatus;
  message?: string;
  tabId?: string;
  workspaceId?: string;
  /** Who queued this doctor: the policy engine or a human click. Drives the
      board's auto marker and the auto-only concurrency cap. */
  origin?: DoctorOrigin;
  /** rt agent record id from the launch result. */
  agentId?: string;
  /** rt herdr pane id the agent landed in, from the launch result. */
  paneId?: string;
  /** Repair tier this doctor launched with ("api" = no-checkout; absent =
      the historical checkout tier). A resumed pane must re-announce the
      same tier the original dispatch forbade a worktree checkout under --
      statusBin/draftBin are re-derivable, this and fixClasses are not. */
  tier?: string;
  /** Enabled fix classes this doctor launched with, composed once at
      dispatch time (author/identity-scoped) -- carried verbatim into a
      resumed pane's prompt rather than recomposed, since the original
      author/identity inputs aren't on this state file. */
  fixClasses?: string[];
  /** Facility gate id from the most recent `gate open`, so `gate wait` /
      `gate answer` can find it by state path alone. */
  gateId?: string;
  /** The kind `gateId` was opened with ("doctor-escalation") -- the
      wrapper's own re-entry reads this to know what a `--resumed-gate`
      id names. */
  gateKind?: string;
  /** Id of the gate the board has already resumed a parked-then-answered
      session for -- the exactly-once dedup marker (see gates/resume.ts). */
  resumedGateId?: string;
  /** Stamp of the last operator reopen of a finished pane, written with the
      SAME clock value the write's updatedAt gets. See ReviewState's own
      reopenedAt for the sweep-exemption contract, which this mirrors. */
  reopenedAt?: number;
  /** Stamp of the operator dismissing this lane's line from the row. While
      it is at least as new as `updatedAt` the row skips the lane entirely;
      any later write (a relaunch, the pane's own status CLI) outranks it and
      the lane speaks again. Never clears a thing: the run stays readable. */
  dismissedAt?: number;
  startedAt: number;
  updatedAt: number;
}

export function doctorFilePath(mrUrl: string): string {
  return mintHandle('doctor', mrUrl);
}

export function writeDoctorState(
  handle: string,
  patch: Partial<DoctorState> & { status: DoctorStatus },
  now: number = Date.now(),
  db: Database = getStateDb()
): DoctorState {
  const updated = updateByHandle(handle, patch, now, db);
  if (updated) return updated as DoctorState;
  if (patch.mrUrl === undefined || patch.iid === undefined) {
    throw new Error(
      `doctor state write with no prior row and no identity: ${handle}`
    );
  }
  const next: DoctorState = {
    mrUrl: patch.mrUrl,
    iid: patch.iid,
    status: patch.status,
    message: patch.message,
    tabId: patch.tabId,
    workspaceId: patch.workspaceId,
    origin: patch.origin,
    agentId: patch.agentId,
    paneId: patch.paneId,
    tier: patch.tier,
    fixClasses: patch.fixClasses,
    gateId: patch.gateId,
    gateKind: patch.gateKind,
    resumedGateId: patch.resumedGateId,
    reopenedAt: patch.reopenedAt,
    dismissedAt: patch.dismissedAt,
    startedAt: now,
    updatedAt: now,
  };
  insertAgentState('doctor', patch.mrUrl, patch.iid, next, handle, db);
  return next;
}

export function readDoctorStates(
  db: Database = getStateDb()
): Map<string, DoctorState> {
  return readStates('doctor', db) as Map<string, DoctorState>;
}

/** Drop doctor states whose MR has left the board (kept while the MR is shown).
    See pruneReviewStates for the rationale and the healthy-snapshot gate. */
export function pruneDoctorStates(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  pruneStates('doctor', keepUrls, db);
}

export function attachDoctors<T extends { webUrl?: string | null }>(
  mrs: T[],
  doctors: Map<string, DoctorState>
): Array<T & { doctor?: DoctorState }> {
  return mrs.map(mr =>
    mr.webUrl && doctors.has(mr.webUrl)
      ? { ...mr, doctor: doctors.get(mr.webUrl) }
      : mr
  );
}

/** The tier/fixClasses/draftBin fields a resumed doctor pane's dispatch
    needs, read back off the original launch's own state -- tier and
    fixClasses only exist there (a resume has no author/identity to
    recompute fixClasses from), while draftBin is re-derivable and folded
    in here so callers need only this one call. */
export function doctorResumeDispatchFields(
  state: Pick<DoctorState, 'tier' | 'fixClasses'> | undefined
): { tier?: string; fixClasses?: string[]; draftBin: string } {
  return {
    tier: state?.tier,
    fixClasses: state?.fixClasses,
    draftBin: draftBinPath(),
  };
}

/** Sent to a live doctor pane on stand-down -- both at the normal call site
    and at the post-launch race guard (server.ts's manual completion,
    triage/run.ts's auto completion), so a pane that only gets a paneId
    AFTER the operator stood its MR down still hears about it. */
export const STAND_DOWN_PANE_MESSAGE =
  'Operator stood down auto-doctor on this MR/stack. Stop and exit -- this pane will not be resumed automatically.';

export interface StandDownPlan {
  /** paneId to nudge via sendPaneText, or null when there's no live pane to tell. */
  paneToNudge: string | null;
  /** Whether the caller should write this MR's doctor state to a clean
      terminal status, so a stale error/escalation never sits on the row
      after the operator stands it down. */
  clearDoctorState: boolean;
}

/** Pure decision for the operator stand-down action: what to nudge and
    clear, given the MR's current doctor row. `inFlight` is DOCTOR_IN_FLIGHT
    from launch-dedup.ts, passed in rather than imported so this module
    (already Bun-only via bun:sqlite) doesn't also pull in focus-pane.ts. */
export function planStandDown(
  existing: DoctorState | undefined,
  inFlight: ReadonlySet<string>
): StandDownPlan {
  if (!existing) return { paneToNudge: null, clearDoctorState: false };
  const isInFlight = inFlight.has(existing.status);
  return {
    paneToNudge: isInFlight && existing.paneId ? existing.paneId : null,
    clearDoctorState: true,
  };
}

export function parseDoctorRequestBody(
  body: unknown
): { mrUrl: string; iid: number; mode?: 'rebase' } | null {
  if (!body || typeof body !== 'object') return null;
  const { mrUrl, iid, mode } = body as {
    mrUrl?: unknown;
    iid?: unknown;
    mode?: unknown;
  };
  if (typeof mrUrl !== 'string' || !mrUrl) return null;
  if (typeof iid !== 'number' || !Number.isFinite(iid)) return null;
  if (mode !== undefined && mode !== 'rebase') return null;
  return { mrUrl, iid, mode };
}
