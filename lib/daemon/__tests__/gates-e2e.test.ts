/**
 * Gate facility e2e: race and lifecycle behaviors that only show up across
 * concurrent calls or a store restart, not in the per-verb unit tests
 * (gates-handlers.test.ts, gates-store.test.ts). Same harness idiom as
 * gates-handlers.test.ts: real store on a tmp db, fake bus, fake broadcast.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { createGatesStore, type GatesStore, type GateQuestion } from "../gates-store.ts";
import { createGateHandlers } from "../handlers/gate.ts";
import { createGatePush } from "../gate-push.ts";
import type { EventsBus } from "../events-bus.ts";

const log = pino({ level: "silent" });

let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

/** A fresh tmp dir per call, joined with `name`; every dir is swept in afterEach. */
function tmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-gates-e2e-"));
  dirs.push(dir);
  return join(dir, name);
}

function qs(): GateQuestion[] {
  return [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }];
}

/** Real store on a fresh tmp db, a fake bus, and a fake broadcast -- mirrors gates-handlers.test.ts. */
function harness() {
  const store: GatesStore = createGatesStore({ dbPath: tmp("gates.db"), log });
  const bus = { emitAt: () => 1 } as unknown as EventsBus;
  const handlers = createGateHandlers(store, bus, () => {});
  return { handlers, store };
}

async function open(handlers: ReturnType<typeof createGateHandlers>) {
  const r = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: qs() });
  if (!r.ok) throw new Error("open failed");
  return r.data;
}

describe("gate facility e2e", () => {
  test("CAS race: two concurrent answers, exactly one non-conflict winner, the loser carries the winner", async () => {
    const { handlers } = harness();
    const id = (await open(handlers)).id;
    const [a, b] = await Promise.all([
      handlers["gate:answer"]({ id, answers: { q: "a" }, by: "console" }),
      handlers["gate:answer"]({ id, answers: { q: "b" }, by: "board" }),
    ]);
    expect(a.ok && b.ok).toBe(true); // conflict is a defined outcome, not an error
    const results = [a, b].filter((r): r is typeof r & { ok: true } => r.ok);
    const winners = results.filter((r) => !r.data.conflict);
    const losers = results.filter((r) => r.data.conflict);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0]!.data.row.answer?.by).toBe(winners[0]!.data.row.answer?.by);
  });

  test("close releases waiters with status closed", async () => {
    const { handlers, store } = harness();
    const id = (await open(handlers)).id;
    const w = store.wait(id, { waitMs: 5000 });
    await handlers["gate:close"]({ id, reason: "abandoned" });
    expect((await w).status).toBe("closed");
  });

  test("wait re-entry across a store close/reopen (daemon restart) resumes correctly", async () => {
    const p = tmp("gates.db");
    const s1 = createGatesStore({ dbPath: p, log });
    const id = s1.open({ subject: "run:r1", kind: "clarify", questions: qs() }).row.id;
    s1.close_();                                     // "restart"
    const s2 = createGatesStore({ dbPath: p, log });
    const w = s2.wait(id, { waitMs: 5000 });         // re-entry: registry-status-first
    s2.answer(id, { q: "a" }, "pane");
    expect((await w).status).toBe("answered");
    s2.close_();
  });
});

/** The re-delivery sweep and the consumption stamp are two halves of one
    loop that no unit file spans: the sweep lives in gate-push, the stamp in
    the gate:wait handler, and the proof that a run: pane is woken once and
    only once needs both wired to the same store. */
describe("re-delivery meets consumption (run: subjects)", () => {
  function sweepHarness() {
    const store: GatesStore = createGatesStore({ dbPath: tmp("gates.db"), log });
    const bus = { emitAt: () => 1 } as unknown as EventsBus;
    const handlers = createGateHandlers(store, bus, () => {});
    const doorbells: string[] = [];
    const push = createGatePush({
      store,
      deliver: async (socketPath) => { doorbells.push(socketPath); return { ok: true as const }; },
      resolveSession: (id) => ({ socketPath: id }),
      log,
    });
    return { store, handlers, push, doorbells };
  }

  async function answeredRunGate(h: ReturnType<typeof sweepHarness>) {
    const opened = await h.handlers["gate:open"]({
      subject: "run:r1", kind: "clarify", questions: qs(),
      pane: "w1:p1", nudge: { session: "sess-1" },
      origin: { presentation: "form", paneId: "w1:p1" },
    });
    if (!opened.ok) throw new Error("open failed");
    await h.handlers["gate:answer"]({ id: opened.data.id, answers: { q: "a" }, by: "console" });
    await h.push.onAnswered(h.store.get(opened.data.id)!);
    h.doorbells.length = 0;
    return opened.data.id;
  }

  test("a run: pane that never read its answer is re-pushed on the 4th sweep", async () => {
    const h = sweepHarness();
    await answeredRunGate(h);
    for (let i = 0; i < 3; i++) expect((await h.push.retryDeadPanes()).reNudged).toBe(0);
    expect((await h.push.retryDeadPanes()).reNudged).toBe(1);
    expect(h.doorbells).toEqual(["sess-1"]);
  });

  test("a run: pane that read its answer through gate:wait is never re-pushed again", async () => {
    const h = sweepHarness();
    const id = await answeredRunGate(h);
    await h.handlers["gate:wait"]({ id, sessionId: "sess-1" });
    for (let i = 0; i < 12; i++) expect((await h.push.retryDeadPanes()).reNudged).toBe(0);
    expect(h.doorbells).toEqual([]);
  });
});
