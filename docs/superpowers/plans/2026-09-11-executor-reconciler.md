# Executor Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executor lifecycle tracking for rt-agent panes: layered pane resolution (fixes the stale-paneId Escape miss), a daemon sweep that derives live/blocked/hidden/gone state, attention gates, answer-time relaunch with outcome verification, an AskUserQuestion PreToolUse hook, and board surfacing.

**Architecture:** Derived-view reconciler (spec approach A): recomputed each sweep from the agents table, gates.db, and herdr `session.snapshot`; durable only at gate rows and a kv tombstone namespace. Four parallel lanes; lane 4 (resolver + Escape hardening) ships first.

**Tech Stack:** Bun + TypeScript (repo-tools daemon, mr-board), bun:test / vitest, sh hook script, herdr NDJSON socket verbs.

**Spec:** `docs/superpowers/specs/2026-09-11-executor-reconciler-design.md`

## Global Constraints

- Never run a built rt binary without `env -i HOME=<temp>` isolation (repo CLAUDE.md).
- Daemon outcome logging is structural: no per-handler logging; domain events only via `ctx.log` / `childLogger`.
- New command modules must be registered in `lib/module-registry.ts` (thunked import).
- `bun run test` excludes e2e; run `bun run test:all` before claiming verification on any `--json` envelope change.
- gates.db / state.db schema blocks: `IF NOT EXISTS` statements only; announce any version bump to other live sessions before merging.
- rt-client changes require `cd packages/rt-client && bun run build` before any consumer install; publishing is release-class, from main only.
- No em/en dashes in any authored text.
- Board (mattstack-apps) gates: `bun run tui-kit:build` first; `board:typecheck`, `board:test`, `format:check`, `scripts/repo-purity.sh`.

## Repos and lanes

| Lane | Repo | Tasks |
|---|---|---|
| 4: resolver + Escape (ships first) | repo-tools | 1, 2 |
| 1: daemon reconciler | repo-tools | 3, 4, 5, 6, 7, 8 |
| 3: hook + launch wiring | repo-tools (+ mattstack-apps skills) | 9, 10, 11 |
| 2: board UI | mattstack-apps | 12, 13, 14 |

Lanes build against the contract types in Task 3; Tasks 1-2 have no dependency on Task 3.

---

### Task 1: Layered pane resolver

**Files:**
- Create: `lib/daemon/pane-resolve-live.ts`
- Test: `lib/daemon/__tests__/pane-resolve-live.test.ts`

**Interfaces:**
- Consumes: `herdrRequest` (`lib/herdr/client.ts`), `resolvePaneRef` (`lib/daemon/pane-ref-socket.ts`), `HerdrPane` shape (`lib/daemon/handlers/pane.ts:24-41`: `pane_id`, `workspace_id`, `agent_status`, `cwd`, `agent_session?: { kind: "id" | "path"; value: string }`).
- Produces:
  ```ts
  export interface PaneHints { paneId?: string; sessionId?: string; worktree?: string }
  export interface LivePane {
    paneRef: string;        // "w1:p2" or "bg:w1:p2"
    sockPath: string;
    workspaceId: string;
    agentStatus: "idle" | "working" | "blocked" | "done" | "unknown";
    cwd?: string;
    sessionId?: string;     // agent_session kind "id" value
  }
  export async function snapshotPanes(): Promise<LivePane[] | null>; // null = herdr unreachable
  export function resolveLivePane(hints: PaneHints, panes: LivePane[]): LivePane | null;
  ```

- [ ] **Step 1: Write failing tests**

```ts
// lib/daemon/__tests__/pane-resolve-live.test.ts
import { describe, expect, test } from "bun:test";
import { resolveLivePane, type LivePane } from "../pane-resolve-live.ts";

const pane = (over: Partial<LivePane>): LivePane => ({
  paneRef: "w1:p1", sockPath: "/tmp/h.sock", workspaceId: "w1",
  agentStatus: "idle", ...over,
});

describe("resolveLivePane", () => {
  test("layer 1: paneId wins when live", () => {
    const panes = [pane({ paneRef: "w1:p1" }), pane({ paneRef: "w1:p2", sessionId: "s-a" })];
    expect(resolveLivePane({ paneId: "w1:p1", sessionId: "s-a" }, panes)?.paneRef).toBe("w1:p1");
  });
  test("layer 2: dead paneId falls through to session id", () => {
    const panes = [pane({ paneRef: "w1:p8", sessionId: "s-a" })];
    expect(resolveLivePane({ paneId: "w1:p6", sessionId: "s-a" }, panes)?.paneRef).toBe("w1:p8");
  });
  test("layer 3: unique worktree match", () => {
    const panes = [pane({ paneRef: "w1:p3", cwd: "/private/tmp/wt" })];
    expect(resolveLivePane({ paneId: "w1:p6", worktree: "/tmp/wt" }, panes)?.paneRef).toBe("w1:p3");
  });
  test("ambiguous worktree resolves null", () => {
    const panes = [pane({ paneRef: "w1:p3", cwd: "/x" }), pane({ paneRef: "w1:p4", cwd: "/x" })];
    expect(resolveLivePane({ worktree: "/x" }, panes)).toBeNull();
  });
  test("no hints, no match: null", () => {
    expect(resolveLivePane({}, [pane({})])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** ... `bun test lib/daemon/__tests__/pane-resolve-live.test.ts`; expect module-not-found.
- [ ] **Step 3: Implement**

```ts
// lib/daemon/pane-resolve-live.ts
import { realpathSync } from "node:fs";
import { herdrRequest, herdrSocketPath } from "../herdr/client.ts";
import { bgSocketPath } from "./bg-service.ts"; // match the import the bg server module actually exports; adjust name if it is exported elsewhere

export interface PaneHints { paneId?: string; sessionId?: string; worktree?: string }
export interface LivePane {
  paneRef: string; sockPath: string; workspaceId: string;
  agentStatus: "idle" | "working" | "blocked" | "done" | "unknown";
  cwd?: string; sessionId?: string;
}

function normalizePath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  try { return realpathSync(trimmed); } catch {
    const isTmp = trimmed === "/tmp" || trimmed.startsWith("/tmp/");
    return process.platform === "darwin" && isTmp ? `/private${trimmed}` : trimmed;
  }
}

/** paneId, then agent-session id, then unique normalized cwd. Null on miss
    or ambiguity: a wrong pane is worse than no pane. */
export function resolveLivePane(hints: PaneHints, panes: LivePane[]): LivePane | null {
  if (hints.paneId) {
    const bare = hints.paneId.replace(/^bg:/, "");
    const hit = panes.find((p) => p.paneRef === hints.paneId || p.paneRef.replace(/^bg:/, "") === bare);
    if (hit) return hit;
  }
  if (hints.sessionId) {
    const hit = panes.find((p) => p.sessionId === hints.sessionId);
    if (hit) return hit;
  }
  if (hints.worktree) {
    const want = normalizePath(hints.worktree);
    const hits = panes.filter((p) => p.cwd !== undefined && normalizePath(p.cwd) === want);
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

/** Snapshot every herdr server (main + bg). Null when no server answers. */
export async function snapshotPanes(): Promise<LivePane[] | null> {
  const servers = [
    { sockPath: herdrSocketPath(), prefix: "" },
    { sockPath: bgSocketPath(), prefix: "bg:" },
  ];
  const out: LivePane[] = [];
  let reachable = false;
  for (const { sockPath, prefix } of servers) {
    const res = await herdrRequest<{ snapshot: { workspaces: Array<{ workspace_id: string; panes: Array<Record<string, unknown>> }> } }>(
      "session.snapshot", {}, { sockPath },
    );
    if (!res.ok) continue;
    reachable = true;
    for (const ws of res.data.snapshot.workspaces) {
      for (const p of ws.panes) {
        const sess = p.agent_session as { kind?: string; value?: string } | undefined;
        out.push({
          paneRef: `${prefix}${String(p.pane_id)}`,
          sockPath,
          workspaceId: ws.workspace_id,
          agentStatus: (p.agent_status as LivePane["agentStatus"]) ?? "unknown",
          ...(typeof p.cwd === "string" ? { cwd: p.cwd } : {}),
          ...(sess?.kind === "id" && typeof sess.value === "string" ? { sessionId: sess.value } : {}),
        });
      }
    }
  }
  return reachable ? out : null;
}
```

Adjust the snapshot field access to the real `HerdrSnapshot` type in `lib/daemon/handlers/pane.ts` (import and reuse that type rather than `Record<string, unknown>` if it is exported; if not, export it from there in this task).

- [ ] **Step 4: Run tests** ... expect PASS.
- [ ] **Step 5: Commit** ... `git commit -m "daemon: layered live-pane resolver (paneId, session, worktree)"`

---

### Task 2: Escape hardening through the resolver

**Files:**
- Modify: `lib/daemon/gate-escape.ts`
- Modify: `lib/daemon/gate-push.ts:103-126` (`pushToPane`)
- Modify: `lib/daemon.ts:587-594` (injector construction, unchanged call shape)
- Test: `lib/daemon/__tests__/gate-escape.test.ts` (extend), `lib/daemon/__tests__/gate-push.test.ts` or the existing push test file

**Interfaces:**
- Consumes: `resolveLivePane`, `snapshotPanes`, `PaneHints` (Task 1).
- Produces: `EscapeInjector` retyped to `(hints: PaneHints) => Promise<{ ok: true; paneRef: string } | { ok: false; error: string }>`.

- [ ] **Step 1: Write failing tests**

```ts
// added to lib/daemon/__tests__/gate-escape.test.ts
import { describe, expect, test } from "bun:test";
import { createEscapeInjector } from "../gate-escape.ts";
import type { LivePane } from "../pane-resolve-live.ts";

const pane = (over: Partial<LivePane>): LivePane => ({
  paneRef: "wE2:p8", sockPath: "/tmp/h.sock", workspaceId: "wE2",
  agentStatus: "blocked", ...over,
});

test("stale paneId resolves via session id before sending", async () => {
  const sent: Array<{ verb: string; payload: unknown }> = [];
  const injector = createEscapeInjector({
    herdr: (async (verb: string, payload: unknown) => { sent.push({ verb, payload }); return { ok: true, data: {} }; }) as never,
    snapshot: async () => [pane({ paneRef: "wE2:p8", sessionId: "s-1" })],
  });
  const res = await injector({ paneId: "wE2:p6", sessionId: "s-1" });
  expect(res).toEqual({ ok: true, paneRef: "wE2:p8" });
  expect(sent[0]).toEqual({ verb: "pane.send_keys", payload: { pane_id: "wE2:p8", keys: ["escape"] } });
});

test("no resolvable pane returns ok:false without sending", async () => {
  const injector = createEscapeInjector({
    herdr: (async () => { throw new Error("must not send"); }) as never,
    snapshot: async () => [],
  });
  const res = await injector({ paneId: "wE2:p6" });
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** ... signature mismatch / assertion failure.
- [ ] **Step 3: Implement** ... rewrite `createEscapeInjector` to take `{ herdr?, snapshot? }` deps (defaults `herdrRequest` / `snapshotPanes`), resolve `hints` via `resolveLivePane` over the snapshot, strip any `bg:` prefix for the `pane_id` payload and use the resolved pane's own `sockPath`. In `gate-push.ts` `pushToPane`, build hints from the row and pass them:

```ts
const injected = await opts.injectEscape({
  paneId: row.origin?.paneId || row.pane || undefined,
  sessionId: row.nudge?.session,
  worktree: row.origin?.worktree,
});
```

Keep the existing guards (`presentation === "form"`, answered-by-pane skip) unchanged. Log the resolved `paneRef` on success at debug.

- [ ] **Step 4: Run** ... `bun test lib/daemon/__tests__/gate-escape.test.ts lib/daemon/__tests__/gate-push.test.ts` and the full `bun run test`; expect PASS.
- [ ] **Step 5: Commit** ... `git commit -m "daemon: Escape injection resolves panes by session and worktree, not stale paneId"`

This task alone fixes the observed 2026-09-11 miss and is shippable on its own.

---

### Task 3: Contract types and gates-store field extensions

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (types below; `reconciler:status`, `reconciler:clear` command entries following the existing `Commands` map pattern)
- Modify: `lib/daemon/gates-store.ts` (delivery outcomes, `execution`, `executor` stamps)
- Test: `lib/daemon/__tests__/gates-store.test.ts` (extend), `packages/rt-client` typecheck

**Interfaces (produces, frozen for all lanes):**

```ts
// packages/rt-client/src/commands.ts
export type ExecutorState = "live" | "blocked" | "hidden" | "gone" | "cleared" | "unknown";
export interface ExecutorView {
  agentId: string;
  repo: string | null;
  subject: string | null;
  surface: AgentSurface;
  sessionId: string;
  paneRef: string | null;
  state: ExecutorState;
  since: number;
  openGateIds: string[];
}
export interface ReconcilerStatus {
  sweptAt: number;
  herdrReachable: boolean;
  executors: ExecutorView[];
}
// Commands map additions:
// "reconciler:status": { payload: {}; data: ReconcilerStatus }
// "reconciler:clear":  { payload: { agentId: string }; data: { cleared: true } }
```

gates-store:
- `markDelivery(id, outcome: "delivered" | "dead-pane" | "confirmed" | "stuck")`
- `markExecution(id: string, execution: "unassigned" | null): void`
- `markExecutor(id: string, executor: ExecutorState | null): void`
- `GateRow` gains `execution?: "unassigned"` and `executor?: ExecutorState`.

- [ ] **Step 1: Write failing tests** ... extend the gates-store suite:

```ts
test("markDelivery accepts confirmed and stuck", () => {
  const { id } = store.open({ subject: "mr:x", kind: "review-post", questions: [Q] });
  store.markDelivery(id, "confirmed");
  expect(store.get(id)!.delivery!.outcome).toBe("confirmed");
  store.markDelivery(id, "stuck");
  expect(store.get(id)!.delivery!.outcome).toBe("stuck");
});
test("markExecution and markExecutor round-trip and clear", () => {
  const { id } = store.open({ subject: "mr:x", kind: "review-post", questions: [Q] });
  store.markExecution(id, "unassigned");
  store.markExecutor(id, "gone");
  expect(store.get(id)).toMatchObject({ execution: "unassigned", executor: "gone" });
  store.markExecution(id, null);
  expect(store.get(id)!.execution).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Delivery is a serialized column: widen the union only. `execution`/`executor` are new columns: add them inside the schema's `IF NOT EXISTS` table creation, guarded by a `PRAGMA table_info` check for existing dbs per the repo's schema footgun; announce the gates.db version bump to other sessions before merge.
- [ ] **Step 4: Run gates-store suite + `cd packages/rt-client && bun run build && bun run typecheck`.**
- [ ] **Step 5: Commit** ... `git commit -m "gates-store + rt-client: reconciler contract types, delivery confirmed/stuck, execution and executor stamps"`

---

### Task 4: Reconciler view computation (pure)

**Files:**
- Create: `lib/daemon/reconciler-view.ts`
- Test: `lib/daemon/__tests__/reconciler-view.test.ts`

**Interfaces:**
- Consumes: `AgentRecord` (`lib/state/agents-store.ts:13`), `GateRow`, `LivePane`, `resolveLivePane` (Task 1), `ExecutorState`/`ExecutorView` (Task 3).
- Produces:
  ```ts
  export interface ViewInput {
    agents: AgentRecord[];          // rows without finished_at
    panes: LivePane[] | null;       // null = herdr unreachable
    openGates: GateRow[];           // open + parked
    clearedAgentIds: Set<string>;
    visibleWorkspaceIds: Set<string> | null; // null = unknown, treat all visible
  }
  export function computeView(input: ViewInput, now: number): ExecutorView[];
  export function gateAgentId(gate: GateRow, agents: AgentRecord[], panes: LivePane[] | null): string | null;
  ```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { computeView } from "../reconciler-view.ts";

const agent = (over = {}) => ({
  id: "a1", repo: "gitlab.com/g/p", cwd: "/wt/a", provider: "claude",
  surface: "herdr", sessionId: "s-1", createdAt: 1, ...over,
});
const pane = (over = {}) => ({
  paneRef: "w1:p1", sockPath: "/s", workspaceId: "w1", agentStatus: "idle",
  sessionId: "s-1", cwd: "/wt/a", ...over,
});
const base = { openGates: [], clearedAgentIds: new Set<string>(), visibleWorkspaceIds: null };

test("resolved idle pane is live", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()] }, 10);
  expect(v).toMatchObject({ agentId: "a1", state: "live", paneRef: "w1:p1" });
});
test("agent_status blocked maps to blocked", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane({ agentStatus: "blocked" })] }, 10);
  expect(v!.state).toBe("blocked");
});
test("no resolvable pane is gone", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [] }, 10);
  expect(v!.state).toBe("gone");
});
test("herdr unreachable is unknown, never gone", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: null }, 10);
  expect(v!.state).toBe("unknown");
});
test("cleared tombstone wins", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [], clearedAgentIds: new Set(["a1"]) }, 10);
  expect(v!.state).toBe("cleared");
});
test("pane in a non-visible workspace is hidden", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()], visibleWorkspaceIds: new Set(["w9"]) }, 10);
  expect(v!.state).toBe("hidden");
});
test("open gates join by subject-worktree-session", () => {
  const g = { gateId: "g1" }; // use a real GateRow fixture: origin.worktree "/wt/a"
  // assert v.openGateIds contains g's id -- write with the real GateRow shape from gates-store tests
});
```

Write the gate-join test with a real `GateRow` fixture copied from the gates-store test file.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `computeView`: per agent, `cleared` from tombstones; else `unknown` when `panes === null`; else resolve via `resolveLivePane({ paneId: rec.paneId, sessionId: rec.sessionId, worktree: rec.cwd }, panes)`; `gone` on null; `blocked` when `agentStatus === "blocked"`; `hidden` when resolved but workspace not in `visibleWorkspaceIds` (when that set is known); else `live`. `openGateIds` joins gates whose origin paneId / nudge session / worktree resolves to the same agent. `since` carries `now` on state change (the caller owns previous-state comparison; here return current `now`).
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** ... `git commit -m "daemon: pure reconciler view computation"`

---

### Task 5: Reconciler sweep, transitions, attention gates

**Files:**
- Create: `lib/daemon/reconciler.ts`
- Modify: `lib/daemon.ts` (wire beside `createGateEscalation`, ~line 595, and register in the sweep units ~line 654)
- Test: `lib/daemon/__tests__/reconciler.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `deriveOwner` (`lib/daemon/handlers/gate.ts`), kv (`lib/state/kv-blob.ts`: `setKvValue`, `listKvValues`, namespace `"reconciler.cleared"`), `listAgents` (`lib/state/agents-store.ts:99` ... extend with an `unfinishedOnly` filter or filter in the caller), pane peek verb used by `rt pane peek`.
- Produces:
  ```ts
  export interface Reconciler {
    sweep(): Promise<void>;
    status(): ReconcilerStatus;
    expect(e: Expectation): void;              // Task 6
    clear(agentId: string): void;
    executorFor(hints: PaneHints): { state: ExecutorState; pane: LivePane | null };
  }
  export interface ReconcilerDeps {
    store: GatesStore;
    listAgents: () => AgentRecord[];
    snapshot: () => Promise<LivePane[] | null>;
    peek: (pane: LivePane) => Promise<string>;
    emit: (topic: string, payload: Record<string, unknown>) => void;
    injectEscape: EscapeInjector;
    resumeAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
    log: Logger;
    debounceSweeps?: number; // default 2
  }
  export function createReconciler(deps: ReconcilerDeps): Reconciler;
  ```
- Attention gate row: `kind: "pane-attention"`, subject = agent's board subject when known else `agent:<agentId>`, `owner: deriveOwner(...)`, `meta: { agentId, paneRef, reason: "blocked" | "gone" }`, one single-select question `{ id: "action", label: "Pane needs attention", options: ["focus-pane", "resume", "clear", "dismiss"] }`, context = peek text truncated to 8192 bytes.

- [ ] **Step 1: Write failing tests** covering, with an in-memory GatesStore (reuse the fixture factory the gate-escalation tests use):
  - blocked sustained 2 sweeps opens exactly one attention gate; a third sweep opens no duplicate.
  - blocked while an open gate already exists on the subject opens nothing.
  - blocked then live closes the attention gate with `closedReason: "resolved"`.
  - gone sustained 2 sweeps with an open gate stamps `markExecutor(gateId, "gone")` and opens a `reason: "gone"` attention gate.
  - `panes: null` (unreachable) produces no transitions and no gates.
  - every transition calls `emit("reconciler.transition", { agentId, from, to, ... })`.
  - `clear("a1")` writes the kv tombstone, closes the agent's open gates as `"abandoned"`, and the next sweep reports `cleared`.

Write each as a real test against the interface above; drive multiple sweeps by swapping the `snapshot` stub between calls.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Keep previous states + pending debounce counters in module memory. Answer handling for attention gates lives in Task 7 (the answer handler routes `resume`/`clear`/`dismiss`). Wire into `lib/daemon.ts` on the escalation sweep's cadence, pushing a `{ stop() }` handle into `sweepHandles`.
- [ ] **Step 4: Run reconciler + full daemon test suites.**
- [ ] **Step 5: Commit** ... `git commit -m "daemon: reconciler sweep with executor transitions and attention gates"`

---

### Task 6: Expectations (outcome verification)

**Files:**
- Modify: `lib/daemon/reconciler.ts`
- Test: `lib/daemon/__tests__/reconciler-expectations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Expectation {
    gateId: string;
    agentId?: string;
    hints: PaneHints;
    expect: "leave-blocked" | "appear-live";
    deadlineSweeps: number;   // decremented per sweep; default 2
    retriesLeft: number;      // default 2 for leave-blocked, 0 for appear-live
  }
  ```

- [ ] **Step 1: Write failing tests**
  - `leave-blocked` satisfied (pane not blocked on next sweep) stamps `markDelivery(gateId, "confirmed")` and emits `reconciler.delivery { outcome: "confirmed" }`.
  - still blocked past deadline: re-resolves and calls `injectEscape` again, decrements retries, resets the deadline.
  - retries exhausted and still blocked: `markDelivery(gateId, "stuck")`, emits `{ outcome: "stuck" }`, expectation dropped.
  - `appear-live` satisfied: `markExecution(gateId, null)` and emits `reconciler.execution { execution: null }`.
  - `appear-live` deadline missed: `markExecution(gateId, "unassigned")`, emits, dropped.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** inside the sweep after transition handling: check each pending expectation against the fresh view.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** ... `git commit -m "daemon: reconciler expectations confirm or retry gate answer delivery"`

---

### Task 7: Answer-time executor guarantee

**Files:**
- Modify: `lib/daemon/handlers/gate.ts` (the `gate:answer` handler's post-record side effects) and `lib/daemon/gate-push.ts` (register expectations after push)
- Modify: `lib/daemon.ts` (pass reconciler into the gate handler deps and gate-push)
- Test: `lib/daemon/__tests__/gate-answer-executor.test.ts`

**Interfaces:**
- Consumes: `Reconciler.executorFor`, `Reconciler.expect`, `agent:resume` handler (`lib/daemon/handlers/agent.ts:310`) exposed to the reconciler as `resumeAgent(agentId)`.
- Produces: behavior only; single-flight keyed by gateId in a module-level `Map<string, Promise<...>>`.

- [ ] **Step 1: Write failing tests**
  - answered gate whose executor is `gone` triggers exactly one `resumeAgent` call even when answered twice concurrently (race the handler with `Promise.all`).
  - successful relaunch registers an `appear-live` expectation for the gate.
  - `resumeAgent` failure stamps `markExecution(gateId, "unassigned")` immediately.
  - answered gate with a `live` executor registers a `leave-blocked` expectation after the push (assert via the reconciler stub's `expect` calls).
  - attention-gate answers route: `"clear"` calls `reconciler.clear(agentId)`; `"resume"` calls `resumeAgent`; `"dismiss"` closes the gate only; `"focus-pane"` is a no-op server-side (the board handles focus client-side, as it does today).

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** All side effects run after the answer is recorded and the response is built (never on the hot path); wrap in try/catch that logs at warn per the catch policy.
- [ ] **Step 4: Run the daemon gate suites + `bun run test`.**
- [ ] **Step 5: Commit** ... `git commit -m "daemon: answered gates relaunch gone executors and verify delivery"`

---

### Task 8: Verbs, REST, events, e2e envelope

**Files:**
- Create: `lib/daemon/handlers/reconciler.ts`
- Modify: `lib/daemon/command-router.ts` (register), `lib/daemon/api-server.ts` (`GET /reconciler`, `POST /reconciler/clear`), `packages/rt-client` (client wrappers following the existing verb wrapper pattern)
- Create: `commands/reconciler.ts` + entry in `lib/command-tree-def.ts` (`rt reconciler status --json`; leaf has no required positional, no `omitBehavior` needed) + `lib/module-registry.ts` thunk
- Test: `lib/daemon/__tests__/reconciler-handlers.test.ts`, `e2e/tests/reconciler.test.ts`

- [ ] **Step 1: Write failing handler tests** ... `reconciler:status` returns the `ReconcilerStatus` shape verbatim from the reconciler stub; `reconciler:clear` validates `agentId` presence and calls `reconciler.clear`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** handler + REST + CLI + rt-client wrappers. Emit topics are already produced by Tasks 5-6; document them in the handler header: `reconciler.transition`, `reconciler.delivery`, `reconciler.execution`.
- [ ] **Step 4: Write the e2e exact-string test for `rt reconciler status --json` envelope and run `bun run test:all`.**
- [ ] **Step 5: Commit** ... `git commit -m "rt: reconciler status/clear verbs, REST, CLI, events"`

---

### Task 9: AskUserQuestion hook script

**Files:**
- Create: `scripts/hooks/gate-fork.sh`
- Test: `lib/__tests__/gate-fork-hook.test.ts` (drives the script as a subprocess)

**Interfaces:**
- Env contract (frozen): `RT_AGENT_ID`, `RT_GATE_SUBJECT`, `RT_DAEMON_SOCK`.
- Output contract: PreToolUse JSON on stdout, exit 0:
  - allow: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`
  - deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocking forks go through the gate protocol: run `rt gate open --subject \"$RT_GATE_SUBJECT\" --kind <scope> --questions <json>` and wait per the gate protocol skill, instead of AskUserQuestion."}}`

- [ ] **Step 1: Write failing tests** ... spawn the script with:
  - `RT_DAEMON_SOCK` pointing at a nonexistent socket: expect allow.
  - a fake socket served by the test (Bun.listen on a unix socket answering the gate-list request with one open gate for the subject): expect allow.
  - the fake socket answering with no open gates: expect deny, reason contains `rt gate open`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** in POSIX sh: probe with a short-timeout `rt gate list --subject "$RT_GATE_SUBJECT" --json` (the CLI already exists; `RT_DAEMON_SOCK` overrides the socket path if the env override exists in `lib/`; if not, add it where the socket path is resolved). Any CLI failure = allow. Parse with `grep -c '"status":"open"\|"status":"parked"'` on the filtered output rather than jq (jq is not a guaranteed dependency of installed bundles).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** ... `git commit -m "hooks: gate-fork PreToolUse script denies improvised AskUserQuestion forks"`

---

### Task 10: Hook injection at rt agent launch

**Files:**
- Modify: `lib/daemon/handlers/agent.ts` (`agent:start` and the resume path: stamp env, extend claude argv/settings)
- Modify: wherever `buildClaudeArgv` / the herdr pane command line is assembled (same file or its helper) to add `--settings <generated-file>` carrying the PreToolUse hook pointing at the installed `gate-fork.sh`
- Test: extend `lib/daemon/__tests__/agent-handlers.test.ts` (or the existing agent handler test file)

**Interfaces:**
- Consumes: hook contract (Task 9). The settings JSON written per launch:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "AskUserQuestion",
      "hooks": [ { "type": "command", "command": "<abs path to gate-fork.sh>" } ] } ] } }
  ```
- Env stamped into the pane/headless environment: `RT_AGENT_ID=<rec.id>`, `RT_GATE_SUBJECT=<payload.subject ?? "agent:" + rec.id>`, `RT_DAEMON_SOCK=<daemon socket path>`. `agent:start` payload gains optional `subject?: string`; the board's launch paths pass their `mr:<url>`.

- [ ] **Step 1: Write failing tests** ... `agent:start` (herdr surface) produces a pane command/env containing the three vars and a `--settings` file whose JSON parses to the hook block above; headless launch argv carries the same `--settings`; resume re-stamps the same env.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Settings file per agent under the daemon's state dir (`~/.mattstack/rt/agent-hooks/<agentId>.json`), written at launch, path recorded on the rec if useful for cleanup; merge-safe: this file is passed via `--settings`, not written into any repo.
- [ ] **Step 4: Run agent handler suite.**
- [ ] **Step 5: Commit** ... `git commit -m "rt agent: launches stamp gate env and inject the gate-fork hook"`

---

### Task 11: Wrapper and skill text updates

**Files (mattstack-apps):**
- Modify: `apps/board/src/agent-launch.ts` / `apps/board/src/review-launch.ts` (pass `subject: mr.webUrl`-derived `mr:<url>` in the `agent:start` payload once rt-client exposes it)
- Modify: `apps/board/skills/review/SKILL.md`, `apps/board/skills/respond/SKILL.md`, `apps/board/skills/doctor/SKILL.md`: one added line in each gate section: "A PreToolUse hook may deny native AskUserQuestion when no gate is open; that denial is the gate protocol speaking: open the gate as this section describes. When the daemon is down the hook allows the native form (degraded mode is unchanged)."
- Test: board test suite (guard tests read the skill files), plus micro-test the added skill line per the writing-skills flow (baseline the denial scenario on a subagent with and without the line; 5 reps)

- [ ] **Step 1: Baseline micro-test** the denial scenario without the line (agent receives the deny reason; does it open a gate?). Document behavior.
- [ ] **Step 2: Add the line + launch payload change.**
- [ ] **Step 3: Re-run the micro-test with the line; expect convergence on opening a gate.**
- [ ] **Step 4: `bun run board:typecheck && bun run board:test && bun run format:check`.**
- [ ] **Step 5: Commit** ... `git commit -m "board: launch subjects + skill notes for the gate-fork hook"`

---

### Task 12: Board server joins the reconciler view

**Files (mattstack-apps):**
- Modify: `apps/board/src/data.ts` / `apps/board/src/server.ts` (fetch `GET /reconciler` alongside the existing daemon polls; join `ExecutorView` by gate id and by MR subject into the payload)
- Modify: `apps/board/src/gates/ingest.ts` (accept `kind: "pane-attention"` rows and non-`mr:` human-owned gates into a new `queueExtras` payload array instead of skipping them)
- Modify: `apps/board/src/client/types.ts` (payload types: `executor?: ExecutorState` on gates, `queueExtras: GateRow[]`, `orphans: ExecutorView[]`)
- Test: `apps/board/src/__tests__/` server-side tests for the join and ingest changes

- [ ] **Step 1: Write failing ingest/join tests** ... a pane-attention gate with owner human lands in `queueExtras`; a herd-owned one does not; an `ExecutorView` with `state: "gone"` and a subject matching an MR row attaches to that row as `orphan`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run board server suites.**
- [ ] **Step 5: Commit** ... `git commit -m "board: server joins reconciler view and admits non-MR human gates"`

---

### Task 13: Queue non-MR section and attention cards

**Files (mattstack-apps):**
- Modify: `apps/board/src/client/board/Board.tsx` (queue entries builder: append `queueExtras`), `apps/board/src/client/board/decision-queue.ts`
- Create: `apps/board/src/client/board/AttentionCard.tsx` (renders peek context + four action buttons; answers the gate with the chosen option via the existing `/gate/answer` POST)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx` (render AttentionCard for `kind === "pane-attention"`; non-MR gates render without the MR strip)
- Test: `apps/board/src/client/board/__tests__/attention-card-dom.test.tsx`

- [ ] **Step 1: Write failing DOM tests** ... a pane-attention gate in the queue renders four buttons (focus pane, resume, clear, dismiss); clicking clear POSTs `/gate/answer` with `{ action: "clear" }`; the sidebar decision-queue count includes extras; a gate with `escalatedAt` set renders an "escalated" chip on its queue card.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `bun run board:typecheck && bun run board:test`.**
- [ ] **Step 5: Commit** ... `git commit -m "board: decision queue admits attention cards and non-MR gates"`

---

### Task 14: Executor badges, orphan strip, stuck/unassigned rendering

**Files (mattstack-apps):**
- Modify: `apps/board/src/client/board/RowView.tsx` (executor dot when a row's run has state gone/stuck/hidden; orphan notification strip with resume/clear wired to `/reconciler/clear` proxied by the board server)
- Modify: `apps/board/src/client/board/GateRowChips.tsx` + `DecisionQueueModal.tsx` (render `delivery: "stuck"` as "pane didn't pick up the answer" with focus-pane, `execution: "unassigned"` as "answered, no pane to execute" with retry)
- Modify: `apps/board/src/style.css`
- Test: extend `apps/board/src/client/board/__tests__/gate-row-chips.test.tsx` and a new orphan-strip DOM test

- [ ] **Step 1: Write failing tests** for the three renderings and the clear action POST.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full board gates: typecheck, test, `format:check`, `scripts/repo-purity.sh`, `bun run board:build`.**
- [ ] **Step 5: Commit** ... `git commit -m "board: executor badges, orphan resume/clear, stuck and unassigned states"`

---

## Integration and verification (final)

- [ ] repo-tools: `bun run test:all`; announce the gates.db schema bump.
- [ ] `packages/rt-client`: `bun run build`; consumers reinstall (board's dist-freshness guard).
- [ ] Manual: reboot-simulation smoke on this machine ... open a gate from a spawned pane (isolated HOME per the CLAUDE.md rule), kill the pane, answer from the board, observe relaunch and `confirmed` delivery.
- [ ] Update `docs/architecture.md` links if the reconciler warrants a row.
