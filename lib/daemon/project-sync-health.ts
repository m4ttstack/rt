/**
 * Per-repo record of the current run of failed project syncs, so
 * project-mrs:read can tell a client why its data stopped moving.
 * In-memory: a restarted daemon relearns it on the next failed sync.
 */

import type { ProjectSyncError, ProjectSyncErrorKind } from "../../packages/rt-client/src/commands.ts";

const MESSAGE_CAP = 200;

/** glance's two status wordings: "... failed: 500 Internal Server Error" and "<op>: HTTP 429 for <path>". */
const STATUS_RE = /(?:failed: |HTTP )(\d{3})\b/;

const failing = new Map<string, ProjectSyncError>();

export function classifySyncError(message: string): ProjectSyncErrorKind {
  const status = Number(STATUS_RE.exec(message)?.[1] ?? 0);
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500 && status < 600) return "server-error";
  if (message.includes("Timeout on") || message.includes("timed out")) return "timeout";
  return "other";
}

export function recordSyncFailure(repoName: string, err: unknown, now: number): void {
  const full = err instanceof Error ? err.message : String(err);
  failing.set(repoName, {
    since: failing.get(repoName)?.since ?? now,
    lastAt: now,
    kind: classifySyncError(full),
    message: full.slice(0, MESSAGE_CAP),
  });
}

export function recordSyncSuccess(repoName: string): void {
  failing.delete(repoName);
}

export function readSyncHealth(repoName: string): ProjectSyncError | undefined {
  return failing.get(repoName);
}
