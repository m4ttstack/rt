import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

/** A peer's review status for one MR, as materialized from an inbound
    review-state envelope. Multiple reviewers can each have their own state
    for the same mrUrl -- see readPeerReviews' grouping. */
export interface PeerReviewState {
  mrUrl: string;
  iid: number;
  reviewer: string;
  status: string;
  outcome?: string;
  updatedAt: number;
}

/** Per-(mrUrl, reviewer) JSON files live here. */
export const PEER_REVIEW_DIR = join(import.meta.dir, "..", "..", "state", "peer-reviews");

/** Deterministic file path for an mrUrl + reviewer pair, so a repeat delivery
    resolves the same file. */
export function peerReviewFilePath(mrUrl: string, reviewer: string, dir: string = PEER_REVIEW_DIR): string {
  const slug = `${mrUrl}-${reviewer}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Write a peer's review state, atomically. Returns false (and leaves the
    prior state untouched) when a newer state is already on disk.
    At-least-once delivery + outbox retries can deliver an older state after
    a newer one; last-write-wins on the payload clock, not arrival order. */
export function writePeerReview(s: PeerReviewState, dir: string = PEER_REVIEW_DIR): boolean {
  const path = peerReviewFilePath(s.mrUrl, s.reviewer, dir);
  try {
    const prev = JSON.parse(readFileSync(path, "utf8")) as PeerReviewState;
    if (prev.updatedAt >= s.updatedAt) return false;
  } catch {
    // no prior state -- first write
  }
  mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, path);
  return true;
}

/** Read all peer review states, grouped by mrUrl -- a single MR can have one
    entry per reviewer who's shared their status. */
export function readPeerReviews(dir: string = PEER_REVIEW_DIR): Map<string, PeerReviewState[]> {
  const out = new Map<string, PeerReviewState[]>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let state: PeerReviewState;
    try {
      state = JSON.parse(readFileSync(join(dir, name), "utf8")) as PeerReviewState;
    } catch {
      continue;
    }
    if (!state.mrUrl) continue;
    const list = out.get(state.mrUrl);
    if (list) list.push(state);
    else out.set(state.mrUrl, [state]);
  }
  return out;
}

/** Delete peer review states whose MR is no longer on the board. `keepUrls`
    is the current board MR set; callers gate this on a healthy snapshot so a
    failed fetch can't wipe live state. */
export function prunePeerReviews(keepUrls: ReadonlySet<string>, dir: string = PEER_REVIEW_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as PeerReviewState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) {
      rmSync(path, { force: true });
    }
  }
}

/** Attach each MR's peer review states (matched by webUrl) as a
    `peerReviews` field. Non-mutating. */
export function attachPeerReviews<T extends { webUrl?: string | null }>(
  mrs: T[],
  peerReviews: Map<string, PeerReviewState[]>,
): Array<T & { peerReviews?: PeerReviewState[] }> {
  return mrs.map((mr) =>
    mr.webUrl && peerReviews.has(mr.webUrl) ? { ...mr, peerReviews: peerReviews.get(mr.webUrl) } : mr,
  );
}
