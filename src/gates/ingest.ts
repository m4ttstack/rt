import { gateFilePath, readGateStates, writeGateState, type GateAnswers, type GateState } from "./store.ts";

/** Minimal store surface `applyGateEvent` needs, injected so tests never
    touch the real GATE_DIR and the relay handler / boot reconcile share one
    production wiring below. */
export interface GateEventStore {
  readGateStates(): Map<string, GateState>;
  writeGateState(path: string, patch: Partial<GateState> & { gateId: string }): void;
  gateFilePath(mrUrl: string): string;
}

/** Production wiring: the real on-disk gate store (GATE_DIR). */
export const gateEventStore: GateEventStore = { readGateStates, writeGateState, gateFilePath };

/** Shape shared by a relay `("event", frame)` push and an `events:list` row --
    both carry a bus topic and its payload, which is all `applyGateEvent`
    needs. */
export interface GateEventFrame {
  topic: string;
  payload: unknown;
}

const GATE_TOPIC_RE = /^board\/gate\/(opened|answered)\/([^/]+)$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Applies one gate bus frame to the store. Pure over the injected store: the
 * relay handler and the boot reconcile pass both call this so opened/answered
 * semantics live in exactly one place. Applying events in emission order
 * (as both callers do) makes a later answered naturally win over an earlier
 * open -- there is no ordering logic here beyond last-write-wins.
 *
 * Tolerated without throwing: a non-gate topic (ignored), a malformed
 * payload (skipped), and an answered frame with no matching open file
 * (answered-before-opened -- the open event just hasn't landed yet; skip
 * rather than fabricate a gate).
 */
export function applyGateEvent(store: GateEventStore, frame: GateEventFrame): void {
  const match = GATE_TOPIC_RE.exec(frame.topic);
  if (!match) return;
  const [, kind, topicGateId] = match;
  if (!isRecord(frame.payload)) return;
  const payload = frame.payload;
  const gateId = typeof payload.gateId === "string" && payload.gateId ? payload.gateId : topicGateId!;

  if (kind === "opened") applyOpened(store, gateId, payload);
  else applyAnswered(store, gateId, payload);
}

function applyOpened(store: GateEventStore, gateId: string, payload: Record<string, unknown>): void {
  const { mrUrl, iid, questions, openedAt } = payload;
  if (typeof mrUrl !== "string" || !mrUrl) return;
  if (typeof iid !== "number") return;
  if (!Array.isArray(questions)) return;
  if (typeof openedAt !== "number") return;

  const patch: Partial<GateState> & { gateId: string } = {
    gateId,
    mrUrl,
    iid,
    kind: "review-post",
    status: "open",
    openedAt,
    questions: questions as GateState["questions"],
  };
  for (const key of ["agentId", "sessionId", "paneId", "tabId"] as const) {
    const v = payload[key];
    if (typeof v === "string") patch[key] = v;
  }
  store.writeGateState(store.gateFilePath(mrUrl), patch);
}

function applyAnswered(store: GateEventStore, gateId: string, payload: Record<string, unknown>): void {
  const { answers, answeredAt, by } = payload;
  if (!isRecord(answers)) return;

  let mrUrl: string | undefined;
  for (const state of store.readGateStates().values()) {
    if (state.gateId === gateId) {
      mrUrl = state.mrUrl;
      break;
    }
  }
  if (!mrUrl) return; // answered-before-opened: tolerated, nothing to merge into yet

  store.writeGateState(store.gateFilePath(mrUrl), {
    gateId,
    status: "answered",
    answers: answers as GateAnswers,
    answeredBy: typeof by === "string" ? (by as GateState["answeredBy"]) : undefined,
    answeredAt: typeof answeredAt === "number" ? answeredAt : Date.now(),
  });
}

// ── Bridge rule: the board's own entry in rt.notify.eventBridges ──────────

export interface EventBridgeRule {
  pattern: string;
  category: string;
  title: string;
  message: string;
}

/** The rule this board contributes so opening a gate raises a desktop
    notification. The `rt.notify.eventBridges` registry key ships from the
    rt daemon side (gate events plan, Task 3); until that lands, the real
    `getSetting`/`setSetting` wiring around `ensureBridgeRule` throws
    "unknown setting" and the caller catches it -- see server.ts boot. */
export const GATE_OPENED_BRIDGE_RULE: EventBridgeRule = {
  pattern: "board/gate/opened/*",
  category: "gate",
  title: "review gate: !{iid}",
  message: "{mrUrl}",
};

/**
 * Merge-not-clobber upsert: appends the board's gate-opened bridge rule to
 * whatever `read()` returns, unless a rule with the same pattern is already
 * present. Every other entry -- other apps' rules, hand edits -- rides along
 * untouched; this only ever appends its one rule, once.
 */
export function ensureBridgeRule(read: () => EventBridgeRule[], write: (next: EventBridgeRule[]) => void): void {
  const current = read();
  if (current.some((r) => r.pattern === GATE_OPENED_BRIDGE_RULE.pattern)) return;
  write([...current, GATE_OPENED_BRIDGE_RULE]);
}
