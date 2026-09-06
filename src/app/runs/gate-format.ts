import {
  gateOptionValue,
  type GateAnswer,
  type GateOption,
  type GateQuestion,
} from '@mattstack/rt-client';

/** UI-collected picks, keyed by question id: an array for a `multi`
    question's checked options, a bare string for a single-select's radio. */
export type GateSelections = Record<string, string | string[]>;

/** One answer's wire value, structurally what the daemon's `GateAnswer`
    stores per question -- a bare option string/array, or the wrapper's
    `{value, note}` note form. */
export type GateAnswerValue = GateAnswer['answers'][string];
export type GateAnswers = GateAnswer['answers'];

/**
 * Shapes UI-collected selections into the `POST /api/gates/:id/answer` body:
 * a `multi` question's selection becomes a string array, a single-select's
 * becomes a bare string. Every question with at least one option is
 * required -- the moment one's selection is missing or empty, this returns
 * null instead of a partial payload, so a caller can disable submit (or
 * skip the fetch) on that alone rather than let an incomplete answer reach
 * the server. A zero-option question has nothing to select, so it is
 * excluded from the required set entirely -- otherwise a question with no
 * possible answer could never be closed.
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
      if (!Array.isArray(value) || value.length === 0) return null;
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
 * read without its own type check: a bare option string/array passes
 * through as `{value}`, and the wrapper's note form (`{value, note}`)
 * unwraps to the same shape with `note` carried alongside. GateCard uses
 * this so the object form (posted whenever a human's pane answer carries
 * free text) renders instead of crashing React on an object child.
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

export interface GateAnswerConflict {
  answers: GateAnswers;
  by: string;
}

/**
 * Parses the body of a 409 `/api/gates/:id/answer` response (`{row}`, the
 * daemon's CAS winner) into the winning answer GateCard renders in place of
 * the generic retry-failure text -- a 409 means an answer WAS recorded, just
 * not this caller's. Tolerant of a missing or malformed row: the daemon's
 * CAS win is real even if the body somehow lost its answer, so this never
 * throws.
 */
export function parseConflictResponse(body: unknown): GateAnswerConflict {
  const row = (
    body as { row?: { answer?: { answers?: GateAnswers; by?: string } } } | null
  )?.row;
  return { answers: row?.answer?.answers ?? {}, by: row?.answer?.by ?? '' };
}

export const optionValue = gateOptionValue;

export function optionLabel(o: GateOption): string {
  return typeof o === 'string' ? o : o.label || o.value;
}

export function displayValueLabel(value: string, options: GateOption[]): string {
  const match = options.find(o => optionValue(o) === value);
  return match !== undefined ? optionLabel(match) : value;
}

export const RESPOND_PLAN_KIND = 'respond-plan';
export const CODE_CHANGES_QUESTION_ID = 'code-changes';
export const CODE_CHANGES_SENTINEL = 'skip';

/**
 * A respond-plan gate's code-changes question is skippable by design once no
 * other question's answer contains a `fix:`-prefixed selection -- the
 * gate's own submit sentinel stands in for it while hidden, so this both
 * decides visibility and tells the caller what to substitute.
 */
export function codeChangesHidden(
  kind: string,
  questions: GateQuestion[],
  selections: GateSelections
): boolean {
  if (kind !== RESPOND_PLAN_KIND) return false;
  const q = questions.find(x => x.id === CODE_CHANGES_QUESTION_ID);
  if (!q || !q.options.some(o => optionValue(o) === CODE_CHANGES_SENTINEL)) return false;
  for (const [qid, sel] of Object.entries(selections)) {
    if (qid === CODE_CHANGES_QUESTION_ID) continue;
    const values = Array.isArray(sel) ? sel : [sel];
    if (values.some(v => typeof v === 'string' && v.startsWith('fix:'))) return false;
  }
  return true;
}
