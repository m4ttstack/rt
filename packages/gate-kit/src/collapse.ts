import type { GateQuestion } from '@mattstack/rt-client';
import { optionValue } from './options';
import type { GateSelections } from './payload';

export const RESPOND_PLAN_KIND = 'respond-plan';
export const CODE_CHANGES_QUESTION_ID = 'code-changes';
export const CODE_CHANGES_SENTINEL = 'skip';

/**
 * A respond-plan gate's code-changes question is skippable by design once no
 * other question's answer contains a `fix:`-prefixed selection -- the gate's
 * own submit sentinel stands in for it while hidden. The collapse keys off
 * the gate's own option set: only a respond-plan gate whose code-changes
 * question carries the sentinel participates, so old gates render exactly as
 * before.
 */
export function codeChangesHidden(
  kind: string,
  questions: GateQuestion[],
  selections: GateSelections
): boolean {
  if (kind !== RESPOND_PLAN_KIND) return false;
  const q = questions.find(x => x.id === CODE_CHANGES_QUESTION_ID);
  if (!q || !q.options.some(o => optionValue(o) === CODE_CHANGES_SENTINEL))
    return false;
  for (const [qid, sel] of Object.entries(selections)) {
    if (qid === CODE_CHANGES_QUESTION_ID) continue;
    const values = Array.isArray(sel) ? sel : [sel];
    if (values.some(v => typeof v === 'string' && v.startsWith('fix:')))
      return false;
  }
  return true;
}

/** The selections a submission should actually carry: while the code-changes
    question is hidden its sentinel is merged in, so the one atomic answer
    stays complete without the user ever seeing the question. Returns the
    input object untouched (same reference) when nothing is hidden. */
export function effectiveSelections(
  kind: string,
  questions: GateQuestion[],
  selections: GateSelections
): GateSelections {
  if (!codeChangesHidden(kind, questions, selections)) return selections;
  const q = questions.find(x => x.id === CODE_CHANGES_QUESTION_ID);
  const sentinel = q?.multi ? [CODE_CHANGES_SENTINEL] : CODE_CHANGES_SENTINEL;
  return { ...selections, [CODE_CHANGES_QUESTION_ID]: sentinel };
}
