# Gate Facility W4: Plumbing Wave

**Goal:** Make every gate answerable on sight from any surface, and make the
herdr pane the best place to answer one. Rich context, human option labels,
and a path back to the live pane travel IN the registry row; herdr panes
render the native question form and are completed remotely by a doorbell
plus a single injected Escape.

**Relationship to prior waves:** W1 built the rt daemon gate registry, W2
moved the board onto it, W3 made everything answer everywhere. This wave
closes the UX gaps found in W3's live verification: raw option strings,
context-free cards, stale forms after remote answers, and typed input
queueing behind blocking waits.

**Ruling (2026-09-05):** W4 is split. This wave is plumbing only. The gate
triage modal (one gate per modal page, dot-row progress, rich per-kind
rendering, console cross-surface inbox) is DEFERRED until after the
platform consolidation work (kit merge / monorepo), where it becomes the
first shared build. Platform consolidation gets its own brainstorm and
spec. Per-site bespoke context recipes for engine gate sites are also out;
adoption there is one shared-part edit, tuned later as annoyances surface.

**Spec review:** fable seat 2026-09-05, two rounds (reports under
`.superpowers/sdd/2026-09-05-gate-facility-w4/`): round 1 (1C/5M/7m/8n)
and round 2 (0C/2M/3m/6n), all findings applied.

**Repos:** rt (daemon, CLI, rt-client, herdr coordination), mattstack-skills
engine, the team pack, board, console.

## Global constraints

- Every push, merge, publish, and plugin update is individually Matt-gated.
- Repo purity: no real employer, team, or person names in tracked files.
- Schema additions are optional: old ROWS render on new and old surfaces
  unchanged, and old OPENERS keep working against the new daemon. The
  reverse direction is NOT free: labeled options from new openers crash
  un-updated surfaces (both render options directly as React children), so
  surface deploys MUST precede opener adoption. Section 9's ordering is
  normative, not advisory.
- CAS answer semantics are untouched.
- The registry remains the ONLY authority for answers. Doorbell messages
  and injected keys never carry answer content.
- No em or en dashes in tracked prose.

## 1. Registry schema (rt daemon + CLI + rt-client)

Three additive fields on the gate row, all set at `rt gate open` time.

**Option labels.** An option is either a bare string (today's form,
unchanged) or `{value, label}`. `label` is display text, max 200 bytes of
UTF-8 (reject over, with a clear error). Answers submit `value` verbatim;
strict option membership moves to value-only comparison in the daemon.
Surfaces render `label` when present, else `value`. Old daemons reject
labeled options loudly at open time ("invalid questions"), so the
daemon-before-openers ordering in section 9 covers that direction.

**Context.** Optional `context` field: a markdown string describing the
material the decision is about. Hard cap 8192 bytes of UTF-8, enforced by
`rt gate open`: oversize is REJECTED with an error naming the cap, never
truncated (silent truncation could cut mid-sentence and misrepresent the
decision). Openers pre-check the byte length against the cap and ship
without context when over, rather than eating a rejected open. Stored and
served verbatim.

**Origin.** Optional `origin` object: `{paneId?, tabId?, runId?,
worktree?, presentation?}`, all strings. `presentation` is `"form"` or
`"wait"`; absent means `"wait"` semantics (back compat). `presentation:
"form"` asserts a native question form is up for this gate in the pane
named by `paneId`, and completion after a remote answer requires input
injection (section 4). No daemon behavior attaches to the other origin
fields; they are data for focus resolution (section 3).

**Event payload.** The `gate/opened` event payload carries `context` and
`origin` alongside its existing fields. The board builds live rows from
this payload alone (its full-row reconcile is boot-only), so without this
the new fields would be invisible on every gate opened while the board is
up. The at-most-8KB payload growth is accepted.

**Delivery extension.** Step (a), the doorbell push, is today's behavior
UNCHANGED: unconditional on any answered gate carrying a nudge (a
self-answer's doorbell remains a discarded stale signal per protocol).
The NEW step is (b) alone: when `origin.presentation == "form"`,
`origin.paneId` is set, a nudge exists, and the recorded `answer.by` is
not the pane constant, the daemon AWAITS the doorbell's inbox accept and
then sends a single Escape to `origin.paneId`. Injection never precedes
the doorbell's accept (today's push layer is parallel fire-and-forget, so
this sequencing is new code). Doorbell outcomes on this path remain
`delivered` or `dead-pane`; injection failure (including herdr's
pane-not-found) is logged and non-fatal. Doorbell-only degrades to the
existing reconcile-at-next-touch behavior.

**Injection mechanism.** No new herdr work: herdr's existing
`pane.send_keys` verb accepts "escape", and the daemon already drives it
over the established daemon-to-herdr socket (the same channel the Enter
nudge helper uses). The delivery layer calls `pane.send_keys` via a thin
new daemon helper; it must NOT reuse the existing `injectIntoPane`
helper, which refuses panes whose agent status is blocked, and a pane
with a pending form is exactly that state. The Escape-only restriction is
enforced at this call site; no general keystroke pass-through is exposed.

Ships as: rt PR, then rt-client minor bump exposing the new fields, then
board and console re-pin.

## 2. Opener adoption

### Board wrappers (review, respond, doctor)

Fills are assembled in wrapper code and protocol steps from strings the
wrapper already holds. No agent free-composition.

- Labels: respond options gain thread-anchored labels
  (`{value: "fix:<threadId>", label: "fix · <file>:<line>"}`); review tier
  options carry counts (`"Major (2)"`); doctor options keep short verb
  values with fuller labels. Fills CLAMP label text to the cap when
  composing (middle-truncate the path portion); the daemon rejection
  remains the backstop, since deep paths can push a label past 200 bytes
  and a routine open must not hard-fail on display text.
- Context: review = tier counts plus finding titles from the report;
  respond = the reviewer thread quoted plus the drafted reply or fix
  summary; doctor = the situation line. Each within the 8KB cap,
  pre-checked.
- Origin: `paneId`/`tabId` from the launch or resume result (already in
  every state file), `worktree`, and `presentation` (section 4).

This lane includes extending the board status-bin's gate verbs: `gate
open <state>` today deliberately passes no pane and no nudge; it gains
origin, nudge, and presentation. Origin comes from the state file's
`paneId`/`tabId`; the nudge session is the pane's own
`$CLAUDE_CODE_SESSION_ID` read at open time (the verbs run inside the
pane, and doctor state carries no sessionId field, so a state-file read
would be empty there). The board's client-facing row
subset (`attachGates` and the client `GateRow` type) gains `context` and
the origin-derived focus data.

### Engine (the pipeline gate sites)

ONE edit to the shared gate-protocol part's open recipe; every site
inherits it through the normal pack recompile (13 include sites as of
engine 0.15.0):

- Stamp origin: `runId` and `worktree` from the runs snapshot, `paneId`
  from the herdr-injected pane env when present, `presentation` per
  section 4.
- Guard: no `gate open` with an empty run id (an empty id mints a junk
  `run:` subject the daemon accepts).
- Include context: a VERBATIM QUOTE of the material the decision is about
  (the task summary from the brief, the plan section under decision, the
  failing check output), never a freshly composed summary, within the
  cap, pre-checked.
- Emit labeled options whenever the site's option values are not already
  human-readable.
- Name doorbell priming explicitly: form-first makes every herdr pipeline
  pane a doorbell receiver, and an unprimed session correctly refuses the
  push as injection, so the recipe carries the priming text.
- Nudge keying changes: the nudge follows PRESENTATION, not attendance
  (the recipe today passes a nudge only for attended panes). Every
  `presentation: "form"` open passes `--nudge` with the pane's own
  session id regardless of `spawned_by`; only wait-presentation opens
  omit it (there, the wait is the delivery). Without this flip, a
  spawned form-first worker would block on an undismissable form with no
  completion path at all.

## 3. Surface rendering and universal focus

Invariant: every gate rendering, on every surface, carries a working path
back to the live pane, resolved from the row's origin, not from
surface-private state.

**Focus resolution (shared rule, implemented per surface):** direct by
`origin.paneId` when present; else worktree match against live panes
(rt-client `paneList` rows carry cwd; the shepherdr technique); else no
target. The focus action itself is the existing single
`paneFocus({paneId})` rt-client call with herdr tab-focus fallback (board
`src/focus-pane.ts` behavior, now fed from the row).

**Board cards:** option buttons render labels; `context` renders as a
collapsed, expandable section on the gate card; the existing focus button
switches to origin-based resolution, which RETIRES the client-side
`gateFocusDomain` hand-duplicate of `domainForKind` (the third hand-synced
kind-to-domain copy). Parked gates keep the existing resume-in-pane flow
as the button's action.

**Console GateCard:** option buttons render labels; expandable `context`
section; NEW focus button backed by a small server endpoint that resolves
origin per the shared rule and makes the `paneFocus` call. Unresolvable
origin renders the FOCUS BUTTON disabled with the reason; likewise the
focus button on parked gates (resume is board-owned this wave). Parked
gates remain fully ANSWERABLE on the console, as today: answering a
parked gate is the facility's unpark path, and nothing in this wave
changes card answerability.

## 4. Form-first in herdr panes

Supersedes the 2026-09-03 spec's unattended-wrapper ruling (board wrapper
panes block in `gate wait`, no form), which predates the injection
mechanism that makes remote form completion possible.

**Pattern.** When the wrapper's pane is herdr-hosted AND every question
on the gate fits the native form's per-question option cap, the wrapper
renders the native question form (AskUserQuestion) and opens the gate
with `presentation: "form"`, a nudge (`--nudge` with the pane's session
id; the nudge is a per-row field, not a `gate subscribe` subscription),
and `origin.paneId`. The attended/unattended split disappears for herdr
panes: a human can focus the pane from any card and answer the form
directly; an unattended pane blocks on its form harmlessly until some
surface answers. The form renders each option's `label` but submits its
`value` (strict membership validates values only); options mirror the
gate's options exactly. The OPENER evaluates the option cap at open time
(it picks `presentation`) against the native form tool's documented
per-question option limit, currently 4; a gate with any question over
the cap opens with `presentation: "wait"` instead. An in-pane
form answer submits through the wrapper's normal answer verb (the board
status-bin for board wrappers, `rt gate answer` for engine sites) and CAS
losers proceed with the returned winner, unchanged from W1.

**Remote completion.** Another surface winning the answer triggers the
daemon delivery of section 1: doorbell push first (queues behind the
pending form, the spike-verified behavior), Escape injection second,
strictly after the doorbell's inbox accept. The dismissed pane's next
input is therefore the queued doorbell frame; the wrapper protocol
directs it to re-read the gate row and proceed with the winning answer.
Only one keypress is ever injected, and the doorbell's
cross-session-message framing keeps transcript attribution honest.

**Known interleave (spike must demonstrate recovery):** the human answers
the form in-pane, the wrapper is mid-submission, and the remote answer
wins CAS first. The Escape then lands during an active turn rather than
on a pending form, interrupting the wrapper mid-work. Recovery is by
construction (queued doorbell delivers at the next boundary, wrapper
re-reads the registry, protocol is idempotent), but the spike proves it
rather than assumes it. If the human's in-pane answer wins CAS, no
injection fires at all (the remote surface receives the conflict plus
winning row).

**Spike (first task of the wave):** in a live herdr pane, verify (a) a
doorbell sent while a form is pending queues and does not dismiss it (the
2026-09-03 spike proved this for inbox frames; it never sent keys, so the
injection half is genuinely unproven), (b) injected Escape via
`pane.send_keys` dismisses the pending form, (c) the queued doorbell is
delivered as the next input after dismissal and re-invokes the pane, (d)
the interleave above recovers, (e) injection after the form is already
gone is harmless. Output is findings plus go/no-go on the delivery
design; any built harness is throwaway.

**Fallback: idle waits for wait-presentation gates.** AskUserQuestion
renders in any terminal; what a non-herdr context lacks is the Escape
path (no herdr-owned PTY to send keys into). Attended non-herdr panes
therefore keep the existing form plus queue-and-reconcile-on-touch
protocol unchanged. Every OTHER pane holding a `presentation: "wait"`
gate takes the idle wait: unattended non-herdr panes, AND herdr panes
whose gate exceeded the option cap (a herdr pane never runs the old
bounded foreground loop, which would re-open the typed-input-queueing
gap on exactly the biggest gates). The wrapper launches ONE background
shell loop (`run_in_background`) that
waits until the gate is answered or terminal and prints the final row as
its last stdout, then ends the turn. The pane is idle but armed: typed
input lands instantly, and the loop's completion re-invokes the pane
with the answered row as the tool result. This is deliberately
background Bash, not a Monitor job (one-shot waits are the documented
background-Bash case). The wait command is per-binary: engine sites run
`rt gate wait <id>` (unbounded form; the CLI already loops internally
around the daemon clamp and survives daemon restarts) or re-run
`rt gate wait <id> --timeout <duration>` on exit 124; board wrappers
(whose over-cap gates are this path's board case) re-run the status-bin's
`gate wait <state> --max-ms <n>` on `pending`. The two flags belong to
two different binaries and are never mixed.

**Stop-hook gate-awareness (prerequisite for the fallback, rides in the
engine lane):** before ending its turn on a background wait, the wrapper
records a waiting-on-gate marker (the gate id) on the run record via
`rt runs field set`; `pipeline-gate-stop.sh` treats a run carrying a
fresh marker as legitimately stopped instead of blocking the turn,
mirroring the existing `hold` field check including its freshness guard
against stale markers. The marker is cleared when the wait completes and
the wrapper resumes. This also stops the hook's live-evidenced over-fire
on controller sessions blocked behind gates.

## 5. Respond form collapse

Form shaping only; the gate remains one atomic answer.

- Single unresolved thread: the OPENER builds one merged question (the
  verb choice implies the disposition; no second question exists on the
  gate). This is open-time reshaping, not a rendering trick, so every
  surface sees the same one-question gate.
- Multiple threads: the code-changes question always exists on the gate
  and always includes a `"skip"` option. Surfaces SHOW it only when at
  least one `fix:` option is selected; when hidden, the surface submits
  the sentinel `"skip"` for it. The daemon requires an answer for every
  question on the gate, so the sentinel is normative: all three
  implementations (pane form, board card, console card) submit the
  identical value, named here so none diverges.

## 6. Smalls

- Sweep: `planSweep` and the resume walk both log an error on an unknown
  gate kind instead of silently skipping (open already throws; these are
  the two silent sites).
- Notify bridge: bridge rules gain an optional `subjectPrefix` field
  matched against the event payload's subject (topics carry only
  `gate/<status>/<id>`), so run-gate volume can be filtered without
  losing mr-gate notifications.
- Forge no-run spawned-context guard: the forge parts' no-run fallback
  ("present the same form in-pane only") branches on spawned context. A
  human-invoked (attended) pane keeps the in-pane form; a SPAWNED pane
  with no armed run never presents a form (nobody is watching and no
  gate row reaches any surface) and instead ends that path with an error
  status the spawning surface can see. Because no run record exists in
  this state, the spawned marker is the existing launch-instruction
  convention: the same signal `run-start --spawned-by` is taken from
  today (the spawning surface's prompt says so; a board wrapper
  invocation counts as spawned per se). No new mechanism; the guard
  reads the invocation context before any run exists. The empty-run-id
  open guard (section 2) rides in the same edit.
- Board doctor fix-classes wiring: the manual `/doctor` endpoint composes
  fix classes exactly as the triage auto-dispatch path does (load the
  triage config's fix classes, compose against the MR author and board
  identity), stamps the configured tier, writes both onto the initial
  doctor state, and passes both to launch; resume then inherits them via
  the existing resume-dispatch fields. Today the manual path passes
  neither, so a manually launched doctor treats every fix class as
  unlicensed and escalates work the auto path would fix.
- `gateFocusDomain` client duplicate: retired by section 3 (tracked here
  so the watchlist item closes).

## 7. Error handling and edge cases

- Oversize context or label: `rt gate open` rejects with a message naming
  the cap; openers pre-check and ship without context rather than
  truncating (labels are never dropped silently; an oversize label is an
  opener bug surfaced by the rejection).
- Missing label: surfaces fall back to rendering `value`.
- Unresolvable origin: focus affordance disabled with the reason shown;
  never a dead button.
- Injection failure or dead pane: logged, non-fatal; doorbell-only
  degrades to reconcile-at-next-touch. Doorbell outcomes stay
  `delivered`/`dead-pane`; there is no socket-level "refused".
- Daemon down: existing per-wrapper error paths unchanged (doctor
  degrades to the terminal error path, never a form).
- Old rows (no labels, context, or origin): render exactly as today.
- Old surfaces vs new rows: unknown row FIELDS are ignored on every read
  path (safe); labeled OPTIONS are not (crash), which is why section 9
  deploys surfaces before opener adoption.

## 8. Testing and verification

Unit coverage per repo: rt (schema validation, caps, value-only option
membership, delivery ordering incl. await-accept-then-inject, injection
fallback), board (fill assembly per kind, status-bin verb extension,
origin-based focus resolution, collapse shaping incl. the sentinel
submission), console (label/context rendering, focus endpoint resolution
including worktree match and disabled states, sentinel submission),
engine (certification rows for the edited parts).

Live verification with Matt, after all lanes deploy:

1. Answer an in-pane form remotely from the console; the pane's form
   dismisses via Escape and the wrapper proceeds with the winner.
2. Answer the same wrapper's form in-pane; remote surface gets the
   conflict plus winning row.
3. Focus a pane from a console run-gate card (origin direct) and from a
   board card (origin, not state join).
4. A pipeline gate renders labels and quoted context on the console.
5. Single-thread respond run produces the merged one-question form; a
   multi-thread run with no fix selected submits the hidden sentinel.
6. Fallback path: an unattended non-herdr wait goes idle, typed input
   lands instantly, remote answer re-invokes with the row; stop hook does
   not block the idle turn.

## 9. Sequencing and releases

Ordering is normative (see Global constraints: surfaces deploy before
openers emit labeled options).

1. Spike (section 4) first; go/no-go gates the rt delivery design.
2. rt lane: schema + delivery sequencing + the send-keys helper; rt PR;
   rt-client minor publish.
3. Board and console lanes (parallel, after the rt-client publish):
   RENDERING + re-pin first, including tolerant option rendering
   (`label ?? value`, defensive on non-strings), focus, and the collapse
   sentinel. Deploy both surfaces.
4. Board wrapper fills + status-bin verb extension (board opener side,
   after its surface is deployed; opener and surface live in the same
   repo but the deploy order inside the lane still puts rendering
   first).
5. Engine lane: shared-part recipe edit, stop-hook fix, respond
   collapse; engine release; team pack recompile. LAST among openers
   because pipeline gates render on the console, which must already be
   deployed. RT-110's fix is merged at source (rt PR #201) and reaches
   the installed rt at its next release; the `--pack-dir` escape hatch
   remains the workaround until then.
6. Live verification pass (section 8), then wave close.

Releases, all individually Matt-gated: rt merge + rt-client npm publish,
engine + pack plugin updates, board and console PRs (CodeRabbit + CI
green) + deck restarts.

Execution is subagent-driven (SDD) per standing approval; whole-branch
final reviews dispatch on the fable model.
