import type { GateAnswer, GateQuestion } from '@mattstack/rt-client';

export type GateAnswers = GateAnswer['answers'];

/** One answer's wire value: a bare option string/array, or the `{value,
    note}` object the wrapper's note form posts -- the daemon stores and
    emits both verbatim. See `unwrapGateAnswer` for the renderer. */
export type GateAnswerValue = GateAnswers[string];

/** UI-collected picks, keyed by question id: an array for a `multi`
    question's checked options, a bare string for a single-select's radio. */
export type GateSelections = Record<string, string | string[]>;

/**
 * Shapes UI-collected selections into an answer body: a `multi` question's
 * selection becomes a string array, a single-select's becomes a bare string.
 * A single-select is required, and a multi question must be PRESENT: the
 * moment either is missing (or a single-select is empty), this returns null
 * instead of a partial payload, so a caller can disable submit (or skip the
 * fetch) on that alone rather than let an incomplete answer reach the
 * server. A multi question's explicit empty array passes through as a
 * deliberate "none" -- the daemon rejects a missing question id but records
 * `[]`, and the consumers already read an empty tier/reply set as
 * nothing-to-post. A zero-option question (e.g. a `tiers` question when a
 * clean review reports no severity levels) has nothing to select, so it is
 * excluded entirely -- otherwise a gate with no possible answer could never
 * be closed.
 */
export function gateAnswerPayload(
  questions: GateQuestion[],
  selections: GateSelections
): { answers: GateSelections } | null {
  const answers: GateSelections = {};
  for (const q of questions) {
    if (q.options.length === 0) continue;
    const value = selections[q.id];
    if (q.multi) {
      if (!Array.isArray(value)) return null;
      answers[q.id] = value;
    } else {
      if (typeof value !== 'string' || value.length === 0) return null;
      answers[q.id] = value;
    }
  }
  return { answers };
}

export interface UnwrappedGateAnswer {
  value: string | string[];
  note?: string;
}

/**
 * Normalizes one answer's wire value into a uniform shape a renderer can
 * read without its own type check: a bare option string/array passes through
 * as `{value}`, and the wrapper's note form (`{value, note}`) unwraps to the
 * same shape with `note` carried alongside -- the object form (posted
 * whenever a human's pane answer carries free text) must render instead of
 * crashing React on an object child.
 */
export function unwrapGateAnswer(raw: GateAnswerValue): UnwrappedGateAnswer {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'value' in raw
  ) {
    return { value: raw.value, note: raw.note };
  }
  return { value: raw };
}
