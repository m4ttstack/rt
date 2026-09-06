import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { APP_ROOT } from './app-root.ts';
import type { RespondStatus } from './respond-outcome.ts';

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
      replies) yet. Computed at read time from the sibling report file; never
      persisted to the state JSON. See ReviewState's own reportReady, which
      this mirrors byte-for-byte. */
  reportReady?: boolean;
}

export const RESPOND_DIR = join(APP_ROOT, 'state', 'responds');

export function respondFilePath(
  mrUrl: string,
  dir: string = RESPOND_DIR
): string {
  const slug = mrUrl
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** The written adjudication markdown for an MR, or null if the fill hasn't
    saved one yet. See readReviewReport, which this mirrors byte-for-byte. */
export function readRespondReport(
  mrUrl: string,
  dir: string = RESPOND_DIR
): string | null {
  try {
    return readFileSync(respondReportPath(respondFilePath(mrUrl, dir)), 'utf8');
  } catch {
    return null;
  }
}

/** Sibling markdown file holding the fill's adjudication table and
    drafted/finalized replies, derived from the state file path so the
    server and the respond wrapper resolve the same location without
    passing it around. See reviewReportPath (review-state.ts), which this
    mirrors byte-for-byte. */
export function respondReportPath(statePath: string): string {
  return statePath.replace(/\.json$/, '') + '.md';
}

export function writeRespondState(
  path: string,
  patch: Partial<RespondState> & { status: RespondStatus },
  now: number = Date.now()
): RespondState {
  let prev: Partial<RespondState> = {};
  try {
    prev = JSON.parse(readFileSync(path, 'utf8')) as RespondState;
  } catch {
    // no prior file, or unreadable -- start fresh
  }
  const next: RespondState = {
    mrUrl: patch.mrUrl ?? prev.mrUrl ?? '',
    iid: patch.iid ?? prev.iid ?? 0,
    status: patch.status,
    message: patch.message ?? prev.message,
    posted: patch.posted ?? prev.posted,
    threads: patch.threads ?? prev.threads,
    tabId: patch.tabId ?? prev.tabId,
    workspaceId: patch.workspaceId ?? prev.workspaceId,
    sessionId: patch.sessionId ?? prev.sessionId,
    agentId: patch.agentId ?? prev.agentId,
    paneId: patch.paneId ?? prev.paneId,
    gateId: patch.gateId ?? prev.gateId,
    gateKind: patch.gateKind ?? prev.gateKind,
    resumedGateId: patch.resumedGateId ?? prev.resumedGateId,
    startedAt: prev.startedAt ?? now,
    updatedAt: now,
  };
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, path);
  return next;
}

export function readRespondStates(
  dir: string = RESPOND_DIR
): Map<string, RespondState> {
  const out = new Map<string, RespondState>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    let state: RespondState;
    try {
      state = JSON.parse(readFileSync(path, 'utf8')) as RespondState;
    } catch {
      continue;
    }
    if (state.mrUrl) {
      state.reportReady = existsSync(respondReportPath(path));
      out.set(state.mrUrl, state);
    }
  }
  return out;
}

/** Drop respond states whose MR has left the board (kept while the MR is shown).
    See pruneReviewStates for the rationale and the healthy-snapshot gate. */
export function pruneRespondStates(
  keepUrls: ReadonlySet<string>,
  dir: string = RESPOND_DIR
): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, 'utf8')) as RespondState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) {
      rmSync(path, { force: true });
      rmSync(respondReportPath(path), { force: true });
    }
  }
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
