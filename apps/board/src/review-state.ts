import { Database } from 'bun:sqlite';

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

export type ReviewStatus = 'queued' | 'reviewing' | 'done' | 'error';
export type ReviewOutcome = 'comment' | 'approve';

export interface ReviewState {
  mrUrl: string;
  iid: number;
  status: ReviewStatus;
  message?: string;
  tabId?: string;
  workspaceId?: string;
  /** The review's verdict, emitted by the skill on `done`. The board consumes
      this and drops the matching reaction on the MR's slack message. */
  outcome?: ReviewOutcome;
  /** Claude Code session id, captured by the status CLI on any write. Lets the
      board relaunch the same conversation via `claude --resume <sessionId>`
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
  /** The kind `gateId` was opened with (e.g. "review-post") -- the wrapper's
      own re-entry reads this to know what a `--resumed-gate` id names. */
  gateKind?: string;
  /** Id of the gate the board has already resumed a parked-then-answered
      session for. The exactly-once dedup marker for `handleAnsweredEvent`/
      `bootResumePass` (gates/resume.ts) -- a gate id matching this is never
      resumed twice, whether the resume is retried by a boot pass or the
      live event fires again. `released` can never stand in for this: it
      stays false forever for the board's unattended gates. */
  resumedGateId?: string;
  startedAt: number;
  updatedAt: number;
  /** Whether the agent has written its full review markdown yet. Computed at
      read time from the db report column; never persisted to the state JSON. */
  reportReady?: boolean;
}

/** Deterministic handle for an MR's review row, so a repeat launch resolves
    the same row. */
export function reviewFilePath(mrUrl: string): string {
  return mintHandle('review', mrUrl);
}

/** Sibling markdown file holding the agent's full written review, derived
    from the handle so the server and the review agent resolve the same
    location without passing it around. Still the pane's scratch handoff. */
export function reviewReportPath(handle: string): string {
  return reportPathForHandle(handle);
}

/** The written review markdown for an MR, or null if the agent hasn't saved one. */
export function readReviewReport(
  mrUrl: string,
  db: Database = getStateDb()
): string | null {
  return readReport('review', mrUrl, db);
}

/** Read-merge-write a review row. First write stamps startedAt; every write
    stamps updatedAt. Tries updateByHandle first; when no row exists it
    requires `patch.mrUrl` and `patch.iid` to insert a fresh row, else there
    is no identity to key the row by and the caller is doing something wrong. */
export function writeReviewState(
  handle: string,
  patch: Partial<ReviewState> & { status: ReviewStatus },
  now: number = Date.now(),
  db: Database = getStateDb()
): ReviewState {
  const updated = updateByHandle(handle, patch, now, db);
  if (updated) return updated as ReviewState;
  if (patch.mrUrl === undefined || patch.iid === undefined) {
    throw new Error(
      `review state write with no prior row and no identity: ${handle}`
    );
  }
  const next: ReviewState = {
    mrUrl: patch.mrUrl,
    iid: patch.iid,
    status: patch.status,
    message: patch.message,
    tabId: patch.tabId,
    workspaceId: patch.workspaceId,
    outcome: patch.outcome,
    sessionId: patch.sessionId,
    agentId: patch.agentId,
    paneId: patch.paneId,
    gateId: patch.gateId,
    gateKind: patch.gateKind,
    resumedGateId: patch.resumedGateId,
    startedAt: now,
    updatedAt: now,
  };
  insertAgentState('review', patch.mrUrl, patch.iid, next, handle, db);
  return next;
}

/** Read all review states, keyed by mrUrl. Pruning is by board membership (see
    pruneReviewStates), not age — a review persists as long as its MR is shown. */
export function readReviewStates(
  db: Database = getStateDb()
): Map<string, ReviewState> {
  return readStates('review', db) as Map<string, ReviewState>;
}

/** Delete review states (and their sibling `.md` reports) whose MR is no longer
    on the board — so a review is kept exactly as long as its MR is shown, then
    dropped once the MR merges/closes/goes stale. `keepUrls` is the current board
    MR set; callers gate this on a healthy snapshot so a failed fetch can't wipe
    live state. */
export function pruneReviewStates(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  pruneStates('review', keepUrls, db);
}

/** Attach each MR's review state (matched by webUrl) as a `review` field. Non-mutating. */
export function attachReviews<T extends { webUrl?: string | null }>(
  mrs: T[],
  reviews: Map<string, ReviewState>
): Array<T & { review?: ReviewState }> {
  return mrs.map(mr =>
    mr.webUrl && reviews.has(mr.webUrl)
      ? { ...mr, review: reviews.get(mr.webUrl) }
      : mr
  );
}

/** Validate an incoming POST /review body. Returns null on any shape mismatch. */
export function parseReviewRequestBody(
  body: unknown
): { mrUrl: string; iid: number } | null {
  if (!body || typeof body !== 'object') return null;
  const { mrUrl, iid } = body as { mrUrl?: unknown; iid?: unknown };
  if (typeof mrUrl !== 'string' || !mrUrl) return null;
  if (typeof iid !== 'number' || !Number.isFinite(iid)) return null;
  return { mrUrl, iid };
}
