import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { createGatesStore, type GatesStore, type GateQuestion, type GateOrigin } from "../gates-store.ts";
import { createGateHandlers } from "../handlers/gate.ts";
import type { EventsBus } from "../events-bus.ts";
import type { GateSubjectResult } from "../gate-subject.ts";

const log = pino({ level: "silent" });

let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const LAUNCH = "herd:acme-x/acme-1234-attorney";
const PANE = "wKW:p2";
const SESSION = "sess-review";

function questions(): GateQuestion[] {
  return [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }];
}

/** gate:fork-check reads the same resolveSubject seam gate:ask does, so one
    harness drives both: the ask files the gate, the check judges it. */
function harness(resolve: (args: { subject?: string; sessionId?: string }) => GateSubjectResult =
  () => ({ ok: false, error: "no subject" })) {
  const dir = mkdtempSync(join(tmpdir(), "rt-gate-fork-check-"));
  dirs.push(dir);
  const store: GatesStore = createGatesStore({ dbPath: join(dir, "gates.db"), log });
  let nextId = 1;
  const bus = { emitAt: () => nextId++ } as unknown as EventsBus;
  const seen: Array<{ subject?: string; sessionId?: string }> = [];
  const handlers = createGateHandlers(store, bus, () => {}, {
    resolveSubject: (args) => { seen.push(args); return resolve(args); },
  });
  const open = (subject: string, origin?: GateOrigin) =>
    store.open({ subject, kind: "plan", questions: questions(), ...(origin ? { origin } : {}) }).row;
  return { handlers, store, open, seen };
}

describe("gate:fork-check", () => {
  test("the receive-review case: a run gate gate:ask filed from this pane, with no worktree, allows", async () => {
    const { handlers, store } = harness(({ sessionId }) =>
      sessionId === SESSION ? { ok: true, subject: "run:r1", runId: "r1" } : { ok: false, error: "no subject" });
    const asked = await handlers["gate:ask"]({
      questions: questions(), sessionId: SESSION, paneId: PANE, context: "the plan under decision",
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(store.get(asked.data.id)!.origin?.worktree).toBeUndefined();

    const res = await handlers["gate:fork-check"]({
      sessionId: SESSION, paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"],
    });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "session", gateId: asked.data.id, subject: "run:r1" } });
  });

  test("an open run gate whose origin.paneId is this pane allows with no session to resolve", async () => {
    const { handlers, open } = harness();
    const gate = open("run:r1", { runId: "r1", paneId: PANE, presentation: "form" });
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "pane", gateId: gate.id } });
  });

  test("the same run gate denies a different pane", async () => {
    const { handlers, open } = harness();
    open("run:r1", { runId: "r1", paneId: PANE, presentation: "form" });
    const res = await handlers["gate:fork-check"]({ paneId: "wKW:p9", subject: LAUNCH, worktrees: ["/wt/other"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("a pane id that is a prefix of the gate's pane does not match", async () => {
    const { handlers, open } = harness();
    open("run:r1", { runId: "r1", paneId: "wKW:p20", presentation: "form" });
    const res = await handlers["gate:fork-check"]({ paneId: "wKW:p2", subject: LAUNCH });
    expect(res.ok && res.data.allow).toBe(false);
  });

  test("an open gate on the recorded subject allows", async () => {
    const { handlers, open } = harness();
    const gate = open(LAUNCH);
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "subject", gateId: gate.id } });
  });

  test("a parked gate on the recorded subject allows", async () => {
    const { handlers, store, open } = harness();
    const gate = open(LAUNCH);
    store.park(gate.id);
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "subject", gateId: gate.id } });
  });

  test("an answered or closed gate on the recorded subject denies", async () => {
    const { handlers, store, open } = harness();
    store.answer(open(LAUNCH).id, { q1: "yes" }, "board");
    store.close(open(LAUNCH).id, "abandoned");
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("an open gate on a same-prefix sibling subject never counts as this subject's", async () => {
    const { handlers, open } = harness();
    open("mr:1-sibling");
    const res = await handlers["gate:fork-check"]({ subject: "mr:1" });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("nothing open denies and reports the subject rt gate ask would file under", async () => {
    const { handlers, seen } = harness(() => ({ ok: true, subject: "run:r1", runId: "r1" }));
    const res = await handlers["gate:fork-check"]({ sessionId: SESSION, paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false, subject: "run:r1" } });
    expect(seen).toEqual([{ sessionId: SESSION }]);
  });

  test("a resolver refusal still lets the recorded subject, pane and worktree decide", async () => {
    const { handlers, open } = harness(() => ({ ok: false, error: "multiple running runs for this session" }));
    const gate = open("run:r2", { runId: "r2", worktree: "/wt/eomer", presentation: "wait" });
    const res = await handlers["gate:fork-check"]({ sessionId: SESSION, subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "worktree", gateId: gate.id } });
  });

  test("an open run gate for this worktree allows; one for another worktree does not", async () => {
    const { handlers, open } = harness();
    open("run:r1", { runId: "r1", worktree: "/wt/other", presentation: "wait" });
    const elsewhere = await handlers["gate:fork-check"]({ subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(elsewhere).toEqual({ ok: true, data: { allow: false } });
    const mine = open("run:r2", { runId: "r2", worktree: "/wt/eomer", presentation: "wait" });
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH, worktrees: ["/private/wt/eomer", "/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "worktree", gateId: mine.id } });
  });

  test("a parked run gate in this worktree or from this pane denies: the scans take open rows only", async () => {
    const { handlers, store, open } = harness();
    store.park(open("run:r1", { runId: "r1", worktree: "/wt/eomer", paneId: PANE, presentation: "form" }).id);
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("the pane and worktree scans read run: gates only", async () => {
    const { handlers, open } = harness();
    open("mr:https://x/1", { paneId: PANE, worktree: "/wt/eomer", presentation: "form" });
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });
});
