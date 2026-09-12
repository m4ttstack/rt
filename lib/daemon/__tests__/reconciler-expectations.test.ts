import { describe, test, expect, beforeEach } from "bun:test";
import pino from "pino";
import { createGatesStore, type GatesStore } from "../gates-store.ts";
import { createReconciler, type Reconciler } from "../reconciler.ts";
import type { LivePane, PaneHints } from "../pane-resolve-live.ts";

const log = pino({ level: "silent" });

const HINTS: PaneHints = { sessionId: "exp-s1" };

const buildPane = (over: Partial<LivePane> = {}): LivePane => ({
  paneRef: "w1:p1", sockPath: "/s", workspaceId: "w1", agentStatus: "idle",
  sessionId: "exp-s1", cwd: "/wt/a", ...over,
});

let store: GatesStore;
let emitted: Array<{ topic: string; payload: Record<string, unknown> }>;
let panesValue: LivePane[] | null;
let injectCalls: PaneHints[];
let injectResult: { ok: true; paneRef: string } | { ok: false; error: string };
let reconciler: Reconciler;

function makeGate(subject = "gate:subject-1") {
  return store.open({
    subject, kind: "clarify",
    questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
    nudge: { session: "exp-s1" },
  }).row;
}

beforeEach(() => {
  store = createGatesStore({ dbPath: ":memory:", log });
  emitted = [];
  panesValue = [buildPane()];
  injectCalls = [];
  injectResult = { ok: true, paneRef: "w1:p1" };
  reconciler = createReconciler({
    store,
    listAgents: () => [],
    snapshot: async () => panesValue,
    peek: async () => "",
    emit: (topic, payload) => { emitted.push({ topic, payload }); },
    injectEscape: async (hints) => { injectCalls.push(hints); return injectResult; },
    resumeAgent: async () => ({ ok: true }),
    log,
  });
});

describe("reconciler expectations: leave-blocked", () => {
  test("satisfied (pane no longer blocked) stamps confirmed delivery and emits", async () => {
    const gate = makeGate();
    reconciler.expect({ gateId: gate.id, hints: HINTS, expect: "leave-blocked", deadlineSweeps: 2, retriesLeft: 2 });
    panesValue = [buildPane({ agentStatus: "idle" })];

    await reconciler.sweep();

    const row = store.get(gate.id)!;
    expect(row.delivery).toMatchObject({ outcome: "confirmed" });
    expect(emitted).toContainEqual({
      topic: "reconciler.delivery",
      payload: { gateId: gate.id, outcome: "confirmed" },
    });
  });

  test("still blocked past the deadline re-resolves, retries injectEscape, decrements retries, resets the deadline", async () => {
    const gate = makeGate();
    reconciler.expect({ gateId: gate.id, hints: HINTS, expect: "leave-blocked", deadlineSweeps: 1, retriesLeft: 2 });
    panesValue = [buildPane({ agentStatus: "blocked" })];

    await reconciler.sweep(); // deadline reached: retry #1 (retriesLeft 2->1, deadline reset to 1)
    expect(injectCalls).toEqual([HINTS]);
    expect(store.get(gate.id)!.delivery).toBeNull();

    await reconciler.sweep(); // deadline reached again: retry #2 (retriesLeft 1->0, deadline reset to 1)
    expect(injectCalls).toHaveLength(2);
    expect(store.get(gate.id)!.delivery).toBeNull();
  });

  test("retries exhausted and still blocked marks delivery stuck, emits, and drops the expectation", async () => {
    const gate = makeGate();
    reconciler.expect({ gateId: gate.id, hints: HINTS, expect: "leave-blocked", deadlineSweeps: 1, retriesLeft: 0 });
    panesValue = [buildPane({ agentStatus: "blocked" })];

    await reconciler.sweep();

    expect(injectCalls).toHaveLength(0);
    const row = store.get(gate.id)!;
    expect(row.delivery).toMatchObject({ outcome: "stuck" });
    expect(emitted).toContainEqual({
      topic: "reconciler.delivery",
      payload: { gateId: gate.id, outcome: "stuck" },
    });

    emitted.length = 0;
    await reconciler.sweep();
    expect(emitted).toHaveLength(0); // dropped: nothing more happens on the stale gate
  });
});

describe("reconciler expectations: appear-live", () => {
  test("satisfied (a live pane resolves) clears execution and emits execution null", async () => {
    const gate = makeGate();
    store.markExecution(gate.id, "unassigned"); // simulates a prior deadline stamp being undone
    reconciler.expect({ gateId: gate.id, hints: HINTS, expect: "appear-live", deadlineSweeps: 2, retriesLeft: 0 });
    panesValue = [buildPane({ agentStatus: "idle" })];

    await reconciler.sweep();

    const row = store.get(gate.id)!;
    expect(row.execution).toBeUndefined();
    expect(emitted).toContainEqual({
      topic: "reconciler.execution",
      payload: { gateId: gate.id, execution: null },
    });
  });

  test("deadline missed marks execution unassigned, emits, and drops the expectation", async () => {
    const gate = makeGate();
    reconciler.expect({ gateId: gate.id, hints: HINTS, expect: "appear-live", deadlineSweeps: 1, retriesLeft: 0 });
    panesValue = []; // no pane resolves from the hints

    await reconciler.sweep();

    const row = store.get(gate.id)!;
    expect(row.execution).toBe("unassigned");
    expect(emitted).toContainEqual({
      topic: "reconciler.execution",
      payload: { gateId: gate.id, execution: "unassigned" },
    });

    emitted.length = 0;
    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();
    expect(emitted).toHaveLength(0); // dropped: a later live pane doesn't reopen it
  });
});

describe("reconciler expectations: herdr unreachable", () => {
  test("an unreachable sweep does not consume the deadline (unknown proves nothing)", async () => {
    const gate = makeGate();
    reconciler.expect({ gateId: gate.id, hints: HINTS, expect: "leave-blocked", deadlineSweeps: 1, retriesLeft: 0 });
    panesValue = null;

    await reconciler.sweep();
    await reconciler.sweep();

    expect(injectCalls).toHaveLength(0);
    expect(store.get(gate.id)!.delivery).toBeNull();
    expect(emitted).toHaveLength(0);

    // Deadline of 1 is still intact once herdr is reachable again: this
    // sweep consumes it and, with retriesLeft 0, goes straight to stuck.
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    expect(store.get(gate.id)!.delivery).toMatchObject({ outcome: "stuck" });
  });
});
