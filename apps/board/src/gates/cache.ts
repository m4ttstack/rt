import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { DoctorStatus } from '../doctor-state.ts';
import type { RespondStatus } from '../respond-state.ts';
import type { ReviewStatus } from '../review-state.ts';
import type { GateEventFrame } from './ingest.ts';
import type {
  GateAnswers,
  GateOption,
  GateQuestion,
  GateRow,
} from './store.ts';
import { domainForKind } from './sweep.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isGateOption(v: unknown): v is GateOption {
  if (typeof v === 'string') return true;
  return (
    isRecord(v) && typeof v.value === 'string' && typeof v.label === 'string'
  );
}

/** `opened` payloads come straight off the bus with no schema enforcement
    upstream -- a malformed question would otherwise ride an `as
    GateQuestion[]` cast all the way to optionValue/rendering. Anything not
    shaped like `{id, label, options}` is dropped rather than coerced, since
    a half-built question breaks the renderer worse than a missing one. */
function sanitizeQuestions(
  gateId: string,
  questions: unknown[]
): GateQuestion[] {
  const out: GateQuestion[] = [];
  for (const q of questions) {
    if (
      isRecord(q) &&
      typeof q.id === 'string' &&
      typeof q.label === 'string' &&
      Array.isArray(q.options) &&
      q.options.every(isGateOption)
    ) {
      out.push({
        id: q.id,
        label: q.label,
        multi: Boolean(q.multi),
        options: q.options as GateOption[],
      });
    } else {
      console.error(
        `gate cache: dropping malformed question on gate ${gateId}`
      );
    }
  }
  return out;
}

// The facility's own bus topics, distinct from the board's legacy
// `board/gate/opened|answered/<id>` bridge topic (see gates/ingest.ts).
const GATE_TOPIC_RE =
  /^gate\/(opened|answered|parked|closed|released)\/([^/]+)$/;

/** Composite key: a subject can now carry more than one live gate at once
    (review-post alongside a respond/doctor kind), so `subject` alone would
    clobber one kind with another -- see gates-cache.test.ts's two-kinds-one-
    subject coverage. */
function cacheKey(subject: string, kind: string): string {
  return `${subject}::${kind}`;
}

/**
 * In-memory cache of the board's gate rows, keyed by facility `subject`
 * (`mr:<mrUrl>`) AND `kind`. Fed by a boot `gateList` reconcile (authoritative
 * snapshot, see `reconcileGatesOnBoot` in ingest.ts) and by individual
 * `gate/**` bus frames relayed through `ingestRelayFrame` (low-latency deltas).
 */
export class GateCache {
  private readonly byKey = new Map<string, FacilityGateRow>();

  /** Set/replace one row wholesale, keyed by its subject+kind. */
  applyRow(row: FacilityGateRow): void {
    this.byKey.set(cacheKey(row.subject, row.kind), row);
  }

  /** `gateList`'s result is authoritative for every subject+kind it names; a
      pair absent from `rows` is left as-is (not deleted) -- it just means
      this reconcile's scope didn't cover it. */
  reconcile(rows: FacilityGateRow[]): void {
    for (const row of rows) this.applyRow(row);
  }

  /** One subject's row for one kind, or undefined when that kind has no live
      row on this subject right now. */
  get(subject: string, kind: string): FacilityGateRow | undefined {
    return this.byKey.get(cacheKey(subject, kind));
  }

  /** Every kind's row for one subject, in no particular order. */
  rowsFor(subject: string): FacilityGateRow[] {
    return this.rows().filter(row => row.subject === subject);
  }

  rows(): FacilityGateRow[] {
    return [...this.byKey.values()];
  }

  /** Applies one `gate/**` bus frame. `opened` carries everything needed to
      build a row from scratch, so it upserts (also how a re-review's fresh
      id replaces a stale answered row for the same subject+kind). Every
      other kind only patches a row the cache already has -- their payloads
      are thinner than a full row, and a frame for an id the cache never saw
      (an unknown gate, or a reconcile the cache hasn't caught up to yet) is
      dropped silently rather than fabricated; the next `reconcile` fills it. */
  applyEvent(frame: GateEventFrame): void {
    const match = GATE_TOPIC_RE.exec(frame.topic);
    if (!match) return;
    const kind = match[1] as
      'opened' | 'answered' | 'parked' | 'closed' | 'released';
    if (!isRecord(frame.payload)) return;
    const payload = frame.payload;

    if (kind === 'opened') {
      this.applyOpened(payload);
      return;
    }
    this.patchExisting(kind, payload);
  }

  private applyOpened(payload: Record<string, unknown>): void {
    const { id, subject, questions, meta } = payload;
    if (typeof id !== 'string' || !id) return;
    if (typeof subject !== 'string' || !subject) return;
    if (!Array.isArray(questions)) return;

    this.applyRow({
      id,
      subject,
      kind: typeof payload.kind === 'string' ? payload.kind : 'review-post',
      questions: sanitizeQuestions(id, questions),
      meta: isRecord(meta) ? meta : null,
      status: 'open',
      answer: null,
      // The daemon's opened event carries no openedAt (handlers/gate.ts's
      // eventPayload doesn't emit one) -- receipt time is the closest
      // approximation the cache can make.
      openedAt: Date.now(),
      parkedAt: null,
      closedAt: null,
      closedReason: null,
      agent: typeof payload.agent === 'string' ? payload.agent : null,
      pane: typeof payload.paneId === 'string' ? payload.paneId : null,
      nudge: null,
      delivery: null,
      released: false,
      context: typeof payload.context === 'string' ? payload.context : null,
      origin: isRecord(payload.origin)
        ? (payload.origin as FacilityGateRow['origin'])
        : null,
    });
  }

  /** Thin patches (answered/parked/closed/released) carry only an id --
      finding the row by id (not subject+kind) is what keeps this correct
      regardless of how the row is keyed. */
  private findById(id: string): FacilityGateRow | undefined {
    for (const row of this.byKey.values()) {
      if (row.id === id) return row;
    }
    return undefined;
  }

  private patchExisting(
    kind: 'answered' | 'parked' | 'closed' | 'released',
    payload: Record<string, unknown>
  ): void {
    const { id } = payload;
    if (typeof id !== 'string' || !id) return;
    const existing = this.findById(id);
    if (!existing) return; // unknown id: drop silently, next reconcile fills it

    if (kind === 'answered') {
      const { answers, by } = payload;
      if (!isRecord(answers)) return;
      this.applyRow({
        ...existing,
        status: 'answered',
        answer: {
          answers: answers as NonNullable<FacilityGateRow['answer']>['answers'],
          by: typeof by === 'string' ? by : '',
          // Not on the wire event either -- see the opened-frame note above.
          answeredAt: Date.now(),
        },
        pane:
          typeof payload.paneId === 'string' ? payload.paneId : existing.pane,
      });
    } else if (kind === 'parked') {
      this.applyRow({ ...existing, status: 'parked', parkedAt: Date.now() });
    } else if (kind === 'closed') {
      this.applyRow({
        ...existing,
        status: 'closed',
        closedAt: Date.now(),
        closedReason: isClosedReason(payload.reason)
          ? payload.reason
          : existing.closedReason,
      });
    } else {
      this.applyRow({ ...existing, released: true });
    }
  }
}

function isClosedReason(v: unknown): v is FacilityGateRow['closedReason'] {
  return v === 'abandoned' || v === 'superseded' || v === 'pruned';
}

function isTerminal(status: string | undefined): boolean {
  return status === 'done' || status === 'error';
}

type GateHost = {
  review?: { status: ReviewStatus };
  respond?: { status: RespondStatus };
  doctor?: { status: DoctorStatus };
};

/** Which lifecycle state an answered row of this kind is scoped to. Unknown
    kinds fall back to the review state -- the only default that existed
    before kinds shipped, kept as a safe catch-all rather than never
    expiring. */
function isAnsweredRowTerminal(kind: string, mr: GateHost): boolean {
  if (kind === 'respond-plan' || kind === 'respond-post')
    return isTerminal(mr.respond?.status);
  if (kind === 'doctor-escalation') return isTerminal(mr.doctor?.status);
  return isTerminal(mr.review?.status);
}

/** Attach each MR's cached gate rows (if any) as `gates`, always an array
    (empty when there's nothing to show) so the client can render "no gates"
    without an `in` check. An ANSWERED row is scoped to its OWN KIND's
    non-terminal state -- never to `released`, which stays false forever for
    the board's unattended, nudge-less gates and would otherwise badge every
    finished run "answered" permanently. A CLOSED row never renders (its
    lifecycle already ended). */
export function attachGates<T extends { webUrl?: string | null } & GateHost>(
  mrs: T[],
  cache: GateCache
): Array<T & { gates: GateRow[] }> {
  return mrs.map(mr => {
    if (!mr.webUrl) return { ...mr, gates: [] };
    const rows = cache.rowsFor(`mr:${mr.webUrl}`);
    const gates: GateRow[] = [];
    for (const row of rows) {
      const label =
        typeof row.meta?.label === 'string' ? row.meta.label : row.kind;
      if (row.status === 'open' || row.status === 'parked') {
        gates.push({
          gateId: row.id,
          kind: row.kind,
          label,
          status: row.status,
          openedAt: row.openedAt,
          questions: row.questions as GateQuestion[],
          context: row.context ?? undefined,
          origin: row.origin ?? undefined,
          domain: domainForKind(row.kind),
        });
      } else if (
        row.status === 'answered' &&
        !isAnsweredRowTerminal(row.kind, mr)
      ) {
        gates.push({
          gateId: row.id,
          kind: row.kind,
          label,
          status: 'answered',
          openedAt: row.openedAt,
          questions: row.questions as GateQuestion[],
          answers: row.answer?.answers as GateAnswers | undefined,
          context: row.context ?? undefined,
          origin: row.origin ?? undefined,
          domain: domainForKind(row.kind),
        });
      }
    }
    return { ...mr, gates };
  });
}
