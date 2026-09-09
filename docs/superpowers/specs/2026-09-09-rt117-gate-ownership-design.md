# RT-117: gate ownership, routing, and honest shepherd surfaces

Date: 2026-09-09
Ticket: RT-117 (shepherdr dogfood findings, two herds)
Baseline: branch `bg-server-spec` at `067dd89f` (RT-113, background server + pane refs). This work assumes RT-113's seams exist: `bg:`-prefixed pane refs accepted and printed by every pane-consuming verb, and socket resolution threaded through `lib/daemon/inject.ts` and `lib/daemon/gate-escape.ts`.

## Problem

Two shepherds running herds in parallel hit the same wall from different sides: the gate facility has no concept of who a gate belongs to. Consequences, all observed live:

- Any subscriber can answer any herd's gates (`gate:answer` validates option membership and nothing else; `--by` is free text).
- No subscription shape serves a shepherd: herd-prefix subscriptions receive no pipeline gates, `run:` subscriptions receive every herd's.
- Every worker gate notifies the human, and the notification drops him into a worker pane a shepherd should have handled.
- A shepherd cannot tell a worker stalled on a pane-local form from one healthy in a background `rt gate wait`, and the surfaces that should tell it (herd status, presence idle timers) report stale or wrong signals.

## Ratified decisions

| Decision | Choice |
| --- | --- |
| Ownership source | Daemon derives at `gate:open` |
| Answer enforcement | Refuse non-owner, `--override` for the human |
| Shepherd routing | Auto owner-scoped subscription at `rt herd start` |
| Legacy shepherdr flow | Migrates to `rt herd` (pack-side companion) |
| Escalation to human | Unanswered past TTL, or owner push channel dead |
| Escalation TTL | 10 minutes, settings-registry key |
| Wait-mode discriminator | `presentation` required for pane-origin gates; surfaced everywhere |
| Run guard | Warn at `herd:close`, refuse at `worktree dispose` (no `--force`) |
| `rt runs --repo` | Resolve aliases at the filter, error on unknown (dir re-key stays RT-112) |
| `herd status` push channel | Live probe of the shepherd inbox |
| Presence idle timer | `lastSeenAt` also updates on outbound activity |

## 1. Ownership

`GateRow` gains `owner: "human" | "herd:<id>"`, stored as a new nullable TEXT column on `gates` (additive migration; see Schema below). A herd reference rather than a session id, so re-pointed shepherds keep ownership without row rewrites; consumers resolve it to the current shepherd session at use time. Derivation at `gate:open`, entirely daemon-side:

1. `origin.runId` present: run row's `spawned_by` is read. `herd:<id>` resolves through the herd store to the herd's current shepherd session. Anything else (absent herd, unowned spawn) derives `human`.
2. No `origin.runId` (including `herd:` subjects, which are opened by the shepherd FOR the human): `human`.

Ownership is derived once and stored; a re-pointed shepherd (`rt herd resume`) does not rewrite existing rows, so the answer guard resolves the CURRENT shepherd session through the herd id at check time, not the stored session. To make that possible the stored owner for herd-spawned runs is the herd reference (`herd:<id>`), resolved to a session lazily wherever a session is needed (push targeting, the answer guard, escalation).

## 2. Answer enforcement

`gate:answer` gains an owner guard ahead of the existing CAS (`lib/daemon/handlers/gate.ts:294-336`):

- Owner `human`: any caller may answer (today's behavior).
- Owner `herd:<id>`: the caller must present the owning session (`--session`, defaulted from the caller's session file the way other verbs do it). Mismatch returns a structured refusal naming the owner: `{ ok: false, error: "owned-by", owner, hint }`. Exit code and `--json` shape follow the existing rejected-verb convention.
- `--override` bypasses the guard, is intended for the human recovering a dead herd, and is recorded on the answer row (`overridden: true`) so the audit trail survives.
- `by === GATE_BY_PANE` (the pane answering its own form) stays exempt; that path is how a form's own submission lands.

Two adjacent repairs on the same handler path:

- Answering a superseded or closed gate returns a clean structured rejection (`reason: "superseded", supersededBy: <id>` when known) instead of today's non-JSON error.
- The refusal and rejection strings are pinned by e2e tests (exact-format assertions live in `e2e/tests/`, not unit suites).

## 3. Routing: owner-scoped subscriptions

`gate_subscriptions` gains a `scope` (`prefix` | `owner`), additive column, default `prefix`. An `owner` row means: push me every gate whose resolved owner session is mine, regardless of subject.

- `rt herd start` (and `rt herd resume`) auto-register the owner subscription for the shepherd session. No skill text is involved; forgetting to subscribe stops being a possible failure.
- `rt gate subscribe` keeps its prefix form for non-shepherd uses; nothing existing breaks.
- Fan-out (`lib/daemon/gate-push.ts` `fanOut`) matches `owner` rows by resolving the row's session against the gate's owner, alongside the existing prefix match.
- Dead-row hygiene: the existing retry sweep prunes subscription rows that have been `dead` longer than a grace window (default 24h, constant, not a setting). Covers today's immortal dead rows.

## 4. Notifications and escalation

The notify seam consults ownership before surfacing a gate to the human:

- Gate owner resolves to a live shepherd session: no human notification at open. The shepherd's push IS the delivery.
- Gate owner is `human` (includes every `rt herd ask` / `milestone`): notify exactly as today.
- Escalation: a daemon sweep (piggybacking the existing gate retry cadence) fires ONE human notification for a shepherd-owned gate that is (a) still open past the TTL, or (b) whose owner's push channel is marked dead. The notification names the gate, the herd, and why it escalated. TTL is a registered settings key (`rt.gates.escalationTtlMinutes`, default 10) following the settings-registry checklist and the registry's `rt.*` naming convention.

## 5. Wait-mode discriminator

`origin.presentation` already takes `"form" | "wait"` and `"form"` already drives Escape injection. Completing it:

- `gate:open` REQUIRES `presentation` when the origin carries a `paneId`; a pane-origin open without it is rejected with a hint. Origins without a pane default to `wait`. (Openers in the wild are pack-generated; the companion pack change updates them in the same wave.)
- `rt gate list`, `rt herd gates`, and the doorbell phrase surface presentation and owner, so a shepherd reading a gate row knows whether Escape is needed, harmful, or handled automatically.
- Herd-subject gates opened from a pane declare `form`, which lights up the Escape seam RT-113 built (the case moe parked on RT-113 for this ticket).
- No wait heartbeat in this wave: `gate wait` remains traceless at the daemon. The OOM-kill blindspot is accepted and recorded as a possible follow-up; the superseded-answer repair above removes its sharpest edge.

## 6. Honest surfaces and satellites

| Surface | Change | Anchor |
| --- | --- | --- |
| `rt herd status` | Live-probes the shepherd inbox (resolve session, ping socket) and reports `push: reachable/unreachable` with `lastDelivery` age; stored `dead` stops being the headline | `lib/daemon/handlers/herd.ts:98-125` |
| `rt herd resume` | Gate count comes from the `herd:gates` query (run gates matched by job worktree), not the herd-prefix list | `handlers/herd.ts:242` vs `:332-344` |
| Presence idle | `touchLastSeen` also fires on post/dm/ack/read, so `idle Ns` means "last did anything" | `lib/state/presence-store.ts:414`, writers in `handlers/chat.ts` |
| `rt chat dm` | Prints a one-line success confirmation (recipient + message id) without `--json` | `commands/chat.ts` |
| `rt runs --repo` | The store filter resolves any accepted alias to the run-dir name; an unresolvable value errors instead of returning `[]` | `lib/runs/store.ts:119-121`, `commands/runs.ts:80-89` |
| `herd:close` | Warns (does not refuse) when the job's worktree has a `status: running` run, printing run id + stage + `rt runs abandon` pointer | `handlers/herd.ts:258-268` |
| `worktree dispose` | New refusal `running-run` in the existing guard chain; `--force` skips like its siblings | `lib/worktree/dispose.ts:218-247` |

## Schema

`gates.db` is its own sqlite store with an established idempotent migration pattern: the `CREATE TABLE IF NOT EXISTS` blocks carry the new columns (`gates.owner`, `gate_subscriptions.scope`), and existing-table adds ride the store's `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` loop (the same one that added `context`/`origin`). No `state.db` involvement, no `SCHEMA_VERSION` claim needed.

## Companion work (mattstack-skills, same plan)

The claimview pack's herd-init migrates to `rt herd start` so every shepherded run resolves an owner (spawned_by carries `herd:<id>`), and pack gate-open templates declare `presentation`. Executed in the mattstack-skills repo as tasks of this plan; rt-side changes do not depend on it landing first (legacy runs simply derive `owner: human`, today's behavior).

## Out of scope

- Run-dir re-keying to serialized identity (RT-112).
- Redelivery/retry changes for form-blocked panes (disproven as the mechanism; the form is the blocker).
- `rt bg status/release` stale-claim CLI (flagged on RT-113).
- Any fs-watcher or wait heartbeat.
- Process reaping on pane close. A closed pane can orphan SIGTERM-immune dev servers reparented to init (RT-117 item 2 addendum); endpoint claims are not a liveness signal and the agent's own teardown report cannot be trusted, so reaping belongs to the pane-closing layer (herdr). Follow-up outside rt's side of this ticket.

## Testing

- Unit: owner derivation (herd, legacy, human, missing run), answer guard (owner, non-owner, override, `GATE_BY_PANE`, superseded), owner-scope fan-out, escalation sweep (TTL, dead-owner, fires once), dispose refusal, runs filter resolution, presence touch, dm output.
- e2e: answer-refusal message shape, doorbell phrase with presentation/owner, `rt chat dm` success line. Run `bun run test:all`; the e2e suite is where verbatim formats are pinned and `bun run test` does not run it.
- The tree needs `bun install` (rt-client moved on the baseline branch) before any suite runs.
