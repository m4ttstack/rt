/**
 * Driving Claude Code's folder-trust modal on a pane, for every path that
 * spawns claude through the daemon (herd:spawn, pane:spawn, agent:start).
 *
 * Two live findings shape the mechanics, both from panes that sat at the
 * dialog until a human cleared them:
 *
 * - A batch of keys in one `pane.send_keys` call does not register: the arrow
 *   is swallowed and the Enter lands on whatever was selected, which on the
 *   elevated variant is "No, exit". Every key therefore goes in its own call.
 * - The cursor is re-read between presses rather than assumed, so the walk to
 *   the accept option is driven by what the screen actually shows and a cursor
 *   that will not move is reported instead of entered on.
 */
import type { Logger } from "pino";
import { readTrustPrompt, type TrustPrompt } from "./trust-dialog.ts";

/** `no-dialog` is "the screen showed no modal", which each caller reads in its
    own context: for a registered pane it means nothing to do, for one that
    never came up it means the spawn failed for a reason the screen cannot
    name. */
export type TrustDriveOutcome = "accepted" | "stuck" | "unchecked" | "no-dialog";

type HerdrCall = <T = unknown>(method: string, params?: Record<string, unknown>, opts?: { sockPath?: string; timeoutMs?: number }) => Promise<{ ok: true; result: T } | { ok: false; code?: string; message?: string }>;

export interface TrustDriveDeps {
  herdr: HerdrCall;
  /** `{ sockPath }` for a pane on a socket-scoped server, `{}` for the
      ambient visible one. */
  sock: { sockPath?: string };
  /** The bare herdr pane id; callers parse an addressable ref first. */
  pane: string;
  /** Optional: pane:spawn's handlers run without one in tests. */
  log?: Logger;
  context: Record<string, unknown>;
  /** Repaint budget after Enter, before the verifying re-read. */
  settleMs?: number;
  /** Repaint budget after a single arrow, before re-reading the cursor. */
  stepMs?: number;
  attempts?: number;
}

const SETTLE_MS = 1_500;
const STEP_MS = 250;
// One retry only: a modal that ignores a correctly-aimed accept twice is not
// going to yield to a third, and every extra round holds the spawn's caller.
const ATTEMPTS = 2;
// The dialog has two options, so one step always suffices; the cap is only
// there so a screen that reparses differently every read cannot spin.
const MAX_STEPS = 4;

export async function driveTrustAccept(deps: TrustDriveDeps): Promise<TrustDriveOutcome> {
  const { herdr, sock, pane, log, context } = deps;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const stepMs = deps.stepMs ?? STEP_MS;
  const attempts = deps.attempts ?? ATTEMPTS;

  /** The modal currently on screen, or null when none is; `false` means the
      screen could not be read at all, which is never evidence of either. */
  const look = async (): Promise<TrustPrompt | null | false> => {
    const screen = await herdr<{ read: { text: string } }>("pane.read", { pane_id: pane, source: "visible" }, sock);
    if (!screen.ok) {
      log?.warn({ ...context, pane, err: screen.message }, "trust: pane read failed; dialog not checked");
      return false;
    }
    return readTrustPrompt(screen.result.read.text);
  };

  const press = async (key: "up" | "down" | "enter"): Promise<boolean> => {
    const sent = await herdr("pane.send_keys", { pane_id: pane, keys: [key] }, sock);
    if (sent.ok) return true;
    log?.warn({ ...context, pane, key, err: sent.message }, "trust: dialog accept key failed");
    return false;
  };

  for (let attempt = 0; attempt < attempts; attempt++) {
    let prompt = await look();
    if (prompt === false) return "unchecked";
    if (prompt === null) return attempt > 0 ? "accepted" : "no-dialog";
    if (prompt.kind === "undrivable") {
      log?.warn({ ...context, pane }, "trust: dialog present but its selection could not be read; not guessing a key");
      return "stuck";
    }

    // keys is the remaining walk plus the trailing enter, so a length of one
    // means the cursor already sits on the accept option.
    for (let step = 0; prompt.keys.length > 1 && step < MAX_STEPS; step++) {
      const key = prompt.keys[0] as "up" | "down";
      if (!(await press(key))) return "stuck";
      await Bun.sleep(stepMs);
      const next = await look();
      if (next === false) return "unchecked";
      // The dialog answering a single arrow by closing is not something the
      // real one does, but a spawn racing a human hand is.
      if (next === null) return "accepted";
      if (next.kind === "undrivable") return "stuck";
      if (next.keys.length >= prompt.keys.length) {
        log?.warn({ ...context, pane, key }, "trust: the cursor did not move; refusing to press enter on an unknown selection");
        return "stuck";
      }
      prompt = next;
    }
    if (prompt.kind !== "accept" || prompt.keys.length > 1) return "stuck";

    if (!(await press("enter"))) return "stuck";
    log?.debug({ ...context, pane, variant: prompt.variant }, "trust: dialog accept sent");
    await Bun.sleep(settleMs);
  }

  const after = await look();
  if (after === false) return "unchecked";
  if (after === null) return "accepted";
  log?.warn({ ...context, pane }, "trust: dialog still up after the accept keys; the pane is stuck at the modal");
  return "stuck";
}
