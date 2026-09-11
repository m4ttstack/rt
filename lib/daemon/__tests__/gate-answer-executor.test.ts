import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { createGatesStore, type GatesStore, type GateQuestion, type GateRow } from "../gates-store.ts";
import { createGateHandlers, relaunchExecutor } from "../handlers/gate.ts";
import type { EventsBus } from "../events-bus.ts";
import type { GatePush } from "../gate-push.ts";
import type { Reconciler, Expectation } from "../reconciler.ts";
import type { LivePane } from "../pane-resolve-live.ts";
import type { ExecutorState } from "../../../packages/rt-client/src/commands.ts";

const log = pino({ level: "silent" });

let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function qs(): GateQuestion[] {
  return [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];
}

function freshStore(): GatesStore {
  const dir = mkdtempSync(join(tmpdir(), "rt-gate-answer-executor-"));
  dirs.push(dir);
  return createGatesStore({ dbPath: join(dir, "gates.db"), log });
}

/** Records every push.onAnswered call -- default no-op delivery, since these
    tests are about the executor guarantee, not gate-push's own mechanics
    (covered by gate-push.test.ts). */
function pushSpy(): { push: GatePush; onAnsweredCalls: GateRow[] } {
  const onAnsweredCalls: GateRow[] = [];
  const push: GatePush = {
    onAnswered: async (row) => { onAnsweredCalls.push(row); },
    onOpened: async () => {},
    onClosed: async () => {},
    retryDeadPanes: async () => ({ retried: 0, delivered: 0, gaveUp: 0 }),
  };
  return { push, onAnsweredCalls };
}

/** A reconciler stub: `executorState` drives executorFor's return, `agentId`
    drives agentIdFor. expect/clear calls are recorded for assertion. */
function reconcilerStub(opts: { executorState?: ExecutorState; agentId?: string | null } = {}) {
  const expectCalls: Expectation[] = [];
  const clearCalls: string[] = [];
  const executorForCalls: unknown[] = [];
  const reconciler: Pick<Reconciler, "executorFor" | "expect" | "clear" | "agentIdFor"> = {
    executorFor: (hints) => {
      executorForCalls.push(hints);
      return { state: opts.executorState ?? "unknown", pane: null as LivePane | null };
    },
    expect: (e) => { expectCalls.push(e); },
    clear: (agentId) => { clearCalls.push(agentId); },
    agentIdFor: () => opts.agentId ?? null,
  };
  return { reconciler, expectCalls, clearCalls, executorForCalls };
}

function harness(opts: {
  push?: GatePush;
  reconciler?: Pick<Reconciler, "executorFor" | "expect" | "clear" | "agentIdFor">;
  resumeAgent?: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
} = {}) {
  const store = freshStore();
  const emitted: Array<{ topic: string; payload: unknown }> = [];
  let nextId = 1;
  const bus = {
    emitAt: (topic: string, payload: unknown) => { emitted.push({ topic, payload }); return nextId++; },
  } as unknown as EventsBus;
  const broadcasts: Array<{ type: string; data: any }> = [];
  const handlers = createGateHandlers(store, bus, (type, data) => broadcasts.push({ type, data }), {
    push: opts.push,
    log,
    reconciler: opts.reconciler,
    resumeAgent: opts.resumeAgent,
  });
  return { handlers, store, emitted, broadcasts };
}

async function openFormGate(store: GatesStore, subject = "run:r1"): Promise<GateRow> {
  const { row } = store.open({
    subject, kind: "clarify", questions: qs(),
    nudge: { session: "sess-1" },
    pane: "pane-7",
    origin: { presentation: "form", paneId: "pane-7" },
  });
  return row;
}

/** Small async-settle helper: the executor guarantee runs fire-and-forget
    off the hot path, so tests await a couple of microtask turns for it to
    finish before asserting on its side effects. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("gate:answer executor guarantee: live/blocked", () => {
  test("live executor: push fires and a leave-blocked expectation is registered", async () => {
    const { push, onAnsweredCalls } = pushSpy();
    const { reconciler, expectCalls } = reconcilerStub({ executorState: "live" });
    const { handlers, store } = harness({ push, reconciler });
    const row = await openFormGate(store);

    await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(onAnsweredCalls).toHaveLength(1);
    expect(expectCalls).toHaveLength(1);
    expect(expectCalls[0]).toMatchObject({ gateId: row.id, expect: "leave-blocked", deadlineSweeps: 2, retriesLeft: 2 });
  });

  test("blocked executor: also registers a leave-blocked expectation", async () => {
    const { push } = pushSpy();
    const { reconciler, expectCalls } = reconcilerStub({ executorState: "blocked" });
    const { handlers, store } = harness({ push, reconciler });
    const row = await openFormGate(store);

    await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(expectCalls).toHaveLength(1);
    expect(expectCalls[0]!.expect).toBe("leave-blocked");
  });
});

describe("gate:answer executor guarantee: gone", () => {
  test("relaunches via resumeAgent and registers an appear-live expectation on success", async () => {
    const { push } = pushSpy();
    const { reconciler, expectCalls } = reconcilerStub({ executorState: "gone", agentId: "agent-1" });
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => { resumeCalls.push(agentId); return { ok: true }; };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = await openFormGate(store);

    await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(resumeCalls).toEqual(["agent-1"]);
    expect(expectCalls).toHaveLength(1);
    expect(expectCalls[0]).toMatchObject({ gateId: row.id, agentId: "agent-1", expect: "appear-live", deadlineSweeps: 4, retriesLeft: 0 });
    expect(store.get(row.id)!.execution).toBeUndefined();
  });

  test("resumeAgent failure stamps execution unassigned and emits reconciler.execution", async () => {
    const { push } = pushSpy();
    const { reconciler } = reconcilerStub({ executorState: "gone", agentId: "agent-1" });
    const resumeAgent = async () => ({ ok: false, error: "herdr down" });
    const { handlers, store, emitted } = harness({ push, reconciler, resumeAgent });
    const row = await openFormGate(store);

    await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(store.get(row.id)!.execution).toBe("unassigned");
    expect(emitted.some((e) => e.topic === "reconciler.execution" && (e.payload as any).execution === "unassigned")).toBe(true);
  });

  test("no agent row resolvable stamps execution unassigned without calling resumeAgent", async () => {
    const { push } = pushSpy();
    const { reconciler } = reconcilerStub({ executorState: "gone", agentId: null });
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => { resumeCalls.push(agentId); return { ok: true }; };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = await openFormGate(store);

    await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(resumeCalls).toHaveLength(0);
    expect(store.get(row.id)!.execution).toBe("unassigned");
  });

  test("answered gate whose executor is gone triggers exactly one resumeAgent call even when answered twice concurrently", async () => {
    const { push } = pushSpy();
    const { reconciler } = reconcilerStub({ executorState: "gone", agentId: "agent-1" });
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => {
      resumeCalls.push(agentId);
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true };
    };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = await openFormGate(store);

    await Promise.all([
      handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" }),
      handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" }),
    ]);
    await flush();
    await new Promise((r) => setTimeout(r, 20));

    expect(resumeCalls).toHaveLength(1);
  });
});

describe("gate:answer executor guarantee: single-flight relaunch", () => {
  test("a manual focus/relaunch racing the single-flight returns the in-flight launch, never spawns a second executor", async () => {
    let calls = 0;
    const resumeAgent = async (agentId: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, agentId };
    };
    const [a, b] = await Promise.all([
      relaunchExecutor(resumeAgent, "gate-race-1", "agent-1"),
      relaunchExecutor(resumeAgent, "gate-race-1", "agent-1"),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});

describe("gate:answer controller ruling: repeat POST on an unassigned gate", () => {
  test("identical answers on an already-answered, unassigned gate is a RETRY: ok, no conflict, guarantee re-runs", async () => {
    const { push } = pushSpy();
    let attempt = 0;
    const { reconciler, expectCalls } = reconcilerStub({ executorState: "gone", agentId: "agent-1" });
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => {
      resumeCalls.push(agentId);
      attempt++;
      return attempt === 1 ? { ok: false, error: "herdr down" } : { ok: true };
    };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = await openFormGate(store);

    const first = await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();
    expect(first.ok).toBe(true);
    expect(store.get(row.id)!.execution).toBe("unassigned");

    const retry = await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(retry.ok).toBe(true);
    if (retry.ok) expect((retry.data as any).conflict).toBeUndefined();
    expect(resumeCalls).toHaveLength(2); // re-ran the guarantee
  });

  test("different answers on an unassigned gate keep today's conflict behavior, guarantee does not re-run", async () => {
    const { push } = pushSpy();
    const { reconciler } = reconcilerStub({ executorState: "gone", agentId: "agent-1" });
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => { resumeCalls.push(agentId); return { ok: false, error: "herdr down" }; };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = await openFormGate(store);

    await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();
    expect(store.get(row.id)!.execution).toBe("unassigned");
    expect(resumeCalls).toHaveLength(1);

    const conflicting = await handlers["gate:answer"]({ id: row.id, answers: { q: "b" }, by: "pane" });
    await flush();

    expect(conflicting.ok).toBe(true);
    if (conflicting.ok) expect((conflicting.data as any).conflict).toBe(true);
    expect(resumeCalls).toHaveLength(1); // not re-run
  });
});

describe("gate:answer attention-gate routing (kind pane-attention)", () => {
  function openAttentionGate(store: GatesStore, agentId = "agent-1"): GateRow {
    const { row } = store.open({
      subject: "agent:agent-1", kind: "pane-attention",
      questions: [{ id: "action", label: "Pane needs attention", multi: false, options: ["focus-pane", "resume", "clear", "dismiss"] }],
      meta: { agentId, paneRef: "pane-7", reason: "blocked" },
    });
    return row;
  }

  test('"clear" calls reconciler.clear(meta.agentId)', async () => {
    const { push } = pushSpy();
    const { reconciler, clearCalls } = reconcilerStub();
    const { handlers, store } = harness({ push, reconciler });
    const row = openAttentionGate(store, "agent-9");

    await handlers["gate:answer"]({ id: row.id, answers: { action: "clear" }, by: "board" });
    await flush();

    expect(clearCalls).toEqual(["agent-9"]);
  });

  test('"resume" triggers the relaunch path and registers appear-live on success', async () => {
    const { push } = pushSpy();
    const { reconciler, expectCalls } = reconcilerStub();
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => { resumeCalls.push(agentId); return { ok: true }; };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = openAttentionGate(store, "agent-9");

    await handlers["gate:answer"]({ id: row.id, answers: { action: "resume" }, by: "board" });
    await flush();

    expect(resumeCalls).toEqual(["agent-9"]);
    expect(expectCalls).toHaveLength(1);
    expect(expectCalls[0]).toMatchObject({ agentId: "agent-9", expect: "appear-live" });
  });

  test('"dismiss" closes the gate only -- no clear, no resume', async () => {
    const { push } = pushSpy();
    const { reconciler, clearCalls } = reconcilerStub();
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => { resumeCalls.push(agentId); return { ok: true }; };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = openAttentionGate(store, "agent-9");

    const res = await handlers["gate:answer"]({ id: row.id, answers: { action: "dismiss" }, by: "board" });
    await flush();

    expect(res.ok).toBe(true);
    expect(clearCalls).toHaveLength(0);
    expect(resumeCalls).toHaveLength(0);
  });

  test('"focus-pane" is a server-side no-op', async () => {
    const { push } = pushSpy();
    const { reconciler, clearCalls } = reconcilerStub();
    const resumeCalls: string[] = [];
    const resumeAgent = async (agentId: string) => { resumeCalls.push(agentId); return { ok: true }; };
    const { handlers, store } = harness({ push, reconciler, resumeAgent });
    const row = openAttentionGate(store, "agent-9");

    await handlers["gate:answer"]({ id: row.id, answers: { action: "focus-pane" }, by: "board" });
    await flush();

    expect(clearCalls).toHaveLength(0);
    expect(resumeCalls).toHaveLength(0);
  });
});

describe("gate:answer executor guarantee: no reconciler wired", () => {
  test("is a no-op when reconciler is omitted (degraded boot, or handler-only tests)", async () => {
    const { push, onAnsweredCalls } = pushSpy();
    const { handlers, store } = harness({ push });
    const row = await openFormGate(store);

    const res = await handlers["gate:answer"]({ id: row.id, answers: { q: "a" }, by: "console" });
    await flush();

    expect(res.ok).toBe(true);
    expect(onAnsweredCalls).toHaveLength(1);
  });
});
