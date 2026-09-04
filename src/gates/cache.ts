import type { GateRow as FacilityGateRow } from "@mattstack/rt-client";
import type { GateEventFrame } from "./ingest.ts";
import type { GateAnswers, GateQuestion, GateRow } from "./store.ts";
import type { ReviewStatus } from "../review-state.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// The facility's own bus topics, distinct from the board's legacy
// `board/gate/opened|answered/<id>` bridge topic (see gates/ingest.ts).
const GATE_TOPIC_RE = /^gate\/(opened|answered|parked|closed|released)\/([^/]+)$/;

/**
 * In-memory cache of the board's gate rows, keyed by facility `subject`
 * (`mr:<mrUrl>`). Fed by a boot `gateList` reconcile (authoritative snapshot,
 * see `reconcileGatesOnBoot` in ingest.ts) and by individual `gate/**` bus
 * frames relayed through `ingestRelayFrame` (low-latency deltas).
 */
export class GateCache {
  private readonly bySubject = new Map<string, FacilityGateRow>();

  /** Set/replace one row wholesale, keyed by its subject. */
  applyRow(row: FacilityGateRow): void {
    this.bySubject.set(row.subject, row);
  }

  /** `gateList`'s result is authoritative for every subject it names; a
      subject absent from `rows` is left as-is (not deleted) -- it just
      means this reconcile's scope didn't cover it. */
  reconcile(rows: FacilityGateRow[]): void {
    for (const row of rows) this.applyRow(row);
  }

  get(subject: string): FacilityGateRow | undefined {
    return this.bySubject.get(subject);
  }

  rows(): FacilityGateRow[] {
    return [...this.bySubject.values()];
  }

  /** Applies one `gate/**` bus frame. `opened` carries everything needed to
      build a row from scratch, so it upserts (also how a re-review's fresh
      id replaces a stale answered row for the same subject). Every other
      kind only patches a row the cache already has -- their payloads are
      thinner than a full row, and a frame for an id the cache never saw
      (an unknown gate, or a reconcile the cache hasn't caught up to yet) is
      dropped silently rather than fabricated; the next `reconcile` fills it. */
  applyEvent(frame: GateEventFrame): void {
    const match = GATE_TOPIC_RE.exec(frame.topic);
    if (!match) return;
    const kind = match[1] as "opened" | "answered" | "parked" | "closed" | "released";
    if (!isRecord(frame.payload)) return;
    const payload = frame.payload;

    if (kind === "opened") {
      this.applyOpened(payload);
      return;
    }
    this.patchExisting(kind, payload);
  }

  private applyOpened(payload: Record<string, unknown>): void {
    const { id, subject, questions, meta, openedAt } = payload;
    if (typeof id !== "string" || !id) return;
    if (typeof subject !== "string" || !subject) return;
    if (!Array.isArray(questions)) return;

    this.applyRow({
      id,
      subject,
      kind: typeof payload.kind === "string" ? payload.kind : "review-post",
      questions: questions as GateQuestion[],
      meta: isRecord(meta) ? meta : null,
      status: "open",
      answer: null,
      openedAt: typeof openedAt === "number" ? openedAt : Date.now(),
      parkedAt: null,
      closedAt: null,
      closedReason: null,
      agent: typeof payload.agent === "string" ? payload.agent : null,
      pane: typeof payload.pane === "string" ? payload.pane : null,
      nudge: null,
      delivery: null,
      released: false,
    });
  }

  private findById(id: string): FacilityGateRow | undefined {
    for (const row of this.bySubject.values()) {
      if (row.id === id) return row;
    }
    return undefined;
  }

  private patchExisting(kind: "answered" | "parked" | "closed" | "released", payload: Record<string, unknown>): void {
    const { id } = payload;
    if (typeof id !== "string" || !id) return;
    const existing = this.findById(id);
    if (!existing) return; // unknown id: drop silently, next reconcile fills it

    if (kind === "answered") {
      const { answers, by, answeredAt } = payload;
      if (!isRecord(answers)) return;
      this.applyRow({
        ...existing,
        status: "answered",
        answer: {
          answers: answers as NonNullable<FacilityGateRow["answer"]>["answers"],
          by: typeof by === "string" ? by : "",
          answeredAt: typeof answeredAt === "number" ? answeredAt : Date.now(),
        },
        pane: typeof payload.paneId === "string" ? payload.paneId : existing.pane,
      });
    } else if (kind === "parked") {
      this.applyRow({
        ...existing,
        status: "parked",
        parkedAt: typeof payload.parkedAt === "number" ? payload.parkedAt : Date.now(),
      });
    } else if (kind === "closed") {
      this.applyRow({
        ...existing,
        status: "closed",
        closedAt: typeof payload.closedAt === "number" ? payload.closedAt : Date.now(),
        closedReason: isClosedReason(payload.closedReason) ? payload.closedReason : existing.closedReason,
      });
    } else {
      this.applyRow({ ...existing, released: true });
    }
  }
}

function isClosedReason(v: unknown): v is FacilityGateRow["closedReason"] {
  return v === "abandoned" || v === "superseded" || v === "pruned";
}

function isTerminalReview(status: ReviewStatus | undefined): boolean {
  return status === "done" || status === "error";
}

/** Attach each MR's cached gate row (if any) as `gate`, always present (null
    when there's nothing to show) so the client can render "no gate" without
    an `in` check. An ANSWERED row is scoped to a NON-TERMINAL review state --
    never to `released`, which stays false forever for the board's
    unattended, nudge-less gates and would otherwise badge every finished
    review "answered" permanently. A CLOSED row never renders (its lifecycle
    already ended). */
export function attachGates<T extends { webUrl?: string | null; review?: { status: ReviewStatus } }>(
  mrs: T[],
  cache: GateCache,
): Array<T & { gate: GateRow | null }> {
  return mrs.map((mr) => {
    const row = mr.webUrl ? cache.get(`mr:${mr.webUrl}`) : undefined;
    if (!row) return { ...mr, gate: null };

    switch (row.status) {
      case "open":
      case "parked":
        return { ...mr, gate: { gateId: row.id, status: row.status, openedAt: row.openedAt, questions: row.questions as GateQuestion[] } };
      case "answered":
        if (isTerminalReview(mr.review?.status)) return { ...mr, gate: null };
        return {
          ...mr,
          gate: {
            gateId: row.id,
            status: "answered",
            openedAt: row.openedAt,
            questions: row.questions as GateQuestion[],
            answers: row.answer?.answers as GateAnswers | undefined,
          },
        };
      default:
        return { ...mr, gate: null };
    }
  });
}
