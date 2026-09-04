import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { APP_ROOT } from "./app-root.ts";

export type ReviewStatus = "queued" | "reviewing" | "done" | "error";
export type ReviewOutcome = "comment" | "approve";

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
      read time from the sibling report file; never persisted to the state JSON. */
  reportReady?: boolean;
}

/** Per-review JSON files live here; the server owns naming, the agent just writes. */
export const REVIEW_DIR = join(APP_ROOT, "state", "reviews");


/** Deterministic file path for an MR url, so a repeat launch resolves the same file. */
export function reviewFilePath(mrUrl: string, dir: string = REVIEW_DIR): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Sibling markdown file holding the agent's full written review, derived from
    the state file path so the server and the review agent resolve the same
    location without passing it around. */
export function reviewReportPath(statePath: string): string {
  return statePath.replace(/\.json$/, "") + ".md";
}

/** The written review markdown for an MR, or null if the agent hasn't saved one. */
export function readReviewReport(mrUrl: string, dir: string = REVIEW_DIR): string | null {
  try {
    return readFileSync(reviewReportPath(reviewFilePath(mrUrl, dir)), "utf8");
  } catch {
    return null;
  }
}

/** Read-merge-write a review state file. First write stamps startedAt; every write stamps updatedAt. */
export function writeReviewState(
  path: string,
  patch: Partial<ReviewState> & { status: ReviewStatus },
  now: number = Date.now(),
): ReviewState {
  let prev: Partial<ReviewState> = {};
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as ReviewState;
  } catch {
    // no prior file, or unreadable -- start fresh
  }
  const next: ReviewState = {
    mrUrl: patch.mrUrl ?? prev.mrUrl ?? "",
    iid: patch.iid ?? prev.iid ?? 0,
    status: patch.status,
    message: patch.message ?? prev.message,
    tabId: patch.tabId ?? prev.tabId,
    workspaceId: patch.workspaceId ?? prev.workspaceId,
    outcome: patch.outcome ?? prev.outcome,
    sessionId: patch.sessionId ?? prev.sessionId,
    agentId: patch.agentId ?? prev.agentId,
    paneId: patch.paneId ?? prev.paneId,
    gateId: patch.gateId ?? prev.gateId,
    resumedGateId: patch.resumedGateId ?? prev.resumedGateId,
    startedAt: prev.startedAt ?? now,
    updatedAt: now,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
  return next;
}

/** Read all review states, keyed by mrUrl. Pruning is by board membership (see
    pruneReviewStates), not age — a review persists as long as its MR is shown. */
export function readReviewStates(dir: string = REVIEW_DIR): Map<string, ReviewState> {
  const out = new Map<string, ReviewState>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let state: ReviewState;
    try {
      state = JSON.parse(readFileSync(path, "utf8")) as ReviewState;
    } catch {
      continue;
    }
    if (state.mrUrl) {
      state.reportReady = existsSync(reviewReportPath(path));
      out.set(state.mrUrl, state);
    }
  }
  return out;
}

/** Delete review states (and their sibling `.md` reports) whose MR is no longer
    on the board — so a review is kept exactly as long as its MR is shown, then
    dropped once the MR merges/closes/goes stale. `keepUrls` is the current board
    MR set; callers gate this on a healthy snapshot so a failed fetch can't wipe
    live state. */
export function pruneReviewStates(keepUrls: ReadonlySet<string>, dir: string = REVIEW_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as ReviewState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) {
      rmSync(path, { force: true });
      rmSync(reviewReportPath(path), { force: true });
    }
  }
}

/** Attach each MR's review state (matched by webUrl) as a `review` field. Non-mutating. */
export function attachReviews<T extends { webUrl?: string | null }>(
  mrs: T[],
  reviews: Map<string, ReviewState>,
): Array<T & { review?: ReviewState }> {
  return mrs.map((mr) => (mr.webUrl && reviews.has(mr.webUrl) ? { ...mr, review: reviews.get(mr.webUrl) } : mr));
}

/** Validate an incoming POST /review body. Returns null on any shape mismatch. */
export function parseReviewRequestBody(body: unknown): { mrUrl: string; iid: number } | null {
  if (!body || typeof body !== "object") return null;
  const { mrUrl, iid } = body as { mrUrl?: unknown; iid?: unknown };
  if (typeof mrUrl !== "string" || !mrUrl) return null;
  if (typeof iid !== "number" || !Number.isFinite(iid)) return null;
  return { mrUrl, iid };
}
