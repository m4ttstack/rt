import type { GateAnswers } from './payload';

export interface AnswerOutcome {
  kind: 'won' | 'lost';
  /** The row the surface's answer response carried, verbatim -- the winning
      row on a loss, the answered row on a console-shaped win, null when the
      response body had none (board's win shape is a bare {ok:true}). */
  row: unknown;
  /** Tolerant extraction of the winning answers/author: a loss is real even
      if the body somehow lost its answer, so these default to {}/'' rather
      than throwing. Meaningful on 'lost'; empty on a row-less win. */
  answers: GateAnswers;
  by: string;
}

/**
 * Normalizes the two answer-response shapes the surfaces produce today into
 * one CAS outcome: console answers with HTTP 200 {row} / 409 {row}; the
 * board answers with {ok:true} / 409 {ok:false, conflict:true, row}. Either
 * signal (status 409, or a truthy conflict flag) means somebody else's
 * answer won.
 */
export function resolveAnswerOutcome(
  status: number,
  body: unknown
): AnswerOutcome {
  const b = body as {
    conflict?: unknown;
    row?: { answer?: { answers?: GateAnswers; by?: string } } | null;
  } | null;
  const row = b?.row ?? null;
  return {
    kind: status === 409 || b?.conflict === true ? 'lost' : 'won',
    row,
    answers: row?.answer?.answers ?? {},
    by: row?.answer?.by ?? '',
  };
}
