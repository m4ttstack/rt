import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

/**
 * Response-to-review lifecycle. The board owns "queued" (from POST /respond);
 * the skill emits the middle states as it works and "done" or "error" at the end.
 */
export type RespondStatus = "queued" | "triaging" | "implementing" | "drafting" | "done" | "error";

export interface RespondState {
  mrUrl: string;
  iid: number;
  status: RespondStatus;
  message?: string;
  tabId?: string;
  workspaceId?: string;
  /** Claude Code session id, captured by the status CLI. Lets the board
      relaunch the same conversation via `claude --resume <sessionId>`. */
  sessionId?: string;
  startedAt: number;
  updatedAt: number;
}

export const RESPOND_DIR = join(import.meta.dir, "..", "state", "responds");


export function respondFilePath(mrUrl: string, dir: string = RESPOND_DIR): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

export function writeRespondState(
  path: string,
  patch: Partial<RespondState> & { status: RespondStatus },
  now: number = Date.now(),
): RespondState {
  let prev: Partial<RespondState> = {};
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as RespondState;
  } catch {
    // no prior file, or unreadable -- start fresh
  }
  const next: RespondState = {
    mrUrl: patch.mrUrl ?? prev.mrUrl ?? "",
    iid: patch.iid ?? prev.iid ?? 0,
    status: patch.status,
    message: patch.message ?? prev.message,
    tabId: patch.tabId ?? prev.tabId,
    workspaceId: patch.workspaceId ?? prev.workspaceId,
    sessionId: patch.sessionId ?? prev.sessionId,
    startedAt: prev.startedAt ?? now,
    updatedAt: now,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
  return next;
}

export function readRespondStates(dir: string = RESPOND_DIR): Map<string, RespondState> {
  const out = new Map<string, RespondState>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let state: RespondState;
    try {
      state = JSON.parse(readFileSync(path, "utf8")) as RespondState;
    } catch {
      continue;
    }
    if (state.mrUrl) out.set(state.mrUrl, state);
  }
  return out;
}

/** Drop respond states whose MR has left the board (kept while the MR is shown).
    See pruneReviewStates for the rationale and the healthy-snapshot gate. */
export function pruneRespondStates(keepUrls: ReadonlySet<string>, dir: string = RESPOND_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as RespondState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) rmSync(path, { force: true });
  }
}

/** Attach each MR's respond state (matched by webUrl) as a `respond` field. */
export function attachResponds<T extends { webUrl?: string | null }>(
  mrs: T[],
  responds: Map<string, RespondState>,
): Array<T & { respond?: RespondState }> {
  return mrs.map((mr) => (mr.webUrl && responds.has(mr.webUrl) ? { ...mr, respond: responds.get(mr.webUrl) } : mr));
}

export function parseRespondRequestBody(body: unknown): { mrUrl: string; iid: number } | null {
  if (!body || typeof body !== "object") return null;
  const { mrUrl, iid } = body as { mrUrl?: unknown; iid?: unknown };
  if (typeof mrUrl !== "string" || !mrUrl) return null;
  if (typeof iid !== "number" || !Number.isFinite(iid)) return null;
  return { mrUrl, iid };
}
