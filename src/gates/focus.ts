import { realpathSync } from "node:fs";
import type { GateOrigin } from "./store.ts";

export type FocusResolution =
  | { ok: true; paneId: string; tabId?: string }
  | { ok: false; reason: string };

/** Normalizes a path before comparing an origin's worktree against a live
    pane's cwd: a trailing slash, or any symlink either side reports in a
    different form (origin.worktree comes from a kernel-resolved
    process.cwd(); a pane cwd sourced from herdr can still carry the
    symlinked form, e.g. macOS's `/tmp` vs. its real `/private/tmp`), would
    otherwise fail an exact-string match on the SAME directory. realpath
    needs the path to exist; a torn-down worktree or a stale pane cwd must
    still normalize deterministically rather than throw, so a missing path
    falls back to the trimmed string with the one rewrite realpath itself
    would have made for the common macOS case. */
export function normalizeWorktreePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  try {
    return realpathSync(trimmed);
  } catch {
    return trimmed === "/tmp" || trimmed.startsWith("/tmp/") ? `/private${trimmed}` : trimmed;
  }
}

/** Shared focus rule: direct by origin.paneId, else worktree match against
    live pane cwds, else a human-readable reason for a disabled affordance. */
export function resolveOriginFocus(
  origin: GateOrigin | undefined,
  panes: Array<{ paneId: string; cwd?: string }>,
): FocusResolution {
  if (origin?.paneId) {
    return origin.tabId !== undefined
      ? { ok: true, paneId: origin.paneId, tabId: origin.tabId }
      : { ok: true, paneId: origin.paneId };
  }
  if (origin?.worktree) {
    const target = normalizeWorktreePath(origin.worktree);
    const match = panes.find((p) => p.cwd !== undefined && normalizeWorktreePath(p.cwd) === target);
    return match
      ? { ok: true, paneId: match.paneId }
      : { ok: false, reason: "no live pane matches the origin worktree" };
  }
  return { ok: false, reason: "no origin on this gate" };
}

export interface PanesForOriginResult {
  panes: Array<{ paneId: string; cwd?: string }>;
  /** True when a worktree-fallback fetch was attempted and the daemon call
      itself failed, as opposed to succeeding with no matching pane. The
      caller needs this to word a "could not list panes" reason correctly
      instead of the misleading "no live pane matches". */
  fetchFailed: boolean;
}

/** Fetches live panes only when the resolution actually needs them: a direct
    `origin.paneId` never touches the pane list, so a fetch that would only
    be discarded (or a call the daemon has to serve for nothing) never
    happens; the worktree-fallback path is the only one that needs to know
    what's live. */
export async function panesForOrigin(
  origin: GateOrigin | undefined,
  listPanes: () => Promise<{ ok: boolean; data?: { panes: Array<{ paneId: string; cwd?: string }> } | null }>,
): Promise<PanesForOriginResult> {
  if (origin?.paneId || !origin?.worktree) return { panes: [], fetchFailed: false };
  const res = await listPanes();
  return res.ok && res.data ? { panes: res.data.panes, fetchFailed: false } : { panes: [], fetchFailed: true };
}
