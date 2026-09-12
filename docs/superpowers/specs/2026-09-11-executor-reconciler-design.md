# Executor reconciler: pane lifecycle for board-originated agent work

Date: 2026-09-11
Status: approved design, pre-plan

## Problem

Board- and pipeline-originated agent actions execute inside herdr panes, but
panes are the most volatile object in the estate while the architecture
treats them as the durable executor. When herdr crashes, the machine
reboots, or a user closes a pane, the durable stores (agents table, gate
rows, board state) keep pointing at executors that no longer exist, and
nothing notices:

- A gate answered from the board with a dead pane records the decision and
  silently never executes it (posting, implementing).
- The remote-answer Escape is injected at `origin.paneId`, stamped at gate
  open; after a reboot the resumed pane has a new paneId, the Escape misses,
  and the pane sits blocked on a stale form with the delivered nudge queued
  behind it (observed 2026-09-11, gate 9db2a8a3).
- A closed review/doctor pane orphans its state: the board shows a live
  "reviewing" badge forever.
- herdr's needs-action (blocked) panes are invisible to the decision queue:
  an agent that improvises a blocking question via the native form never
  becomes a gate.
- `delivery.outcome: "delivered"` records transmission, not that the
  executor actually processed the answer.

## Principles

1. **Derived, not duplicated.** Executor state is recomputed each sweep from
   sources that already exist: the agents table, gates.db, and herdr's
   `session.snapshot`. No new table of record; durability only where user
   intent must persist (gate rows, a small kv for tombstones).
2. **The session id is the durable pane identity.** herdr recovery resumes
   the same Claude session in a new pane; `agent_session.value` in the
   snapshot survives reboots while paneId does not. Every pane lookup layers
   paneId, then session id, then cwd/worktree.
3. **Verify outcomes against herdr state.** Sends (Escape, relaunch) are
   followed by an expectation the sweep checks; fire-and-forget delivery is
   retired.
4. **Ownership routes decisions.** The human queue shows `owner === "human"`
   gates (escalated included). Herd-owned gates and their attention gates go
   to the shepherd via the existing `deriveOwner` / gate-escalation path.

## Architecture

### Layered pane resolver (shared)

`lib/daemon/pane-resolve.ts` (new): given `{ paneId?, sessionId?, worktree? }`
and a herdr snapshot (all servers: main and bg sockets), resolve to a live
pane ref:

1. `paneId` when the snapshot still contains it.
2. The pane whose `agent_session.kind === "id"` and value equals
   `sessionId`.
3. Unique cwd/worktree match, normalized per
   `normalizeWorktreePath` in `packages/gate-kit` (the daemon carries its own
   copy of the rule; symlink and `/tmp` forms already documented there).

Ambiguous or empty at every layer resolves to `null`. Consumers: the Escape
injector (`lib/daemon/gate-escape.ts`), origin focus, the reconciler sweep,
answer-time relaunch. This resolver alone fixes the observed Escape miss and
ships first (lane 4).

### Reconciler sweep

`lib/daemon/reconciler.ts` (new), wired in `lib/daemon.ts` beside
`createGateEscalation` on the same cadence. Each pass:

1. Snapshot herdr (main + bg). herdr unreachable: every non-finished agent
   row gets executor state `unknown`; no transitions fire on `unknown`, so a
   herdr restart does not stampede attention gates.
2. For every agents-table row without `finished_at`, resolve the pane via
   the layered resolver and stamp an **executor state**:
   - `live`: pane resolved, `agent_status` is `idle`/`working`/`done`.
   - `blocked`: pane resolved, `agent_status === "blocked"`.
   - `hidden`: pane resolved but its workspace is not open in any visible
     herdr window (bg server, or workspace absent from the tray's visible
     set).
   - `gone`: no pane resolves.
   - `cleared`: kv tombstone (user clicked clear); terminal, sweep skips.
3. Join open/parked gates by subject and agent (origin.paneId, nudge
   session, worktree) so each gate carries the executor state of the pane
   behind it.
4. Compare against the previous pass (in-memory) and act on transitions:
   - `* -> blocked` sustained for 2 consecutive sweeps: open an
     **attention gate** (below) unless an open/parked gate already exists
     for the subject (a legitimate form presentation is `blocked` by
     design).
   - `blocked -> live`: close that attention gate (`closedReason:
     "resolved"`).
   - `* -> gone` sustained for 2 consecutive sweeps, with open/parked gates
     or a non-terminal board status: stamp the run's gate rows `executor:
     "gone"`, and open an attention gate (`reason: "gone"`) so the orphan
     appears in the queue with resume/clear; a pane coming back closes it
     (`closedReason: "resolved"`).
5. Check pending **expectations** (below).
6. Serve the computed view via `reconciler:status` and emit bus events on
   every transition so the board's SSE push refreshes without polling.

In-memory previous-pass state means a daemon restart re-derives everything
in one sweep; the only replays possible are idempotent (attention-gate open
checks for an existing row first).

### Attention gates

Ordinary gate rows, `kind: "pane-attention"`, subject `agent:<agentId>`
(or the run's `mr:`/`run:` subject when the agents row carries one), owner
via `deriveOwner`, `meta: { agentId, paneRef, reason: "blocked" | "gone" }`,
context filled with the pane's last screen (`pane.peek`, truncated to the
8 KB context cap). One question, single-select, options
`["focus-pane", "resume", "clear", "dismiss"]`; the board renders these as
buttons, not a form. Answering `clear` writes the kv tombstone, closes the
run's other gates (`closedReason: "abandoned"`), and marks the board status
`interrupted`. `dismiss` closes the attention gate only.

### Answer-time executor guarantee

In the gate answer handler, after the answer is recorded (off the hot
path):

- Executor `live`/`blocked`: deliver nudge + Escape via the layered
  resolver, then register expectation `leave-blocked`.
- Executor `gone`: single-flight per gate, relaunch through
  `agent:resume` (`resumeAgentPane`; the agentId is already in the agents
  table and on the board's state file). The wrapper's `--resumed-gate` path
  already reads a recorded answer and proceeds to execution. Register
  expectation `appear-live`.
- Relaunch impossible (herdr down, agent row missing) or expectation
  failed: stamp the gate row `execution: "unassigned"` and emit; the board
  shows "answered, no pane to execute" with a retry action.

A manual focus-pane during an in-flight relaunch returns the launching
pane; it never spawns a second executor.

### Expectations

Small in-memory list `{ gateId, agentId, expect: "leave-blocked" |
"appear-live", deadlineAt, retriesLeft }` checked each sweep:

- `leave-blocked`: pane still `blocked` past the deadline (2 sweep
  intervals): re-resolve the pane and re-send Escape, up to 2 retries; then
  stamp `delivery.outcome: "stuck"` and emit (board: "pane didn't pick up
  the answer").
- `appear-live`: no live pane by the launch deadline: `execution:
  "unassigned"` as above.
- Success stamps `delivery.outcome: "confirmed"`.

`delivery.outcome` values become `"delivered" | "confirmed" | "stuck"`;
`"delivered"` remains the transmitted-only intermediate state.

### AskUserQuestion hook

Every `rt agent` launch injects a PreToolUse hook (matcher
`AskUserQuestion`) through the settings it already controls at spawn; the
script ships with rt (`scripts/hooks/gate-fork.sh` in the bundle). Env
stamped at launch: `RT_AGENT_ID`, `RT_GATE_SUBJECT`, `RT_DAEMON_SOCK`.

Hook logic, in order:

1. Daemon socket probe fails: **allow** (degraded mode stays legal).
2. An open or parked gate exists for `RT_GATE_SUBJECT`: **allow** (the
   wrapper's `presentation: "form"` branch legitimately renders gates as
   native forms).
3. Otherwise: **deny**, with a denial message instructing the agent to open
   a gate per the gate protocol (subject and status-bin from env).

Net effect: a native form may only be the face of a real gate; improvised
forks become gates and route by owner. Blocked-pane detection remains the
safety net for everything else (permission prompts, wedged processes,
un-hooked panes).

### Board surfacing (mr-board repo)

- Data payload joins the reconciler view: each MR row and gate carries the
  executor state; rows with orphaned runs get a notification strip
  (resume / clear).
- The decision queue gains a **non-MR section** for human-owned gates
  without an `mr:` subject: console run gates, escalated herd gates,
  attention gates. Attention cards render peek context and the
  focus-pane / resume / clear / dismiss actions.
- The sidebar decision-queue button counts all human-owned queue entries.
- Gate cards for `execution: "unassigned"` and `delivery: "stuck"` render
  those states with a retry / focus-pane affordance instead of appearing
  done.

## Ownership routing (unchanged, restated)

| Gate | Owner | Human queue? |
|---|---|---|
| Board review/respond/doctor | human | yes |
| Console run gates | human | yes (non-MR section) |
| Herd member -> shepherd | herd:\<shepherd\> | no |
| Herd gate, TTL/owner-dead escalation | escalated -> human | yes, marked |
| Attention gate | deriveOwner of its run | herd's -> shepherd; else human |

## API contracts (frozen before lanes start)

### Types (packages/rt-client)

```ts
export type ExecutorState =
  "live" | "blocked" | "hidden" | "gone" | "cleared" | "unknown";

export interface ExecutorView {
  agentId: string;
  repo: string | null;
  subject: string | null;        // mr:<url> | run:<id> | agent:<id>
  surface: AgentSurface;
  sessionId: string;
  paneRef: string | null;        // resolved live ref, null when gone
  state: ExecutorState;
  since: number;                 // epoch ms of the current state
  openGateIds: string[];
  boardStatus?: string;          // review/respond/doctor status word
}

export interface ReconcilerStatus {
  sweptAt: number;
  herdrReachable: boolean;
  executors: ExecutorView[];
}
```

### Gate row additions

```ts
delivery: { outcome: "delivered" | "confirmed" | "stuck"; at: number }
execution?: "unassigned";        // answered, no executor; cleared on success
executor?: ExecutorState;        // stamped by the sweep for open/parked rows
```

`kind: "pane-attention"` joins the known kinds; `domainForKind` returns
undefined for it by design (no board lifecycle), the queue includes it by
owner, not by domain.

### Daemon verbs

- `reconciler:status` -> `ReconcilerStatus` (also REST `GET /reconciler`).
- `reconciler:clear` `{ agentId }` -> kv tombstone + gate closes as
  specified (REST `POST /reconciler/clear`).
- `gate:answer` response unchanged; side effects per answer-time section.
- `agent:resume` unchanged; gains the single-flight guard keyed by gateId.

### Bus events

`reconciler.transition` `{ agentId, from, to, paneRef, gateIds }`,
`reconciler.delivery` `{ gateId, outcome }`,
`reconciler.execution` `{ gateId, execution }`.

### Hook contract

PreToolUse, matcher `AskUserQuestion`. Env: `RT_AGENT_ID`,
`RT_GATE_SUBJECT`, `RT_DAEMON_SOCK`. Exit 0 with the Claude Code hook
envelope on stdout: `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
"permissionDecision": "allow"}}` or `{"hookSpecificOutput":
{"hookEventName": "PreToolUse", "permissionDecision": "deny",
"permissionDecisionReason": "<gate-protocol instruction>"}}`. The deny
reason text is part of the contract: it names `rt gate open`, the subject,
and the status-bin form.

## Parallel lanes

Buildable concurrently against fixtures of the contracts above:

1. **Daemon reconciler**: sweep, expectations, attention gates, answer-time
   guarantee, verbs, events. (repo-tools)
2. **Board UI**: non-MR queue section, executor badges, orphan strip,
   attention cards, unassigned/stuck rendering. (mattstack-apps)
3. **Hook + launch wiring**: hook script, `rt agent` settings injection,
   env stamping, wrapper-skill text updates. (repo-tools +
   mattstack-apps skills)
4. **Layered pane resolver + Escape/delivery hardening**: ships first as
   the tactical fix for the observed Escape miss. (repo-tools)

Lane 4 is a strict prerequisite of nothing (lane 1 consumes the resolver
module but can build against its interface); it ships independently.

## Testing

- Resolver: unit table over snapshot fixtures (paneId hit, session hit, cwd
  hit, ambiguity, empty).
- Reconciler: simulated snapshots driving transitions; attention-gate
  open/close idempotency; herdr-unreachable produces `unknown` and no
  transitions; expectation retry/stuck paths.
- Answer-time: answered-with-gone triggers exactly one resume
  (single-flight race test); relaunch-fail stamps `unassigned`.
- Hook: script-level tests of the three branches (daemon down, open gate,
  no gate) driven by env + a fake socket.
- Board: DOM tests for the non-MR section, attention card actions, and
  stuck/unassigned rendering.
- e2e: the `--json` envelopes of `reconciler:status` (exact-string, per the
  e2e footgun).

## Out of scope

- Mirroring a native form's options into a gate (answer-from-queue for
  un-hooked blocks); focus-pane covers it.
- herdr-side changes; the snapshot as-is suffices.
- Event-sourcing the lifecycle over the bus beyond transition emits.
