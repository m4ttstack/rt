/**
 * gate-escalation: surfaces an unanswered herd-owned gate to the human.
 * Runs as a periodic sweep, not on the answer/close hot path:
 * both trigger reasons (TTL elapsed, owner's subscription gone) are only
 * knowable by re-checking the clock and the subscription table, not by
 * reacting to a single event.
 */

import type { Logger } from "pino";
import type { GateRow, GatesStore } from "./gates-store.ts";

export interface GateEscalation {
  /** Escalates every eligible open herd-owned gate once, returns the count. */
  sweep(): number;
}

// One page covers every practical gates.db size (mirrors handlers/gate.ts's
// own list-limit ceiling); paging still guards the sweep against a gates.db
// that somehow exceeds it.
const PAGE_SIZE = 1000;

function gateLabel(row: GateRow): string {
  return typeof row.meta?.label === "string" ? row.meta.label : row.kind;
}

export function createGateEscalation(deps: {
  store: GatesStore;
  ttlMs: () => number;
  emit: (topic: string, payload: Record<string, unknown>) => void;
  log: Logger;
}): GateEscalation {
  const { store, ttlMs, emit, log } = deps;
  const log_ = log.child({ module: "gate-escalation" });

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

  return {
    sweep() {
      const now = Date.now();
      const ttl = ttlMs();
      let escalated = 0;
      let cursor: number | undefined;
      for (;;) {
        const { gates, cursor: nextCursor } = store.list({ open: true, limit: PAGE_SIZE, cursor });
        for (const row of gates) {
          if (!row.owner || !row.owner.startsWith("herd:") || row.escalatedAt !== null) continue;
          try {
            if (row.openedAt <= now - ttl) {
              escalate(row, "ttl");
              escalated++;
            } else if (ownerIsDead(row.owner)) {
              escalate(row, "owner-dead");
              escalated++;
            }
          } catch (err) {
            log_.warn({ err, gateId: row.id }, "gate-escalation: sweep row failed");
          }
        }
        if (gates.length < PAGE_SIZE) break;
        cursor = nextCursor;
      }
      return escalated;
    },
  };
}
