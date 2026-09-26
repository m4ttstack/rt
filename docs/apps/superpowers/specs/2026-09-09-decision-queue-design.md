# Decision Queue: board wiring design

Ratified live with Matt on 2026-09-09 (design-pass canvas + Storybook
sign-off, branch `gate-design-pass`). The presentational layer is DONE and
approved: `DecisionQueueModal` / `DecisionQueueComplete`
(`apps/board/src/client/board/DecisionQueueModal.tsx`) hosting the
`GateForm` extracted from `GateCard`, specced by the 9 stories under
`Gates/Board/DecisionQueue`. This spec covers what remains: the queue
driver, the row face, and the wiring that makes the modal live on the
board.

## Ratified product decisions (binding)

- One modal session walks every pending gate on the board: the queue holds
  all actionable gates (`open` or `parked`) on VISIBLE rows (after
  tab/member/slack filtering), in board order (group order, then the
  group's sort, then stack nesting order — exactly the order rows render).
- Entry points, both: a header affordance opens the queue at gate 1; a
  gate chip on a row opens it positioned at that gate.
- Skip gate: advance only. The skipped gate and its localStorage draft
  stay untouched; a skipped gate does not come back around this session.
- A gate that stops being actionable while queued (answered elsewhere,
  closed, superseded) is auto-advanced past — the modal never dwells on
  it. Its pip flips done.
- A CAS loss on submit (answered elsewhere DURING answering) is the one
  pause: the modal shows "answered elsewhere" + the winning answer, and a
  solid `continue` button advances.
- When no gate is left, `DecisionQueueComplete` shows counts (answered,
  skipped this session) and a done button closing the modal.
- MR rows render NO form controls anymore. A row's gate face is:
  - actionable gate: a compact chip-style button (the gate kind, plus the
    existing parked badge treatment) that opens the queue at that gate;
  - answered/terminal gate: the existing `AnsweredChip` summary,
    unchanged.
- Console is out of scope; it adopts the same kit adapter later.

## Driver architecture

One hook owns the queue; `Board.tsx` composes it.

`useDecisionQueue(entries)` in
`apps/board/src/client/board/decision-queue.ts` (pure logic + hook, no
fetches):

- `entries: QueueEntry[]` — `{ gate: GateRow, mr: BoardMRWithReview }`,
  recomputed by Board every render from the SAME `groups` structure the
  rows render (flattened with `nestStacks` per group so the order is
  byte-identical to the visual order), filtered to actionable gates.
- Internal state: `open: boolean`, `activeGateId: string | null`,
  `answered: Set<string>`, `skipped: Set<string>` (gateIds, session-local,
  reset when the queue closes).
- The queue is keyed by gateId, never by index: entries recompute on every
  poll, and the active gate is found by id. If the active gateId is no
  longer in `entries` (answered elsewhere, row filtered away, gate
  superseded), the driver marks it done and auto-advances to the next
  entry after its last known position (falling back to the first
  remaining; complete face when none remain).
- API: `openAtStart()`, `openAt(gateId)`, `close()`, `skip()` (adds to
  `skipped`, advances), `advance()` (moves to the next entry not yet
  answered/skipped), `noteAnswered(gateId)` (adds to `answered`,
  advances).
- Derived for the modal: `active: QueueEntry | null`, `position` (1-based
  among the session's queue = entries ∪ answered/skipped ids in first-seen
  order, so pips don't renumber as gates resolve), `states:
  TriageGateState[]` (done/skipped/active/todo in that stable order),
  `nextPeek: string | undefined` ("<repo or ref> · <clean title>" of the
  next todo entry), `complete: boolean`, counts.
- The session order list (first-seen gateId order) is kept in a ref so a
  gate resolving does not reshuffle pips; newly appearing gates append.

## Submit and advance wiring

- `useGateForm` gains an optional `onAnswered?: () => void` argument,
  called exactly once after a submit resolves successfully (the same spot
  that clears the draft; NOT on CAS loss, NOT on failure). `GateCard`
  passes nothing (rows no longer host forms anyway); the modal passes the
  driver's `noteAnswered`.
- CAS loss: `DecisionQueueModal` gains `onContinue: () => void`; the lost
  face renders a solid `continue` button (`.tui-gate-submit`) under the
  winning answer. The driver treats continue like `noteAnswered` (the
  gate IS answered) without double-counting.
- `DecisionQueueComplete` wires `answered`/`skipped` counts and `onClose`
  from the driver.

## Row face

`RowView.tsx` stops rendering `GateCard`. Per gate on a row:

- `gate.status === 'answered'` (or terminal): render `AnsweredChip`
  exactly as `GateCard`'s answered branch does today (same summary row
  input), inside the same stop-propagation wrapper.
- actionable: render a chip-row: a `Chip as="button"` (tui-kit recipe,
  `intent="warn"` outline for parked with the parked badge, neutral
  otherwise) labeled with the gate kind plus a short "answer" affordance,
  `data-gate-id` preserved for click routing, `onClick` →
  `openAt(gateId)` (stopPropagation so the row's own click doesn't fire).
- The context disclosure stays OFF the row (context lives in the modal).
- `GateCard` itself shrinks to the pieces still used (`AnsweredChip`,
  `GateForm`, `useGateForm`); its inline-form rendering and its stories
  are REMOVED (the DecisionQueue stories are the catalog for the form
  now). A new `GateRowChips` story file covers the row face states
  (actionable, parked, answered, with-note) for sign-off.

## Board integration

- `Board.tsx`: build `queueEntries` from `groups` (flatten with
  `nestStacks`, collect actionable gates in order), call
  `useDecisionQueue`, render `DecisionQueueModal` /
  `DecisionQueueComplete` when open, passing `handleFocusPane` through.
- Header affordance: a `decision queue` button in the header controls
  area (`.tui-controls`, beside the existing controls), showing the
  pending count (`decision queue · 3`), hidden when zero. Clicking opens
  at gate 1. Light-tier button styling from the gate token scale.
- Escape/overlay close comes free from the kit Modal.

## Testing

- `decision-queue.test.ts(x)`: unit tests over the hook via
  `renderHook`-style harness or a pure reducer core — first-seen order
  stability, openAt positioning, skip/advance/noteAnswered, active gate
  vanishing → auto-advance, queue emptying → complete, close resets
  session sets.
- Row face: RowView-level render test pinning "no form controls in rows"
  (no `.tui-gate-form` under `.tui-row`) and the chip → `openAt` call.
- Existing modal stories stay prop-driven and untouched; add the
  `GateRowChips` stories.
- Suite gate: `bun test` in `apps/board` green (1314 + new), root
  typecheck/lint/format green.

## Out of scope

Console adoption, RT-116 (allowOther/optional) rt-side work, SORI-38
polish port, deploy (branch ships without PR per Matt; merge/deploy is a
later explicit step).
