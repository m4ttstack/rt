import type { GateOrigin } from "./store.ts";

export type FocusResolution =
  | { ok: true; paneId: string; tabId?: string }
  | { ok: false; reason: string };

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
    const match = panes.find((p) => p.cwd === origin.worktree);
    return match
      ? { ok: true, paneId: match.paneId }
      : { ok: false, reason: "no live pane matches the origin worktree" };
  }
  return { ok: false, reason: "no origin on this gate" };
}
