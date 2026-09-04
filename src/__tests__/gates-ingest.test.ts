import { describe, expect, test } from "bun:test";
import type { GateRow as FacilityGateRow } from "@mattstack/rt-client";
import {
  ingestRelayFrame,
  reconcileGatesOnBoot,
  ensureBridgeRule,
  GATE_OPENED_BRIDGE_RULE,
  type EventBridgeRule,
  type GateCacheTarget,
  type GateReconcileTarget,
} from "../gates/ingest.ts";

function fakeCache(): { target: GateCacheTarget; applied: unknown[] } {
  const applied: unknown[] = [];
  return { target: { applyEvent: (frame) => applied.push(frame) }, applied };
}

function fakeNotify(): { notify: () => void; calls: number } {
  const state = { calls: 0 };
  return { notify: () => state.calls++, calls: state.calls };
}

describe("ingestRelayFrame", () => {
  test("a gate/** frame with an mr: subject applies to the cache and notifies", () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(target, { topic: "gate/opened/g1", payload: { subject: "mr:https://gitlab.com/acme/webapp/-/merge_requests/1" } }, () => notified++);
    expect(applied).toHaveLength(1);
    expect(notified).toBe(1);
  });

  test("a gate/** frame with a non-mr: subject is ignored", () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(target, { topic: "gate/opened/g1", payload: { subject: "run:abc123" } }, () => notified++);
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });

  test("a non-gate topic is ignored", () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    ingestRelayFrame(target, { topic: "project-mrs", payload: { subject: "mr:https://gitlab.com/acme/webapp/-/merge_requests/1" } }, () => notified++);
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });

  test("a malformed payload is ignored without throwing", () => {
    const { target, applied } = fakeCache();
    let notified = 0;
    expect(() => ingestRelayFrame(target, { topic: "gate/opened/g1", payload: null }, () => notified++)).not.toThrow();
    expect(applied).toHaveLength(0);
    expect(notified).toBe(0);
  });
});

function fakeRow(id: string): FacilityGateRow {
  return {
    id,
    subject: `mr:https://gitlab.com/acme/webapp/-/merge_requests/${id}`,
    kind: "review-post",
    questions: [],
    meta: null,
    status: "open",
    answer: null,
    openedAt: 1000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
  };
}

describe("reconcileGatesOnBoot", () => {
  test("pages gateList by cursor and reconciles all rows gathered", async () => {
    const calls: unknown[] = [];
    const list = async (payload: { subjectPrefix: string; cursor?: number }) => {
      calls.push(payload);
      if (!payload.cursor) return { ok: true, data: { gates: [fakeRow("1"), fakeRow("2")], cursor: 2 } };
      return { ok: true, data: { gates: [fakeRow("3")], cursor: 0 } };
    };
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = { reconcile: (rows) => reconciled.push(rows) };

    await reconcileGatesOnBoot(list, cache);

    expect(calls).toEqual([{ subjectPrefix: "mr:", cursor: undefined }, { subjectPrefix: "mr:", cursor: 2 }]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  test("a single page (cursor 0) reconciles once with no further calls", async () => {
    const list = async () => ({ ok: true, data: { gates: [fakeRow("1")], cursor: 0 } });
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = { reconcile: (rows) => reconciled.push(rows) };

    await reconcileGatesOnBoot(list, cache);

    expect(reconciled).toEqual([[fakeRow("1")]]);
  });

  test("a failed page stops paging and reconciles whatever was gathered so far", async () => {
    const list = async (payload: { subjectPrefix: string; cursor?: number }) => {
      if (!payload.cursor) return { ok: true, data: { gates: [fakeRow("1")], cursor: 2 } };
      return { ok: false, error: "boom" };
    };
    const reconciled: FacilityGateRow[][] = [];
    const cache: GateReconcileTarget = { reconcile: (rows) => reconciled.push(rows) };

    await expect(reconcileGatesOnBoot(list, cache)).resolves.toBeUndefined();
    expect(reconciled).toEqual([[fakeRow("1")]]);
  });
});

describe("ensureBridgeRule", () => {
  function fakeIo(initial: EventBridgeRule[]): { read: () => EventBridgeRule[]; write: (next: EventBridgeRule[]) => void; writes: EventBridgeRule[][] } {
    let current = initial;
    const writes: EventBridgeRule[][] = [];
    return {
      read: () => current,
      write: (next) => {
        writes.push(next);
        current = next;
      },
      writes,
    };
  }

  test("rule pattern is gate/opened/*, template renders label, no per-rule suppression field", () => {
    expect(GATE_OPENED_BRIDGE_RULE.pattern).toBe("gate/opened/*");
    expect(GATE_OPENED_BRIDGE_RULE.title).toContain("{label}");
    // Suppression is payload-driven (a bridge event's own `paneId`), not a
    // property of the rule -- the rule carries only pattern/category/title/message.
    expect(Object.keys(GATE_OPENED_BRIDGE_RULE).sort()).toEqual(["category", "message", "pattern", "title"]);
  });

  test("neither rule present: the gate-opened rule is added", () => {
    const io = fakeIo([]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([GATE_OPENED_BRIDGE_RULE]);
  });

  test("new-pattern rule already present: unchanged, no duplicate written", () => {
    const io = fakeIo([GATE_OPENED_BRIDGE_RULE]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(0);
  });

  test("old board/gate/opened/* rule present: replaced with the new-pattern rule, not duplicated", () => {
    const legacy: EventBridgeRule = { pattern: "board/gate/opened/*", category: "gate", title: "review gate: !{iid}", message: "{mrUrl}" };
    const io = fakeIo([legacy]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([GATE_OPENED_BRIDGE_RULE]);
  });

  test("unrelated entries are preserved alongside the appended rule", () => {
    const other: EventBridgeRule = { pattern: "chat/mention/*", category: "chat", title: "mention", message: "{body}" };
    const io = fakeIo([other]);
    ensureBridgeRule(io.read, io.write);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toEqual([other, GATE_OPENED_BRIDGE_RULE]);
  });
});
