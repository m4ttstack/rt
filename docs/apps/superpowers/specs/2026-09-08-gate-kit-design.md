# Gate Kit Design

**Goal:** one headless home for the gate logic apps/board and apps/console
currently carry as hand-synced copies, plus a questionnaire-based answering
UI baseline and a compact answered-gate summary, so each app fulfills only
rendering.

**Placement (ratified 2026-09-08):** `packages/gate-kit`,
`@mattstack/gate-kit`, internal unpublished workspace package
(`private: true`, raw-TS exports, vitest + tsc) like `packages/tokens`.

**Prior art:** the extraction brief at
`apps/board/docs/superpowers/specs/2026-09-06-gate-kit-extraction-brief.md`
(inventory with file:line anchors, coupling table, constraints from the
ui-platform spec). This spec supersedes its API sketch.

## Constraints

- Headless core: zero react/mantine dependencies on the `"."` entry; wire
  types come from `@mattstack/rt-client` as type-only imports (no runtime
  import, so the entry is browser-safe by construction).
- Daemon I/O only behind `"./server"` (value imports of rt-client allowed
  there and nowhere else in the package).
- `"./react"` may depend on react and on `@shadcn/react` (pinned exact,
  0.3.1, MIT): it is the one place UI wiring lives, still unstyled.
- Per-surface variance stays in the apps: rendering, HTTP routes, board's
  parked-resume flow and tabId fallback, console's sockPath threading and
  panesUnavailable wording.
- Answer contracts do not change: one atomic submission, strict
  value-only option membership, CAS first-answer-wins with the winning
  row returned, daemon validation as the backstop.

## Package layout

```
packages/gate-kit/
  package.json          exports: ".", "./react", "./server"
  src/
    index.ts            re-exports the core modules below
    options.ts
    payload.ts
    collapse.ts
    grouping.ts
    conflict.ts
    kinds.ts
    summary.ts
    react/index.ts      the questionnaire adapter
    server/index.ts     focus resolution
  test/ (or colocated *.test.ts, matching the repo's convention)
```

## Core modules ("." entry, all pure)

- `options.ts`: `optionValue(o)`, `optionLabel(o)`,
  `displayForValue(value, options)` returning `{text, title?}`; carries
  the legacy verb-token transform for bare-string options so old gates
  keep rendering short.
- `payload.ts`: `gateAnswerPayload(questions, selections)` returning
  `{answers} | null` (null while any required question lacks an answer).
- `collapse.ts`: `RESPOND_PLAN_KIND`, `CODE_CHANGES_QUESTION_ID`,
  `CODE_CHANGES_SENTINEL`, `codeChangesHidden(kind, questions,
  selections)`, and `effectiveSelections(kind, questions, selections)`
  which merges the sentinel for the hidden question (each app hand-merges
  this today).
- `grouping.ts`: `groupThreadOptions(options)` returning
  `ThreadOptionGroup[] | null`; a group exists only for a complete unique
  reply/fix/skip verb set per thread token, null means render flat.
- `conflict.ts`: `resolveAnswerOutcome(response)` returning
  `{kind: "won" | "lost", row}`, normalizing the 409/`conflict: true`
  shapes both apps parse today.
- `kinds.ts`: `GATE_KINDS`, `domainForKind(kind)`. Becomes the single
  source; the board's kind-sync guard test retargets here.
- `summary.ts`: `answeredGateSummary(row)` returning
  `{chip: string, detail: Array<{question, answers: Array<{text,
  title?}>, decidedBy, at}>}`. The chip is one short line derived per
  kind from labels, never raw values (for example
  `review !44043 · comment, nothing posted` or
  `respond !44058 · 1 fix, approved · by board`). Detail carries the
  structured question/answer pairs the current large answered blocks
  show. Applies to answered, superseded, and closed rows.

## React adapter ("./react" entry)

Baseline: `@shadcn/react/questionnaire`, an unstyled multi-step
questionnaire over a native form (FormData answers, items with
choices/multiple/required, progress, skip, keyboard shortcuts, controlled
or uncontrolled active item, validate-then-advance with focus management,
SSR-capable, pure React + DOM). Both kits style it; the adapter adds only
gate semantics:

- `gateItems(row, selections)`: gate questions to
  `QuestionnaireItemDefinition[]` plus display data per item (prompt from
  the question label, choices as `{value, label, description?}` via
  `options.ts`, `multi` to `multiple`, required when the question carries
  options). The respond collapse is STRUCTURAL: the code-changes item is
  excluded from the returned items until any other selection includes a
  `fix:` value; inclusion is reactive to `selections`.
- `answersFromForm(questions, formData)`: FormData to selections
  (`get`/`getAll` per `multi`), then through `effectiveSelections` (the
  excluded code-changes item submits the sentinel) into
  `gateAnswerPayload`. One atomic answer.
- Grouped rendering data: the adapter exposes `groupThreadOptions` output
  alongside items so a styled layer can render per-thread choice groups.
- No `QuestionnaireInput` (freeform) ever: strict option membership
  forbids values outside the option set.
- Answered/terminal gates never mount the questionnaire; surfaces render
  the `summary.ts` chip with expand-to-detail.

The future gate triage modal is `Questionnaire.Root` in its multi-step
shape with `Progress` as the dot row, reusing this adapter unchanged;
today's cards use the same primitive with one-or-two-item gates.

## Server module ("./server" entry)

- `normalizeWorktreePath(path)`: trailing-slash trim, `realpathSync` in
  try/catch, deterministic fallback of the trimmed string with the
  darwin-only `/tmp` to `/private/tmp` rewrite.
- `resolveOriginFocus(origin, panes, opts?)`: paneId direct (carrying
  tabId when `opts.carryTabId`), else normalized worktree match, else
  `{ok: false, reason}`; `opts.panesUnavailable` selects the
  could-not-list reason wording.
- `panesForOrigin(origin, paneList)`: fetches panes only when paneId is
  absent and worktree present, returning `{panes, fetchFailed}`; a
  rejected paneList call is caught into `fetchFailed: true`.

## App migrations

**apps/console** (Mantine): actionable gate cards render through the
adapter with Mantine-styled Questionnaire wrappers; answered gates render
the summary chip (Badge plus the chip line) with expand-to-detail.
`src/app/runs/gate-format.ts` deletes down to what the kit does not own;
`src/server/gates.ts` imports the server module (sockPath threading stays
local). The browser-bundle lint wall allows `@mattstack/gate-kit` value
imports in app code (browser-safe entry) and keeps banning the rt-client
barrel.

**apps/board** (tui-kit): same shape with tui-styled wrappers; the
answered-gate blocks on the board (the current large summaries) become
chips. Deletes the duplicated logic in `src/client/board/gate-format.ts`
and `src/gates/focus.ts`; `src/gates/sweep.ts` imports `kinds.ts`; the
kind-sync guard test asserts against the kit's `GATE_KINDS`. Parked-gate
resume flow unchanged.

## Testing

- Kit: the apps' existing unit tests for the extracted logic move in
  (options, payload, collapse, grouping, conflict, kind sync) plus new
  suites for `summary.ts` and the server module (symlink and dead-path
  normalization cases); adapter tests with testing-library cover items
  mapping, structural collapse (item appears on `fix:` selection),
  sentinel injection at submit, and the FormData round-trip.
- Apps keep rendering tests only: chip renders for answered gates and
  expands to detail; actionable card submits exact option values; focus
  button states.
- CI: gate-kit joins the per-package test matrix as its own job.

## Sequencing (one wave)

1. Kit package with all three entries and its tests.
2. Console migration (adapter cards, chip, server import, lint-wall
   update).
3. Board migration (adapter cards, chip, server/kinds imports, guard
   retarget).
4. Live check: answer one real gate per surface; verify the chip
   collapse and an expand.

Single repo, so no cross-repo deploy ordering: per-app deploys happen
after the wave merges.

## Amendment (2026-09-08, live review): card interaction model

Ratified by Matt on the preview of the migrated cards. Supersedes the
"flat card" rendering described under the React adapter for gates with
more than one question, and adds four capabilities of the questionnaire
primitive that the first cut left unwired.

### Layout

- **One question:** flat. Title, options (each with its shortcut hint),
  error line, note field, Submit. The single item is the primitive's
  active item, so no `hidden`/`inert` override is needed.
- **Two or more questions:** the primitive's step mode. A progress line
  built from `Questionnaire.Progress` render state ("2 of 3" beside the
  active question's title), one question's options, error line, note
  field, then the actions row: Previous, Next, Submit (Submit only on the
  last item). Non-active items keep the primitive's `hidden` + `inert`.
  The `hidden={false} inert={false}` override is removed from both cards;
  the adapter's pin test retargets to the step contract (only the active
  item visible, the single-item case visible).
- The respond-plan collapse is unchanged and stays value-keyed: the
  code-changes item joins the sequence only once a `fix:` value is
  selected; while absent it submits the sentinel through
  `effectiveSelections` as today. In step mode this means the last step
  appears when a fix is picked, and Submit moves to it.
- Chip, recommended badge, context disclosure, focus button, conflict
  path: unchanged. Board keeps its tui chrome, console its Mantine chrome.

### Shortcuts

`Questionnaire.Root shortcuts="numbers"`. Each option renders
`Questionnaire.ChoiceShortcut` as a small key hint (board: a mono chip,
console: `Kbd`). The primitive resolves keys against the active item,
which is the visible one in both layouts.

### Errors and navigation state

Each item renders `Questionnaire.Error`; the primitive's required
validation supplies the message when Next or Submit is pressed with no
answer. Next and Submit render disabled until the active item's status is
answered (`Questionnaire.Next`/`Submit` render state), so the enabled
button always does something.

### Freeform note

Every question carries an optional note input (`Questionnaire.Input`,
accessible name "Note for <question label>", placeholder "Add a note").
The adapter names the field `<question id>:note`. `answersFromForm`
returns wire answers (`{ answers: GateAnswers }`): a question whose note
is non-empty after trimming submits `{ value, note }` where `value` is
the selection (string, or string[] for multi); an empty note submits the
bare selection exactly as today. The daemon already stores and emits both
shapes; the answered chip and detail already render the note via
`unwrapGateAnswer`.

### Resume

The adapter exports `useGateDraft(gateId, enabled)` (browser-only, in
`./react`): a draft `{ selections, notes, item }` per gate id in
`localStorage` under `gate-kit:draft:<gateId>`, saved on every change
while the gate is open, restored on mount, and cleared on a successful
submit, on a conflict loss, or when the gate is no longer open. A Reset
action (rendered beside Previous) clears the draft and the form. Storage
access is wrapped so an unavailable `localStorage` degrades to no draft.

### Deferred

Explicit skip (optional questions) waits on rt: `optional?: true` on the
wire question, daemon validation accepting omission for optional
questions, and the gate-protocol prose. Dialog hosting is the triage
modal, the next build on this kit. Animated item transitions: not now.

### Testing (amendment)

- Adapter: step contract pin (active item visible, others hidden and
  inert; single item visible); shortcut selects in the active item;
  note round-trip (`{ value, note }` for single and multi, bare value on
  empty note); `useGateDraft` save, restore, clear, and storage-unavailable
  path.
- Console (DOM): progress text advances on Next; Submit disabled until
  answered; error text on an empty Next; note reaches the POST body.
- Board: typecheck + `build:client`; behavior covered by the adapter
  suite and the preview.

### Sequencing (amendment)

5. Card interaction model (adapter first, then board, then console),
   previewed from the worktree on the live deck rows before the PR
   merges.
