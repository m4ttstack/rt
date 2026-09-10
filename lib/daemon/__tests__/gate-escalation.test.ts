import { describe, test, expect, beforeEach } from "bun:test";
import pino from "pino";
import { createGatesStore, type GateQuestion, type GatesStore } from "../gates-store.ts";
import { createGateEscalation } from "../gate-escalation.ts";

const log = pino({ level: "silent" });

function qs(): GateQuestion[] {
  return [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];
}

/** A fresh subject per call (unless overridden) so unrelated opens in the
    same test never trip the store's same-subject-and-kind supersede rule. */
function baseOpen(overrides: { kind?: string } = {}) {
  return {
    subject: `escalate:${crypto.randomUUID()}`,
    kind: overrides.kind ?? "clarify",
    questions: qs(),
  };
}

let store: GatesStore;
let emitted: Array<{ topic: string; payload: Record<string, unknown> }>;
let emit: (topic: string, payload: Record<string, unknown>) => void;

beforeEach(() => {
  store = createGatesStore({ dbPath: ":memory:", log });
  emitted = [];
  emit = (topic, payload) => { emitted.push({ topic, payload }); };
});

describe("gate-escalation sweep", () => {
  test("sweep escalates an owned gate past the TTL exactly once", () => {
    const { row } = store.open({ ...baseOpen(), owner: "herd:h-1" });
    const esc = createGateEscalation({ store, ttlMs: () => 0, emit, log });
    expect(esc.sweep()).toBe(1);
    expect(emitted[0]!.topic).toBe(`gate/escalated/${row.id}`);
    expect(emitted[0]!.payload.reason).toBe("ttl");
    expect(esc.sweep()).toBe(0);
  });

  test("sweep escalates immediately when the owner's subscription is dead", () => {
    store.subscribe({ subjectPrefix: "", session: "shep", scope: "owner", ownerRef: "herd:h-1" });
    const sub = store.subscriptions({})[0]!;
    store.markSubscriptionDead(sub.id);
    store.open({ ...baseOpen(), owner: "herd:h-1" });
    const esc = createGateEscalation({ store, ttlMs: () => 60 * 60 * 1000, emit, log });
    expect(esc.sweep()).toBe(1);
    expect(emitted[0]!.payload.reason).toBe("owner-dead");
  });

  test("sweep ignores human-owned and unowned gates", () => {
    store.open(baseOpen());
    store.open({ ...baseOpen({ kind: "k2" }), owner: "human" });
    const esc = createGateEscalation({ store, ttlMs: () => 0, emit, log });
    expect(esc.sweep()).toBe(0);
  });

  test("a live owner subscription holds off escalation until the TTL elapses", () => {
    store.subscribe({ subjectPrefix: "", session: "shep", scope: "owner", ownerRef: "herd:h-1" });
    store.open({ ...baseOpen(), owner: "herd:h-1" });
    const esc = createGateEscalation({ store, ttlMs: () => 60 * 60 * 1000, emit, log });
    expect(esc.sweep()).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  test("escalation payload carries id/subject/kind/label/owner/reason/paneId/origin", () => {
    const { row } = store.open({
      subject: "run:r1", kind: "clarify", questions: qs(),
      owner: "herd:h-9", pane: "pane-1", meta: { label: "Pick a path" },
      origin: { presentation: "wait" },
    });
    const esc = createGateEscalation({ store, ttlMs: () => 0, emit, log });
    expect(esc.sweep()).toBe(1);
    expect(emitted[0]!.payload).toEqual({
      id: row.id, subject: row.subject, kind: row.kind, label: "Pick a path",
      owner: "herd:h-9", reason: "ttl", paneId: "pane-1", origin: row.origin,
    });
  });

  test("a throwing emit for one gate does not stall the sweep for the rest", () => {
    const { row: bad } = store.open({ ...baseOpen(), owner: "herd:h-1" });
    const { row: good } = store.open({ ...baseOpen(), owner: "herd:h-2" });
    const badEmit = (topic: string, payload: Record<string, unknown>) => {
      if (payload.id === bad.id) throw new Error("boom");
      emitted.push({ topic, payload });
    };
    const esc = createGateEscalation({ store, ttlMs: () => 0, emit: badEmit, log });
    expect(esc.sweep()).toBe(1);
    expect(store.get(bad.id)!.escalatedAt).toBeNull();
    expect(store.get(good.id)!.escalatedAt).not.toBeNull();
  });
});
