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
function harness(opts: {
  resolveSubject?: (args: { subject?: string; sessionId?: string }) => GateSubjectResult;
  runSpawnedBy?: (runId: string) => string | null;
  runWorktree?: (runId: string) => string | null;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rt-gate-ask-handler-"));
  dirs.push(dir);
  const store: GatesStore = createGatesStore({ dbPath: join(dir, "gates.db"), log });
  let nextId = 1;
  const bus = { emitAt: () => nextId++ } as unknown as EventsBus;
  const handlers = createGateHandlers(store, bus, () => {}, {
    resolveSubject: opts.resolveSubject,
    runSpawnedBy: opts.runSpawnedBy,
    runWorktree: opts.runWorktree,
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
      context: "why this decision",
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
      context: "why this decision",
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
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/wt/r1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
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
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), context: "why this decision" });
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
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:https://x/1", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.data).sort()).toEqual(["id", "presentation", "subject", "supersededId"]);
    expect(res.data.supersededId).toBeNull();
  });

  test("(g) sessionId resolving to an agent record -> subject agent:<id>", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "agent:ag-9" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("agent:ag-9");
  });

  test("(h) an options-less question with pane + session refuses cleanly (no throw)", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: [{ id: "q1", label: "go?", multi: false }],
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res).toEqual({ ok: false, error: "invalid questions" });
  });

  test("(i) a null question refuses cleanly (no throw)", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: [null],
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res).toEqual({ ok: false, error: "invalid questions" });
  });

  test("(j) multibyte context just over the cap (4097 'é' chars, 8194 bytes) is omitted; the gate still opens", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1", context: "é".repeat(4097),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.context).toBeNull();
  });

  test("(k) multibyte context just under the cap (4096 'é' chars, 8192 bytes) keeps its context", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const context = "é".repeat(4096);
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1", context,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.context).toBe(context);
  });

  test("(l) meta/agent/origin passthrough ride into the row; ceremony-derived presentation and paneId still win", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(),
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      meta: { label: "review gate !7" }, agent: "worker-1",
      origin: { surface: "board", tabId: "t9", worktree: "/tmp/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.meta).toEqual({ label: "review gate !7" });
    expect(row.agent).toBe("worker-1");
    expect(row.origin?.surface).toBe("board");
    expect(row.origin?.tabId).toBe("t9");
    expect(row.origin?.worktree).toBe("/tmp/wt");
    expect(row.origin?.presentation).toBe("form");
    expect(row.origin?.paneId).toBe("w1:p1");
  });

  test("(m) a run-derived worktree beats a passthrough worktree", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/run/wt" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), sessionId: "sess-1",
      origin: { worktree: "/caller/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.worktree).toBe("/run/wt");
  });

  test("(n) a raw payload smuggling origin.presentation with no paneId still gets the ceremony's computed presentation", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1",
      origin: { presentation: "form" } as unknown as { surface?: string },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.presentation).toBe("wait");
    expect(row.origin?.paneId).toBeUndefined();
  });

  test("(o) a raw payload smuggling origin.paneId/origin.runId is dropped when no top-level paneId and an explicit non-run subject", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1",
      origin: { paneId: "smuggled", runId: "smuggled" } as unknown as { surface?: string },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.paneId).toBeUndefined();
    expect(row.origin?.runId).toBeUndefined();
  });

  test("(p) a raw payload with an unknown origin key is rejected by gate:open's validation", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1",
      origin: { foo: "x" } as unknown as { surface?: string },
      context: "why this decision",
    });
    expect(res.ok).toBe(false);
  });

  test("(q) explicit non-run subject enriched with a run session's runId/worktree carries both into origin", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x", runId: "r1", runWorktree: "/w" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", sessionId: "sess-1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("r1");
    expect(row.origin?.worktree).toBe("/w");
  });

  test("(r) explicit run: subject keeps its own runId regardless of the session's runs", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:rZ", runId: "rZ" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "run:rZ", sessionId: "sess-1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("run:rZ");
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("rZ");
  });

  test("(s) owner derivation reads the runId gate:ask derives from resolved.runId, same as an explicit run: subject", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x", runId: "r1" }),
      runSpawnedBy: () => "herd:h-9",
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", sessionId: "sess-1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.owner).toBe("herd:h-9");
  });

  test("(t) explicit non-run subject + sessionId's run worktree + passthrough origin.worktree: the run-derived worktree wins", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x", runId: "r1", runWorktree: "/run/wt" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", sessionId: "sess-1",
      origin: { worktree: "/caller/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.worktree).toBe("/run/wt");
    expect(row.origin?.runId).toBe("r1");
  });
});

// RT-179: only the session-owns-the-run path stamped origin.worktree, so a
// gate opened on any other run: subject was invisible to the hook's
// per-worktree match.
describe("gate:ask stamps origin.worktree whenever the runId is known", () => {
  test("a run subject the session does not own gets its worktree from the runWorktree dep", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r9", runId: "r9" }),
      runWorktree: (runId) => (runId === "r9" ? "/wt/r9" : null),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "run:r9", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("r9");
    expect(row.origin?.worktree).toBe("/wt/r9");
  });

  test("the resolver's own worktree wins over the dep lookup", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/run/wt" }),
      runWorktree: () => "/stale/wt",
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.origin?.worktree).toBe("/run/wt");
  });

  test("a run with no recorded worktree leaves a caller-supplied origin.worktree intact", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r2", runId: "r2" }),
      runWorktree: () => null,
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "run:r2", origin: { worktree: "/caller/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.origin?.worktree).toBe("/caller/wt");
  });

  test("no runId at all: no lookup happens and the gate opens without a worktree", async () => {
    let calls = 0;
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x" }),
      runWorktree: () => { calls++; return "/never"; },
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toBe(0);
    expect(store.get(res.data.id)!.origin?.worktree).toBeUndefined();
  });
});

// RT-177: an agent opened a human decision gate with no context because it
// feared the size cap, and Matt hit a bare decision form in the board.
describe("gate:ask context enforcement", () => {
  const CTX = "the plan section under decision, quoted verbatim";

  test("a human-owned gate with no context is refused, naming what to pass", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("context");
    expect(res.error).toContain("decide from alone");
  });

  test("whitespace-only context counts as none", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context: "   \n\t " });
    expect(res.ok).toBe(false);
  });

  test("a human-owned gate WITH context opens as before", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context: CTX });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.context).toBe(CTX);
    expect(res.data.contextOmitted).toBeUndefined();
  });

  test("a herd-owned run gate is not refused: the shepherd reads the registry, not a bare form", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1" }),
      runSpawnedBy: () => "herd:h-9",
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1" });
    expect(res.ok).toBe(true);
  });

  test("the milestone kind is exempt: its artifact carries the material", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", kind: "milestone" });
    expect(res.ok).toBe(true);
  });

  test("the pane-attention kind is exempt: an internal wait-path gate carries none", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", kind: "pane-attention" });
    expect(res.ok).toBe(true);
  });

  test("an oversized context is still dropped, but the response says so", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", context: "x".repeat(9000),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.contextOmitted).toBe(true);
    expect(store.get(res.data.id)!.context).toBeNull();
  });
});

describe("gate:ask structured question context (RT-184)", () => {
  const CTX = "the plan section under decision, quoted verbatim";
  const withContexts = (a: number, b: number): GateQuestion[] => [
    { id: "q1", label: "go?", multi: false, options: ["yes", "no"], context: "x".repeat(a) },
    { id: "q2", label: "how?", multi: false, options: ["fast", "slow"], context: "y".repeat(b) },
  ];

  test("option descriptions and per-question context reach the stored row", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      subject: "mr:x", context: CTX,
      questions: [{
        id: "q1", label: "go?", multi: false, context: "per-question material",
        options: [{ value: "yes", label: "yes", description: "ship it" }, "no"],
      }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.contextOmitted).toBeUndefined();
    const row = store.get(res.data.id)!;
    expect(row.context).toBe(CTX);
    expect(row.questions).toEqual([{
      id: "q1", label: "go?", multi: false, context: "per-question material",
      options: [{ value: "yes", label: "Yes", description: "ship it" }, { value: "no", label: "No" }],
    }]);
  });

  test("under the shared 8192-byte budget nothing is dropped", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ subject: "mr:x", context: "g".repeat(4096), questions: withContexts(2048, 2048) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.contextOmitted).toBeUndefined();
    const row = store.get(res.data.id)!;
    expect(row.context).toBe("g".repeat(4096));
    expect(row.questions[0]!.context).toBe("x".repeat(2048));
    expect(row.questions[1]!.context).toBe("y".repeat(2048));
  });

  test("over the shared budget, question contexts are dropped first and the gate context kept, reported as contextOmitted", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ subject: "mr:x", context: "g".repeat(4096), questions: withContexts(2048, 2049) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.contextOmitted).toBe(true);
    const row = store.get(res.data.id)!;
    expect(row.context).toBe("g".repeat(4096));
    expect(Object.keys(row.questions[0]!)).not.toContain("context");
    expect(Object.keys(row.questions[1]!)).not.toContain("context");
  });

  test("a gate context that is over budget on its own drops question contexts too", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ subject: "mr:x", context: "g".repeat(9000), questions: withContexts(10, 10) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.contextOmitted).toBe(true);
    const row = store.get(res.data.id)!;
    expect(row.context).toBeNull();
    expect(Object.keys(row.questions[0]!)).not.toContain("context");
  });

  test("question contexts alone over budget are dropped and reported, with no gate context to keep", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ subject: "mr:x", kind: "milestone", questions: withContexts(4096, 4097) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.contextOmitted).toBe(true);
    const row = store.get(res.data.id)!;
    expect(Object.keys(row.questions[0]!)).not.toContain("context");
  });

  test("an oversized option description is a hard reject, not a drop: the caller authored it", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      subject: "mr:x", context: CTX,
      questions: [{ id: "q1", label: "go?", multi: false, options: [{ value: "yes", label: "Yes", description: "d".repeat(1025) }, "no"] }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("1024 bytes");
  });
});
