import type { BoardMR } from "../../data.ts";
import type { ActionResult } from "../api.ts";

/** Deps a launch flow needs from its caller: how to POST, how to reflect the
    optimistic queued/rollback state (no-ops for non-optimistic actions like
    resume), how to toast, and how to reload once the server answers. */
export interface LaunchFlowDeps {
  post: (payload: Record<string, unknown>) => Promise<ActionResult>;
  setQueued: () => void;
  rollback: () => void;
  addToast: (t: string) => void;
  reload: () => void;
  verbing: string;
  noun: string;
  /** Overrides the default failure toast (`couldn't launch ${noun} for !${iid}
      (${status})`). Resume actions use this to surface the server's own
      response text, matching today's handleResume (`resume review failed for
      !N (400): <server message>`) -- the other six handlers rely on the
      default and are unaffected. */
  failureMessage?: (result: ActionResult, mr: BoardMR) => string;
}

/** The pure shape common to every launch-a-pane action (characterized from
    today's handleLaunch): claim optimistic queued state, toast that it's
    starting, POST, and on the answer either roll back + toast the failure
    status, or toast a "focused an existing tab" note when the server says so
    and reload either way that reflects the server's real state.

    DOM-free by design (no react, no browser globals) so it stays importable
    from a plain root-tsconfig test without pulling DOM types into that
    program -- see hooks.ts, which imports this for useLaunchAction. */
export async function runLaunchFlow(deps: LaunchFlowDeps, mr: BoardMR, extra: Record<string, unknown>): Promise<void> {
  if (!mr.webUrl) return;
  deps.setQueued();
  deps.addToast(`${deps.verbing} for !${mr.iid}…`);
  const result = await deps.post({ mrUrl: mr.webUrl, iid: mr.iid, ...extra });
  if (!result.ok) {
    deps.rollback();
    deps.addToast(
      deps.failureMessage ? deps.failureMessage(result, mr) : `couldn't launch ${deps.noun} for !${mr.iid} (${result.status})`,
    );
    return;
  }
  // Resume actions route through here too (axis: null + a bespoke
  // failureMessage above), but the server never sets `focused` on a resume
  // response today -- this branch is inert for resume until/unless that
  // changes, at which point resume would start showing this toast too.
  if (result.body?.focused) deps.addToast(`${deps.noun} already running for !${mr.iid} — focused its tab`);
  deps.reload();
}
