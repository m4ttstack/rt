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

describe("gate-escalation herd summary", () => {
  const MIN = 60_000;
  let start: number;
  let clock: number;
  beforeEach(() => { start = Date.now(); clock = start; });

  const summaries = () => emitted.filter((e) => e.topic.startsWith("herd/gates-waiting/"));

  function openFor(herd: string, label: string) {
    return store.open({ ...baseOpen(), owner: `herd:${herd}`, pane: "worker-pane", meta: { label } }).row;
  }

  function liveShepherd(herd: string) {
    store.subscribe({ subjectPrefix: "", session: `shep-${herd}`, scope: "owner", ownerRef: `herd:${herd}` });
  }

  function make(panes: Record<string, string | null>, quietMins = 30) {
    return createGateEscalation({
      store, ttlMs: () => 10 * MIN, emit, log, now: () => clock,
      herds: { shepherdPane: (id) => panes[id] ?? null, quietMs: () => quietMins * MIN },
    });
  }

  test("one summary per herd, counting its waiting gates and focusing the shepherd pane", () => {
    const herd = "cv-sentry-20260923-123200";
    liveShepherd(herd);
    openFor(herd, "plan");
    openFor(herd, "self-review");
    openFor(herd, "plan");
    clock = start + 24 * MIN;
    expect(make({ [herd]: "wKM:p1" }).sweep()).toBe(3);
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0]!.topic).toBe(`herd/gates-waiting/${herd}`);
    expect(summaries()[0]!.payload).toEqual({
      herd, count: 3, paneId: "wKM:p1", shepherdGone: false,
      headline: "cv-sentry is waiting on its shepherd",
      summary: "3 worker gates waiting, the oldest for 24 min: plan, self-review",
    });
  });

  test("herds are summarized separately, each focusing its own shepherd", () => {
    liveShepherd("a-20260923-000001");
    liveShepherd("b-20260923-000002");
    openFor("a-20260923-000001", "plan");
    openFor("b-20260923-000002", "ship");
    clock = start + 15 * MIN;
    make({ "a-20260923-000001": "p-a", "b-20260923-000002": "p-b" }).sweep();
    expect(summaries().map((e) => e.payload.paneId).sort()).toEqual(["p-a", "p-b"]);
  });

  test("a single gate reads singular", () => {
    liveShepherd("solo-20260923-000001");
    openFor("solo-20260923-000001", "evidence");
    clock = start + 12 * MIN;
    make({ "solo-20260923-000001": "p" }).sweep();
    expect(summaries()[0]!.payload.summary).toBe("1 worker gate waiting for 12 min: evidence");
  });

  test("a gone shepherd says so and carries no pane to focus", () => {
    openFor("lost-20260923-000001", "plan");
    make({ "lost-20260923-000001": "p" }).sweep();
    const s = summaries()[0]!;
    expect(s.payload.shepherdGone).toBe(true);
    expect(s.payload.paneId).toBeUndefined();
    expect(s.payload.headline).toBe("lost has lost its shepherd");
    expect(s.payload.summary).toBe("1 worker gate has nobody to answer it: plan");
  });

  test("gates still inside the TTL raise no summary", () => {
    liveShepherd("h-20260923-000001");
    openFor("h-20260923-000001", "plan");
    clock = start + 3 * MIN;
    make({ "h-20260923-000001": "p" }).sweep();
    expect(summaries()).toHaveLength(0);
  });

  test("an escalation inside the quiet window waits for it, then reports the current count", () => {
    const herd = "q-20260923-000001";
    liveShepherd(herd);
    openFor(herd, "plan");
    const esc = make({ [herd]: "p" }, 30);
    clock = start + 11 * MIN;
    esc.sweep();
    expect(summaries()).toHaveLength(1);

    openFor(herd, "ship");
    clock = start + 16 * MIN;
    expect(esc.sweep()).toBe(1);
    expect(summaries()).toHaveLength(1);

    clock = start + 42 * MIN;
    esc.sweep();
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1]!.payload.count).toBe(2);
  });

  test("no new escalation means no repeat summary, even after the quiet window", () => {
    const herd = "r-20260923-000001";
    liveShepherd(herd);
    openFor(herd, "plan");
    const esc = make({ [herd]: "p" });
    clock = start + 11 * MIN;
    esc.sweep();
    clock = start + 90 * MIN;
    esc.sweep();
    expect(summaries()).toHaveLength(1);
  });

  test("a held summary is dropped once the herd's gates are all answered", () => {
    const herd = "d-20260923-000001";
    liveShepherd(herd);
    const first = openFor(herd, "plan");
    const esc = make({ [herd]: "p" });
    clock = start + 11 * MIN;
    esc.sweep();
    const second = openFor(herd, "ship");
    clock = start + 16 * MIN;
    esc.sweep();
    store.answer(first.id, { q: "a" }, "shepherd");
    store.answer(second.id, { q: "a" }, "shepherd");
    clock = start + 50 * MIN;
    esc.sweep();
    expect(summaries()).toHaveLength(1);
  });

  test("more than four labels collapse into a count", () => {
    const herd = "m-20260923-000001";
    liveShepherd(herd);
    for (const l of ["a", "b", "c", "d", "e", "f"]) openFor(herd, l);
    clock = start + 30 * MIN;
    make({ [herd]: "p" }).sweep();
    expect(summaries()[0]!.payload.summary).toBe("6 worker gates waiting, the oldest for 30 min: a, b, c, d and 2 more");
  });

  test("a throwing summary emit is retried on the next sweep", () => {
    const herd = "t-20260923-000001";
    liveShepherd(herd);
    openFor(herd, "plan");
    let fail = true;
    const flaky = (topic: string, payload: Record<string, unknown>) => {
      if (fail && topic.startsWith("herd/")) throw new Error("boom");
      emitted.push({ topic, payload });
    };
    const esc = createGateEscalation({
      store, ttlMs: () => 10 * MIN, emit: flaky, log, now: () => clock,
      herds: { shepherdPane: () => "p", quietMs: () => 30 * MIN },
    });
    clock = start + 11 * MIN;
    esc.sweep();
    expect(summaries()).toHaveLength(0);
    fail = false;
    esc.sweep();
    expect(summaries()).toHaveLength(1);
  });

  test("without herds deps the sweep emits only per-gate events", () => {
    store.open({ ...baseOpen(), owner: "herd:h-1" });
    createGateEscalation({ store, ttlMs: () => 0, emit, log }).sweep();
    expect(summaries()).toHaveLength(0);
    expect(emitted).toHaveLength(1);
  });
});
