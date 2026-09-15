# L2: daemon gate:ask + herd:ask on the shared presentation rule (RT-143)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One daemon command, `gate:ask`, owns the gate-opening ceremony (subject resolution, presentation, nudge/origin, context cap); herd:ask adopts the same presentation rule.

**Architecture:** gate:ask is a thin ceremony layer that DELEGATES to the existing gate:open handler (never reimplements open semantics). Subject resolution uses the runs store's session lookup, then the agents store. Presentation comes from rt-client's `gatePresentation` (landed by L3).

**Tech Stack:** Bun, TypeScript, bun test; daemon handler pattern per `lib/daemon/handlers/gate.ts`.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 1)

## Global Constraints

- Contracts C1, C3, C10 in `docs/superpowers/plans/2026-09-14-gate-seam-00-contracts.md` are binding; payload/response/refusal strings verbatim.
- REBASE ON L3 (RT-144) BEFORE STARTING: this plan imports `gatePresentation` from rt-client.
- Announce before merge (touches commands.ts + handlers/gate.ts + handlers/herd.ts).
- Not live until a daemon restart; the herd:ask behavior change (over-cap questions now wait) is announced in #rt before that restart.
- No SCHEMA_VERSION or db schema changes. `bun run test:all` before verified.

---

### Task 1: wire contract in rt-client

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (Commands map, gate section around line 671; COMMAND_NAMES gate block around line 822)
- Modify: `packages/rt-client/src/client.ts` (add the `gateAsk` wrapper beside `gateOpen`; follow that function's exact shape)
- Modify: `packages/rt-client/src/index.ts` (export `gateAsk`)

**Interfaces:**
- Produces: `Commands["gate:ask"]` exactly as contract C3; `gateAsk(payload, opts?)` client function.

- [ ] **Step 1: Add the Commands entry**

```ts
/** Ceremony layer over gate:open: resolves subject from the caller's
    session (explicit subject wins; else its single running run as
    `run:<id>`; else its agent record as `agent:<id>`), computes
    presentation via gatePresentation, supplies nudge/origin, and omits an
    oversized context instead of rejecting it. Delegates to gate:open for
    everything else (validation, supersede, events, push). */
"gate:ask": {
  payload: {
    questions: GateQuestion[];
    context?: string;
    kind?: string;
    subject?: string;
    sessionId?: string;
    paneId?: string;
  };
  data: { id: string; presentation: "form" | "wait"; subject: string; supersededId: string | null };
};
```

Add `"gate:ask"` to COMMAND_NAMES directly after `"gate:open"`.

- [ ] **Step 2: Add the client wrapper + export, build dist**

Mirror `gateOpen`'s implementation in client.ts for `gateAsk`. Then `cd packages/rt-client && bun run build`.

- [ ] **Step 3: Commit**

```bash
git add packages/rt-client/src/commands.ts packages/rt-client/src/client.ts packages/rt-client/src/index.ts
git commit -m "rt-client: gate:ask command entry + client wrapper"
```

### Task 2: subject resolution helper, test-first

**Files:**
- Create: `lib/daemon/gate-subject.ts`
- Test: `lib/daemon/__tests__/gate-subject.test.ts` (put it wherever sibling handler tests live; check `lib/daemon` for the existing test dir convention and match it)

**Interfaces:**
- Consumes: `findRunsBySession` (`lib/runs/store.ts:246`), `getAgent` (`lib/state/agents-store.ts:104`, which accepts id OR sessionId).
- Produces: `resolveGateSubject(deps, args): { ok: true; subject: string; runWorktree?: string } | { ok: false; error: string }` where `deps = { runsBySession(sessionId: string): Array<{ runId: string; status: string; worktree: string | null }>; agentBySession(sessionId: string): { id: string } | undefined }` and `args = { subject?: string; sessionId?: string }`. Dep-injected so tests need no daemon or real stores.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { resolveGateSubject } from "../gate-subject.ts";

const none = { runsBySession: () => [], agentBySession: () => undefined };

describe("resolveGateSubject", () => {
  test("explicit subject wins over everything", () => {
    const deps = { runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }], agentBySession: () => ({ id: "ag-1" }) };
    expect(resolveGateSubject(deps, { subject: "mr:x", sessionId: "s" })).toEqual({ ok: true, subject: "mr:x" });
  });
  test("single running run resolves to run:<id> with its worktree", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "running", worktree: "/w" }] };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "run:r1", runWorktree: "/w" });
  });
  test("non-running runs are ignored", () => {
    const deps = { ...none, runsBySession: () => [{ runId: "r1", status: "done", worktree: null }] };
    expect(resolveGateSubject(deps, { sessionId: "s" }).ok).toBe(false);
  });
  test("two running runs is a loud error naming candidates", () => {
    const deps = { ...none, runsBySession: () => [
      { runId: "r1", status: "running", worktree: null },
      { runId: "r2", status: "running", worktree: null },
    ] };
    const res = resolveGateSubject(deps, { sessionId: "s" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("r1, r2");
  });
  test("agent record fallback", () => {
    const deps = { ...none, agentBySession: () => ({ id: "ag-9" }) };
    expect(resolveGateSubject(deps, { sessionId: "s" })).toEqual({ ok: true, subject: "agent:ag-9" });
  });
  test("nothing resolvable", () => {
    const res = resolveGateSubject(none, { sessionId: "s" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("no subject: pass --subject, or run under a recorded run/agent session");
  });
  test("no sessionId and no subject", () => {
    expect(resolveGateSubject(none, {}).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect module-not-found**

Run: `bun test lib/daemon/__tests__/gate-subject.test.ts`

- [ ] **Step 3: Implement**

```ts
// lib/daemon/gate-subject.ts
export interface GateSubjectDeps {
  runsBySession(sessionId: string): Array<{ runId: string; status: string; worktree: string | null }>;
  agentBySession(sessionId: string): { id: string } | undefined;
}

export type GateSubjectResult =
  | { ok: true; subject: string; runWorktree?: string }
  | { ok: false; error: string };

export function resolveGateSubject(
  deps: GateSubjectDeps,
  args: { subject?: string; sessionId?: string },
): GateSubjectResult {
  if (args.subject) return { ok: true, subject: args.subject };
  if (args.sessionId) {
    const running = deps.runsBySession(args.sessionId).filter((r) => r.status === "running");
    if (running.length === 1) {
      const run = running[0]!;
      return { ok: true, subject: `run:${run.runId}`, ...(run.worktree ? { runWorktree: run.worktree } : {}) };
    }
    if (running.length > 1) {
      return { ok: false, error: `multiple running runs for this session; pass --subject (candidates: ${running.map((r) => r.runId).join(", ")})` };
    }
    const agent = deps.agentBySession(args.sessionId);
    if (agent) return { ok: true, subject: `agent:${agent.id}` };
  }
  return { ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" };
}
```

- [ ] **Step 4: Run tests, expect pass; commit**

```bash
git add lib/daemon/gate-subject.ts lib/daemon/__tests__/gate-subject.test.ts
git commit -m "daemon: gate subject resolution helper"
```

### Task 3: the gate:ask handler

**Files:**
- Modify: `lib/daemon/handlers/gate.ts` (new handler in `createGateHandlers`'s returned map + its return type; new deps fields)
- Modify: `lib/daemon.ts` (wire the two new deps where `createGateHandlers` is constructed; find the call site by the existing `getAgentRecord:` wiring at lib/daemon.ts:1087)
- Modify: `lib/daemon/command-router.ts` (route "gate:ask" like the sibling gate verbs; read the file's gate:open row and mirror it)
- Test: handler-level test beside the existing gate handler tests (match their fixture pattern: `createGateHandlers` with an in-memory store and `deps.push` omitted)

**Interfaces:**
- Consumes: Task 2's `resolveGateSubject`; rt-client `gatePresentation` (L3); the handler's own `"gate:open"` sibling (call it directly: `handlers["gate:open"](payload)` composition inside the same map, or factor the open body into a shared local; pick whichever the existing file structure makes cleaner, but gate:open's EXTERNAL behavior must not change).
- Produces: `"gate:ask": (payload: unknown) => Promise<CommandResult<"gate:ask">>` with contract C3's behavior table.

- [ ] **Step 1: Write the failing handler test** covering: (a) explicit subject + paneId + sessionId + 2-option question -> form, nudge present, origin `{paneId, presentation:"form"}`; (b) same but 5-option question -> wait, NO nudge; (c) session resolving to a run -> subject `run:<id>`, origin carries runId + worktree; (d) no resolvable subject -> `ok:false` with the C3 error string; (e) context of 9000 bytes -> gate opens, row has `context: null` (omitted), response ok; (f) response shape `{id, presentation, subject, supersededId}`.

Test skeleton (adapt store/fixture construction to the existing gate handler tests in this repo; the assertions below are the contract):

```ts
const res = await handlers["gate:ask"]({
  questions: [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }],
  subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
});
expect(res.ok).toBe(true);
if (res.ok) {
  expect(res.data.presentation).toBe("form");
  expect(res.data.subject).toBe("mr:https://x/1");
  const row = store.get(res.data.id)!;
  expect(row.nudge).toEqual({ session: "sess-1" });
  expect(row.origin?.presentation).toBe("form");
  expect(row.origin?.paneId).toBe("w1:p1");
}
```

- [ ] **Step 2: Run, expect failure (no such handler)**

- [ ] **Step 3: Implement the handler**

```ts
"gate:ask": async (rawPayload: unknown) => {
  const p = rawPayload as Commands["gate:ask"]["payload"] | undefined;
  const questions = p?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false as const, error: "invalid questions" };
  }
  const sessionId = typeof p?.sessionId === "string" && p.sessionId.trim() ? p.sessionId.trim() : undefined;
  const paneId = typeof p?.paneId === "string" && p.paneId.trim() ? p.paneId.trim() : undefined;
  const resolved = deps.resolveSubject!({ subject: typeof p?.subject === "string" ? p.subject.trim() || undefined : undefined, sessionId });
  if (!resolved.ok) return { ok: false as const, error: resolved.error };

  const presentation = gatePresentation({ paneId, sessionId, questions });
  let context = typeof p?.context === "string" ? p.context : undefined;
  if (context !== undefined && Buffer.byteLength(context, "utf8") > 8192) context = undefined;

  const origin: GateOrigin = { presentation };
  if (paneId) origin.paneId = paneId;
  if (resolved.subject.startsWith("run:")) origin.runId = resolved.subject.slice(4);
  if (resolved.runWorktree) origin.worktree = resolved.runWorktree;

  const opened = await open({
    subject: resolved.subject,
    kind: typeof p?.kind === "string" && p.kind.trim() ? p.kind.trim() : "question",
    questions,
    ...(context !== undefined ? { context } : {}),
    ...(paneId ? { pane: paneId } : {}),
    ...(presentation === "form" && sessionId ? { nudge: { session: sessionId } } : {}),
    origin,
  });
  if (!opened.ok) return opened;
  return { ok: true as const, data: { id: opened.data.id, presentation, subject: resolved.subject, supersededId: opened.data.supersededId } };
},
```

Where `open` is the gate:open handler body factored so both verbs share it (external gate:open behavior unchanged), and `deps.resolveSubject` is wired in lib/daemon.ts as:

```ts
resolveSubject: (args) => resolveGateSubject({
  runsBySession: (sid) => findRunsBySession(sid).map((m) => ({ runId: m.run.run.id, status: m.run.run.status, worktree: m.run.fields.find((f) => f.key === "worktree")?.value ?? null })),
  agentBySession: (sid) => getAgent(sid, getStateDb("daemon")),
}, args),
```

(Adjust the `findRunsBySession` mapping to its REAL return shape; read `lib/runs/store.ts:246` first and map accordingly. The dep boundary is the contract; the mapping is whatever the store returns.)

- [ ] **Step 4: Run handler tests + full suite, expect pass**

Run: `bun test lib` then `bun run test:all`

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/gate.ts lib/daemon.ts lib/daemon/command-router.ts
git commit -m "daemon: gate:ask ceremony handler over gate:open"
```

### Task 4: herd:ask onto the shared rule

**Files:**
- Modify: `lib/daemon/handlers/herd.ts:76-83` (delete `paneOrigin`; compute presentation) and the `herd:ask` + `herd:milestone` open calls (both stamp pane origins today)
- Test: extend the existing herd handler tests: a 5-option ask now opens with `origin.presentation === "wait"` and NO nudge; a 4-option ask keeps form + nudge.

**Interfaces:**
- Consumes: rt-client `gatePresentation`.
- Produces: unchanged herd:ask wire shape; changed presentation behavior for over-cap questions (the announced change).

- [ ] **Step 1: Write the failing test** (over-cap ask -> wait, no nudge; under-cap -> form + nudge; milestone gates are fixed 3-option so always form when a pane exists).
- [ ] **Step 2: Implement**

```ts
// replaces paneOrigin at herd.ts:82-83
const askOrigin = (paneRef: string | undefined, session: string, questions: GateQuestion[]):
  { origin?: { paneId: string; presentation: "form" | "wait" }; nudge?: { session: string } } => {
  if (!paneRef) return {};
  const presentation = gatePresentation({ paneId: paneRef, sessionId: session, questions });
  return {
    origin: { paneId: paneRef, presentation },
    ...(presentation === "form" ? { nudge: { session } } : {}),
  };
};
```

herd:ask's gate:open call spreads `...askOrigin(paneRef, session, p!.questions)` instead of the unconditional `nudge: { session }, origin: paneOrigin(paneRef)`. herd:milestone does the same with its own fixed question array. Note: today herd:ask nudges even with no pane; preserving THAT nuance for the no-pane case is deliberate behavior simplification per the spec... a no-pane ask has no form to dismiss, so the nudge goes with presentation. If the existing herd tests assert a no-pane nudge, flag it to the shepherd instead of silently changing the assertion.

- [ ] **Step 3: Run herd tests + full suite; commit**

```bash
git add lib/daemon/handlers/herd.ts
git commit -m "daemon: herd:ask/milestone adopt the shared presentation rule (over-cap asks now wait)"
```

### Task 5: lane wrap

- [ ] **Step 1:** `bun run test:all` + `bun run picker:check` green.
- [ ] **Step 2:** `cd packages/rt-client && bun run build` (dist freshness).
- [ ] **Step 3:** Announce in #rt: "L2 merging: daemon gains gate:ask; herd:ask over-cap questions now take the wait path AFTER the next daemon restart."
- [ ] **Step 4:** Push, PR "RT-143: gate:ask ceremony command + unified presentation rule".
