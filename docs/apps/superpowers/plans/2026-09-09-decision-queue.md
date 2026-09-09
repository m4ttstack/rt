# Decision Queue Board Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the signed-off DecisionQueueModal into the board: a queue driver over the visible rows' gates, both entry points, and MR rows that no longer render inline forms.

**Architecture:** A pure queue core (`decision-queue.ts`) wrapped by a thin hook, composed in `Board.tsx` from the same `groups` structure the rows render. `GateForm` gains an answered callback; rows swap `GateCard` for a chip face that opens the queue.

**Tech Stack:** React 18, Bun test (+ happy-dom for DOM tests), tui-kit recipes (Modal, Chip), Storybook for the row-face catalog.

**Spec:** `docs/superpowers/specs/2026-09-09-decision-queue-design.md` (same branch). Read it first; every ratified behavior below is argued there.

## Global Constraints

- Branch `gate-design-pass` in this worktree; NO pushes, NO PR — Matt builds off the branch directly.
- Never `git stash`. Commit after each task (small imperative messages).
- Comments state constraints only — no decision history, no task/review references in source (clean-code comment rule).
- No em dashes or en dashes in any output, code, or commit message.
- The queue is keyed by gateId, never by array index.
- Actionable gate = `status === 'open' || status === 'parked'`.
- All new UI text is lowercase board voice ("decision queue", "skip gate").
- Suite gates per task: `cd apps/board && bun test` green; root `bun run typecheck` green. Root `bun run format` before each commit.
- Storybook classes/tokens: use the existing `--gate-*` scale in `apps/board/src/style.css`; no new hardcoded font sizes or paddings where a token fits.

---

### Task 1: Queue core + hook

**Files:**
- Create: `apps/board/src/client/board/decision-queue.ts`
- Test: `apps/board/src/client/board/__tests__/decision-queue.test.ts`

**Interfaces:**
- Consumes: `GateRow` from `../../gates/store.ts`, `BoardMRWithReview` from `../types.ts`, `TriageGateState` (type) from `./DecisionQueueModal.tsx`, `cleanTitle` from `./format.ts`.
- Produces (later tasks rely on these exact names):

```ts
export interface QueueEntry {
  gate: GateRow;
  mr: BoardMRWithReview;
}
export interface QueueView {
  open: boolean;
  active: QueueEntry | null;
  position: number;
  states: TriageGateState[];
  nextPeek: string | undefined;
  complete: boolean;
  answeredCount: number;
  skippedCount: number;
}
export interface DecisionQueue extends QueueView {
  openAtStart: () => void;
  openAt: (gateId: string) => void;
  close: () => void;
  skip: () => void;
  noteAnswered: (gateId: string) => void;
}
export function useDecisionQueue(entries: QueueEntry[]): DecisionQueue;
// pure core, exported for tests:
export interface QueueSession {
  order: string[]; // first-seen gateIds, append-only while open
  answered: string[];
  skipped: string[];
  activeId: string | null;
}
export function queueView(
  session: QueueSession,
  entries: QueueEntry[]
): QueueView;
export function advance(
  session: QueueSession,
  entries: QueueEntry[],
  from: string | null
): string | null; // next order id after `from` that is present in entries and not answered/skipped; null when none
export function reconcile(
  session: QueueSession,
  entries: QueueEntry[]
): QueueSession; // appends unseen actionable gateIds to order; if activeId is set but absent from entries, moves it to answered and advances
```

Semantics the tests pin (all from the spec):

- `order` is first-seen and stable: entries recomputing every poll never reshuffles pips; new gates append.
- `position` = 1-based index of `activeId` in `order`; `states[i]` maps `order[i]` to `'done'` (answered), `'skipped'`, `'active'`, else `'todo'`.
- `nextPeek` = for the next todo id after active: `` `!${entry.mr.iid} · ${cleanTitle(entry.mr.title)}` ``; `undefined` when none.
- `advance` walks `order` circularly from `from`'s successor but only forward positions (no wrap to earlier skipped gates: a skipped gate does not come back this session) — concretely: successors in `order` after `from`, first one present in entries and not answered/skipped.
- `reconcile` with a vanished `activeId` marks it answered (auto-advance rule) and picks `advance(...)`; `complete` = `open && activeId === null && order.length > 0`.
- `close()` resets the whole session (order, answered, skipped, activeId).
- `openAt(gateId)` for an id not in entries falls back to `openAtStart()`.
- `noteAnswered(id)`: appends to answered (idempotent), then advances from that id.

- [ ] **Step 1: Write the failing tests** (pure core only, no DOM):

```ts
import { describe, expect, test } from 'bun:test';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import {
  advance,
  queueView,
  reconcile,
  type QueueEntry,
  type QueueSession,
} from '../decision-queue.ts';

function entry(gateId: string, iid: number, title = 'fix the thing'): QueueEntry {
  return {
    gate: { gateId, status: 'open' } as GateRow,
    mr: { iid, title } as BoardMRWithReview,
  };
}
const session = (over: Partial<QueueSession> = {}): QueueSession => ({
  order: ['g1', 'g2', 'g3'],
  answered: [],
  skipped: [],
  activeId: 'g1',
  ...over,
});
const entries = [entry('g1', 1), entry('g2', 2), entry('g3', 3)];

test('view maps order to states and 1-based position', () => {
  const v = queueView(session({ answered: ['g1'], activeId: 'g2' }), entries);
  expect(v.states).toEqual(['done', 'active', 'todo']);
  expect(v.position).toBe(2);
  expect(v.nextPeek).toBe('!3 · fix the thing');
});

test('advance skips answered and skipped, never wraps backwards', () => {
  expect(advance(session({ skipped: ['g2'] }), entries, 'g1')).toBe('g3');
  expect(advance(session({ skipped: ['g2'] }), entries, 'g3')).toBeNull();
});

test('reconcile appends new gates without reshuffling', () => {
  const next = reconcile(session(), [...entries, entry('g4', 4)]);
  expect(next.order).toEqual(['g1', 'g2', 'g3', 'g4']);
});

test('reconcile auto-advances past a vanished active gate', () => {
  const next = reconcile(session(), [entry('g2', 2), entry('g3', 3)]);
  expect(next.answered).toContain('g1');
  expect(next.activeId).toBe('g2');
});

test('complete when nothing is left', () => {
  const v = queueView(
    session({ answered: ['g1', 'g2'], skipped: ['g3'], activeId: null }),
    entries
  );
  expect(v.complete).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/board && bun test src/client/board/__tests__/decision-queue.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `decision-queue.ts`**: the pure core exactly as the interfaces above, plus the hook: `useState<QueueSession>` (closed baseline `{order: [], answered: [], skipped: [], activeId: null}` + `open` boolean), `useEffect` calling `reconcile` when `open` and entries change, callbacks per the semantics (openAtStart seeds order from entries and sets activeId to the first id; skip appends activeId to skipped then advances; close resets). Derive the view with `queueView` and spread it into the returned object.

- [ ] **Step 4: Run tests to verify pass** (same command).

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/client/board/decision-queue.ts apps/board/src/client/board/__tests__/decision-queue.test.ts
git commit -m "board: decision-queue core and hook"
```

### Task 2: Answered and continue wiring

**Files:**
- Modify: `apps/board/src/client/board/GateCard.tsx` (the `useGateForm` hook)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx`
- Modify: `apps/board/src/client/board/DecisionQueueModal.stories.tsx`

**Interfaces:**
- Consumes: Task 1's nothing (independent).
- Produces: `useGateForm(gate: GateRow, onAnswered?: () => void)` — callback fires exactly once per successful submit, after the draft clear, never on CAS loss or failure. `DecisionQueueModal` gains required props `onAnswered: () => void` and `onContinue: () => void`; the CAS-lost face renders `<button type="button" className="tui-gate-submit" onClick={onContinue}>continue</button>` after the AnsweredChip; the modal calls `useGateForm(gate, onAnswered)`.

- [ ] **Step 1**: Add the parameter to `useGateForm`; in `submit`, after the final `clearDraft()` on the success path only, call `onAnswered?.()`. `GateCard` keeps calling `useGateForm(gate)`.
- [ ] **Step 2**: Thread the two new props through `DecisionQueueModal`; add the continue button to the lost face; pass `onAnswered` into the hook call.
- [ ] **Step 3**: Update every story in `DecisionQueueModal.stories.tsx` to pass `onAnswered={noop}` and `onContinue={noop}`.
- [ ] **Step 4**: `cd apps/board && bun test` green; root `bun run typecheck` green.
- [ ] **Step 5: Commit** `git commit -m "decision queue: answered callback and CAS-loss continue"` (after `git add` of the three files).

### Task 3: Row face

**Files:**
- Create: `apps/board/src/client/board/GateRowChips.tsx`
- Create: `apps/board/src/client/board/GateRowChips.stories.tsx`
- Modify: `apps/board/src/client/board/GateCard.tsx` → rename to `apps/board/src/client/board/GateForm.tsx` via `git mv`; DELETE the `GateCard` component from it (keep `AnsweredChip`, `SummaryDetail`, `useGateForm`, `GateForm`; exports become `export { AnsweredChip, GateForm, useGateForm }`).
- Delete: `apps/board/src/client/board/GateCard.stories.tsx`
- Modify: `apps/board/src/client/board/RowView.tsx` (the gates block, currently `((mr as BoardMRWithReview).gates ?? []).map(gate => <GateCard .../>)`)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx` (import path `./GateCard.tsx` → `./GateForm.tsx`)
- Modify: `apps/board/src/client/types.ts` (`RowContext` gains `onOpenGate: (gateId: string) => void`)
- Modify: `apps/board/src/style.css` (row-face block)
- Test: `apps/board/src/client/board/__tests__/gate-row-chips.test.tsx`

**Interfaces:**
- Consumes: `AnsweredChip` from `./GateForm.tsx`.
- Produces:

```tsx
export function GateRowChips({
  gates,
  onOpenGate,
}: {
  gates: GateRow[];
  onOpenGate: (gateId: string) => void;
}): JSX.Element | null;
```

Renders `null` for an empty list, else `<div className="tui-gate-row-face" onClick={e => e.stopPropagation()}>` containing, per gate in order:
- actionable (`open`/`parked`): `<Chip as="button" intent={gate.status === 'parked' ? 'warn' : 'neutral'} variant="outline" uppercase data-gate-id={gate.gateId} onClick={() => onOpenGate(gate.gateId)}>{gate.label} · answer{gate.status === 'parked' ? ' · parked' : ''}</Chip>` (import `Chip` from `@mattstack/tui-kit`).
- otherwise: `<AnsweredChip row={{ subject: gate.subject, kind: gate.kind, status: gate.status, questions: gate.questions, answer: gate.answers ? { answers: gate.answers, by: gate.answeredBy, answeredAt: gate.answeredAt } : null }} />`.

CSS block (append near the old `.tui-gate-card` rules):

```css
/* Rows carry no form controls: a gate is a chip that opens the decision
   queue, or the answered summary. */
.tui-gate-row-face {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
```

RowView swap: replace the `GateCard` map with `<GateRowChips gates={(mr as BoardMRWithReview).gates ?? []} onOpenGate={ctx.onOpenGate} />`, drop the `GateCard` import, keep the explanatory comment trimmed to the new shape. `RowContext` consumers: grep `RowContext` for object literals that must gain `onOpenGate` (Board.tsx supplies it in Task 4; for this task's compile, add the field to the type and thread a `() => {}` placeholder ONLY in test fixtures, never in Board.tsx — Task 4 wires the real one; if Board.tsx fails typecheck without it, add `onOpenGate: () => {}` there with a `TODO` NOT allowed — instead wire it to a no-op named `openGateNoop` const and Task 4 replaces it).

DOM test (happy-dom pattern from `__tests__/gate-deep-link-dom.test.tsx` — GlobalRegistrator, IS_REACT_ACT_ENVIRONMENT):

```tsx
test('rows render chips, not forms', async () => {
  // render <GateRowChips gates={[openGate, answeredGate]} onOpenGate={spy} />
  // assert: no '.tui-gate-form' in document
  // assert: '[data-gate-id="g-open"]' exists and clicking it calls spy with 'g-open'
  // assert: the answered gate renders '[data-gate="chip"]'
});
```

(Write it as a real test with `createRoot` + `act`, fixtures shaped like the story fixtures: gateId/subject/kind/label/status/openedAt/questions.)

Stories: `GateRowChips.stories.tsx` mirrors the BoardStage decorator from `DecisionQueueModal.stories.tsx` (copy the stage; title `Gates/Board/GateRowChips`), stories: `ActionableGate`, `ParkedGate`, `AnsweredGate`, `MixedRow` (open + answered together).

- [ ] Step 1: failing DOM test; Step 2: run (fails on import); Step 3: `git mv` + component work + CSS + RowView swap + stories; Step 4: `bun test` + root typecheck green; storybook index no longer lists `gates-board-gatecard--*` (check `curl -s localhost:6007/index.json | grep -c gatecard` → 0, tolerate the dev server needing a restart); Step 5: commit `"board: rows swap inline gate forms for queue chips"`.

### Task 4: Board integration + header entry

**Files:**
- Modify: `apps/board/src/client/board/Board.tsx`
- Modify: `apps/board/src/style.css`
- Test: `apps/board/src/client/board/__tests__/decision-queue-dom.test.tsx`

**Interfaces:**
- Consumes: `useDecisionQueue`/`QueueEntry` (Task 1), `DecisionQueueModal`/`DecisionQueueComplete` (Task 2 props), `GateRowChips` via `ctx.onOpenGate` (Task 3), `nestStacks` from `../view.ts` (StackNode = `{ mr, children: StackNode[] }`), existing `groups`, `handleFocusPane`.
- Produces: the live feature.

Entries builder (place after `groups` is computed):

```tsx
const queueEntries = useMemo(() => {
  const out: QueueEntry[] = [];
  const collect = (node: StackNode) => {
    const mr = node.mr as BoardMRWithReview;
    for (const gate of mr.gates ?? [])
      if (gate.status === 'open' || gate.status === 'parked')
        out.push({ gate, mr });
    node.children.forEach(collect);
  };
  for (const g of groups) nestStacks(g.mrs).forEach(collect);
  return out;
}, [groups]);
const queue = useDecisionQueue(queueEntries);
```

Wire-up:
- `rowContext` (the object holding `onFocusPane`) gains `onOpenGate: queue.openAt` (replacing any Task 3 no-op).
- Render, near the modals the Board already mounts: when `queue.open && queue.active`, `<DecisionQueueModal gate={queue.active.gate} mr={queue.active.mr} position={queue.position} states={queue.states} nextPeek={queue.nextPeek} onClose={queue.close} onSkip={queue.skip} onFocusPane={handleFocusPane} onAnswered={() => queue.noteAnswered(queue.active!.gate.gateId)} onContinue={() => queue.noteAnswered(queue.active!.gate.gateId)} />`; when `queue.open && queue.complete`, `<DecisionQueueComplete answered={queue.answeredCount} skipped={queue.skippedCount} onClose={queue.close} />`.
- Header button inside the `.tui-controls.tui-controls-header` div, before `<Controls .../>`:

```tsx
{queueEntries.length > 0 && (
  <button
    type="button"
    className="tui-dq-open"
    onClick={queue.openAtStart}
  >
    decision queue · {queueEntries.length}
  </button>
)}
```

```css
.tui-dq-open {
  padding: var(--gate-btn-pad, 5px 12px);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--accent-text);
  white-space: nowrap;
}
.tui-dq-open:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
```

(the `--gate-*` tokens are scoped to the gate surfaces, hence the fallback value.)

DOM test (follow `gate-deep-link-dom.test.tsx`'s harness verbatim: GlobalRegistrator, FakeEventSource, fetch stub returning the board payload, `createRoot` + `act`): board data with two MRs, each one open gate. Assert: header shows `decision queue · 2`; clicking it opens `[role="dialog"][aria-label="decision queue"]` with the first MR's title in the strip; clicking `skip gate` advances (strip shows the second title); `✕` closes and the dialog is gone.

- [ ] Steps: failing test → run → implement → `bun test` + typecheck green → commit `"board: decision queue wired, header entry, row chips open it"`.

### Task 5: Row status badges (side-note fix)

**Files:**
- Modify: `apps/board/src/client/board/format.ts:440` (`needs review` cls `t-muted` → `t-warn`)
- Modify: `apps/board/src/style.css` (`.tui-phrase`, line ~398)

`.tui-phrase` becomes badge chrome so "approved" / "needs review" / "changes requested" read as badges in both the span and CommentsButton faces:

```css
.tui-phrase {
  flex-shrink: 0;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

Check the CommentsButton underline rule just below (~line 441) still reads sensibly with the badge (drop its `text-decoration: underline` if it fights the border; the hover affordance can be `background: color-mix(in srgb, currentColor 10%, transparent)`).

- [ ] Implement, eyeball via the board stories or dev board, `bun test` green (a snapshot/format test may pin the old cls — update it deliberately if so), commit `"board: status phrases read as badges, needs review in warn"`.

### Task 6: Gauntlet + close

- [ ] Root: `bun run typecheck && bun run lint && bun run format:check` all green (`format` first if drift).
- [ ] `cd apps/board && bun test` green (full suite).
- [ ] Storybook on :6007 (restart `bun run storybook -- --port 6007 --no-open` from the worktree if dead): index.json lists `gates-board-gaterowchips--*` and `gates-board-decisionqueue--*`, and no `gates-board-gatecard--*`.
- [ ] Sweep: `grep -rn "GateCard" apps/board/src` returns nothing (docs/ excluded).
- [ ] Commit any stragglers; append the outcome to the SDD ledger.

## Self-Review

- Spec coverage: driver semantics (T1), submit/continue (T2), row face + no-forms rule (T3), both entry points + integration (T4), status badges side-note (T5), suite gates (T6). Console/RT-116/SORI-38 explicitly out of scope. Covered.
- Placeholder scan: T3's Board no-op is named and replaced in T4 (explicitly forbidden as TODO); T4 test steps name concrete assertions. Clean.
- Type consistency: `QueueEntry`/`DecisionQueue`/`useGateForm(gate, onAnswered?)`/`GateRowChips`/`onOpenGate` names match across tasks.
