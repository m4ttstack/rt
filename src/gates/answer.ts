import type { Commands, GateRow, RtResponse } from "@mattstack/rt-client";
import type { GateAnswers } from "./store.ts";

/** Board-UI answer path: proxies the facility's `gate:answer` (the single
    CAS arbiter) rather than owning any state itself, so the HTTP handler in
    server.ts stays a thin status-mapping shell and this is unit-testable
    without touching the real gate cache or a live daemon. */
export interface AnswerGateIo {
  /** The board's gate cache maps `mr:<mrUrl>` subjects to facility rows;
      `gate:answer` takes an id, not a subject, so this resolves it -- and
      only for a row still `open`/`parked`, since anything else (missing,
      already answered, closed) has nothing left to answer here. */
  findAnswerableGateId(mrUrl: string): string | undefined;
  gateAnswer(payload: Commands["gate:answer"]["payload"]): Promise<RtResponse<Commands["gate:answer"]["data"]>>;
}

export type AnswerGateResult =
  | { kind: "ok" }
  | { kind: "conflict"; row: GateRow }
  | { kind: "not-found" }
  | { kind: "invalid"; reason: string };

/** Distinguishes the daemon's "nothing there to answer" rejections from
    validation/strict-membership ones -- the former maps to 404, the latter
    to 400 with the message surfaced verbatim. Exact equality, not a
    substring/regex test: a strict-membership message can legitimately echo
    an option value like "closed" (e.g. an invalid answer naming a "closed"
    option), which a substring match would misroute to 404. */
function isMissingGateError(message: string): boolean {
  return message === "not-found" || message === "closed";
}

/**
 * Answers a gate through the facility CAS: resolves the id from the board's
 * cache, calls `gateAnswer`, and maps the outcome. A CAS loss is `ok:true`
 * with `conflict:true` and the winning row -- not an error, since the
 * facility already recorded a real answer, just not this caller's. The
 * daemon emits `gate/answered` itself on a genuine write, so there is
 * nothing left for this path to emit or persist.
 */
export async function answerGate(mrUrl: string, answers: GateAnswers, io: AnswerGateIo): Promise<AnswerGateResult> {
  const gateId = io.findAnswerableGateId(mrUrl);
  if (!gateId) return { kind: "not-found" };

  const res = await io.gateAnswer({ id: gateId, answers, by: "board" });
  if (!res.ok || !res.data) {
    const message = res.error ?? "gate:answer failed with no error detail";
    return isMissingGateError(message) ? { kind: "not-found" } : { kind: "invalid", reason: message };
  }

  return res.data.conflict ? { kind: "conflict", row: res.data.row } : { kind: "ok" };
}
