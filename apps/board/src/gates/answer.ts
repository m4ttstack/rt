import type { Commands, GateRow, RtResponse } from '@mattstack/rt-client';
import type { GateAnswers } from './store.ts';

/** Board-UI answer path: proxies the facility's `gate:answer` (the single
    CAS arbiter) rather than owning any state itself, so the HTTP handler in
    server.ts stays a thin status-mapping shell and this is unit-testable
    without touching the real gate cache or a live daemon. */
export interface AnswerGateIo {
  /** True when the board's gate cache still holds this id `open`/`parked` --
      anything else (unknown id, already answered, closed) has nothing left
      to answer here. The caller addresses the gate directly by id now (a
      row can be one of several live on the same MR), so this is a guard
      against a stale id, not a lookup. */
  isAnswerable(gateId: string): boolean;
  gateAnswer(
    payload: Commands['gate:answer']['payload']
  ): Promise<RtResponse<Commands['gate:answer']['data']>>;
}

export type AnswerGateResult =
  | { kind: 'ok' }
  | { kind: 'conflict'; row: GateRow }
  | { kind: 'not-found' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'unreachable'; reason: string };

/** Distinguishes the daemon's "nothing there to answer" rejections from
    validation/strict-membership ones -- the former maps to 404, the latter
    to 400 with the message surfaced verbatim. Exact equality, not a
    substring/regex test: a strict-membership message can legitimately echo
    an option value like "closed" (e.g. an invalid answer naming a "closed"
    option), which a substring match would misroute to 404. */
function isMissingGateError(message: string): boolean {
  return message === 'not-found' || message === 'closed';
}

/** The rt-client transport's own error-shape prefix (see rtCommand's catch)
    for a failed socket connection -- distinct from a daemon-issued
    validation rejection, which never carries this text. */
const UNREACHABLE_PREFIX = 'rt daemon unreachable';

function isUnreachableError(message: string): boolean {
  return message.startsWith(UNREACHABLE_PREFIX);
}

/**
 * Answers a gate through the facility CAS: guards the id is still live in
 * the board's cache, calls `gateAnswer`, and maps the outcome. A CAS loss is
 * `ok:true` with `conflict:true` and the winning row -- not an error, since
 * the facility already recorded a real answer, just not this caller's. The
 * daemon emits `gate/answered` itself on a genuine write, so there is
 * nothing left for this path to emit or persist.
 *
 * `gateAnswer` itself never rejects in production (the rt-client transport
 * catches connection failures into `{ok:false}`), but the try/catch here
 * guards the contract anyway -- an unexpected throw is a transport failure
 * exactly like the unreachable `ok:false` shape, not a validation error.
 */
export async function answerGate(
  gateId: string,
  answers: GateAnswers,
  io: AnswerGateIo
): Promise<AnswerGateResult> {
  if (!io.isAnswerable(gateId)) return { kind: 'not-found' };

  let res: Awaited<ReturnType<AnswerGateIo['gateAnswer']>>;
  try {
    res = await io.gateAnswer({ id: gateId, answers, by: 'board' });
  } catch (err) {
    return {
      kind: 'unreachable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok || !res.data) {
    const message = res.error ?? 'gate:answer failed with no error detail';
    if (isMissingGateError(message)) return { kind: 'not-found' };
    if (isUnreachableError(message))
      return { kind: 'unreachable', reason: message };
    return { kind: 'invalid', reason: message };
  }

  return res.data.conflict
    ? { kind: 'conflict', row: res.data.row }
    : { kind: 'ok' };
}
