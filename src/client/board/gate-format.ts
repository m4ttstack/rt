import type { GateQuestion } from "../../gates/store.ts";

/** UI-collected picks, keyed by question id: an array for a `multi`
    question's checked options, a bare string for a single-select's radio. */
export type GateSelections = Record<string, string | string[]>;

/** The subset of a gate GateCard needs to shape a payload: where to post the
    answer, and which questions must be answered. */
export interface GateForAnswer {
  mrUrl: string;
  questions: GateQuestion[];
}

export interface GateAnswerPayload {
  mrUrl: string;
  answers: GateSelections;
}

/**
 * Shapes UI-collected selections into the `/gate/answer` POST body: a
 * `multi` question's selection becomes a string array, a single-select's
 * becomes a bare string. Every question with at least one option is
 * required -- the moment one's selection is missing or empty, this returns
 * null instead of a partial payload, so a caller can disable submit (or
 * skip the fetch) on that alone rather than let an incomplete answer reach
 * the server. A zero-option question (e.g. a `tiers` question when a clean
 * review reports no severity levels) has nothing to select, so it is
 * excluded from the required set entirely -- otherwise a clean review's
 * gate would have no possible answer and could never be closed.
 */
export function gateAnswerPayload(gate: GateForAnswer, selections: GateSelections): GateAnswerPayload | null {
  const answers: GateSelections = {};
  for (const q of gate.questions) {
    if (q.options.length === 0) continue;
    const value = selections[q.id];
    if (q.multi) {
      if (!Array.isArray(value) || value.length === 0) return null;
      answers[q.id] = value;
    } else {
      if (typeof value !== "string" || value.length === 0) return null;
      answers[q.id] = value;
    }
  }
  return { mrUrl: gate.mrUrl, answers };
}
