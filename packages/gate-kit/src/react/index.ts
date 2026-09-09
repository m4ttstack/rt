import type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire';

import type { GateQuestion } from '@mattstack/rt-client';
import {
  CODE_CHANGES_QUESTION_ID,
  codeChangesHidden,
  effectiveSelections,
} from '../collapse';
import { optionDisplayFor, optionValue } from '../options';
import {
  gateAnswerPayload,
  type GateAnswers,
  type GateSelections,
} from '../payload';

export { Questionnaire } from '@shadcn/react/questionnaire';
export type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire';
export { gateDraftKey, useGateDraft } from './draft';
export type { GateDraft } from './draft';

/** The slice of a gate the adapter needs; both apps' row shapes satisfy it
    structurally. */
export interface GateForItems {
  kind: string;
  questions: GateQuestion[];
}

export interface GateItemChoice {
  value: string;
  /** Display text via the option transform (label, or the verb-token
      compaction for bare strings). Submission always uses `value`. */
  label: string;
  /** The full raw value when it differs from `label` -- title/tooltip
      material, mirroring GateOptionDisplay.title. */
  description?: string;
  /** The agent's pick; render a badge. */
  recommended?: boolean;
}

export interface GateItemDisplay {
  name: string;
  prompt: string;
  multiple: boolean;
  required: boolean;
  choices: GateItemChoice[];
}

export interface GateItems {
  /** For Questionnaire.Root's `items` prop (logical order and validation). */
  items: QuestionnaireItemDefinition[];
  /** One entry per item, same order, carrying what a styled layer renders. */
  display: GateItemDisplay[];
}

/**
 * Gate questions to questionnaire items plus display data. The respond
 * collapse is STRUCTURAL here: the code-changes item is excluded from the
 * returned items until some other selection carries a `fix:` value, so
 * inclusion is reactive to `selections` and the hidden question never
 * renders at all. Zero-option questions are excluded too -- they have
 * nothing to collect and gateAnswerPayload already exempts them. Every
 * included item is required: strict option membership means an
 * option-carrying question must be answered from its own set (never a
 * freeform QuestionnaireInput).
 */
export function gateItems(
  gate: GateForItems,
  selections: GateSelections
): GateItems {
  const hidden = codeChangesHidden(gate.kind, gate.questions, selections);
  const visible = gate.questions.filter(
    q => q.options.length > 0 && !(hidden && q.id === CODE_CHANGES_QUESTION_ID)
  );
  const display: GateItemDisplay[] = visible.map(q => ({
    name: q.id,
    prompt: q.label,
    multiple: q.multi,
    required: true,
    choices: q.options.map(opt => {
      const d = optionDisplayFor(opt);
      return {
        value: optionValue(opt),
        label: d.text,
        ...(d.title !== undefined ? { description: d.title } : {}),
        ...(d.recommended ? { recommended: true } : {}),
      };
    }),
  }));
  return {
    items: display.map(d => ({
      name: d.name,
      required: d.required,
      choices: d.choices.map(c => ({ value: c.value })),
    })),
    display,
  };
}

/** The form field a question's optional note travels in; the cards name
    their note inputs with it and `answersFromForm` reads it back. */
export function noteFieldName(questionId: string): string {
  return `${questionId}:note`;
}

/**
 * The native form back to one atomic wire answer: `get` for a single-select,
 * `getAll` for a multi, then through effectiveSelections (the structurally
 * excluded code-changes item submits the sentinel) into gateAnswerPayload.
 * Null while any required question lacks an answer, so a caller can refuse
 * the submit on that alone. A question whose note field is non-empty after
 * trimming submits `{ value, note }`; every other question submits the bare
 * selection, and the injected sentinel never carries a note.
 */
export function answersFromForm(
  gate: GateForItems,
  formData: FormData
): { answers: GateAnswers } | null {
  const selections: GateSelections = {};
  for (const q of gate.questions) {
    if (q.multi) {
      const values = formData
        .getAll(q.id)
        .filter((v): v is string => typeof v === 'string');
      if (values.length > 0) selections[q.id] = values;
    } else {
      const value = formData.get(q.id);
      if (typeof value === 'string' && value.length > 0)
        selections[q.id] = value;
    }
  }
  const payload = gateAnswerPayload(
    gate.questions,
    effectiveSelections(gate.kind, gate.questions, selections)
  );
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const raw = id in selections ? formData.get(noteFieldName(id)) : null;
    const note = typeof raw === 'string' ? raw.trim() : '';
    answers[id] = note.length > 0 ? { value, note } : value;
  }
  return { answers };
}
