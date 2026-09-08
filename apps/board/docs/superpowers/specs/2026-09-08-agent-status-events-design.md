# Agent status over the rt event bus

Move the pane-to-board lifecycle signal off HTTP and onto the rt daemon's
event bus, and retire the port file that HTTP depended on.

## Problem

A launched pane (review, respond, doctor) reports each lifecycle transition
by writing its state file and then POSTing the same signal to the board at
`/agent/status`. To do that the status CLI has to know the board's port,
which it reads from `state/board-port`, a file the server writes at boot.
Any other board boot from the same `APP_ROOT` overwrites it, in the dev
checkout and in the bundled binary alike, and the CLIs cannot be handed the
port another way: panes launch through `rt agent start`, which carries no
environment.

On 2026-09-06 a stray boot left a dead port in that file. Every `done`
signal after that was posted to nothing and swallowed as best-effort, so no
latch was armed, no Slack reaction landed, and no pane tab auto-closed
until the sweeps caught up. The latch on !44121 arrived from the triage
pass five minutes late; the rest never arrived.

## Solution

The CLI emits the signal on the rt daemon's event bus. The board reads it
from the journal that bus keeps, using the daemon subscription it already
holds for gate events as a wake-up rather than as the delivery. The port
file, its boot-time write, `notifyBoard`, and the `/agent/status` and
`/review/outcome` routes go away.

### Wire contract

Topic `board/agent-status/<kind>`, where `<kind>` is `review`, `respond`
or `doctor`. Payload is the existing `AgentSignal` plus one scoping field:

```json
{
  "mrUrl": "https://gitlab.com/acme/acme-web/-/merge_requests/44121",
  "iid": 44121,
  "kind": "review",
  "status": "done",
  "outcome": "comment",
  "appRoot": "/Users/matt/Documents/GitHub/mattstack-apps/apps/board"
}
```

`appRoot` is the emitting CLI's `APP_ROOT`. The status-bin a pane runs is
the launching board's own (`statusBinPath()`), so this is the launching
board's root by construction, in the checkout form and the compiled form.
The bus is machine-wide and every board on the machine hears every frame;
a board handles only frames whose `appRoot` equals its own and drops the
rest silently. Without this, a dev board and the deck board watching the
same MR would both post a latch.

The `--status-bin` contract the wrapper skills call is unchanged: same
verbs, same arguments, same state-file writes.

### CLI side

`bin/review-status.ts`, `bin/respond-status.ts` and `bin/doctor-status.ts`
replace their `notifyBoard(signal)` call with `emitAgentStatus(signal)`
from a new `src/agent-status/emit.ts`, which calls rt-client's
`eventsEmit(topic, payload)`. Best-effort, exactly as today: a daemon that
is down logs one line to stderr and the CLI still exits zero, because the
state file it already wrote is the source of truth.

### Server side: the feed

A new `src/agent-status/feed.ts` owns consumption. It is the only path by
which a signal reaches the handler, so live delivery and catch-up share one
code path and one ordering.

- **Cursor.** The feed persists the id of the last journal event it has
  handled in `state/agent-status-cursor`. On boot with no cursor file it
  reads `eventsHead()` and starts from there: nothing before the feature
  shipped is replayed.
- **Catch-up.** `catchUp()` reads
  `eventsList({pattern: "board/agent-status/*", after: cursor})`, handles
  each event in id order, and advances the cursor after each one. Frames
  whose `appRoot` is not this board's are skipped and still advance the
  cursor; the first frame from each foreign root is logged once so a
  misconfigured `BOARD_APP_ROOT` is visible rather than silent. A handler
  throw is logged, the cursor still advances, and the sweeps remain the
  backstop for that MR; a poison event must never wedge the feed.
- **Deadline.** Each handler call is raced against `HANDLE_DEADLINE_MS`
  (30s). On expiry the feed logs, advances, and moves on; the running call
  is not cancelled. One stalled GitLab or Slack call therefore costs one
  MR's signal 30s, never every MR's.
- **Triggers.** Three things call `catchUp()`: boot, every relay `event`
  frame whose topic starts with `board/agent-status/`, and the existing
  gate-sweep tick (`GATE_SWEEP_MS`, 60s). The relay push is a wake-up, not
  the delivery: the pushed frame's payload is ignored and the journal is
  read instead, so a frame that arrives while the board is mid-reconnect
  or backpressured is picked up by the next tick at the latest.
- **One in flight.** Concurrent triggers coalesce onto one running
  `catchUp()`; a trigger that lands while one is running schedules exactly
  one more pass after it. Events for one MR therefore never interleave.

The feed takes its I/O as an injected interface (`eventsHead`,
`eventsList`, read and write cursor, `handle(signal, emittedAt)`,
`appRoot`, `log`, and an optional `handleDeadlineMs`) so it is unit-tested
with fakes and no daemon.

### Server side: the handler

The body of the `/agent/status` case in `src/server.ts` becomes
`async function handleAgentSignal(signal: AgentSignal, emittedAt: number):
Promise<void>` in the same file, where `emittedAt` is the journal's stamp
for the event. It keeps its four side effects in their current order and
semantics: peer review-state relay, latch arm or spend, `closeOnDone`,
Slack reaction. Two of them read `emittedAt`, because on a replay the
handling time is boot time, not transition time: the peer envelope carries
`updatedAt: emittedAt`, and `closeOnDone` is skipped when that kind's state
file already has an `updatedAt` newer than `emittedAt`, since a later
transition or launch owns that tab. The CLI writes the state file before
it emits, so a live signal always closes. Latch and Slack replay
unguarded: a latch is posted only when none is armed, and `reactToMR`
already treats `already_reacted` as success. The Slack branch logs instead
of returning an HTTP status. The feed's `handle` is this function.

### Retired

- `state/board-port`: the write at server boot and `readBoardPort`.
- `src/board-notify.ts` and its test, replaced by `src/agent-status/emit.ts`.
- The `/agent/status` and `/review/outcome` routes.
- `parseAgentSignal` and its tests, replaced by `parseAgentStatusPayload`,
  which validates the bus payload including `appRoot`.
- The `BOARD_APP_ROOT` comments in the server-booting tests that explain
  the port-file write; the env var itself stays, since those tests still
  isolate state.

### Guarantees

| Board state at emit time                                                             | Delivery                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Up and connected                                                                     | Relay push wakes `catchUp()`; handled within a second |
| Up, relay reconnecting or backpressured                                              | Next sweep tick, at most 60s                          |
| Down                                                                                 | Boot catch-up replays everything after the cursor     |
| Down past journal retention (older than 7 days and outside the newest 50,000 events) | The triage latch pass and gate sweep, unchanged       |
| Daemon down at emit                                                                  | Lost, as today; state file plus sweeps                |

The sweeps are not touched by this change and remain the durable path.

### Dev and bundle parity

Both forms run the same code. The CLIs are `bun run bin/<name>.ts` from a
checkout or the compiled binary's subcommands, and both already bundle
rt-client for the gate verbs. `APP_ROOT` differs between the forms and the
feed's cursor file lives under it, next to the state it describes.

## Testing

- `src/__tests__/agent-status-emit.test.ts`: topic and payload shape per
  kind, `appRoot` present, daemon failure swallowed with one stderr line
  and a resolved promise.
- `src/__tests__/agent-status-feed.test.ts`: first boot seeds the cursor
  from head and replays nothing; catch-up handles in id order and advances
  per event; foreign `appRoot` skipped and cursor advanced; handler throw
  logged and cursor advanced; concurrent triggers coalesce to one run plus
  one follow-up; relay frame payload ignored in favour of the journal.
- `src/__tests__/agent-signal.test.ts` (existing): drop the `/review/outcome`
  cases, add the `appRoot` cases.
- Existing server-booting tests keep `BOARD_APP_ROOT`; their comments are
  updated. `board-notify.test.ts` is deleted with its module.

## Docs

`README.md` (Configuration: port paragraph, Agent actions) and
`docs/agent-actions.md` lose the port-file and HTTP wording and describe
the bus topic, the cursor file, and the guarantees table above.

## Out of scope

- Any rt or daemon change. The bus, journal, relay fan-out and client
  wrappers all exist.
- Changing the wrapper skills or the `--status-bin` contract.
- Retiring the sweeps or changing `LATCH_POST_GRACE_MS`.
- Signals from anything other than the three status CLIs.
