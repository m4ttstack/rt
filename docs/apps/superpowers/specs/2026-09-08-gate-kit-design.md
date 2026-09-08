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
