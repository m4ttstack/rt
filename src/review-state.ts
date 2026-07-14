import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

export type ReviewStatus = "queued" | "reviewing" | "done" | "error";

export interface ReviewState {
  mrUrl: string;
  iid: number;
  status: ReviewStatus;
  message?: string;
  tabId?: string;
  workspaceId?: string;
  startedAt: number;
  updatedAt: number;
}

/** Per-review JSON files live here; the server owns naming, the agent just writes. */
export const REVIEW_DIR = join(import.meta.dir, "..", "state", "reviews");

const DAY_MS = 24 * 60 * 60_000;

/** Deterministic file path for an MR url, so a repeat launch resolves the same file. */
export function reviewFilePath(mrUrl: string, dir: string = REVIEW_DIR): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
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
    startedAt: prev.startedAt ?? now,
    updatedAt: now,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** Read all review states, keyed by mrUrl. Files older than maxAgeMs are pruned from disk and skipped. */
export function readReviewStates(
  dir: string = REVIEW_DIR,
  now: number = Date.now(),
  maxAgeMs: number = DAY_MS,
): Map<string, ReviewState> {
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
    if (now - (state.updatedAt ?? 0) > maxAgeMs) {
      rmSync(path, { force: true });
      continue;
    }
    if (state.mrUrl) out.set(state.mrUrl, state);
  }
  return out;
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
