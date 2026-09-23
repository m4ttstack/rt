# Review Gate Shapes (gate-ctx: review@1, findings@1)

Extends `docs/superpowers/specs/2026-09-21-respond-gate-context-design.md`
(the base spec, as amended): same transport, same parse rules, same shared
budget, two new shapes. The goal on record: no regex parsing of gate
content anywhere -- structured content, designed with intention. This
repo is public; every example below is invented.

## Problem

Review-post gates never carry the full finding text at all: what rides
the gate is option labels and descriptions. The registry REJECTS a label
over 200 UTF-8 bytes, so the emitter middle-truncates titles to dodge
the rejection, and its own recipe caps descriptions at 1024 bytes -- the
human picks findings from hints, not findings. The board compensates
with two regex parsers:

- `finding-option.ts` (`parseFindingOption`): the LIVE one. It
  regex-parses each option's label and description (`[Tier] title`,
  `anchor - fix - kind`) into the ReviewGateSheet's finding rows and
  severity groups, and its success is what routes a review-post gate to
  the sheet at all (`isReviewSheetGate`).
- `gate-context.ts` (`parseGateContext`, `parseLabelledLines`): the
  generic modal's enrichment -- `=== key -- verdict -> recommend ===`
  sectioning and `[label]:` grouping. Both of its input formats are
  orphaned: the sectioned emitter was retired by the respond-gate
  program, and no current emitter writes the bracketed gate-level
  format (only pre-redesign gates in the registry carry either).

Guessed structure is the opposite of designed intention, and the parsers
mis-file anything that drifts from the format they imagine.

## Decision

Two new shapes under the existing `gate-ctx` discriminant. All base-spec
rules apply verbatim: JSON document inside the existing context string
fields, unknown keys ignored, missing or wrong-typed required fields fail
the whole parse to prose, no partial parses, shared 8192-byte budget.

### `review@1` (gate-level `--context` of a review-post gate)

```json
{"gate-ctx": "review@1",
 "reviewer": "renee",
 "readiness": "with-fixes",
 "summary": "mechanism verified against the pinned deps; tests substantiate AC1/AC2 and fail on master; evidence attached.",
 "findings": {"critical": 0, "important": 1, "minor": 4},
 "round": 2,
 "re_review": true,
 "prior": {"addressed": 3, "still_open": 1}}
```

- Required: `readiness` -- the review engine's own vocabulary verbatim,
  `"yes" | "no" | "with-fixes"` (hyphenated, exactly as
  review-core-body-tail pins it; no boolean mapping layer, matching the
  verdict-vocabulary precedent) -- `summary` (one or two sentences), and
  `findings` (counts by severity; a severity with no findings may omit
  its key, absent reads 0).
- Optional: `reviewer` (the reviewing agent or person, when known),
  `round`, `re_review` (absent reads false), `prior` (re-review only:
  how the previous round's findings fared; both keys required when
  present).

### `findings@1` (each `findings-*` question's `context`)

```json
{"gate-ctx": "findings@1", "findings": [
  {"id": "f1", "severity": "important",
   "title": "retry fix is parity wiring, not a live fix",
   "file": "queue/enqueue.ts:81",
   "body": "the guard only runs on the parity path; the live path still re-enqueues. The full finding text, never truncated.",
   "fix": "note it is parity wiring in the doc comment",
   "disposition": "new"},
  {"id": "f2", "severity": "minor",
   "title": "test over-specifies the ordering",
   "file": "queue/enqueue.test.ts:132",
   "body": "asserts exact call order where the contract only promises the set.",
   "fix": "assert set membership"}
]}
```

- Required per entry: `id` (== that finding's option value), `severity`
  (`critical | important | minor`), `title`, `body`. Optional: `file`
  (`path:line`; a repo-wide finding has none), `fix` (the suggested
  change, one line), `evidence` (verbatim output backing the finding),
  `disposition` (`new | still-open | addressed-check`, re-review only:
  `still-open` re-raises a prior finding, `addressed-check` asks the
  human to confirm a claimed fix the reviewer verified).
- Join rule, stricter than `replies@1`: entries and that question's
  options correspond ONE TO ONE by `id` == option value. The check lives
  in the ROUTING PREDICATE, after a successful parse -- `parseGateCtx`
  stays string-only per the base spec and never sees the options. A
  mismatch in either direction fails routing for the whole gate, which
  renders in the generic modal. There is no half-joined sheet.
- Option labels and descriptions remain for surfaces without a card
  renderer, and they keep TODAY'S exact recipe: label `[Severity] title`,
  description `anchor - fix gist - kind` joined as board:review emits it
  now. The old sheet's parser reads precisely that format, which is what
  makes the emitters-first rollout safe, and card-less surfaces keep
  their anchors forever. A degraded view, pinned -- nothing requires it
  to carry the full text anymore, and nothing may reshape it either.
- The `outcome` question is untouched: its options already carry their
  meaning in plain descriptions.

### Size rule

The base spec's shared budget applies, with per-entry granularity inside
a `findings@1` array: drop `evidence` from the largest entry first
(largest by that field's serialized UTF-8 bytes), then `fix` the same
way, whole fields only, never mid-text. Still over: the whole gate goes
prose, never half-structured. `title`, `file`, and `body` are never
trimmed; a `body` too large to ever fit is an emitter defect, not a trim
case. `gate-ctx.sh` grows accordingly: validation for both shapes,
per-entry trimming, and a prose flattener for each (the whole-gate prose
fallback and the pane form both need it, exactly as `thread@1` and
`replies@1` have theirs).

## Renderer (apps/board)

- `parseGateCtx` gains the two shapes as further union members; every
  rule from the base spec's parser section applies.
- Routing: a gate reaches the ReviewGateSheet if and only if its kind is
  `review-post`, its gate context parses as `review@1`, and EVERY
  `findings-*` question's context parses as `findings@1`. Anything else
  -- legacy review-post gates included -- renders in the generic modal
  with plain-markdown context. `isReviewSheetGate` becomes that
  predicate.
- ReviewGateSheet renders its severity groups, finding rows, and the
  readiness header from the parsed shapes: severity pill + title, accent
  `file:line`, full `body` in ink, `fix` as the muted action line,
  `disposition` as a small state pill on re-review rounds. The approved
  layout stands, and the rows GROW within it -- the body paragraph and
  disposition pill are new, visible, and the point; the re-rendered
  captures re-pin the result.
- **`gate-context.ts` AND `finding-option.ts` are deleted**, with their
  tests. GroupedContext, OverviewStrip, QuestionContext, and every
  sectioned/grouped branch in GateForm and DecisionQueueModal go with
  them. A context that is not valid gate-ctx renders as plain markdown
  -- no enrichment guessing, anywhere, for any gate kind, and no
  option-label parsing either.
- Fallback reality: historical review-post gates lose the sheet and
  render in the generic modal as plain markdown. That is the intended
  end state, not a regression; the capture baselines that pinned the
  grouped/sectioned/sheet-on-prose rendering are re-rendered.

## Emitters

- The structured findings file (review-core-body-tail's `.json` sibling
  of the report) grows the data the shapes need: `body` (required -- the
  full finding text) and optional `evidence` per finding. That is a
  contract change to the findings-file schema with its own version bump;
  its named consumers update with it. A findings file with no `body`
  (a legacy report) cannot produce a structured open: the emitter goes
  whole-gate prose, deterministically, never a lifted-from-markdown
  guess.
- The review engine (mattstack-skills) builds the review-post open the
  way receive-review builds respond opens: a source JSON from the
  findings file, the shared `gate-ctx.sh fit`, hand back to a
  gate-owning caller or `rt gate ask` on the direct path.
- `board:review` (apps) adopts the handed-back open exactly as
  `board:respond` did, including the pane-form prose flatten and the
  fits:false largest-first context drop from the base spec's amendments.
- Re-review passes fill `round`, `re_review`, `prior`, and per-finding
  `disposition` from the prior report -- the data the re-review mode
  already reads.
- gate-protocol's Structured context section gains the two shapes' rows.

## Non-goals

- No transport, daemon, or rt-client change.
- No visual redesign of the review sheet; the pen-approved layout
  stands.
- Other gate kinds (clarify, doctor-escalation, milestones) stay prose;
  nothing regex-parses them today.

## Testing

- Parser: both shapes' valid forms, every required-field omission,
  unknown keys accepted, wrong-typed fields fail whole -- mirroring the
  base spec's suite.
- Renderer: sheet from structured data per severity and disposition;
  plain-markdown fallback for prose gates; the deleted parsers' test
  files go with them, replaced by fallback-rendering tests. Routing:
  both bijection-mismatch cases (an entry with no option, an option with
  no entry) route the gate to the generic modal -- they are routing
  behaviour now, not just emit-time validation.
- Emitter: gate-ctx.sh validation cases for the new shapes; fit/trim
  cases for evidence and fix drops; whole-gate prose fallback.
- Capture: re-rendered baselines for the review sheet (structured) and
  one prose-fallback gate, both schemes, looked at.

## Rollout

Emitters FIRST (skills engine, then the wrapper adoption), renderer plus
parser deletion second -- the reverse of the base spec's order, because
here the deletion takes the sheet away from prose gates. Why this order
is safe: option labels and descriptions keep being emitted as the
degraded view, so the OLD renderer's sheet keeps working from them all
through the window; the one cosmetic cost is that a surface which shows
the raw gate context (the generic modal's context pane, a stale tab) may
show gate-ctx JSON until the renderer lands. Once the renderer ships,
every newly opened review-post gate routes structured, and only
historical gates degrade to the generic modal's plain markdown -- the
intended end state. Landing renderer-first instead would take the sheet
away from the LIVE review flow for the whole inter-repo window; that
trade is rejected, not overlooked.
