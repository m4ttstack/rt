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

**Repos:** rt (daemon, CLI, rt-client), mattstack-skills engine, the team
pack, board, console.

## Global constraints

- Every push, merge, publish, and plugin update is individually Matt-gated.
- Repo purity: no real employer, team, or person names in tracked files.
- All schema additions are optional and backward compatible: old rows and
  old openers keep working unchanged. CAS answer semantics are untouched.
- The registry remains the ONLY authority for answers. Doorbell messages
  and injected keys never carry answer content.
- No em or en dashes in tracked prose.

## 1. Registry schema (rt daemon + CLI + rt-client)

Three additive fields on the gate row, all set at `rt gate open` time.

**Option labels.** An option is either a bare string (today's form,
unchanged) or `{value, label}`. `label` is display text, max 200 chars
(reject over, with a clear error). Answers submit `value` verbatim; strict
option membership continues to validate against `value` only. Surfaces
render `label` when present, else `value`.

**Context.** Optional `context` field: a markdown string describing the
material the decision is about. Hard cap 8192 bytes, enforced by
`rt gate open`: oversize is REJECTED with an explicit error, never
truncated (silent truncation could cut mid-sentence and misrepresent the
decision). Stored and served verbatim.

**Origin.** Optional `origin` object: `{paneId?, tabId?, runId?,
worktree?, presentation?}`, all strings. `presentation` is `"form"` or
`"wait"`; absent means `"wait"` semantics (back compat). `presentation:
"form"` asserts a native question form is up for this gate in the pane
named by `paneId`, and completion after a remote answer requires input
injection (section 4). No daemon behavior attaches to the other origin
fields; they are data for focus resolution (section 3).

**Delivery extension.** The daemon's answer handler gains one step: when a
gate with `origin.presentation == "form"` and a nudge subscription is
answered by a surface other than the opening pane, it (a) sends the
standard doorbell push (existing mechanism, queues behind the pending
form), then (b) calls herdr's key-injection endpoint to send a single
Escape to `origin.paneId`. Injection failure is logged and non-fatal: the
doorbell alone reproduces today's reconcile-at-next-touch behavior.

**herdr injection endpoint.** herdr exposes an internal call taking
`paneId` and the literal key `Escape` (only Escape; no general keystroke
API this wave). Unknown or dead pane returns an error the daemon logs.

Ships as: rt PR, then rt-client minor bump exposing the new fields and the
injection-capable delivery, then board and console re-pin.

## 2. Opener adoption

### Board wrappers (review, respond, doctor)

Fills are assembled in wrapper code and protocol steps from strings the
wrapper already holds. No agent free-composition.

- Labels: respond options gain thread-anchored labels
  (`{value: "fix:<threadId>", label: "fix · <file>:<line>"}`); review tier
  options carry counts (`"Major (2)"`); doctor options keep short verb
  values with fuller labels.
- Context: review = tier counts plus finding titles from the report;
  respond = the reviewer thread quoted plus the drafted reply or fix
  summary; doctor = the situation line. Each within the 8KB cap.
- Origin: `paneId`/`tabId` from the launch or resume result (already in
  every state file), `worktree`, and `presentation: "form"` (section 4).

### Engine (the pipeline gate sites)

ONE edit to the shared gate-protocol part's open recipe; every site
inherits it through the normal pack recompile:

- Stamp origin: `runId` and `worktree` from the runs snapshot, `paneId`
  when the pane knows it, `presentation` per section 4.
- Include context: a VERBATIM QUOTE of the material the decision is about
  (the task summary from the brief, the plan section under decision, the
  failing check output), never a freshly composed summary, within the cap.
- Emit labeled options whenever the site's option values are not already
  human-readable.

## 3. Surface rendering and universal focus

Invariant: every gate rendering, on every surface, carries a working path
back to the live pane, resolved from the row's origin, not from
surface-private state.

**Focus resolution (shared rule, implemented per surface):** direct by
`origin.paneId` when present; else worktree match against live panes (the
shepherdr technique); else no target. The focus action itself is the
existing single `paneFocus({paneId})` rt-client call with herdr tab-focus
fallback (board `src/focus-pane.ts` behavior, now fed from the row).

**Board cards:** option buttons render labels; `context` renders as a
collapsed, expandable section on the gate card; the existing focus button
switches to origin-based resolution, which RETIRES the client-side
`gateFocusDomain` hand-duplicate of `domainForKind`. Parked gates keep the
existing resume-in-pane flow as the button's action.

**Console GateCard:** option buttons render labels; expandable `context`
section; NEW focus button backed by a small server endpoint that resolves
origin per the shared rule and makes the `paneFocus` call. Unresolvable
origin renders the button disabled with the reason. Parked gates render
disabled-with-reason (resume is board-owned this wave).

## 4. Form-first in herdr panes

**Pattern.** When the wrapper's pane is herdr-hosted, the wrapper ALWAYS
renders the native question form (AskUserQuestion) and opens the gate with
`presentation: "form"`, a nudge subscription for the doorbell channel, and
`origin.paneId`. The attended/unattended split disappears for herdr panes:
a human can focus the pane from any card and answer the form directly; an
unattended pane blocks on its form harmlessly until some surface answers.
The form's options mirror the gate's options exactly (strict membership,
as today); an in-pane form answer submits via `rt gate answer` and CAS
losers proceed with the returned winner, unchanged from W1.

**Remote completion.** Another surface winning the answer triggers the
daemon delivery of section 1: doorbell push first (queues behind the
pending form), Escape injection second (dismisses the form). The
dismissed pane's next input is therefore the queued doorbell frame; the
wrapper protocol directs it to re-read the gate row and proceed with the
winning answer. Only one keypress is ever injected, and the doorbell's
cross-session-message framing keeps transcript attribution honest.

**Known interleave (spike must demonstrate recovery):** the human answers
the form in-pane, the wrapper is mid-submission, and the remote answer
wins CAS first. The Escape then lands during an active turn rather than
on a pending form, interrupting the wrapper mid-work. Recovery is by
construction (queued doorbell delivers, wrapper re-reads the registry,
protocol is idempotent), but the spike proves it rather than assumes it.
If the human's in-pane answer wins CAS, no injection fires at all (the
remote surface receives the conflict plus winning row).

**Spike (first task of the wave):** in a live herdr pane, verify (a) a
doorbell sent while a form is pending queues and does not dismiss it,
(b) injected Escape dismisses the pending form, (c) the queued doorbell
is delivered as the next input after dismissal and re-invokes the pane,
(d) the interleave above recovers, (e) injection after the form is
already gone is harmless. Output is findings plus go/no-go on the
delivery design; any built harness is throwaway.

**Fallback: idle waits for non-herdr contexts.** Where no form can be
rendered (non-herdr terminals), the wrapper replaces today's blocking
foreground wait with fire-and-end-turn: launch ONE background shell loop
(`run_in_background`) that re-runs the bounded `rt gate wait --max-ms`
internally and exits only on answered or terminal status, printing the
final row as its last stdout; then end the turn. The pane is idle but
armed: typed input lands instantly, and the loop's completion re-invokes
the pane with the answered row as the tool result. This is deliberately
background Bash, not a Monitor job (one-shot waits are the documented
background-Bash case).

**Stop-hook gate-awareness (prerequisite for the fallback, rides in the
engine lane):** before ending its turn on a background wait, the wrapper
records a waiting-on-gate marker (the gate id) on the run record via
`rt runs field set`; `pipeline-gate-stop.sh` treats a run carrying that
marker as legitimately stopped instead of blocking the turn. The marker
is cleared when the wait completes and the wrapper resumes. This also
stops the hook's live-evidenced over-fire on controller sessions blocked
behind gates.

## 5. Respond form collapse

Form shaping only; the gate remains one atomic answer with unchanged
option values.

- Single unresolved thread: ONE merged question. The verb choice implies
  the disposition; no second approve/revise question.
- Multiple threads: the code-changes question is asked only when at least
  one `fix:` option was selected.

Applies to the pane form and to every surface's rendering of the same
gate (the collapse logic keys off the gate's option set, so surfaces
derive it identically).

## 6. Smalls

- Sweep: unknown gate kind logs an error (today: silence) so kind #5
  fails loudly.
- Bridge rule: the run-gate notification bridge gains a subject-prefix
  filter so run gates do not flood notifications.
- Forge: no-run spawned-context guard.
- Board doctor: fix-classes wiring completed.
- `gateFocusDomain` client duplicate: retired by section 3 (tracked here
  so the watchlist item closes).

## 7. Error handling and edge cases

- Oversize context or label: `rt gate open` rejects with a message naming
  the cap; the opener ships without context rather than truncating.
- Missing label: surfaces fall back to rendering `value`.
- Unresolvable origin: focus affordance disabled with the reason shown;
  never a dead button.
- Injection failure or dead pane: logged, non-fatal; doorbell-only
  degrades to reconcile-at-next-touch.
- Daemon down: existing per-wrapper error paths unchanged (doctor
  degrades to the terminal error path, never a form).
- Old rows (no labels, context, or origin): render exactly as today.

## 8. Testing and verification

Unit coverage per repo: rt (schema validation, caps, delivery ordering,
injection fallback), board (fill assembly per kind, origin-based focus
resolution, collapse shaping), console (label/context rendering, focus
endpoint resolution including worktree match and disabled states), engine
(certification rows for the edited parts).

Live verification with Matt, after all lanes deploy:

1. Answer an in-pane form remotely from the console; the pane's form
   dismisses via Escape and the wrapper proceeds with the winner.
2. Answer the same wrapper's form in-pane; remote surface gets the
   conflict plus winning row.
3. Focus a pane from a console run-gate card (origin direct) and from a
   board card (origin, not state join).
4. A pipeline gate renders labels and quoted context on the console.
5. Single-thread respond run produces the merged one-question form.
6. Fallback path: a non-herdr wait goes idle, typed input lands
   instantly, remote answer re-invokes with the row; stop hook does not
   block the idle turn.

## 9. Sequencing and releases

1. Spike (section 4) first; go/no-go gates the rt delivery design.
2. rt lane: schema + delivery + herdr injection endpoint; rt PR;
   rt-client minor publish.
3. Engine lane (parallel once schema shape is settled): shared-part
   recipe edit, stop-hook fix, respond collapse; engine release; team
   pack recompile. Depends on RT-110 landing for the normal compile path
   (the `--pack-dir` escape hatch is the workaround if it has not).
4. Board and console lanes (parallel, after rt-client publish): fills,
   rendering, focus; PRs with CodeRabbit + CI green; deck restarts.
5. Live verification pass (section 8), then wave close.

Execution is subagent-driven (SDD) per standing approval; whole-branch
final reviews dispatch on the fable model.
