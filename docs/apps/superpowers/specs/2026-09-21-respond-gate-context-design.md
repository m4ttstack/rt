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
`"gate-ctx"` key equals `1`. Anything else -- old gates, other gate kinds,
foreign senders -- renders exactly as today. The prose parser
(`gate-context.ts`) stays for review gates; nothing about them changes.

## The gate-ctx@1 contract

### Gate-level context (respond-plan and respond-post)

Carries only what the board cannot derive. The board already joins the
gate to its MR row by subject (`mr:<url>`), so MR title, branch, ticket,
and author never appear in the payload.

```json
{"gate-ctx": 1,
 "reviewer": "renee",
 "round": 1,
 "threads": {"total": 2, "blocking": 1},
 "adjudication": "fresh-context (opus), all valid"}
```

respond-post adds the posting state instead of `threads`:

```json
{"gate-ctx": 1,
 "reviewer": "renee",
 "round": 1,
 "replies": 2,
 "fixes": [{"sha": "ab12cd3"}]}
```

### Per-thread question context (respond-plan)

```json
{"gate-ctx": 1,
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
- **The planned fix is not in this object.** It travels as the `fix`
  option's `description` -- an existing field of the gate contract -- so
  the plan renders exactly where the choice is made. The `reply` and
  `skip` options carry one-line descriptions the same way.

### The replies question context (respond-post)

```json
{"gate-ctx": 1,
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
fit an option description.

### Size rule

The registry drops a gate-level context over 8192 bytes (loudly:
`contextOmitted: true`). Question contexts have no daemon cap, but the
emitter keeps each under 4KB; a claim that cannot fit has its `points`
trimmed before its `summary`.

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
- The chips row is its own line under the text block.
- The pane id is not shown; the focus-pane action already encodes it.
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
- Choices render as the existing option cards; option descriptions (the
  plan on `fix`) display under each label as today.

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
- No board server change; this is client rendering plus one CSS fix.

## Testing

- `parseGateCtx` unit tests: valid v1 objects, prose, malformed JSON,
  wrong version, oversized input -- everything non-conforming returns
  `null`.
- Renderer tests per face: thread card for each severity and each
  `reply.kind`; header card for both kinds; respond-post join by thread
  id; prose gate renders through the old path unchanged.
- The existing decision-queue DOM tests keep passing (prose fixtures).
- Visual: capture fixtures for one structured respond-plan gate and one
  respond-post gate, both schemes, via the board capture harness.

## Rollout

Board lands first: it renders old prose gates exactly as today, so it is
safe alone. The skill lands second; from then on new respond gates render
structured. Nothing needs to move in lockstep.
