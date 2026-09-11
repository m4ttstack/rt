/**
 * lib/daemon/reconciler.ts: the executor reconciler sweep. Derives each
 * agent's live pane state from a fresh herdr snapshot every pass, debounces
 * blocked/gone transitions across consecutive sweeps before acting, and
 * opens/closes "pane-attention" gates so a wedged or orphaned pane surfaces
 * in the human decision queue. See
 * docs/superpowers/specs/2026-09-11-executor-reconciler-design.md,
 * "Reconciler sweep" and "Attention gates".
 *
 * Expectation checking (retry/stuck handling for in-flight Escape/resume
 * sends) runs at the end of every sweep, against the same fresh snapshot
 * used for transition handling. See docs/superpowers/specs/
 * 2026-09-11-executor-reconciler-design.md, "Expectations".
 */

import type { Logger } from "pino";
import type { AgentRecord } from "../state/agents-store.ts";
import type { GateRow, GatesStore } from "./gates-store.ts";
import type {
  ExecutorState,
  ExecutorView,
  ReconcilerStatus,
  GateQuestion,
} from "../../packages/rt-client/src/commands.ts";
import { resolveLivePane, type LivePane, type PaneHints } from "./pane-resolve-live.ts";
import type { EscapeInjector } from "./gate-escape.ts";
import { computeView, gateAgentId } from "./reconciler-view.ts";
import { listKvValues, setKvValue } from "../state/kv-blob.ts";

const CLEARED_NS = "reconciler.cleared";
// Mirrors gate-escalation.ts's own page ceiling: one page covers every
// practical gates.db size, and paging still guards against exceeding it.
const PAGE_SIZE = 1000;
// Matches handlers/gate.ts's CONTEXT_CAP_BYTES: gate:open rejects an
// oversized context rather than truncating it, so a caller that opens
// directly against the store (as this sweep does) must truncate itself.
const CONTEXT_CAP_BYTES = 8192;

export interface Expectation {
  gateId: string;
  agentId?: string;
  hints: PaneHints;
  expect: "leave-blocked" | "appear-live";
  /** Decremented per sweep; reset to its own starting value on a
      leave-blocked retry (not a fixed default) so a caller who passes a
      non-default deadline keeps that cadence across retries. */
  deadlineSweeps: number;
  retriesLeft: number;
}

/** The queue's internal shape: `initialDeadlineSweeps` is what "reset the
    deadline" resets to, captured once at `expect()` time since the public
    `Expectation` type carries only the live, decrementing countdown. */
interface PendingExpectation extends Expectation {
  readonly initialDeadlineSweeps: number;
}

export interface Reconciler {
  sweep(): Promise<void>;
  status(): ReconcilerStatus;
  /** Queues an expectation for checking at the end of every subsequent
      sweep, against a freshly resolved pane. */
  expect(e: Expectation): void;
  clear(agentId: string): void;
  executorFor(hints: PaneHints): { state: ExecutorState; pane: LivePane | null };
  /** The agent behind a gate row, via the same pane-then-field join the
      sweep's own view computation uses (reconciler-view.ts's gateAgentId).
      Read fresh against the last-swept pane snapshot -- stale between
      sweeps in exactly the way status()/executorFor() already are. */
  agentIdFor(gate: GateRow): string | null;
}

export interface ReconcilerDeps {
  store: GatesStore;
  listAgents: () => AgentRecord[];
  snapshot: () => Promise<LivePane[] | null>;
  peek: (pane: LivePane) => Promise<string>;
  emit: (topic: string, payload: Record<string, unknown>) => void;
  injectEscape: EscapeInjector;
  resumeAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  log: Logger;
  /** Consecutive sweeps a blocked/gone reading must persist before the
      reconciler acts on it. Default 2 (spec "Reconciler sweep"). */
  debounceSweeps?: number;
}

const ATTENTION_QUESTION: GateQuestion = {
  id: "action",
  label: "Pane needs attention",
  multi: false,
  options: ["focus-pane", "resume", "clear", "dismiss"],
};

/** Byte-accurate cap: peek text can carry multi-byte characters right at the
    boundary, so a char-length slice could still land over CONTEXT_CAP_BYTES. */
function truncateToBytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  return buf.byteLength <= maxBytes ? s : buf.subarray(0, maxBytes).toString("utf8");
}

export function createReconciler(deps: ReconcilerDeps): Reconciler {
  const debounceSweeps = deps.debounceSweeps ?? 2;
  const log = deps.log.child({ module: "reconciler" });

  // In-memory only, by design (spec "Reconciler sweep"): a daemon restart
  // re-derives every agent's state in one sweep, and the only replays that
  // causes (a re-opened attention gate) are idempotent via the store's own
  // subject check below, not this memory.
  const previousStates = new Map<string, ExecutorState>();
  const pendingBlocked = new Map<string, number>();
  const pendingGone = new Map<string, number>();
  const attentionGateByAgent = new Map<string, string>();
  const expectations: PendingExpectation[] = [];
  let lastPanes: LivePane[] | null = null;
  let lastStatus: ReconcilerStatus = { sweptAt: 0, herdrReachable: false, executors: [] };

  function fetchOpenAndParkedGates(): GateRow[] {
    const out: GateRow[] = [];
    let cursor: number | undefined;
    for (;;) {
      const { gates, cursor: nextCursor } = deps.store.list({ limit: PAGE_SIZE, cursor });
      for (const g of gates) if (g.status === "open" || g.status === "parked") out.push(g);
      if (gates.length < PAGE_SIZE) break;
      cursor = nextCursor;
    }
    return out;
  }

  async function peekFor(paneRef: string | null, panes: LivePane[] | null): Promise<string> {
    if (!paneRef || !panes) return "";
    const pane = panes.find((p) => p.paneRef === paneRef);
    if (!pane) return "";
    try {
      return truncateToBytes(await deps.peek(pane), CONTEXT_CAP_BYTES);
    } catch (err) {
      log.warn({ err, paneRef }, "reconciler: peek failed, opening attention gate without context");
      return "";
    }
  }

  /** Ownership routing (spec "Ownership routing"): a herd member's own
      gates carry their shepherd as owner (`herd:<id>`); the attention gate
      for that agent must route the same way, not fall back to human. Takes
      the first non-"human" owner among the agent's joined open/parked
      gates; "human" (including no joined gates at all) is the default. */
  function ownerForAttentionGate(v: ExecutorView, gatesSnapshot: GateRow[]): string {
    for (const gateId of v.openGateIds) {
      const joined = gatesSnapshot.find((row) => row.id === gateId);
      if (joined?.owner && joined.owner !== "human") return joined.owner;
    }
    return "human";
  }

  /** Opens the attention gate and records it, pushing the new row into
      `gatesSnapshot` too so a later agent in the same sweep pass that
      somehow shares a subject still sees it occupied. */
  async function openAttentionGate(
    v: ExecutorView,
    reason: "blocked" | "gone",
    panes: LivePane[] | null,
    gatesSnapshot: GateRow[],
  ): Promise<void> {
    const context = await peekFor(v.paneRef, panes);
    const owner = ownerForAttentionGate(v, gatesSnapshot);
    const { row } = deps.store.open({
      subject: v.subject ?? `agent:${v.agentId}`,
      kind: "pane-attention",
      questions: [ATTENTION_QUESTION],
      meta: { agentId: v.agentId, paneRef: v.paneRef, reason },
      context,
      owner,
    });
    attentionGateByAgent.set(v.agentId, row.id);
    gatesSnapshot.push(row);
  }

  function closeAttentionGateIfAny(agentId: string): void {
    const gateId = attentionGateByAgent.get(agentId);
    attentionGateByAgent.delete(agentId);
    if (!gateId) return;
    const row = deps.store.get(gateId);
    if (row && (row.status === "open" || row.status === "parked")) {
      // "resolved" (not "abandoned"): the pane came back on its own, it
      // wasn't given up on. clear() below uses "abandoned" for the
      // human/user-initiated close -- the two must read differently in
      // any UI that surfaces closedReason.
      deps.store.close(gateId, "resolved");
    }
  }

  /** Checks each pending expectation against `panes` and resolves, retries,
      or drops it. `panes === null` (herdr unreachable) is a no-op for the
      whole queue: an unknown read proves nothing about pane state, so a
      sweep that can't reach herdr must not consume anyone's deadline
      (spec "Expectations"; controller ruling). */
  async function checkExpectations(panes: LivePane[] | null): Promise<void> {
    if (panes === null) return;

    const remaining: PendingExpectation[] = [];
    for (const pe of expectations) {
      const pane = resolveLivePane(pe.hints, panes);
      const paneLive = pane !== null && pane.agentStatus !== "blocked";

      if (pe.expect === "leave-blocked") {
        if (paneLive) {
          deps.store.markDelivery(pe.gateId, "confirmed");
          deps.emit("reconciler.delivery", { gateId: pe.gateId, outcome: "confirmed" });
          continue;
        }
        const deadlineSweeps = pe.deadlineSweeps - 1;
        if (deadlineSweeps > 0) {
          remaining.push({ ...pe, deadlineSweeps });
          continue;
        }
        if (pe.retriesLeft > 0) {
          const res = await deps.injectEscape(pe.hints);
          if (!res.ok) {
            log.warn(
              { gateId: pe.gateId, err: res.error },
              "reconciler: expectation retry escape inject failed",
            );
          }
          remaining.push({ ...pe, deadlineSweeps: pe.initialDeadlineSweeps, retriesLeft: pe.retriesLeft - 1 });
          continue;
        }
        deps.store.markDelivery(pe.gateId, "stuck");
        deps.emit("reconciler.delivery", { gateId: pe.gateId, outcome: "stuck" });
        continue;
      }

      // appear-live
      if (paneLive) {
        deps.store.markExecution(pe.gateId, null);
        deps.emit("reconciler.execution", { gateId: pe.gateId, execution: null });
        continue;
      }
      const deadlineSweeps = pe.deadlineSweeps - 1;
      if (deadlineSweeps > 0) {
        remaining.push({ ...pe, deadlineSweeps });
        continue;
      }
      deps.store.markExecution(pe.gateId, "unassigned");
      deps.emit("reconciler.execution", { gateId: pe.gateId, execution: "unassigned" });
    }

    expectations.length = 0;
    expectations.push(...remaining);
  }

  async function sweep(): Promise<void> {
    const panes = await deps.snapshot();
    lastPanes = panes;
    const herdrReachable = panes !== null;
    const now = Date.now();

    const agents = deps.listAgents().filter((a) => a.finishedAt == null);
    const clearedMap = listKvValues<{ clearedAt: number }>(CLEARED_NS);
    const clearedAgentIds = new Set(Object.keys(clearedMap));
    const openParkedGates = fetchOpenAndParkedGates();

    const view = computeView(
      { agents, panes, openGates: openParkedGates, clearedAgentIds, visibleWorkspaceIds: null },
      now,
    );

    // herdr unreachable: every agent reads "unknown" (computeView) and
    // previousStates is left untouched here, so a restart never fires a
    // spurious transition into OR back out of "unknown" (spec "Reconciler
    // sweep": "no transitions fire on unknown").
    if (herdrReachable) {
      for (const v of view) {
        const prevState = previousStates.get(v.agentId);
        if (prevState !== undefined && prevState !== v.state) {
          deps.emit("reconciler.transition", {
            agentId: v.agentId,
            from: prevState,
            to: v.state,
            paneRef: v.paneRef,
            gateIds: v.openGateIds,
          });
        }

        const subject = v.subject ?? `agent:${v.agentId}`;

        if (v.state === "blocked") {
          const count = (pendingBlocked.get(v.agentId) ?? 0) + 1;
          pendingBlocked.set(v.agentId, count);
          // A legitimate form presentation is blocked by design: any
          // open/parked gate already on the subject (the form gate itself,
          // or an attention gate from an earlier pass) means skip.
          const occupied = openParkedGates.some((g) => g.subject === subject);
          if (count >= debounceSweeps && !occupied) {
            await openAttentionGate(v, "blocked", panes, openParkedGates);
          }
        } else {
          pendingBlocked.delete(v.agentId);
        }

        if (v.state === "gone") {
          const count = (pendingGone.get(v.agentId) ?? 0) + 1;
          pendingGone.set(v.agentId, count);
          // Unlike blocked, an existing joined gate is the TRIGGER here
          // (the orphaned run's own gate row), not a reason to skip; only
          // dedupe against an attention gate this sweep already opened.
          if (count >= debounceSweeps && v.openGateIds.length > 0) {
            for (const gateId of v.openGateIds) deps.store.markExecutor(gateId, "gone");
            const hasAttentionGate = openParkedGates.some(
              (g) => g.kind === "pane-attention" && g.subject === subject,
            );
            if (!hasAttentionGate) await openAttentionGate(v, "gone", panes, openParkedGates);
          }
        } else {
          pendingGone.delete(v.agentId);
        }

        if (v.state === "live" && (prevState === "blocked" || prevState === "gone")) {
          closeAttentionGateIfAny(v.agentId);
        }

        previousStates.set(v.agentId, v.state);
      }
    }

    await checkExpectations(panes);

    lastStatus = { sweptAt: now, herdrReachable, executors: view };
  }

  function clear(agentId: string): void {
    setKvValue(CLEARED_NS, agentId, { clearedAt: Date.now() });

    const agents = deps.listAgents();
    const toClose = new Set<string>();
    for (const g of fetchOpenAndParkedGates()) {
      if (gateAgentId(g, agents, lastPanes) === agentId) toClose.add(g.id);
    }
    const trackedAttentionGate = attentionGateByAgent.get(agentId);
    if (trackedAttentionGate) toClose.add(trackedAttentionGate);
    for (const id of toClose) deps.store.close(id, "abandoned");

    attentionGateByAgent.delete(agentId);
    pendingBlocked.delete(agentId);
    pendingGone.delete(agentId);
    previousStates.delete(agentId);
  }

  function executorFor(hints: PaneHints): { state: ExecutorState; pane: LivePane | null } {
    if (lastPanes === null) return { state: "unknown", pane: null };
    const pane = resolveLivePane(hints, lastPanes);
    if (!pane) return { state: "gone", pane: null };
    return { state: pane.agentStatus === "blocked" ? "blocked" : "live", pane };
  }

  function agentIdFor(gate: GateRow): string | null {
    return gateAgentId(gate, deps.listAgents(), lastPanes);
  }

  return {
    sweep,
    status: () => lastStatus,
    expect(e) {
      expectations.push({ ...e, initialDeadlineSweeps: e.deadlineSweeps });
    },
    clear,
    executorFor,
    agentIdFor,
  };
}
