import { describe, test, expect, beforeEach } from "bun:test";
import pino from "pino";
import { createGatesStore, type GateQuestion, type GatesStore } from "../gates-store.ts";
import { createReconciler, type Reconciler } from "../reconciler.ts";
import type { AgentRecord } from "../../state/agents-store.ts";
import type { LivePane } from "../pane-resolve-live.ts";

const log = pino({ level: "silent" });

function qs(): GateQuestion[] {
  return [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];
}

const buildAgent = (id: string, over: Partial<AgentRecord> = {}): AgentRecord => ({
  id, repo: "gitlab.com/g/p", cwd: "/wt/a", provider: "claude",
  surface: "herdr", sessionId: "s-1", createdAt: 1, ...over,
});
const buildPane = (over: Partial<LivePane> = {}): LivePane => ({
  paneRef: "w1:p1", sockPath: "/s", workspaceId: "w1", agentStatus: "idle",
  sessionId: "s-1", cwd: "/wt/a", ...over,
});

let store: GatesStore;
let emitted: Array<{ topic: string; payload: Record<string, unknown> }>;
let agentId: string;
let agentsList: AgentRecord[];
let panesValue: LivePane[] | null;
let peekText: string;
let reconciler: Reconciler;

function attentionGates() {
  return store.list({ limit: 100 }).gates.filter((g) => g.kind === "pane-attention");
}

beforeEach(() => {
  // A fresh random agentId per test: gates.db is `:memory:` per test (fine
  // on its own), but the reconciler.cleared kv namespace lives in the real
  // state.db under this process's fake HOME (test-setup.ts), which every
  // test file in the run shares -- a fixed id would leak a clear() across
  // unrelated tests/files.
  agentId = `ag-${crypto.randomUUID().slice(0, 8)}`;
  store = createGatesStore({ dbPath: ":memory:", log });
  emitted = [];
  agentsList = [buildAgent(agentId)];
  panesValue = [buildPane()];
  peekText = "screen text";
  reconciler = createReconciler({
    store,
    listAgents: () => agentsList,
    snapshot: async () => panesValue,
    peek: async () => peekText,
    emit: (topic, payload) => { emitted.push({ topic, payload }); },
    injectEscape: async () => ({ ok: false, error: "not used in this task" }),
    resumeAgent: async () => ({ ok: true }),
    log,
  });
});

describe("reconciler sweep: blocked", () => {
  test("sustained 2 sweeps opens exactly one attention gate; a third sweep opens no duplicate", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    expect(attentionGates()).toHaveLength(0);

    await reconciler.sweep();
    expect(attentionGates()).toHaveLength(1);
    const [row] = attentionGates();
    expect(row!.meta).toMatchObject({ agentId, paneRef: "w1:p1", reason: "blocked" });
    expect(row!.owner).toBe("human");
    expect(row!.questions).toEqual([
      { id: "action", label: "Pane needs attention", multi: false, options: ["focus-pane", "resume", "clear", "dismiss"] },
    ]);

    await reconciler.sweep();
    expect(attentionGates()).toHaveLength(1);
  });

  test("an open gate already on the subject opens nothing", async () => {
    store.open({ subject: "run:x", kind: "clarify", questions: qs(), nudge: { session: "s-1" } });
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    await reconciler.sweep();
    expect(attentionGates()).toHaveLength(0);
  });

  test("blocked then live closes the attention gate with closedReason resolved", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [opened] = attentionGates();
    expect(opened).toBeDefined();

    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();

    const row = store.get(opened!.id)!;
    expect(row.status).toBe("closed");
    // "resolved", not "abandoned": the pane came back on its own.
    // clear() (below) is the one that uses "abandoned".
    expect(row.closedReason).toBe("resolved");
  });

  test("context is truncated to 8192 bytes", async () => {
    peekText = "x".repeat(20_000);
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [row] = attentionGates();
    expect(Buffer.byteLength(row!.context ?? "", "utf8")).toBeLessThanOrEqual(8192);
  });
});

describe("reconciler sweep: gone", () => {
  test("sustained 2 sweeps with an open gate stamps markExecutor and opens a gone attention gate", async () => {
    const { row: openGate } = store.open({ subject: "run:y", kind: "clarify", questions: qs(), nudge: { session: "s-1" } });
    panesValue = [];
    await reconciler.sweep();
    expect(store.get(openGate.id)!.executor).toBeUndefined();
    expect(attentionGates()).toHaveLength(0);

    await reconciler.sweep();
    expect(store.get(openGate.id)!.executor).toBe("gone");
    const attn = attentionGates().find((g) => g.subject === "run:y");
    expect(attn).toBeDefined();
    expect(attn!.meta).toMatchObject({ agentId, reason: "gone" });
  });

  test("gone with no joined gate opens nothing (no run to orphan)", async () => {
    panesValue = [];
    await reconciler.sweep();
    await reconciler.sweep();
    expect(attentionGates()).toHaveLength(0);
  });

  test("a pane coming back live closes the gone attention gate", async () => {
    store.open({ subject: "run:z", kind: "clarify", questions: qs(), nudge: { session: "s-1" } });
    panesValue = [];
    await reconciler.sweep();
    await reconciler.sweep();
    const attn = attentionGates().find((g) => g.subject === "run:z")!;
    expect(attn).toBeDefined();

    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();
    expect(store.get(attn.id)!.status).toBe("closed");
    expect(store.get(attn.id)!.closedReason).toBe("resolved");
  });
});

describe("reconciler sweep: attention gate ownership", () => {
  // "blocked" can never exercise inheritance: its own dedupe guard skips
  // opening whenever ANY gate (including the joined one whose owner we'd
  // inherit from) already occupies the subject. "gone" is the real case:
  // the joined gate is the trigger, not a blocker, so both rows coexist.
  test("inherits the first non-human owner among the agent's joined gates", async () => {
    const { row: openGate } = store.open({
      subject: "run:owned", kind: "clarify", questions: qs(), nudge: { session: "s-1" }, owner: "herd:shep-1",
    });
    panesValue = [];
    await reconciler.sweep();
    await reconciler.sweep();
    expect(store.get(openGate.id)!.executor).toBe("gone");
    const attn = attentionGates().find((g) => g.subject === "run:owned")!;
    expect(attn).toBeDefined();
    expect(attn.owner).toBe("herd:shep-1");
  });

  test("falls back to human when the agent has no joined gates", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [attn] = attentionGates();
    expect(attn).toBeDefined();
    expect(attn!.owner).toBe("human");
  });
});

describe("reconciler sweep: herdr unreachable", () => {
  test("panes null produces no transitions and no attention gates", async () => {
    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep(); // baseline live, no emit (no prior state)
    emitted.length = 0;

    panesValue = null;
    await reconciler.sweep();
    await reconciler.sweep();

    expect(emitted).toHaveLength(0);
    expect(attentionGates()).toHaveLength(0);
    const status = reconciler.status();
    expect(status.herdrReachable).toBe(false);
    expect(status.executors[0]!.state).toBe("unknown");
  });
});

describe("reconciler sweep: transition emits", () => {
  test("every state change calls emit(\"reconciler.transition\", ...)", async () => {
    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();
    expect(emitted).toHaveLength(0); // first sighting: no prior state to diff against

    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      topic: "reconciler.transition",
      payload: { agentId, from: "live", to: "blocked", paneRef: "w1:p1" },
    });

    panesValue = [];
    await reconciler.sweep();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]!.payload).toMatchObject({ agentId, from: "blocked", to: "gone" });
  });
});

describe("reconciler.clear", () => {
  test("writes the kv tombstone, closes the agent's open gates as abandoned, and the next sweep reports cleared", async () => {
    const { row: openGate } = store.open({ subject: "run:c", kind: "clarify", questions: qs(), nudge: { session: "s-1" } });

    reconciler.clear(agentId);

    expect(store.get(openGate.id)!.status).toBe("closed");
    expect(store.get(openGate.id)!.closedReason).toBe("abandoned");

    await reconciler.sweep();
    const status = reconciler.status();
    expect(status.executors.find((e) => e.agentId === agentId)!.state).toBe("cleared");
  });

  test("flips the cached status entry to cleared immediately, before any sweep", async () => {
    panesValue = [];
    await reconciler.sweep();
    expect(reconciler.status().executors.find((e) => e.agentId === agentId)!.state).toBe("gone");

    // A status consumer refetching right after the clear round-trips (the
    // board reloads on the click) must see cleared, not wait out the next
    // 60s sweep -- the tombstone IS the state, computeView-wise.
    reconciler.clear(agentId);
    const entry = reconciler.status().executors.find((e) => e.agentId === agentId)!;
    expect(entry.state).toBe("cleared");
  });

  test("also closes a tracked attention gate that has no direct join hints", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [attn] = attentionGates();
    expect(attn).toBeDefined();

    reconciler.clear(agentId);
    expect(store.get(attn!.id)!.status).toBe("closed");
  });
});

describe("reconciler recovery close survives a restart", () => {
  test("an attention gate opened before a restart closes resolved once a FRESH reconciler sweeps a live pane", async () => {
    const { row: attn } = store.open({
      subject: `agent:${agentId}`, kind: "pane-attention", questions: qs(),
      meta: { agentId, paneRef: "w1:p1", reason: "blocked" },
    });
    // A brand-new reconciler sharing the same store but none of the first
    // one's in-memory maps -- simulates exactly what a daemon restart
    // leaves behind: the gate row persists, nothing in memory does.
    const restarted = createReconciler({
      store, listAgents: () => agentsList, snapshot: async () => panesValue,
      peek: async () => peekText, emit: () => {}, injectEscape: async () => ({ ok: false, error: "n/a" }),
      resumeAgent: async () => ({ ok: true }), log,
    });
    panesValue = [buildPane({ agentStatus: "idle" })];
    await restarted.sweep();

    const row = store.get(attn.id)!;
    expect(row.status).toBe("closed");
    expect(row.closedReason).toBe("resolved");
  });
});

describe("reconciler clears a stale executor stamp on recovery", () => {
  test("a gate's executor stamp goes gone -> unset once its agent reads live again", async () => {
    const { row: openGate } = store.open({ subject: "run:stale", kind: "clarify", questions: qs(), nudge: { session: "s-1" } });
    panesValue = [];
    await reconciler.sweep();
    await reconciler.sweep();
    expect(store.get(openGate.id)!.executor).toBe("gone");

    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();
    expect(store.get(openGate.id)!.executor).toBeUndefined();
  });
});

describe("reconciler status: since (onset) tracking", () => {
  test("since stays the onset time while state is unchanged; a state change updates it", async () => {
    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();
    const firstSince = reconciler.status().executors[0]!.since;

    await new Promise((r) => setTimeout(r, 2));
    await reconciler.sweep();
    expect(reconciler.status().executors[0]!.since).toBe(firstSince);

    await new Promise((r) => setTimeout(r, 2));
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    const secondSince = reconciler.status().executors[0]!.since;
    expect(secondSince).not.toBe(firstSince);

    await new Promise((r) => setTimeout(r, 2));
    await reconciler.sweep();
    expect(reconciler.status().executors[0]!.since).toBe(secondSince);
  });
});

describe("reconciler emits gate lifecycle events for attention gates", () => {
  test("opening an attention gate emits gate/opened/<id> in the handlers/gate.ts shape, with an origin stamp", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [row] = attentionGates();
    const opened = emitted.find((e) => e.topic === `gate/opened/${row!.id}`);
    expect(opened).toBeDefined();
    expect(opened!.payload).toMatchObject({
      id: row!.id, subject: row!.subject, kind: "pane-attention",
      questions: row!.questions, meta: row!.meta, paneId: row!.pane,
      label: "pane-attention", context: row!.context, owner: row!.owner,
    });
    expect(opened!.payload["origin"]).toMatchObject({ paneId: "w1:p1", worktree: "/wt/a" });
  });

  test("recovery close emits gate/closed/<id> with reason resolved", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [row] = attentionGates();
    emitted.length = 0;

    panesValue = [buildPane({ agentStatus: "idle" })];
    await reconciler.sweep();
    const closed = emitted.find((e) => e.topic === `gate/closed/${row!.id}`);
    expect(closed).toBeDefined();
    expect(closed!.payload).toMatchObject({ id: row!.id, subject: row!.subject, kind: "pane-attention", reason: "resolved" });
  });

  test("clear() emits gate/closed/<id> with reason abandoned for a closed attention gate", async () => {
    panesValue = [buildPane({ agentStatus: "blocked" })];
    await reconciler.sweep();
    await reconciler.sweep();
    const [row] = attentionGates();
    emitted.length = 0;

    reconciler.clear(agentId);
    const closed = emitted.find((e) => e.topic === `gate/closed/${row!.id}`);
    expect(closed).toBeDefined();
    expect(closed!.payload).toMatchObject({ id: row!.id, subject: row!.subject, kind: "pane-attention", reason: "abandoned" });
  });
});

describe("reconciler.executorFor", () => {
  test("returns unknown before any sweep has run", () => {
    const fresh = createReconciler({
      store, listAgents: () => agentsList, snapshot: async () => panesValue,
      peek: async () => peekText, emit: () => {}, injectEscape: async () => ({ ok: false, error: "n/a" }),
      resumeAgent: async () => ({ ok: true }), log,
    });
    expect(fresh.executorFor({ sessionId: "s-1" })).toEqual({ state: "unknown", pane: null });
  });

  test("resolves the live pane from hints after a sweep", async () => {
    await reconciler.sweep();
    const result = reconciler.executorFor({ sessionId: "s-1" });
    expect(result.state).toBe("live");
    expect(result.pane?.paneRef).toBe("w1:p1");
  });
});
