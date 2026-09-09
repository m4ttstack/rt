import { Database } from 'bun:sqlite';

import type { RespondStatus } from './respond-outcome.ts';
import {
  getStateDb,
  insertAgentState,
  mintHandle,
  pruneStates,
  readReport,
  readStates,
  reportPathForHandle,
  updateByHandle,
} from './state/index.ts';

/**
 * Response-to-review lifecycle. The board owns "queued" (from POST /respond);
 * the skill emits the middle states as it works and "done" or "error" at the end.
 */
export type { RespondStatus };

export interface RespondState {
  mrUrl: string;
  iid: number;
  status: RespondStatus;
  message?: string;
  /** Unresolved human threads the run set out to answer, and how many of those
      actually got a reply posted. The board derives the terminal outcome from
      the pair (see respondOutcome); absent means a run that never reported. */
  posted?: number;
  threads?: number;
  tabId?: string;
  workspaceId?: string;
  /** Claude Code session id, captured by the status CLI. Lets the board
      relaunch the same conversation via `claude --resume <sessionId>`
      (see launchLegacyResume) when no agentId is on file. */
  sessionId?: string;
  /** rt agent record id from the launch/resume result. When present, a resume
      goes through resumeAgentPane instead of the legacy claude --resume path. */
  agentId?: string;
  /** rt herdr pane id the agent landed in, from the launch/resume result. */
  paneId?: string;
  /** Facility gate id from the most recent `gate open`, so `gate wait` /
      `gate answer` can find it by state path alone. */
  gateId?: string;
  /** The kind `gateId` was opened with ("respond-plan" or "respond-post") --
      the wrapper's own re-entry reads this to know what a `--resumed-gate`
      id names. */
  gateKind?: string;
  /** Id of the gate the board has already resumed a parked-then-answered
      session for -- the exactly-once dedup marker (see gates/resume.ts). */
  resumedGateId?: string;
  startedAt: number;
  updatedAt: number;
  /** Whether the fill has written its adjudication (verdict table + drafted
      replies) yet. Computed at read time from the db report column; never
      persisted to the state JSON. See ReviewState's own reportReady, which
      this mirrors byte-for-byte. */
  reportReady?: boolean;
}

export function respondFilePath(mrUrl: string): string {
  return mintHandle('respond', mrUrl);
}

/** The written adjudication markdown for an MR, or null if the fill hasn't
    saved one yet. See readReviewReport, which this mirrors byte-for-byte. */
export function readRespondReport(
  mrUrl: string,
  db: Database = getStateDb()
): string | null {
  return readReport('respond', mrUrl, db);
}

/** Sibling markdown file holding the fill's adjudication table and
    drafted/finalized replies, derived from the handle so the server and the
    respond wrapper resolve the same location without passing it around.
    See reviewReportPath (review-state.ts), which this mirrors byte-for-byte. */
export function respondReportPath(handle: string): string {
  return reportPathForHandle(handle);
}

export function writeRespondState(
  handle: string,
  patch: Partial<RespondState> & { status: RespondStatus },
  now: number = Date.now(),
  db: Database = getStateDb()
): RespondState {
  const updated = updateByHandle(handle, patch, now, db);
  if (updated) return updated as RespondState;
  if (patch.mrUrl === undefined || patch.iid === undefined) {
    throw new Error(
      `respond state write with no prior row and no identity: ${handle}`
    );
  }
  const next: RespondState = {
    mrUrl: patch.mrUrl,
    iid: patch.iid,
    status: patch.status,
    message: patch.message,
    posted: patch.posted,
    threads: patch.threads,
    tabId: patch.tabId,
    workspaceId: patch.workspaceId,
    sessionId: patch.sessionId,
    agentId: patch.agentId,
    paneId: patch.paneId,
    gateId: patch.gateId,
    gateKind: patch.gateKind,
    resumedGateId: patch.resumedGateId,
    startedAt: now,
    updatedAt: now,
  };
  insertAgentState('respond', patch.mrUrl, patch.iid, next, handle, db);
  return next;
}

export function readRespondStates(
  db: Database = getStateDb()
): Map<string, RespondState> {
  return readStates('respond', db) as Map<string, RespondState>;
}

/** Drop respond states whose MR has left the board (kept while the MR is shown).
    See pruneReviewStates for the rationale and the healthy-snapshot gate. */
export function pruneRespondStates(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  pruneStates('respond', keepUrls, db);
}

/** Attach each MR's respond state (matched by webUrl) as a `respond` field. */
export function attachResponds<T extends { webUrl?: string | null }>(
  mrs: T[],
  responds: Map<string, RespondState>
): Array<T & { respond?: RespondState }> {
  return mrs.map(mr =>
    mr.webUrl && responds.has(mr.webUrl)
      ? { ...mr, respond: responds.get(mr.webUrl) }
      : mr
  );
}

export function parseRespondRequestBody(
  body: unknown
): { mrUrl: string; iid: number } | null {
  if (!body || typeof body !== 'object') return null;
  const { mrUrl, iid } = body as { mrUrl?: unknown; iid?: unknown };
  if (typeof mrUrl !== 'string' || !mrUrl) return null;
  if (typeof iid !== 'number' || !Number.isFinite(iid)) return null;
  return { mrUrl, iid };
}
