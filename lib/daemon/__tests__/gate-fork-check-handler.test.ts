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
const FORM = { presentation: "form" } as const;

function questions(): GateQuestion[] {
  return [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }];
}

/** gate:fork-check reads the same resolveSubject seam gate:ask does, so one
    harness drives both: the ask files the gate, the check judges it. `seen`
    records every resolver call, which is the per-session run DB walk. */
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
  const open = (subject: string, opts: { origin?: GateOrigin; pane?: string; nudge?: string; kind?: string } = {}) =>
    store.open({
      subject, kind: opts.kind ?? "plan", questions: questions(),
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.pane ? { pane: opts.pane } : {}),
      ...(opts.nudge ? { nudge: { session: opts.nudge } } : {}),
    }).row;
  return { handlers, store, open, seen };
}

const runSession = (runId: string) => ({ sessionId }: { sessionId?: string }): GateSubjectResult =>
  sessionId === SESSION ? { ok: true, subject: `run:${runId}`, runId } : { ok: false, error: "no subject" };

describe("gate:fork-check pane rule", () => {
  test("the receive-review case: the form gate gate:ask filed from this pane, with no worktree, allows", async () => {
    const { handlers, store } = harness(runSession("r1"));
    const asked = await handlers["gate:ask"]({
      questions: questions(), sessionId: SESSION, paneId: PANE, context: "the plan under decision",
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    const row = store.get(asked.data.id)!;
    expect(row.origin?.worktree).toBeUndefined();
    expect(row.origin?.presentation).toBe("form");

    const res = await handlers["gate:fork-check"]({
      sessionIds: [SESSION], paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"],
    });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "pane", gateId: asked.data.id } });
  });

  test("a form gate asked with an explicit subject from this pane allows", async () => {
    const { handlers, open } = harness();
    const gate = open("mr:https://x/1", { origin: { ...FORM, paneId: PANE }, nudge: SESSION });
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "pane", gateId: gate.id } });
  });

  test("with no caller session, the pane alone decides", async () => {
    const { handlers, open } = harness();
    const gate = open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE }, nudge: SESSION });
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "pane", gateId: gate.id } });
  });

  test("the top-level pane column stands in when origin carries no paneId", async () => {
    const { handlers, open } = harness();
    const gate = open("run:r1", { origin: { ...FORM, runId: "r1" }, pane: PANE });
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "pane", gateId: gate.id } });
  });

  test("a different pane denies", async () => {
    const { handlers, open } = harness();
    open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE } });
    const res = await handlers["gate:fork-check"]({ paneId: "wKW:p9", subject: LAUNCH, worktrees: ["/wt/other"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("a pane id that is a prefix of the gate's pane does not match", async () => {
    const { handlers, open } = harness();
    open("run:r1", { origin: { ...FORM, runId: "r1", paneId: "wKW:p20" } });
    const res = await handlers["gate:fork-check"]({ paneId: "wKW:p2", subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("a stale pane id denies: the gate's executor is gone", async () => {
    const { handlers, store, open } = harness();
    store.markExecutor(open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE } }).id, "gone");
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("a reused pane id under a different session denies", async () => {
    const { handlers, open } = harness();
    open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE }, nudge: "sess-previous-launch" });
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("hook and env session ids that differ: a gate stamped with the env id still allows", async () => {
    const { handlers, open } = harness();
    const gate = open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE }, nudge: "sess-env" });
    const res = await handlers["gate:fork-check"]({ sessionIds: ["sess-hook", "sess-env"], paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "pane", gateId: gate.id } });
  });

  test("a wait gate from this pane denies", async () => {
    const { handlers, open } = harness();
    open("run:r1", { origin: { presentation: "wait", runId: "r1", paneId: PANE } });
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });
});

describe("gate:fork-check never counts a pane-attention gate", () => {
  const ATTENTION = { kind: "pane-attention", origin: { presentation: "wait" as const, paneId: PANE, worktree: "/wt/eomer" } };

  test("filed under the launch subject, open or parked, it denies", async () => {
    const { handlers, store, open } = harness();
    const gate = open(LAUNCH, ATTENTION);
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
    store.park(gate.id);
    const parked = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH });
    expect(parked).toEqual({ ok: true, data: { allow: false } });
  });

  test("filed under a run: subject for this worktree, it denies", async () => {
    const { handlers, open } = harness();
    open("run:r1", ATTENTION);
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("filed under the subject the session resolves to, it denies", async () => {
    const { handlers, open } = harness(runSession("r1"));
    open("run:r1", ATTENTION);
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false, subject: "run:r1" } });
  });
});

describe("gate:fork-check launch subject rule", () => {
  test("an open gate on the launch subject allows, without walking run DBs", async () => {
    const { handlers, open, seen } = harness(runSession("r1"));
    const gate = open(LAUNCH);
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "subject", gateId: gate.id } });
    expect(seen).toEqual([]);
  });

  test("a parked gate on the launch subject allows", async () => {
    const { handlers, store, open } = harness();
    const gate = open(LAUNCH);
    store.park(gate.id);
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "subject", gateId: gate.id } });
  });

  test("an answered or closed gate on the launch subject denies", async () => {
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
});

describe("gate:fork-check worktree rule", () => {
  test("an open run gate for this worktree allows, without walking run DBs; one for another worktree does not", async () => {
    const { handlers, open, seen } = harness(runSession("r9"));
    open("run:r1", { origin: { presentation: "wait", runId: "r1", worktree: "/wt/other" } });
    const elsewhere = await handlers["gate:fork-check"]({ subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(elsewhere).toEqual({ ok: true, data: { allow: false } });
    const mine = open("run:r2", { origin: { presentation: "wait", runId: "r2", worktree: "/wt/eomer" } });
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], subject: LAUNCH, worktrees: ["/private/wt/eomer", "/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "worktree", gateId: mine.id } });
    expect(seen).toEqual([]);
  });

  test("reads run: gates only", async () => {
    const { handlers, open } = harness();
    open("mr:https://x/1", { origin: { presentation: "wait", worktree: "/wt/eomer" } });
    const res = await handlers["gate:fork-check"]({ subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });

  test("a parked run gate in this worktree or from this pane denies", async () => {
    const { handlers, store, open } = harness();
    store.park(open("run:r1", { origin: { ...FORM, runId: "r1", worktree: "/wt/eomer", paneId: PANE } }).id);
    const res = await handlers["gate:fork-check"]({ paneId: PANE, subject: LAUNCH, worktrees: ["/wt/eomer"] });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });
});

describe("gate:fork-check session rule", () => {
  test("a relaunched pane (new pane id, same session) reaches its run gate through the resolver", async () => {
    const { handlers, open, seen } = harness(runSession("r1"));
    const gate = open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE }, nudge: SESSION });
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], paneId: "wKW:p5", subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "session", gateId: gate.id } });
    expect(seen).toEqual([{ sessionId: SESSION }]);
  });

  test("differing hook and env session ids: each is resolved, and the env one reaches its run", async () => {
    const { handlers, open, seen } = harness(runSession("r1"));
    const gate = open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE }, nudge: SESSION });
    const res = await handlers["gate:fork-check"]({ sessionIds: ["sess-hook", SESSION], paneId: "wKW:p5", subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: true, match: "session", gateId: gate.id } });
    expect(seen).toEqual([{ sessionId: "sess-hook" }, { sessionId: SESSION }]);
  });

  test("a parked gate on the resolved run subject denies, naming that subject", async () => {
    const { handlers, store, open } = harness(runSession("r1"));
    store.park(open("run:r1", { origin: { ...FORM, runId: "r1", paneId: PANE }, nudge: SESSION }).id);
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], paneId: "wKW:p5", subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false, subject: "run:r1" } });
  });

  test("nothing open denies and reports the subject rt gate ask would file under", async () => {
    const { handlers, seen } = harness(runSession("r1"));
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], paneId: PANE, subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false, subject: "run:r1" } });
    expect(seen).toEqual([{ sessionId: SESSION }]);
  });

  test("a resolver refusal denies with no subject to name", async () => {
    const { handlers } = harness(() => ({ ok: false, error: "multiple running runs for this session" }));
    const res = await handlers["gate:fork-check"]({ sessionIds: [SESSION], subject: LAUNCH });
    expect(res).toEqual({ ok: true, data: { allow: false } });
  });
});
