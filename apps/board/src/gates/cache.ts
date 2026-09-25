import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { DoctorStatus } from '../doctor-state.ts';
import type { RespondStatus } from '../respond-state.ts';
import type { ReviewStatus } from '../review-state.ts';
import type { GateEventFrame } from './ingest.ts';
import { isLiveRunGate, normalizeMrUrl, type RunMrLinks } from './run-mr.ts';
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
        ...(typeof q.context === 'string' ? { context: q.context } : {}),
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
  /^gate\/(opened|answered|parked|closed|released|escalated)\/([^/]+)$/;

type PatchKind = 'answered' | 'parked' | 'closed' | 'released' | 'escalated';

/** Composite key: a subject can now carry more than one live gate at once
    (review-post alongside a respond/doctor kind), so `subject` alone would
    clobber one kind with another -- see gates-cache.test.ts's two-kinds-one-
    subject coverage. */
function cacheKey(subject: string, kind: string): string {
  return `${subject}::${kind}`;
}

/** A gate only moves forward through these, so an older copy of a known
    id (a resync read that raced a live patch) must never overwrite it. */
const STATUS_RANK: Record<FacilityGateRow['status'], number> = {
  open: 0,
  parked: 1,
  answered: 2,
  closed: 3,
};

/** Whole-row comparison: resync is the only path that updates fields no
    bus frame patches (delivery, execution, escalatedAt), so a narrower
    check would silently freeze them. */
function sameRow(a: FacilityGateRow, b: FacilityGateRow): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * In-memory cache of the board's gate rows, keyed by facility `subject`
 * (`mr:<mrUrl>`, or `run:<runId>` for a pipeline gate) AND `kind`. Fed by the
 * boot `gateList` reconciles (authoritative snapshots, see
 * `reconcileGatesOnBoot` in ingest.ts) and by individual `gate/**` bus frames
 * relayed through `ingestRelayFrame` (low-latency deltas).
 */
export class GateCache {
  private readonly byKey = new Map<string, FacilityGateRow>();

  /** Increases on every write that changes a row, so a caller can tell a
      no-op resync from one that found something. */
  revision = 0;

  /** A different gate for the same subject+kind replaces the cached one
      only when it is not older, so a reconcile listing several rounds keeps
      the latest whatever order the daemon returns them in. A same-id row
      never regresses status (a stale resync racing a live patch). */
  applyRow(row: FacilityGateRow): void {
    const key = cacheKey(row.subject, row.kind);
    const existing = this.byKey.get(key);
    if (existing && existing.id !== row.id && existing.openedAt > row.openedAt)
      return;
    if (
      existing &&
      existing.id === row.id &&
      STATUS_RANK[existing.status] > STATUS_RANK[row.status]
    )
      return;
    if (existing && sameRow(existing, row)) return;
    this.byKey.set(key, row);
    this.revision++;
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
    const kind = match[1] as PatchKind | 'opened';
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
    // A frame for a known id carries nothing the cached row lacks, and
    // replaying it would reset status, answer, and openedAt.
    if (this.findById(id)) return;

    // Receipt-time openedAt is always now, so applyRow's older-sibling
    // check can never drop this write for a genuinely different id.
    const kind =
      typeof payload.kind === 'string' ? payload.kind : 'review-post';
    this.applyRow({
      id,
      subject,
      kind,
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
      supersededBy: null,
      owner: typeof payload.owner === 'string' ? payload.owner : null,
      // The opened event predates supersession, escalation, and
      // consumption, so those start empty the way the daemon's fresh row does.
      escalatedAt: null,
      consumedAt: null,
      context: typeof payload.context === 'string' ? payload.context : null,
      origin: isRecord(payload.origin)
        ? (payload.origin as FacilityGateRow['origin'])
        : null,
    });
  }

  /** Thin patches (answered/parked/closed/released/escalated) carry only
      an id -- finding the row by id (not subject+kind) is what keeps this
      correct regardless of how the row is keyed. */
  private findById(id: string): FacilityGateRow | undefined {
    for (const row of this.byKey.values()) {
      if (row.id === id) return row;
    }
    return undefined;
  }

  private patchExisting(
    kind: PatchKind,
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
    } else if (kind === 'escalated') {
      this.applyRow({
        ...existing,
        escalatedAt: existing.escalatedAt ?? Date.now(),
        owner:
          typeof payload.owner === 'string' ? payload.owner : existing.owner,
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

/** `execution` isn't declared on the facility's own `GateRow` type yet (SDD
    executor-reconciler: the daemon emits it on the wire ahead of a
    rt-client republish) -- read it defensively off the row rather than
    widening the imported type. Exported so server.ts's retry-answerable
    check (an ANSWERED row with `execution === "unassigned"`) reads the
    same field the same way. */
export function cachedExecution(row: FacilityGateRow): GateRow['execution'] {
  const raw = (row as unknown as { execution?: unknown }).execution;
  return raw === 'unassigned' ? 'unassigned' : undefined;
}

/** Whether a cached row still has something to answer: the ordinary
    `open`/`parked` case, plus the retry path -- an already-ANSWERED row
    left `execution: "unassigned"` (the answer-time relaunch never ran) --
    the daemon accepts a same-answers repeat there, so the board must not
    404 it. Anything else (answered-and-executed, closed, unknown id) has
    nothing left to answer. */
export function isRowAnswerable(row: FacilityGateRow | undefined): boolean {
  if (!row) return false;
  if (row.status === 'open' || row.status === 'parked') return true;
  return row.status === 'answered' && cachedExecution(row) === 'unassigned';
}

/** A cached row some surface already answered, with the answer it
    recorded: what a late answer from the board loses to. */
export function answeredWinner(
  row: FacilityGateRow | undefined
): FacilityGateRow | undefined {
  return row?.status === 'answered' && row.answer ? row : undefined;
}

/** Same story as `cachedExecution`: the facility's typed `delivery.outcome`
    (`"delivered" | "dead-pane"`) lags the board's own richer set
    (`"delivered" | "confirmed" | "stuck"`) the daemon already emits --
    validated defensively rather than cast straight through. Exported so
    `ingest.ts`'s `buildQueueExtras` reads the same field the same way
    `attachGates` below does, rather than duplicating the cast/validation. */
export function cachedDelivery(row: FacilityGateRow): GateRow['delivery'] {
  const raw = (row as unknown as { delivery?: unknown }).delivery;
  if (!isRecord(raw)) return undefined;
  const { outcome, at } = raw;
  if (
    (outcome === 'delivered' ||
      outcome === 'confirmed' ||
      outcome === 'stuck') &&
    typeof at === 'number'
  ) {
    return { outcome, at };
  }
  return undefined;
}

export type GateHost = {
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
    lifecycle already ended). A pipeline run's gate joins the MR its run
    recorded (`runLinks`) while it is live for a human; it keeps its own
    `run:` subject and id, which is what answers it. */
export function attachGates<T extends { webUrl?: string | null } & GateHost>(
  mrs: T[],
  cache: GateCache,
  runLinks: RunMrLinks = new Map()
): Array<T & { gates: GateRow[] }> {
  return mrs.map(mr => {
    if (!mr.webUrl) return { ...mr, gates: [] };
    const gates: GateRow[] = [];
    for (const row of cache.rowsFor(`mr:${mr.webUrl}`)) {
      if (row.status === 'open' || row.status === 'parked') {
        gates.push(liveGateRow(row, row.status));
      } else if (
        row.status === 'answered' &&
        !isAnsweredRowTerminal(row.kind, mr)
      ) {
        gates.push({
          ...liveGateRow(row, 'answered'),
          answers: row.answer?.answers as GateAnswers | undefined,
          answeredBy: row.answer?.by,
          answeredAt: row.answer?.answeredAt,
          delivery: cachedDelivery(row),
          execution: cachedExecution(row),
        });
      }
    }
    for (const runId of runLinks.get(normalizeMrUrl(mr.webUrl)) ?? []) {
      for (const row of cache.rowsFor(`run:${runId}`)) {
        if (!isLiveRunGate(row)) continue;
        gates.push(liveGateRow(row, row.status as 'open' | 'parked'));
      }
    }
    return { ...mr, gates };
  });
}

function liveGateRow(row: FacilityGateRow, status: GateRow['status']): GateRow {
  return {
    gateId: row.id,
    subject: row.subject,
    kind: row.kind,
    label: typeof row.meta?.label === 'string' ? row.meta.label : row.kind,
    status,
    openedAt: row.openedAt,
    questions: row.questions as GateQuestion[],
    context: row.context ?? undefined,
    origin: row.origin ?? undefined,
    domain: domainForKind(row.kind),
    meta: row.meta ?? undefined,
    escalatedAt: row.escalatedAt ?? undefined,
    owner: row.owner ?? undefined,
  };
}
