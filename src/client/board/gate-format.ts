import type { GateAnswers, GateAnswerValue, GateQuestion } from "../../gates/store.ts";

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

export interface UnwrappedGateAnswer {
  value: string | string[];
  note?: string;
}

/**
 * Normalizes one answer's wire value into a uniform shape a renderer can
 * read without its own type check: a bare option string/array passes
 * through as `{value}`, and the wrapper's note form (`{value, note}`)
 * unwraps to the same shape with `note` carried alongside. GateCard uses
 * this so the object form (posted whenever a human's pane answer carries
 * free text) renders instead of crashing React on an object child.
 */
export function unwrapGateAnswer(raw: GateAnswerValue): UnwrappedGateAnswer {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
    return { value: raw.value, note: raw.note };
  }
  return { value: raw };
}

export interface GateAnswerConflict {
  answers: GateAnswers;
  by: string;
}

/**
 * Parses the body of a 409 `/gate/answer` response (`{ok:false, conflict:true,
 * row}`) into the winning answer GateCard renders in place of the generic
 * retry-failure text -- a 409 means an answer WAS recorded, just not this
 * caller's. Tolerant of a missing or malformed row: the daemon's CAS win is
 * real even if the body somehow lost its answer, so this never throws.
 */
export function parseConflictResponse(body: unknown): GateAnswerConflict {
  const row = (body as { row?: { answer?: { answers?: GateAnswers; by?: string } } } | null)?.row;
  return { answers: row?.answer?.answers ?? {}, by: row?.answer?.by ?? "" };
}
