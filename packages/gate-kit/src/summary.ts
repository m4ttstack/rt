// GATE_BY_PANE is not yet on /gate (RT-180); migrate this line once it
// lands.
// eslint-disable-next-line no-restricted-imports
import type { GATE_BY_PANE } from '@mattstack/rt-client';
import { domainForKind } from './kinds';
import { displayForValue, type GateOptionDisplay } from './options';
import { unwrapGateAnswer, type GateAnswers } from './payload';
import type { GateQuestion } from './types';

/** Structural subset of rt-client's GateRow: console passes its rows
    directly; the board passes its client projection. `status`/`closedReason`
    stay open strings so either surface's narrower unions assign cleanly. */
export interface GateSummaryInput {
  subject?: string;
  kind: string;
  status: string;
  closedReason?: string | null;
  questions: GateQuestion[];
  answer?: { answers?: GateAnswers; by?: string; answeredAt?: number } | null;
}

export interface GateSummaryDetailRow {
  id: string;
  question: string;
  answers: GateOptionDisplay[];
  note?: string;
  text?: string;
  decidedBy: string | null;
  at: number | null;
}

export interface GateSummary {
  chip: string;
  /** The answers tallied for a glance ("5 findings, comment"), with no
      kind and subject head and no decider suffix. */
  outcome: string;
  detail: GateSummaryDetailRow[];
}

/** The `by` value a pane stamps when it answers its own gate -- the unmarked
    case, so only other deciders get called out on the chip. Typed against
    rt-client's own GATE_BY_PANE via a type-only import so a value change
    there is a compile error here, while the core entry stays runtime-free
    of rt-client. */
const BY_PANE: typeof GATE_BY_PANE = 'pane';

const VERB_VALUE = /^([a-z][a-z-]*):(.+)$/;

const VERB_PLURALS: Record<string, string> = {
  reply: 'replies',
  fix: 'fixes',
  skip: 'skips',
};

/** "1 fix" / "2 replies" per verb for an all-verb-shaped multi answer, with
    skips left unsaid unless nothing else was chosen; null when any value is
    not verb-shaped (the caller then lists labels instead). `edited` appends
    " (N edited)" to the reply part only, for callers that count edited
    single-select reply answers; the chip's own callers pass none. */
function verbCounts(values: string[], edited = 0): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const m = VERB_VALUE.exec(v);
    if (!m) return null;
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [verb, count] of counts) {
    if (verb === 'skip') continue;
    const label =
      count === 1
        ? `1 ${verb}`
        : `${count} ${VERB_PLURALS[verb] ?? `${verb}s`}`;
    parts.push(
      verb === 'reply' && edited > 0 ? `${label} (${edited} edited)` : label
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'all skipped';
}

/** A respond-post thread question: a multi of exactly `post:<id>` and
    `resolve:<id>`. Its answers add up across threads on the chip. */
function isPostPair(q: GateQuestion): boolean {
  if (!q.multi || q.options.length !== 2) return false;
  const values = q.options.map(o => (typeof o === 'string' ? o : o.value));
  const post = values.find(v => v.startsWith('post:'));
  return post !== undefined && values.includes(`resolve:${post.slice(5)}`);
}

/** "2 posted (1 edited), 1 resolved, 1 held" across a respond-post gate's
    thread questions; null when the gate has none. */
function postPairSummary(
  pairs: GateQuestion[],
  answers: GateAnswers | undefined
): string | null {
  if (pairs.length === 0) return null;
  let posted = 0;
  let edited = 0;
  let resolved = 0;
  for (const q of pairs) {
    const raw = answers?.[q.id];
    const unwrapped = raw === undefined ? null : unwrapGateAnswer(raw);
    const value = unwrapped?.value ?? [];
    const picked = Array.isArray(value) ? value : [value];
    if (picked.some(v => v.startsWith('post:'))) {
      posted++;
      if (unwrapped?.text !== undefined) edited++;
    }
    if (picked.some(v => v.startsWith('resolve:'))) resolved++;
  }
  return [
    edited > 0 ? `${posted} posted (${edited} edited)` : `${posted} posted`,
    resolved > 0 ? `${resolved} resolved` : null,
    posted < pairs.length ? `${pairs.length - posted} held` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** "1 finding" / "5 findings" from a question-id noun, which may already be
    plural. */
function nounCount(noun: string, n: number): string {
  const one = noun.endsWith('ies')
    ? `${noun.slice(0, -3)}y`
    : noun.replace(/s$/, '');
  const many = noun.endsWith('s')
    ? noun
    : one.endsWith('y')
      ? `${one.slice(0, -1)}ies`
      : `${one}s`;
  return `${n} ${n === 1 ? one : many}`;
}

type OutcomeSlot = { text: string } | { verbs: true } | { noun: string };

/** The outcome reads at a glance where the chip lists labels: verb picks
    from every question add up into one tally, a multi's other picks count
    under its noun, a single pick keeps its label. Each tally sits where its
    first question does; "nothing posted" stays last, as on the chip. */
function compactOutcome(
  questions: GateQuestion[],
  answers: GateAnswers | undefined,
  pairs: GateQuestion[],
  pairSummary: string | null
): string {
  const slots: OutcomeSlot[] =
    pairSummary === null ? [] : [{ text: pairSummary }];
  const verbs: string[] = [];
  let editedReplies = 0;
  const nouns = new Map<string, number>();
  for (const q of questions) {
    if (pairs.includes(q)) continue;
    const raw = answers?.[q.id];
    if (raw === undefined && !(q.multi && q.options.length === 0)) continue;
    const unwrapped = raw === undefined ? null : unwrapGateAnswer(raw);
    const value = unwrapped === null ? [] : unwrapped.value;
    const values = Array.isArray(value) ? value : [value];
    const picked = values.filter(v => VERB_VALUE.test(v));
    const plain = values.filter(v => !VERB_VALUE.test(v));
    if (picked.length > 0 && verbs.length === 0) slots.push({ verbs: true });
    verbs.push(...picked);
    if (!q.multi) {
      if (
        unwrapped?.text !== undefined &&
        picked.some(v => v.startsWith('reply:'))
      )
        editedReplies++;
      for (const v of plain)
        slots.push({ text: displayForValue(v, q.options).text });
      continue;
    }
    if (plain.length === 0 && picked.length > 0) continue;
    // Chunks of one list (`findings-1`, `findings-2`) share a noun, so they
    // count together.
    const noun = q.id.replace(/-\d+$/, '');
    if (!nouns.has(noun)) slots.push({ noun });
    nouns.set(noun, (nouns.get(noun) ?? 0) + plain.length);
  }
  const parts: string[] = [];
  let nothingPosted = false;
  for (const slot of slots) {
    if ('text' in slot) parts.push(slot.text);
    else if ('verbs' in slot)
      parts.push(verbCounts(verbs, editedReplies) ?? 'all skipped');
    else {
      const n = nouns.get(slot.noun) ?? 0;
      if (n > 0) parts.push(nounCount(slot.noun, n));
      else nothingPosted = true;
    }
  }
  if (nothingPosted) parts.push('nothing posted');
  return parts.length > 0 ? parts.join(', ') : 'no answers recorded';
}

function subjectRef(subject: string | undefined): string | null {
  if (subject === undefined) return null;
  if (subject.startsWith('mr:')) {
    const m = /(\d+)\/?$/.exec(subject.slice(3));
    return m ? `!${m[1]}` : null;
  }
  if (subject.startsWith('run:')) return `run ${subject.slice(4, 12)}`;
  return null;
}

/**
 * One compact line plus structured detail for a gate that is past answering
 * (answered, superseded, closed). The chip is derived from option LABELS,
 * never raw values: answered fragments come first in question order, then a
 * "nothing posted" marker per zero-option multi question (the clean-review
 * shape), then "· by <decider>" only when someone other than the origin
 * pane answered. A closed row chips its closedReason in place of answers.
 * Detail carries what the old large answered blocks showed, one row per
 * question, tolerant of missing answers.
 */
export function answeredGateSummary(row: GateSummaryInput): GateSummary {
  const answers = row.answer?.answers;
  const decidedBy = row.answer?.by ?? null;
  const at = row.answer?.answeredAt ?? null;

  const detail: GateSummaryDetailRow[] = row.questions.map(q => {
    const raw = answers?.[q.id];
    const unwrapped = raw !== undefined ? unwrapGateAnswer(raw) : null;
    const values =
      unwrapped === null
        ? []
        : Array.isArray(unwrapped.value)
          ? unwrapped.value
          : [unwrapped.value];
    return {
      id: q.id,
      question: q.label,
      answers:
        values.length > 0
          ? values.map(v => displayForValue(v, q.options))
          : [{ text: '(none)' }],
      ...(unwrapped?.note !== undefined ? { note: unwrapped.note } : {}),
      ...(unwrapped?.text !== undefined ? { text: unwrapped.text } : {}),
      decidedBy,
      at,
    };
  });

  const head = [domainForKind(row.kind) ?? row.kind, subjectRef(row.subject)]
    .filter((part): part is string => part !== null)
    .join(' ');

  const fragments: string[] = [];
  let outcome: string;
  if (row.status === 'closed') {
    fragments.push(row.closedReason ?? 'closed');
    outcome = fragments[0]!;
  } else {
    const markers: string[] = [];
    const pairs = row.questions.filter(isPostPair);
    const pairSummary = postPairSummary(pairs, answers);
    if (pairSummary !== null) fragments.push(pairSummary);
    outcome = compactOutcome(row.questions, answers, pairs, pairSummary);
    for (const q of row.questions) {
      if (pairs.includes(q)) continue;
      const raw = answers?.[q.id];
      if (raw === undefined) {
        if (q.multi && q.options.length === 0) markers.push('nothing posted');
        continue;
      }
      const { value } = unwrapGateAnswer(raw);
      if (Array.isArray(value)) {
        // An explicit [] answer (skipped multi) joins the zero-option shape's
        // marker rather than falling into verbCounts, whose empty-input
        // "all skipped" reads as a verb tally that never happened.
        if (value.length === 0) {
          markers.push('nothing posted');
          continue;
        }
        fragments.push(
          verbCounts(value) ??
            value.map(v => displayForValue(v, q.options).text).join(', ')
        );
      } else {
        fragments.push(displayForValue(value, q.options).text);
      }
    }
    fragments.push(...markers);
    if (fragments.length === 0) fragments.push('no answers recorded');
  }

  const by = row.answer?.by;
  const bySuffix =
    by !== undefined && by !== '' && by !== BY_PANE ? ` · by ${by}` : '';
  return {
    chip: `${head} · ${fragments.join(', ')}${bySuffix}`,
    outcome,
    detail,
  };
}
