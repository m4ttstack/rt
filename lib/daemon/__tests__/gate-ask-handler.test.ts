import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { createGatesStore, type GatesStore, type GateQuestion } from "../gates-store.ts";
import { createGateHandlers } from "../handlers/gate.ts";
import type { EventsBus } from "../events-bus.ts";
import type { GateSubjectResult } from "../gate-subject.ts";

const log = pino({ level: "silent" });

let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function twoOptionQuestion(): GateQuestion[] {
  return [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }];
}

function fiveOptionQuestion(): GateQuestion[] {
  return [{ id: "q1", label: "pick", multi: false, options: ["a", "b", "c", "d", "e"] }];
}

/** Same shape as gates-handlers.test.ts's harness, plus an injectable
    resolveSubject -- gate:ask's own seam, tested independently of
    resolveGateSubject's own suite (gate-subject.test.ts). */
function harness(opts: { resolveSubject?: (args: { subject?: string; sessionId?: string }) => GateSubjectResult } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rt-gate-ask-handler-"));
  dirs.push(dir);
  const store: GatesStore = createGatesStore({ dbPath: join(dir, "gates.db"), log });
  let nextId = 1;
  const bus = { emitAt: () => nextId++ } as unknown as EventsBus;
  const handlers = createGateHandlers(store, bus, () => {}, {
    resolveSubject: opts.resolveSubject,
  });
  return { handlers, store };
}

describe("gate:ask", () => {
  test("(a) explicit subject + paneId + sessionId + 2-option question -> form, nudge present, origin form", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(),
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("form");
    expect(res.data.subject).toBe("mr:https://x/1");
    const row = store.get(res.data.id)!;
    expect(row.nudge).toEqual({ session: "sess-1" });
    expect(row.origin?.presentation).toBe("form");
    expect(row.origin?.paneId).toBe("w1:p1");
  });

  test("(b) 5-option question -> wait, no nudge", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: fiveOptionQuestion(),
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("wait");
    const row = store.get(res.data.id)!;
    expect(row.nudge).toBeNull();
    expect(row.origin?.presentation).toBe("wait");
  });

  test("(c) session resolving to a run -> subject run:<id>, origin carries runId + worktree", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runWorktree: "/wt/r1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), sessionId: "sess-1", paneId: "w1:p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("run:r1");
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("r1");
    expect(row.origin?.worktree).toBe("/wt/r1");
  });

  test("(d) no resolvable subject -> ok:false with the resolver's error", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion() });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("no subject: pass --subject, or run under a recorded run/agent session");
  });

  test("(e) context of 9000 bytes -> gate opens, row.context omitted (null)", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const bigContext = "x".repeat(9000);
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1", context: bigContext,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.context).toBeNull();
  });

  test("(f) response shape {id, presentation, subject, supersededId}", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:https://x/1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.data).sort()).toEqual(["id", "presentation", "subject", "supersededId"]);
    expect(res.data.supersededId).toBeNull();
  });

  test("(g) sessionId resolving to an agent record -> subject agent:<id>", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "agent:ag-9" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("agent:ag-9");
  });
});
