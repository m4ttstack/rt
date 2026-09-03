# Gate events: review gates on the rt bus, focus everywhere, panes that clean up

> Goal: a review's human gate becomes an event any surface can answer (board UI,
> the pane, a notification), launched panes become rt agents with durable
> identity, focus buttons land in the board and the console, and panes stop
> accumulating: they close at completion and park after an unanswered gate goes
> quiet. Single spec, single plan, staged across repo-tools (rt + tray), board,
> console, and the board wrapper skills.

Tickets: BOARD-20 (auto-close), BOARD-21 (gate notifications + focus). The
addendum ambitions on both tickets (headless panes, gates as event emissions)
were explored; the event half ships here, the headless half was investigated
and rejected for this pass (see Rejected alternatives).

## Decisions already made (with Matt, 2026-09-02)

1. **Gates are events.** The wrapper skill emits a `gate opened` event on the
   rt events bus and blocks until a `gate answered` event arrives. Any surface
   that can emit an event can answer. The in-pane form (AskUserQuestion) stops
   being the gate.
2. **One combined gate per review.** Today's two sequential gates (comment
   tiers to post, and comment vs approve, in whichever order the current
   skill runs them) collapse into one gate carrying both questions. One
   notification, one interruption, one transcript replay per review.
3. **Panes stay in the daily herdr session.** Launched visible (background
   workspace, `--no-focus`), exactly as today. Focus, peek, and the tray
   bridge all work on them unchanged.
4. **Hot gate window, then park.** A pane waiting at a gate stays alive for a
   grace window (default 90 minutes of unanswered gate age,
   setting-controlled).
   An answer inside the window continues in-session with no transcript
   replay. Past the window the board parks the review: closes the pane, keeps
   the gate open, and resumes the recorded session later with the answer as
   the resume prompt.
5. **Launch through rt agent.** The board's hand-rolled herdr CLI launch moves
   to `agent:start` / `agent:resume` (surface `herdr`). rt mints the session
   id up front, records pane/tab/workspace ids durably, and pins the account
   as data. The rt side is already adoption-ready (repo-tools spec
   2026-08-28-rt-agent-adoption-readiness-design.md); the installed rt-client
   in board already carries the resume `workspace`/`tab` fields.
6. **Notification bridge lives in rt.** The daemon notifier grows a generic
   subscriber that maps event topic patterns to notifications. The board
   configures a mapping; it builds no notification plumbing of its own.
7. **Focus suppression uses herdr's focused flag.** rt's `pane:list` starts
   propagating the `focused` boolean herdr already reports. A gate
   notification is skipped when the gate's pane is focused. Known limitation,
   accepted: "focused in herdr" is wrong when herdr's terminal is itself in
   the background; a tray frontmost-app check is a documented follow-up if it
   bites.
8. **Focus buttons in board and console.** Both apps copy chat's proven
   pattern: `POST /api/panes/:id/focus` forwarding to rt-client `paneFocus`,
   which routes through the daemon to the tray and raises the hosting
   terminal window.
9. **Resumes re-invoke the wrapper.** Every resume (re-review, parked gate)
   passes the wrapper slash command, built with the same full flag set as a
   fresh launch (`--report` included), as the `agent:resume` prompt. A slash
   command in a resumed session loads the current wrapper skill and
   re-resolves the pack binding, so prose governance returns to the skill and
   pack on every path. The hardcoded `reReviewResumePrompt` in board's
   `src/herdr.ts` is deleted, not rewritten.
10. **Typed skill invocation: descoped.** Explored 2026-09-02, judged too big
    for this pass; captured as a mattstack-skills backlog ticket. The launch
    lane keeps board's existing `dispatchPrompt` builder for prompt strings,
    on both fresh launches and resumes.

### Rejected alternatives (so the next session does not re-litigate)

- **Headless claude (`agent:start` surface `headless`, `claude -p`)**: parking
  is free, but the active phase is opaque, there is no pane to focus mid-run,
  and every gate cycle costs a transcript replay (full input-token re-read
  once the prompt cache expires). Rejected as the default surface.
- **A second multiplexer (tmux engine, zellij, rmux)**: the runner's
  TmuxEngine is runner-internal and would need daemon verbs, registry, orphan
  reaping, and an attach bridge; zellij is heavier headless for no headless
  benefit; rmux is pre-1.0 and unproven under a full-screen claude TUI.
  herdr itself already does everything needed. rmux stays a documented future
  candidate behind the runner's Engine interface.
- **Headless herdr (second `herdr server --session <name>`)**: spiked
  2026-09-02. Works (panes run and answer the socket API with no client), and
  `--session` gives true state isolation (a bare `HERDR_SOCKET_PATH` override
  does NOT: the server restores the default session's state). But the tray
  focus bridge shells the herdr CLI with no session awareness, so seamless
  focus would require session-aware plumbing through rt, the tray, and Swift,
  or nested herdr-in-herdr attach. Not worth it while auto-close solves the
  actual complaint. Also verified: herdr has no cross-server pane migration
  (pane move is intra-server; handoff transfers a whole server's runtime to a
  replacement, same session, source exits).
- **Two gates kept separate**: rejected; see decision 2.

## The event contract

Topics are opaque strings on the rt events bus (SQLite journal, `events:emit`
/ `events:wait` verbs, WS relay on 9401). Consumers match with glob patterns
and hold their own cursors.

- `board/gate/opened/<gateId>`

  ```json
  {
    "gateId": "<uuid, minted at open>",
    "kind": "review-post",
    "mrUrl": "https://gitlab.com/acme/web/-/merge_requests/2317",
    "iid": 2317,
    "agentId": "<rt agent id>",
    "sessionId": "<claude session uuid>",
    "paneId": "wC2:p4",
    "tabId": "wC2:t4",
    "questions": [
      { "id": "tiers", "label": "Post which findings?", "multi": true,
        "options": ["blocking", "non-blocking", "nitpicks"] },
      { "id": "outcome", "label": "Verdict", "multi": false,
        "options": ["comment", "approve"] }
    ],
    "openedAt": 1789000000000
  }
  ```

- `board/gate/answered/<gateId>`

  ```json
  {
    "gateId": "<same uuid>",
    "answers": { "tiers": ["blocking", "non-blocking"], "outcome": "comment" },
    "by": "board-ui | pane",
    "answeredAt": 1789000000000
  }
  ```

Rules:

- The gate id is minted by the status-bin at open time and is the join key
  everywhere. The answer topic embeds it so a waiter subscribes to exactly one
  gate.
- Exactly one answer wins. The board is the only writer of parked-gate
  resumes, and the wrapper treats the first `answered` event as final;
  later duplicates are ignored.
- The `questions` array is the render contract for the board UI card. The
  wrapper owns the semantics; the board renders and echoes back answers by
  question id, and treats unknown `kind` values as render-only (show the
  questions, emit the answers, know nothing else).

## Components by repo

### repo-tools (rt daemon + tray)

**Notifier event bridge.** A daemon-internal subscriber on the events bus
(same process, no socket hop). A settings-declared mapping list, shape along
the lines of:

```jsonc
// mattstack settings, rt scope, registered per the settings conventions
"rt.notify.eventBridges": [
  { "pattern": "board/gate/opened/*", "category": "gate",
    "title": "review gate: !{iid}", "message": "{mrUrl}" }
]
```

For each matching persisted event: build a `NotificationEvent`, carrying the
payload's `paneId` when present, and enqueue through the existing durable
notify queue (tray push, osascript fallback, all unchanged). Suppression: when
the event payload names a `paneId` and herdr's snapshot reports that pane
focused at fire time, drop the notification (log, do not queue).

**`NotificationEvent.paneId`.** New optional field on the event shape and the
`notify_queue` row, threaded through `pushToTray`.

**Tray focus action.** A notification category for pane-carrying events whose
click (default action) calls the existing `HerdrBridge.focusPaneById(paneId)`
instead of opening a URL. Swift changes confined to NotificationManager plus
the category registration.

**rt-client events wrappers.** The catalog has `events:emit/wait/list` but
the client exports only `eventsHead`; the board's gate verbs and answer
endpoint need all three, so rt-client adds `eventsEmit`, `eventsWait`
(client timeout above the daemon's 240s cap), and `eventsList`, published as
a minor bump the board's pin consumes.

**`pane:list` focused flag.** `paneRow` starts copying herdr's per-pane
`focused` boolean onto `ChatPane`. The `HerdrPane` input type in the pane
handlers needs the field too (it currently drops it at parse); fixtures
updated.

### board

**Launch via rt agent.** `launchReview` / `launchRespond` / `launchDoctor` /
`launchResume` move from shelling the herdr CLI to `agentStart` /
`agentResume` (surface `herdr`), keeping today's workspace labels, tab labels
(glyphs included), and operator notes in the launched prompt. Review state
gains `agentId` and `paneId`; `sessionId` is now populated at launch from the
agent record instead of captured late by the status-bin (the status-bin
`--session` write stays as a harmless echo until a later cleanup).
`config.claudeCommand` retires; account/model/effort become launch fields
resolved from settings. The duplicate-label dedup branch maps `agent:start`'s
"already open; focused it" error onto the existing focused-existing outcome;
`agent:resume` can return the same error and gets the same mapping (a parked
resume should never hit it, since the park closed the tab, but the mapping
costs nothing).

**Gate store + UI.** The board server already subscribes to the rt WS relay;
it adds the `event` frames for `board/gate/*` topics. Open gates live in a
small store (state file per gate beside review state), pushed to the client
over the existing SSE channel. The client renders a gate card on the MR row:
the questions from the payload, answer controls, submit. Submit hits
`POST /gate/answer`, which validates against the stored gate, emits
`board/gate/answered/<gateId>`, and marks the gate answered locally.

**Auto-close.** When a board-launched review reaches `done` (the
`/review/outcome` handler, plus the triage reconcile pass for a missed
signal), the board closes the pane's tab. `error` keeps the pane for
forensics and notifies instead. Respond and doctor panes get the same done
close; they have no gates this pass.

The close mechanism is `herdr tab close <tabId>` through the board's
existing `HerdrRunner`. rt-client has no close verb, and this pass does not
add one: lanes 2 and 3 move launch and focus off the herdr CLI, but the
runner is deliberately retained for this one verb (an `rt pane:close` verb
is a candidate follow-up, not this pass).

**Park after grace.** The park trigger is gate age alone: a gate still
unanswered `board.gateGraceMinutes` (default 90, registered per the
settings conventions) after `openedAt`. No pane
activity signal feeds it; the wait loop keeps the pane's agent status
pinned at `working`, so activity-based triggers cannot work. The timer is a
sweep on the board server's existing interval loop over the gate store.
Accepted edge: a human still discussing in-pane past the grace without
answering gets parked under them; the transcript persists and resume
recovers the session. When the sweep fires, the board closes the pane (the
wrapper is mid `gate wait`; killing the pane kills the wait; the transcript
is safe)
and marks the gate parked. When an answer later arrives for a parked gate,
the board resumes via `agentResume` with the wrapper slash command as the
prompt (the same `dispatchPrompt` build as a fresh launch, full flag set),
into the same workspace. The re-invoked wrapper reaches `gate wait`, which
finds the journaled answer and returns immediately. The resumed pane is then
subject to normal auto-close at done.

**Focus button.** The existing row actions ("focus response tab" etc.) and
the launch-dedup focus switch from `herdr tab focus` to a new
`POST /api/panes/:id/focus` route calling rt-client `paneFocus(paneId)`
(chat's route copied verbatim), which raises the terminal window. Fallback:
when a pane id is missing (pre-migration panes), fall back to the current
`focusTab`.

### status-bin (board CLI verbs, consumed by the wrapper skills)

New `gate` verb family beside `review-status`:

- `<status-bin> gate open <state> --questions <json>`: mints the gate id,
  writes the gate state file, emits `board/gate/opened/<gateId>` (payload
  assembled from review state, carrying every field of the event contract:
  mrUrl, iid, agentId, sessionId, paneId, tabId, questions), prints the
  gate id.
- `<status-bin> gate wait <state>`: checks the events journal first (the
  answer may already be persisted, which is exactly the parked-resume case)
  and returns it immediately when present; otherwise blocks on `events:wait`
  for the answer topic (looping the daemon's 240s cap). Prints the answer
  JSON.
- `<status-bin> gate answer <state> --answers <json> --by pane`: emits the
  answered event; used when the human answers by talking to the pane
  directly. The skill calls this before acting so every other surface
  converges.

The skills stay dumb: they never learn topic names or the bus; the status-bin
owns the contract, symmetrically with review-status today.

### wrapper skills (board repo `skills/`, symlinked live)

Correction over an earlier draft: the wrappers are NOT mattstack-skills
engines. They are hand-authored in the board repo (`skills/review/SKILL.md`,
`skills/respond/`, `skills/doctor/`) and symlinked into `~/.claude/skills/`
by `scripts/setup.ts`, so a wrapper edit is live on save with no compile
pipeline. Only the team pack FILLS (the domain skills the manifest binds
into the review slot) live in pack repos and go through each pack's own
compile/bump/update pipeline.

`board:review` replaces its two sequential posting gates with one combined
gate: write the report, `gate open` with both questions, `gate wait`, then
hand the answer back to the domain skill to post (or post itself on the
generic no-domain-skill path) and mark done. The wrapper gains a line telling a resumed session that the
current invocation supersedes any earlier gate contract remembered in the
transcript. A parked-gate resume DOES need a branch: the board passes
`--resumed-gate <gateId>` and the wrapper skips straight to `gate wait`,
since a re-invoked wrapper would otherwise re-run `gate open` and orphan
the journaled answer. The in-pane
escape hatch is documented in the skill: a human may interrupt the wait and
answer conversationally; the skill then runs `gate answer --by pane` before
acting.

The gate change also bumps the review slot contract (`mr-review@1` to
`mr-review@2`), and the boundary at `@2` is:

- The domain skill keeps: resolving the MR/ticket, the review substance,
  writing the report, and executing the posting once handed the human's
  decision (post the selected tiers; comment or approve).
- The domain skill gains one output: when its review is done it reports the
  severity levels present back to the wrapper, so the wrapper can build the
  gate's tier options.
- The domain skill loses: presenting gates and deciding disposition. It
  never talks to the human about posting again.
- The wrapper owns: lifecycle status, `gate open` (questions built from the
  reported levels plus the fixed comment/approve pair), `gate wait`, and
  handing the answer back to the domain skill to execute.

The wrapper and its slot description are board-repo edits, live via the
symlink. Any pack fill that implements its own posting gates is updated in
its pack repo through that pack's compile/bump/update pipeline, as a rollout
step alongside the wrapper change.

### console

Focus button on run rows and the run drawer, rendered when `run.agent` is
present (the run record already carries `agent: { status, pane }`, mirrored
live from herdr) and `agent.status` is not `done`. Click calls the same new
`POST /api/panes/:id/focus` route pattern added to console's server. No new
data plumbing.

## Flows

**Launch.** Board calls `agentStart` (herdr surface, workspace/tab labels,
prompt = wrapper slash command). Agent record returns session id + pane ids;
board persists them in review state. Pane visible in the background workspace
as today.

**Gate, answered live from the board.** Wrapper emits `gate opened`; board
(WS relay) stores it and shows the card; rt notifier bridge fires a
notification unless the pane is focused. Matt answers on the card; board
emits `answered`; the wrapper's `gate wait` returns; it posts, marks done;
board closes the pane.

**Gate, answered at the pane.** Notification click focuses the pane (tray).
Matt interrupts the wait, tells the agent; the skill emits `gate answer
--by pane`, acts, marks done; board sees done, closes the pane; the board
card resolves itself off the answered event.

**Gate, parked.** No answer for 90 minutes; board closes the pane, gate stays
on the card (marked parked). Matt answers the card next morning; board
`agentResume` with the wrapper slash command as prompt; the re-invoked
wrapper hits `gate wait`, gets the journaled answer immediately, acts, marks
done; pane closes.

**Focus button.** Any running review/respond/doctor row (board) or running
run (console): click, `paneFocus`, terminal raises on the right tab.

## Error handling

- rt daemon down: `agentStart` fails; launch surfaces the error exactly as
  today's herdr failures do. Gate events cannot flow; the wrapper's
  `gate open` fails loudly and the skill falls back to a single in-pane
  AskUserQuestion carrying the same combined questions (documented in the
  skill as the degraded mode; never the old two-gate pair).
- Tray down: `paneFocus` returns "tray unavailable"; buttons surface a toast
  (chat behavior); notifications fall back to osascript (existing notifier
  behavior) with no focus action.
- Board down during an answer: the answered event persists in the bus
  journal; the board reconciles open gates against the journal on boot
  (cursor from the gate store), so a parked resume is never lost.
- Duplicate answers: first event wins; the wrapper ignores later ones; the
  board marks the gate answered idempotently.
- Pane killed by hand mid-wait: the gate stays open; the grace timer
  eventually parks it; a later answer resumes normally.

## Testing

- Unit: gate store transitions (open, answered, parked, reconciled), the
  notifier bridge mapping + suppression, `paneRow` focused propagation,
  status-bin gate verbs against a fake bus, launch adapter mapping
  (agentStart payloads, dedup error mapping).
- The board's existing harness style: injected gateways/runners, no network.
- One e2e-ish check per repo at plan time (board: launch + state fields;
  rt: bridge fires into the queue; tray: manual verification of the focus
  action, Swift has no test rig).
- Skill change verified by a live review run on a scratch MR before rollout.

## Staging (single plan, ordered lanes)

1. **rt lane**: `pane:list` focused flag; notifier event bridge + paneId +
   suppression; tray focus action. Publishable independently.
2. **board launch lane**: rt agent adoption (start/resume), state fields,
   dedup mapping, claudeCommand retirement, resume-as-reinvocation
   (`reReviewResumePrompt` deleted; resumes carry the `dispatchPrompt` slash
   command with the full flag set).
3. **focus lane**: board route + button swap; console route + button.
4. **gate lane**: status-bin gate verbs (journal-first wait); board gate
   store/SSE/card/answer endpoint; combined gate in the board-repo wrapper
   with the slot contract bump to `mr-review@2` (live via symlink); affected
   pack fills updated in their own repos through each pack's
   compile/bump/update pipeline.
5. **lifecycle lane**: auto-close on done; park-after-grace; resume-with-
   answer; boot reconcile.

Each lane lands green before the next starts; lanes 1-3 change no existing
behavior visibly except the better focus.

## Non-goals

- Doctor/respond gates (they have none; they only gain auto-close).
- Tray frontmost-app focus detection (follow-up if herdr-focus suppression
  proves too coarse).
- Headless surfaces of any kind (rt agent headless, tmux, second herdr
  server), cross-server pane migration (a herdr feature request, filed
  separately if wanted).
- Peer boards: gate events stay local to this board's machine this pass.
- Retiring the status-bin `--session` echo write (deferred cleanup).
