import type { GateQuestion } from '@mattstack/rt-client';
import { domainForKind } from './kinds';
import { displayForValue, type GateOptionDisplay } from './options';
import { unwrapGateAnswer, type GateAnswers } from './payload';

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
  question: string;
  answers: GateOptionDisplay[];
  note?: string;
  decidedBy: string | null;
  at: number | null;
}

export interface GateSummary {
  chip: string;
  detail: GateSummaryDetailRow[];
}

/** The `by` value a pane stamps when it answers its own gate (rt-client's
    GATE_BY_PANE) -- the unmarked case, so only other deciders get called
    out on the chip. String literal rather than an rt-client value import:
    the core entry must stay runtime-free of rt-client. */
const BY_PANE = 'pane';

const VERB_VALUE = /^([a-z][a-z-]*):(.+)$/;

const VERB_PLURALS: Record<string, string> = {
  reply: 'replies',
  fix: 'fixes',
  skip: 'skips',
};

/** "1 fix" / "2 replies" per verb for an all-verb-shaped multi answer, with
    skips left unsaid unless nothing else was chosen; null when any value is
    not verb-shaped (the caller then lists labels instead). */
function verbCounts(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const m = VERB_VALUE.exec(v);
    if (!m) return null;
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [verb, count] of counts) {
    if (verb === 'skip') continue;
    parts.push(
      count === 1 ? `1 ${verb}` : `${count} ${VERB_PLURALS[verb] ?? `${verb}s`}`
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'all skipped';
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
      question: q.label,
      answers:
        values.length > 0
          ? values.map(v => displayForValue(v, q.options))
          : [{ text: '(none)' }],
      ...(unwrapped?.note !== undefined ? { note: unwrapped.note } : {}),
      decidedBy,
      at,
    };
  });

  const head = [domainForKind(row.kind) ?? row.kind, subjectRef(row.subject)]
    .filter((part): part is string => part !== null)
    .join(' ');

  const fragments: string[] = [];
  if (row.status === 'closed') {
    fragments.push(row.closedReason ?? 'closed');
  } else {
    const markers: string[] = [];
    for (const q of row.questions) {
      const raw = answers?.[q.id];
      if (raw === undefined) {
        if (q.multi && q.options.length === 0) markers.push('nothing posted');
        continue;
      }
      const { value } = unwrapGateAnswer(raw);
      if (Array.isArray(value)) {
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
  return { chip: `${head} · ${fragments.join(', ')}${bySuffix}`, detail };
}
