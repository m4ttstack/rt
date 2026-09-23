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
  decidedBy: string | null;
  at: number | null;
}

export interface GateSummary {
  chip: string;
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

/** A respond-post thread question: a multi of exactly `post:<id>` and
    `resolve:<id>`. Its answers add up across threads on the chip. */
function isPostPair(q: GateQuestion): boolean {
  if (!q.multi || q.options.length !== 2) return false;
  const values = q.options.map(o => (typeof o === 'string' ? o : o.value));
  const post = values.find(v => v.startsWith('post:'));
  return post !== undefined && values.includes(`resolve:${post.slice(5)}`);
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
    const pairs = row.questions.filter(isPostPair);
    if (pairs.length > 0) {
      let posted = 0;
      let resolved = 0;
      for (const q of pairs) {
        const raw = answers?.[q.id];
        const value = raw === undefined ? [] : unwrapGateAnswer(raw).value;
        const picked = Array.isArray(value) ? value : [value];
        if (picked.some(v => v.startsWith('post:'))) posted++;
        if (picked.some(v => v.startsWith('resolve:'))) resolved++;
      }
      fragments.push(
        [
          `${posted} posted`,
          resolved > 0 ? `${resolved} resolved` : null,
          posted < pairs.length ? `${pairs.length - posted} held` : null,
        ]
          .filter(Boolean)
          .join(', ')
      );
    }
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
  return { chip: `${head} · ${fragments.join(', ')}${bySuffix}`, detail };
}
