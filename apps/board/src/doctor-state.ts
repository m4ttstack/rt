import { Database } from 'bun:sqlite';

import {
  getStateDb,
  insertAgentState,
  mintHandle,
  pruneStates,
  readStates,
  updateByHandle,
} from './state/index.ts';
import { draftBinPath } from './herdr.ts';

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
