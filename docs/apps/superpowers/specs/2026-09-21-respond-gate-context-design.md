# Respond Gate Structured Context

Approved 2026-09-21. The visual reference is the seven approved frames in
Matt's local pen file (`review gate.pen`: "Respond Gate Modal" and the six
frames right of it). That file holds real employer content, so it is not
committed; every example below uses invented data.

## Problem

The decision-queue modal renders a respond gate as prose. The skill that
opens the gate packs everything a human needs -- who reviewed, what they
claimed, the adjudication, the planned action, and the reply that will be
posted in the developer's name -- into one paragraph per question, and the
board can only pour that paragraph through Markdown. The review gate looks
good only because `gate-context.ts` regex-parses `=== key -- verdict ===`
markers out of prose; respond gates emit no markers, so they fall to the
blob. Three specific defects, each traced:

- `.tui-gate-question-context` colours the primary decision material with
  `--text-3`, the muted step.
- `--gate-context-floor: 13rem` reserves 208px for a two-sentence gate
  context, pushing the question off the scroll.
- The modal repeats the MR id and ticket up to three times, while the
  reviewer -- the person being responded to -- is a lowercase word inside a
  paragraph.

## Decision

Structured context travels as a **JSON document inside the existing
`questions[].context` string field** (and the gate-level `--context`
string). No rt daemon or rt-client change: today's registry stores and
returns the string untouched, so there is no deploy-ordering hazard and
old gates keep rendering through the prose path. The contract lives in a
typed parser on the consumer side, not in the transport.

A context string parses as structured when it is a JSON object whose
`"gate-ctx"` key names a known shape: `"plan@1"`, `"post@1"`,
`"thread@1"`, or `"replies@1"`. The key is both the discriminant and the
version; four payloads share a wire without structural sniffing. Anything
else -- old gates, other gate kinds, foreign senders, unknown shapes --
renders exactly as today. The prose parser (`gate-context.ts`) stays for
review gates; nothing about them changes.

Parsing rules, per shape:

- Unknown keys are ignored. Additive fields never bump the version; a
  version bumps only when an existing field changes meaning or type.
- A missing or wrong-typed REQUIRED field fails the whole parse: the
  context renders as prose. There are no partial parses.
- `parseGateCtx(context)` returns a discriminated union tagged by shape,
  or `null`. It has no size limit of its own; the transport owns size.

## The gate-ctx@1 contract

### Gate-level context (respond-plan and respond-post)

Carries only what the board cannot derive. The board already joins the
gate to its MR row by subject (`mr:<url>`), so MR title, branch, ticket,
and author never appear in the payload.

```json
{"gate-ctx": "plan@1",
 "reviewer": "renee",
 "round": 1,
 "threads": {"total": 2, "blocking": 1},
 "adjudication": "both valid · fresh-context adjudicated"}
```

respond-post adds the posting state instead of `threads`:

```json
{"gate-ctx": "post@1",
 "reviewer": "renee",
 "round": 1,
 "replies": 2,
 "fixes": [{"sha": "ab12cd3"}]}
```

Required: `reviewer`; `threads.total` (plan) / `replies` (post). Optional:
`round`, `adjudication`, `threads.blocking` (absent reads as 0), `fixes`.
`adjudication` is a display string the header chip renders verbatim.

### Per-thread question context (respond-plan)

```json
{"gate-ctx": "thread@1",
 "author": "renee",
 "severity": "blocking",
 "claim": {
   "summary": "the retry queue re-enqueues a job that already failed permanently.",
   "points": [
     "permanent failures carry retryable: false, but enqueue() never reads it",
     "violates the queue-contract doc; the other three callers all check it"
   ]
 },
 "verdict": {"call": "valid", "note": "confirmed against the checkout"},
 "reply": {"kind": "verbatim", "text": "fixed. enqueue() now drops non-retryable jobs; added the missing check and a test."}}
```

- `severity`: `"blocking" | "non-blocking" | "question" | "none"`.
  `"question"` is a reviewer question that is explicitly not a change
  request; `"none"` is a thread with no ask (a top-level summary).
- `claim.summary` is one or two sentences; `claim.points` is zero or more
  bullets. The emitter splits, not the renderer.
- `verdict.call`: `"valid" | "valid-low-value" | "invalid" | "no-ask"`,
  plus a free `note`.
- `reply.kind`: `"verbatim"` (the exact text that will be posted),
  `"direction"` (the reply exists only as intent so far), or `"none"`
  (nothing will be posted -- e.g. a fix whose reply finalizes later, or a
  skip-recommended thread). `text` is required unless `kind` is `"none"`.
- Required: `author`, `severity`, `claim.summary`, `verdict.call`,
  `reply.kind`, and `reply.text` unless `reply.kind` is `"none"`.
  Optional: `claim.points` (absent reads as empty), `verdict.note`.
- The thread's `file:line` is NOT in this object: it is the question's
  `label`, exactly as the prose path already assumes. The "thread N of M"
  ordinal derives from the question's position among the gate's
  `thread-*` questions, which are already positional by contract.
- **The planned fix is not in this object.** It travels as the `fix`
  option's `description` -- an existing field of the gate contract -- so
  the plan renders exactly where the choice is made. The `reply` and
  `skip` options carry one-line descriptions the same way.

### The replies question context (respond-post)

```json
{"gate-ctx": "replies@1",
 "replies": [
   {"thread": "<threadId>", "file": "queue/enqueue.ts:88", "verb": "fix",
    "sha": "ab12cd3",
    "text": "good call. enqueue() now drops non-retryable jobs; added the check and a test."},
   {"thread": "<threadId>", "file": "queue/README.md:12", "verb": "reply",
    "text": "agreed on the wording; noted the contract in the doc."}
 ]}
```

The board joins each entry to its checkbox option by `thread` ==
option value. `verb` is `"reply" | "fix"`; `sha` appears only with
`"fix"`. `text` is the verbatim reply -- full length, never truncated to
fit an option description. Required per entry: `thread`, `file`, `verb`,
`text`; `sha` is optional. Join fallbacks: an entry whose `thread`
matches no option is not rendered (nothing selectable answers it); an
option with no matching entry renders as today's plain checkbox option,
label and description unchanged.

### Size rule

The 8192-byte budget is SHARED: the gate context plus every question's
context together (rt-client `commands.ts`, `contextOmitted`). On overflow
the daemon opens the gate but drops the question contexts -- and the gate
context too when it alone exceeds -- flagging `contextOmitted: true`.

So the emitter pre-flights the whole open: gate-level payload plus all
question payloads must total under 8192 bytes. When over, it trims
`claim.points` from the longest threads first, then `verdict.note`; it
NEVER trims `reply.text` -- the reply is the thing being approved. If the
open still cannot fit, the emitter falls back to prose contexts for the
whole gate: deterministic, no half-structured gate, nothing for the
daemon to drop.

The board must survive the dropped case anyway (a foreign emitter may
not pre-flight): a question with no context renders its label and
options, never blank.

## Board rendering

All in `apps/board`. A `parseGateCtx(context: string)` module returns the
typed object or `null`; every renderer branches on that, never on gate
kind alone.

### Header card (replaces the MR row + context pane for respond gates)

One card, hierarchy inverted so the purpose leads:

```
[avatar R]  Responding to renee's review            16px, name bold
            !87 · add retry to the fetch queue      13px, MR id accent
            feature/demo-12-retry · Alex Doe · 1m    11.5px faint
[2 threads] [1 blocking] [both valid · fresh-context adjudicated] [round 1]
```

- The headline verb comes from the kind: "Responding to" (respond-plan) /
  "Posting replies to" (respond-post).
- When the board has no MR row for the subject, the object line falls back
  to the subject's MR reference alone; the card never blocks on the join.
- The action strip above the card (focus pane, skip gate) is untouched.
  The parked and escalated chips render today inside the MR strip this
  card replaces, so they MOVE: onto the action strip, beside skip gate.
  A parked respond gate parks exactly as today.
- Chip derivation: the threads chip from `threads.total`; the blocking
  chip from `threads.blocking` (0 renders grey as "all non-blocking");
  the adjudication chip renders the `adjudication` string verbatim,
  green; the round chip from `round` when present. respond-post: an
  "N replies" chip, one green "fix pushed · <sha>" chip per `fixes`
  entry (three or more collapse to "N fixes pushed"), then round.
- Retiring the floor accepts per-gate height variation as the queue
  advances; the fixed frame was the floor's whole purpose, and the canvas
  approval trades it away knowingly.
- The chips row is its own line under the text block.
- The pane id is not shown; the focus-pane action already encodes it.
  The origin worktree basename is dropped with it, deliberately and for
  the same reason: operator plumbing, still in the gate registry when
  debugging needs it.
- The gate-level prose card ("Decision context") does not render at all
  when the gate parses as gate-ctx -- the header card replaces it, so the
  13rem floor question disappears for these gates. For prose gates the
  floor is removed anyway: the context pane keeps its `46vh` max but
  loses its min-height.

### Thread card (per respond-plan question)

```
file:line   [BLOCKING]                    thread 1 of 2
claim summary                              13px ink
· point                                    13px ink, bulleted
· point
VERDICT  valid  · note                     10px label, call coloured
┌ WILL POST AS REPLY ────────────────┐     green wash, 13px ink
│ verbatim reply text                │
└────────────────────────────────────┘
```

- Severity pill colours: blocking amber wash, non-blocking grey,
  question accent wash, none grey ("NO ASK").
- The reply box label is "WILL POST AS REPLY" for `verbatim`,
  "REPLY DIRECTION" for `direction`; the box is absent for `none`.
- All content text is ink (`--text-1`/`--text-2`), never `--text-3`.
  The dim colour on `.tui-gate-question-context` is corrected for the
  prose fallback too.
- Choices render as the existing option cards. The plan lives in the
  `fix` option's description, and that slot is `.tui-gate-choice-subtitle`
  -- which already wraps, so the change is colour only: `--text-3` to
  `--text-2`, so primary decision material does not render muted. This is
  the third declared CSS change, and like the other two it applies to
  every gate the modal shows.

### Replies card (respond-post)

"Post which replies?" heads a card of checkbox rows, one per reply:
`file:line` + a verb tag (`REPLY` grey / `FIX · <sha>` green) + the full
verbatim text in ink. The disposition question renders as normal option
cards.

## Emitter changes (mattstack-marketplace, separate repo)

`receive-review` (the respond path) emits:

- gate-level `--context` as the gate-ctx object,
- one gate-ctx object per thread question,
- the plan as the `fix` option's `description`, one-liners on `reply`
  and `skip`,
- the respond-post `replies` question context with full verbatim texts.

The in-pane form branch flattens the same data itself when composing
AskUserQuestion calls (the pane never sees JSON). gate-protocol's
SKILL.md gains a short section defining gate-ctx@1 so other skills can
adopt it; nothing forces them to.

No mattstack ticket ids or internal references appear in any
employer-visible surface; the skill change carries none of this spec's
history.

## Non-goals

- No rt daemon, rt-client, or registry schema change.
- Review gates and their prose parser are untouched.
- No other gate kind adopts gate-ctx in this pass.
- No board server change; this is client rendering plus three CSS
  fixes (question-context colour, the context floor, the choice-subtitle
  colour).

## Testing

- `parseGateCtx` unit tests: every shape's valid form, prose, malformed
  JSON, unknown shape tag, missing or wrong-typed required fields, unknown extra keys
  (accepted) -- everything non-conforming returns `null`.
- Renderer tests per face: thread card for each severity and each
  `reply.kind`; header card for both kinds; respond-post join by thread
  id; prose gate renders through the old path unchanged.
- The existing decision-queue DOM tests keep passing (prose fixtures).
- Visual: capture fixtures for one structured respond-plan gate and one
  respond-post gate, both schemes, via the board capture harness.

## Rollout

Board lands first: it renders old prose gates exactly as today, so it is
safe alone. The skill lands second; from then on new respond gates render
structured. Nothing needs to move in lockstep. One skew case to own: a
board tab left open from before the deploy shows a structured gate's
context as raw JSON through Markdown until the tab reloads -- board
deploys already require a reload, so this is the known cost of the known
rule, not a new hazard.
