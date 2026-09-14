import type { Logger } from "pino";
import { herdrRequest, waitTimeout, HERDR_UNAVAILABLE } from "../herdr/client.ts";
import { formatPaneRef } from "../../packages/rt-client/src/index.ts";
import { bgSocketPath } from "./bg-service.ts";

const DEFAULT_WAIT_MS = 5_000;

/** Relocated from handlers/pane.ts (logic unchanged), re-exported there; keeps inject.ts and pane.ts from importing each other. */
export function herdrError(res: { ok: false; code: string; message: string }): { ok: false; error: string } {
  if (res.code === "unreachable" || res.code === "timeout") {
    return { ok: false, error: res.message.startsWith(HERDR_UNAVAILABLE) ? res.message : `${HERDR_UNAVAILABLE}: ${res.message}` };
  }
  return { ok: false, error: `${res.code}: ${res.message}` };
}

export type InjectDelivery = "accepted" | "queued" | "refused";
export interface InjectResult { paneId: string; delivered: InjectDelivery; reason?: string }
export interface InjectOptions { paneId: string; text: string; callerPane?: string; herdr?: typeof herdrRequest; promptWaitMs?: number; sockPath?: string }

/**
 * herdr's injection delivery, shared by chat:invite and pane:send. Returns the
 * CommandResult shape both handlers already return: a refused/accepted/queued
 * outcome is `{ ok: true, data }`; a herdr-unavailable or unexpected herdr error
 * is `{ ok: false, error }` (via herdrError), so a caller returns it directly.
 * agent.get first: not-claude and blocked are refused; working is queued (prompt,
 * no wait); else agent.prompt with a wait until working, and on a stall (the
 * prompt fails with `timeout`/`agent_prompt_stalled`) one `pane.send_keys` Enter
 * nudge then an agent.wait, accepted or queued honestly.
 *
 * `paneId` here is always a bare herdr id: callers (pane:send, chat:invite)
 * resolve the incoming ref to `{ paneId, sockPath }` before calling in.
 */
export async function injectIntoPane(opts: InjectOptions): Promise<{ ok: true; data: InjectResult } | { ok: false; error: string }> {
  const { paneId, text, callerPane, sockPath } = opts;
  const herdr = opts.herdr ?? herdrRequest;
  const waitMs = opts.promptWaitMs ?? DEFAULT_WAIT_MS;
  const ok = (delivered: InjectDelivery, reason?: string) =>
    ({ ok: true as const, data: reason ? { paneId, delivered, reason } : { paneId, delivered } });
  // callerPane arrives as a ref (bare or bg:-prefixed, per selfPaneRef); paneId
  // here is always the bare id the caller's ref already resolved against
  // (see the docstring above), so the comparison must re-address paneId into
  // the same ref space -- a bg:w1:p1 caller vs. a bare w1:p1 target would
  // never match even when they are the exact same pane.
  const targetRef = formatPaneRef(paneId, sockPath === bgSocketPath() ? "bg" : "visible");
  if (callerPane && callerPane === targetRef) return ok("refused", "that is this pane");

  const probe = await herdr<{ agent: { agent: string; agent_status: string } }>("agent.get", { target: paneId }, { sockPath });
  if (!probe.ok) {
    if (probe.code === "agent_not_found" || probe.code === "agent_target_ambiguous") return ok("refused", "not a claude pane");
    return herdrError(probe);
  }
  if (probe.result.agent.agent !== "claude") return ok("refused", "not a claude pane");
  if (probe.result.agent.agent_status === "blocked") return ok("refused", "at a prompt");

  if (probe.result.agent.agent_status === "working") {
    const queued = await herdr("agent.prompt", { target: paneId, text }, { sockPath });
    if (!queued.ok) return queued.code === "agent_blocked" ? ok("refused", "at a prompt") : herdrError(queued);
    return ok("queued");
  }

  const prompted = await herdr("agent.prompt", { target: paneId, text, wait: { until: ["working"], timeout_ms: waitMs } }, { timeoutMs: waitTimeout(waitMs), sockPath });
  if (prompted.ok) return ok("accepted");
  if (prompted.code === "agent_blocked") return ok("refused", "at a prompt");
  if (prompted.code !== "timeout" && prompted.code !== "agent_prompt_stalled") return herdrError(prompted);

  // The Claude TUI can absorb the bundled Enter into the composer; one nudge, one more wait.
  const nudge = await herdr("pane.send_keys", { pane_id: paneId, keys: ["enter"] }, { sockPath });
  if (!nudge.ok) return herdrError(nudge);
  const nudged = await herdr("agent.wait", { target: paneId, until: ["working"], timeout_ms: waitMs }, { timeoutMs: waitTimeout(waitMs), sockPath });
  if (nudged.ok) return ok("accepted");
  if (nudged.code !== "timeout" && nudged.code !== "agent_prompt_stalled") return herdrError(nudged);
  return ok("queued");
}

const AFTER_TURN_STATES = ["idle", "done"];
const AFTER_TURN_LEG_MS = 10_000;
const AFTER_TURN_MAX_MS = 30 * 60_000;
const AFTER_TURN_SETTLE_MS = 1_500;
// herdr detection rule ids (its claude manifest): the parked-on-background-agents
// line as the last line above a free prompt box. Both must match, and no blocker.
const HOLD_RULES = ["background_agents_working", "live_prompt_box"];

interface AgentExplain { explain: { state: string; evaluated_rules: Array<{ id: string; matched: boolean }> } }

/**
 * True while Claude Code has finished its message and is only waiting on
 * background agents. herdr reports that as `working` (the title spinner and
 * its background_agents rule), yet the composer is open: a queued slash
 * command has already run and a typed line starts its own turn, so a
 * continuation can land now instead of after the agents finish.
 */
async function onBackgroundHold(herdr: typeof herdrRequest, paneId: string, sockPath: string | undefined): Promise<boolean> {
  const res = await herdr<AgentExplain>("agent.explain", { target: paneId }, { sockPath });
  if (!res.ok || res.result.explain.state === "blocked") return false;
  const matched = new Set(res.result.explain.evaluated_rules.filter((r) => r.matched).map((r) => r.id));
  return HOLD_RULES.every((id) => matched.has(id));
}

export interface AfterTurnOptions {
  paneId: string;
  text: string;
  herdr?: typeof herdrRequest;
  sockPath?: string;
  log?: Logger;
  legMs?: number;
  maxWaitMs?: number;
  settleMs?: number;
}

/**
 * Injects `text` once the target's current turn has ended. Claude Code hands
 * a plain line queued mid-turn to the model inside that turn, while a slash
 * command waits for the turn's end, so a continuation sent right behind one
 * would run first; waiting for idle restores the order. `blocked` is a
 * prompt mid-turn, not an end, so it keeps waiting. The caller is often the
 * very pane whose turn must end, so this never blocks a reply: handlers
 * schedule it with `void`. A settle window plus a re-probe after `agent.wait`
 * guards against a transient idle between a tool result and the next model
 * call, which would otherwise fire the continuation mid-turn. A turn parked
 * on background agents never reaches idle until they finish, so each leg is
 * preceded by the hold check, which injects without waiting for them.
 */
export async function injectAfterTurn(opts: AfterTurnOptions): Promise<void> {
  const { paneId, text, sockPath, log } = opts;
  const herdr = opts.herdr ?? herdrRequest;
  const legMs = opts.legMs ?? AFTER_TURN_LEG_MS;
  const settleMs = opts.settleMs ?? AFTER_TURN_SETTLE_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? AFTER_TURN_MAX_MS);
  const deliver = async () => {
    const res = await injectIntoPane({ paneId, text, herdr, sockPath });
    if (res.ok && res.data.delivered === "refused") log?.warn(res.data, "pane:send continuation refused");
    else if (res.ok) log?.info(res.data, "pane:send continuation delivered");
    else log?.warn({ paneId, err: res.error }, "pane:send continuation failed");
  };
  try {
    while (Date.now() < deadline) {
      if (await onBackgroundHold(herdr, paneId, sockPath)) {
        await deliver();
        return;
      }
      const settled = await herdr("agent.wait", { target: paneId, until: AFTER_TURN_STATES, timeout_ms: legMs }, { timeoutMs: waitTimeout(legMs), sockPath });
      if (settled.ok) {
        await Bun.sleep(settleMs);
        const probe = await herdr<{ agent: { agent_status: string } }>("agent.get", { target: paneId }, { sockPath });
        if (probe.ok && AFTER_TURN_STATES.includes(probe.result.agent.agent_status)) {
          await deliver();
          return;
        }
        if (probe.ok) continue;
        log?.warn({ paneId, err: probe.message }, "pane:send continuation abandoned");
        return;
      }
      if (settled.code !== "timeout") {
        log?.warn({ paneId, err: settled.message }, "pane:send continuation abandoned");
        return;
      }
    }
    log?.warn({ paneId }, "pane:send continuation abandoned: turn never ended");
  } catch (err) {
    log?.warn({ paneId, err }, "pane:send continuation crashed");
  }
}
