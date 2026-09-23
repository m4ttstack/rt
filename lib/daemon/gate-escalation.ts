/**
 * gate-escalation: surfaces an unanswered herd-owned gate to the human.
 * Runs as a periodic sweep, not on the answer/close hot path:
 * both trigger reasons (TTL elapsed, owner's subscription gone) are only
 * knowable by re-checking the clock and the subscription table, not by
 * reacting to a single event.
 *
 * Each gate emits its own gate/escalated/<id> event; the human-facing one is
 * the per-herd herd/gates-waiting/<herd> summary, which points at the
 * shepherd's pane, never at the worker that raised the gate.
 */

import type { Logger } from "pino";
import type { GateRow, GatesStore } from "./gates-store.ts";

export interface GateEscalation {
  /** Escalates every eligible open herd-owned gate once, returns the count. */
  sweep(): number;
}

export interface HerdSummaryDeps {
  shepherdPane(herdId: string): string | null;
  /** Minimum gap between two summaries for the same herd. */
  quietMs(): number;
}

// One page covers every practical gates.db size (mirrors handlers/gate.ts's
// own list-limit ceiling); paging still guards the sweep against a gates.db
// that somehow exceeds it.
const PAGE_SIZE = 1000;
const MAX_LABELS = 4;
const HERD_OWNER = "herd:";

function gateLabel(row: GateRow): string {
  return typeof row.meta?.label === "string" ? row.meta.label : row.kind;
}

/** mintHerdId appends a -YYYYMMDD-HHMMSS stamp (plus -N from uniqueHerdId on a collision); the banner reads better without it. */
function herdName(herdId: string): string {
  return herdId.replace(/-\d{8}-\d{6}(-\d+)?$/, "");
}

function labelList(rows: GateRow[]): string {
  const labels = [...new Set(rows.map(gateLabel))];
  if (labels.length <= MAX_LABELS) return labels.join(", ");
  return `${labels.slice(0, MAX_LABELS).join(", ")} and ${labels.length - MAX_LABELS} more`;
}

function summaryPayload(herdId: string, rows: GateRow[], pane: string | null, shepherdGone: boolean, now: number): Record<string, unknown> {
  const count = rows.length;
  const labels = labelList(rows);
  const name = herdName(herdId);
  if (shepherdGone) {
    const summary = count === 1
      ? `1 worker gate has nobody to answer it: ${labels}`
      : `${count} worker gates have nobody to answer them: ${labels}`;
    return { herd: herdId, count, shepherdGone, headline: `${name} has lost its shepherd`, summary };
  }
  const oldestMins = Math.max(1, Math.round((now - Math.min(...rows.map((r) => r.openedAt))) / 60_000));
  const summary = count === 1
    ? `1 worker gate waiting for ${oldestMins} min: ${labels}`
    : `${count} worker gates waiting, the oldest for ${oldestMins} min: ${labels}`;
  return {
    herd: herdId, count, shepherdGone,
    headline: `${name} is waiting on its shepherd`, summary,
    ...(pane ? { paneId: pane } : {}),
  };
}

export function createGateEscalation(deps: {
  store: GatesStore;
  ttlMs: () => number;
  emit: (topic: string, payload: Record<string, unknown>) => void;
  log: Logger;
  now?: () => number;
  herds?: HerdSummaryDeps;
}): GateEscalation {
  const { store, ttlMs, emit, log, herds } = deps;
  const now_ = deps.now ?? Date.now;
  const log_ = log.child({ module: "gate-escalation" });
  // Owners with an escalation not yet covered by a summary. Held across
  // sweeps so an escalation inside a herd's quiet window still surfaces
  // once the window ends, if its gates are still waiting then.
  const pending = new Set<string>();
  const summarizedAt = new Map<string, number>();

  /** No live subscription (scope "owner") is watching this gate's owner. */
  function ownerIsDead(owner: string): boolean {
    const liveOwnerSubs = store.subscriptions({ live: true }).filter(
      (s) => s.scope === "owner" && s.ownerRef === owner,
    );
    return liveOwnerSubs.length === 0;
  }

  function escalate(row: GateRow, reason: "ttl" | "owner-dead"): void {
    emit(`gate/escalated/${row.id}`, {
      id: row.id,
      subject: row.subject,
      kind: row.kind,
      label: gateLabel(row),
      owner: row.owner,
      reason,
      paneId: row.pane,
      origin: row.origin ?? null,
    });
    store.markEscalated(row.id);
  }

  function summarize(waiting: Map<string, GateRow[]>, now: number): void {
    if (!herds) return;
    for (const owner of [...pending]) {
      const rows = waiting.get(owner);
      if (!rows || rows.length === 0) {
        pending.delete(owner);
        continue;
      }
      const last = summarizedAt.get(owner);
      if (last !== undefined && now - last < herds.quietMs()) continue;
      const herdId = owner.slice(HERD_OWNER.length);
      try {
        const shepherdGone = ownerIsDead(owner);
        const pane = shepherdGone ? null : herds.shepherdPane(herdId);
        emit(`herd/gates-waiting/${herdId}`, summaryPayload(herdId, rows, pane, shepherdGone, now));
        summarizedAt.set(owner, now);
        pending.delete(owner);
      } catch (err) {
        log_.warn({ err, herd: herdId }, "gate-escalation: herd summary failed");
      }
    }
  }

  return {
    sweep() {
      const now = now_();
      const ttl = ttlMs();
      let escalated = 0;
      const waiting = new Map<string, GateRow[]>();
      const noteWaiting = (owner: string, row: GateRow) => {
        const rows = waiting.get(owner);
        if (rows) rows.push(row);
        else waiting.set(owner, [row]);
      };
      let cursor: number | undefined;
      for (;;) {
        const { gates, cursor: nextCursor } = store.list({ open: true, limit: PAGE_SIZE, cursor });
        for (const row of gates) {
          const owner = row.owner;
          if (!owner || !owner.startsWith(HERD_OWNER)) continue;
          if (row.escalatedAt !== null) {
            noteWaiting(owner, row);
            continue;
          }
          try {
            if (row.openedAt <= now - ttl) {
              escalate(row, "ttl");
            } else if (ownerIsDead(owner)) {
              escalate(row, "owner-dead");
            } else {
              continue;
            }
            escalated++;
            pending.add(owner);
            noteWaiting(owner, row);
          } catch (err) {
            log_.warn({ err, gateId: row.id }, "gate-escalation: sweep row failed");
          }
        }
        if (gates.length < PAGE_SIZE) break;
        cursor = nextCursor;
      }
      summarize(waiting, now);
      return escalated;
    },
  };
}
