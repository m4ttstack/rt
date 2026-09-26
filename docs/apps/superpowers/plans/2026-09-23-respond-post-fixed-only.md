# Respond Post Step: Fixed Threads Only, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate 2 (respond-post) asks only about threads whose reply was written after a fix; reply-only threads post from gate 1's answer, and gate 1's reply text becomes editable on the board.

**Architecture:** receive-review and the board:respond wrapper stop offering reply-only threads at gate 2 and post them from the respond-plan answer (its `text` when edited). The board's plan sheet reuses the post card's `EditableReply` on `reply:` picks and sends `{value: "reply:<id>", text}`. gate-kit's recap outcome counts edited replies.

**Tech Stack:** Bun, TypeScript, React 19 (board), bun:test + happy-dom, vitest (gate-kit), Markdown skills compiled by `rt skills compile`.

**Spec:** `docs/superpowers/specs/2026-09-23-respond-post-fixed-only-design.md` (this repo). Read it before any task.

## Repos and trees

| Part | Repo | Tree |
|---|---|---|
| A (Task 1) | `~/Documents/GitHub/mattstack-skills` (rt identity `remote:github.com%2Fm4ttstack%2Fskills`) | `rt worktree provision --repo "remote:github.com%2Fm4ttstack%2Fskills" --branch respond-fixed-only --owner claude --json`, cut only after the `followups-slug-pane-decider` branch has merged to skills `main` |
| B (Tasks 2-4) | this repo | this worktree, branch `respond-fixed-only-post` |

Task 1 and Tasks 2-4 touch different repos and may run in parallel once Task 1's branch point exists. Work in a provisioned tree by absolute path; never edit a canonical checkout or a plugin cache.

## Global Constraints

- Gate 2 offers a thread only when its reply was finalized after a fix (`fix:<threadId>` implemented in step 5). Reply-only threads never appear at gate 2.
- A reply-only thread posts the respond-plan answer's `text` when present, else the drafted `thread@1` `reply.text`, and is never resolved.
- With no fixed thread there is no respond-post gate and no respond-post record; reply-only threads post right after gate 1.
- With fixes, reply-only threads post together with gate 2's picks, after gate 2.
- respond-plan record for edited replies: a sibling map, `{"threads": {"T1": "reply", "T2": "fix"}, "texts": {"T1": "<edited reply>"}, "code-changes": "approve"}`; the `threads` values stay strings.
- The board sends `{"value": "reply:<id>", "text": "<trimmed edit>"}` only for a thread picked `reply:` whose trimmed edit differs from the trimmed draft; an emptied reply on a `reply:` pick blocks submit.
- The in-pane form never sends `text`.
- Recap outcome with an edited reply reads like `2 replies (1 edited)`; `chip` stays byte-identical.
- Follow `~/.claude/rules/no-em-dashes.md`: no em or en dashes anywhere, and none of the phrases it bans.
- Comments state constraints the code cannot show; never narrate, never cite tasks or reviews.
- Public repos: invented data only (no real names, no employer terms, no internal ticket ids).
- UI: read `docs/ui-authoring.md` first; role tokens only; weights 400, 500, 700 only.
- Apps gates: `bun run tui-kit:build` first; every apps task runs `bun run format:check` and `sh scripts/repo-purity.sh`.
- Skill edits: load `superpowers:writing-skills` and `mattstack:editing-skills` first; baseline before editing; `sh tests/certify.sh <dir>` exits 0; read compiled output in full.
- Implementers never push, merge, publish, or release.
- Every commit ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- A thread picked `reply:`, edited, then switched to `fix:`: the edit stays in the draft and is not sent (Task 3 test).
- Every thread picked `skip:`: the dock says nothing posts, submit sends no `text`, and the skills post nothing and open no gate 2 (Task 3 test, Task 1 scenario).
- An edit whose trimmed text equals the draft sends no `text` and shows no chip (Task 3 test).
- Send-back (`revise`) mode: no `text` rides the revise answer and the empty-reply reason never shows (Task 3 test).
- A respond-post resume after a restart still posts the reply-only threads, with their edited text (Task 1 and Task 4 scenarios).

---

### Task 1: receive-review posts reply-only threads from gate 1 (mattstack-skills)

**Files:**
- Modify: `attachments/review/receive-review/SKILL.md` (step 4 answer reading and record; step 6 offer, no-offer rule, act paragraph, record, red-flag and quick-reference rows)
- Modify: `.claude-plugin/plugin.json` (next patch after the followups release, e.g. `0.18.1` -> `0.18.2`), `CERTIFICATION.md` (row directly under the last table row, no blank line)
- Create: `docs/superpowers/tests/2026-09-23-respond-post-fixed-only/red-green.md` and `scenarios/` beside it

**Interfaces:**
- Consumes: the answer object form `{value, note?, text?}` (rt-client 0.30.0).
- Produces: the respond-plan record's optional `texts` map; the rule that gate 2 offers fixed threads only.

- [ ] **Step 1: Load skills and provision** (see "Repos and trees"; only after the followups branch has merged).
- [ ] **Step 2: Scenarios.** Write three, invented data only, modeled on `docs/superpowers/tests/2026-09-22-respond-post-edited-text/scenarios/post-act-edited.md`:
  - `plan-replies-only.md`: two pushback threads; the respond-plan answer is `{"thread-1": {"value": "reply:T1", "text": "<edited reply>"}, "thread-2": "reply:T2", "code-changes": "skip"}` by `board`. Ask for every forge action and command until the run closes. Pass: T1 posts the edited text, T2 posts its draft, neither resolves, no `respond-post` gate opens, no `respond-post` record, the respond-plan record carries `"texts": {"T1": "<edited reply>"}`, the run closes.
  - `plan-fix-and-reply.md`: T1 `fix:` (finalized in step 5 at a given sha), T2 `reply:` with an edit, `code-changes: approve`. Ask what the respond-post open contains and, given a gate 2 answer `{"thread-1": ["post:T1", "resolve:T1"]}`, every forge action. Pass: the open offers only T1; after gate 2, T1 posts and resolves, T2 posts its edited text unresolved.
  - `plan-all-skip.md`: every thread `skip:`, `code-changes: skip`. Pass: nothing posts, no gate 2, the run closes.
- [ ] **Step 3: RED.** Preview-compile receive-review from the tree (method in `docs/superpowers/tests/2026-09-22-respond-post-per-thread/respond-post.md`) and run 5 reps of each scenario (`claude --model sonnet --tools "" --strict-mcp-config --append-system-prompt-file <compiled> -p "<scenario>"`). Record every rep. Expected: `plan-replies-only` and `plan-fix-and-reply` fail (a gate 2 over reply-only threads, or the draft posted instead of the edit).
- [ ] **Step 4: Edit receive-review.** Make the text say, in the file's own voice:
  - step 4: a `reply:` answer may be an object whose `text` is the reply to post for that thread; record edited replies in a sibling `"texts"` map beside `"threads"`; write each edited reply into the report's row for that thread so every later posting reads the report;
  - step 6: a thread is offered only when a fix finalized its reply in step 5; reply-only threads post from gate 1 (the plan answer's `text`, else the drafted reply), never resolved; with no offered thread there is no respond-post gate and no respond-post record, and the reply-only threads post right away; with offered threads they post together with gate 2's picks after gate 2;
  - the red-flag and quick-reference rows match.
- [ ] **Step 5: GREEN.** Recompile; 5 reps each of the three scenarios (target 5/5 strict), then 5 reps each of the existing `post-build`, `post-act`, `post-resume`, `post-none` (from `2026-09-22-respond-post-per-thread/scenarios/`) and `post-act-edited`, `post-pane-typed` (from `2026-09-22-respond-post-edited-text/scenarios/`), updating any scenario whose premise this change retires (a reply-only thread in a post open) and saying so in the record.
- [ ] **Step 6: Certify and record.** `sh tests/certify.sh attachments/review/receive-review && sh tests/repo-purity.sh` exit 0; bump the version; add the CERTIFICATION row; write `red-green.md` with strict tallies; read the preview-compiled receive-review in full.
- [ ] **Step 7: Commit** `receive-review: gate 2 asks only about fixed threads; replies post from gate 1`, ending with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Checkpoint A (controller)

Review Task 1; merge to skills `main` with Matt's confirmation; `rt skills sync --pack mattstack`, then `rt skills sync` for each other compiled pack; full reads of every compiled file whose content changed.

### Task 2: the recap outcome counts edited replies (gate-kit)

**Files:**
- Modify: `packages/gate-kit/src/summary.ts` (`verbCounts`, `compactOutcome`)
- Test: `packages/gate-kit/test/summary.test.ts`

**Interfaces:**
- Produces: `answeredGateSummary(row).outcome` reads `N replies (E edited)` when E single-select `reply:` answers carry `text`; `chip` unchanged.

- [ ] **Step 1: Failing test** in `summary.test.ts`:

```ts
  test('a plan gate outcome counts edited replies; the chip does not change', () => {
    const thread = (n: number, t: string): GateQuestion => ({
      id: `thread-${n}`,
      label: `${t}.ts:1`,
      multi: false,
      options: [
        { value: `reply:${t}`, label: 'Reply' },
        { value: `fix:${t}`, label: 'Fix' },
        { value: `skip:${t}`, label: 'Skip' },
      ],
    });
    const row = {
      subject:
        'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/87',
      kind: 'respond-plan',
      status: 'answered',
      questions: [
        thread(1, 'T1'),
        thread(2, 'T2'),
        { id: 'code-changes', label: 'Approve?', multi: false, options: ['approve', 'revise', 'skip'] },
      ],
      answer: {
        answers: {
          'thread-1': { value: 'reply:T1', text: 'edited reply' },
          'thread-2': 'reply:T2',
          'code-changes': 'skip',
        },
        by: 'board',
        answeredAt: 1,
      },
    };
    const before = answeredGateSummary({
      ...row,
      answer: { ...row.answer, answers: { ...row.answer.answers, 'thread-1': 'reply:T1' } },
    });
    const { outcome, chip } = answeredGateSummary(row);
    expect(outcome).toBe('2 replies (1 edited), skip');
    expect(chip).toBe(before.chip);
  });
```

- [ ] **Step 2: Run it to see it fail.** `bun run gate-kit:test` (expected: outcome reads `2 replies, skip`).
- [ ] **Step 3: Implement.** Give `verbCounts` an optional second parameter `edited = 0` that appends ` (${edited} edited)` to the `reply` part only when `edited > 0`; the chip's existing callers pass nothing. In `compactOutcome`, count single-select answers whose unwrapped value starts with `reply:` and whose unwrapped answer has `text`, and pass that count to `verbCounts`.
- [ ] **Step 4: Gates.** `bun run gate-kit:test && bun run --cwd packages/gate-kit typecheck && bun run tui-kit:build && bun run board:typecheck && bun run console:typecheck && bun run format:check && sh scripts/repo-purity.sh`.
- [ ] **Step 5: Commit** `gate-kit: the recap outcome counts edited replies`, with the trailer line.

### Task 3: gate 1's reply text is editable on the board's plan sheet (apps)

**Files:**
- Modify: `apps/board/src/client/board/respond-post.ts` (shared edit rule, `planReplies`, `planTexts`)
- Modify: `apps/board/src/client/board/RespondSheet.tsx` (plan cards, payload, dock copy, empty-reply reason)
- Test: `apps/board/src/client/board/__tests__/respond-post.test.ts`, `respond-sheet-dom.test.tsx`

**Interfaces:**
- Consumes: `EditableReply`, `EditedChip` (`RespondCards.tsx`); `GateFormState.texts/setText/clearText`; `sheetAnswers(gate, shown, selections, notes, texts)`.
- Produces: `interface PlanReply { name: string; label: string; draft: string; value: string }`; `planReplies(questions: GateQuestion[]): PlanReply[]`; `planTexts(replies: PlanReply[], selections: GateSelections, texts: Record<string, string>): Record<string, string> | null`; `editedText(name: string, draft: string, texts: Record<string, string>): boolean`.

- [ ] **Step 1: Failing helper tests** in `respond-post.test.ts`:

```ts
const planQ = (n: number, id: string, kind: 'verbatim' | 'direction', text: string) => ({
  id: `thread-${n}`,
  label: `${id}.ts:1`,
  multi: false,
  context: JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'question',
    claim: { summary: 'a claim' },
    verdict: { call: 'pushback' },
    reply: { kind, text },
  }),
  options: [
    { value: `reply:${id}`, label: 'reply' },
    { value: `fix:${id}`, label: 'fix' },
    { value: `skip:${id}`, label: 'skip' },
  ],
});

test('planReplies lists only verbatim replies, with their reply option', () => {
  const qs = [planQ(1, 'T1', 'verbatim', 'draft one'), planQ(2, 'T2', 'direction', 'intent')];
  expect(planReplies(qs)).toEqual([
    { name: 'thread-1', label: 'T1.ts:1', draft: 'draft one', value: 'reply:T1' },
  ]);
});

test('planTexts sends a trimmed edit only for a reply pick whose edit differs', () => {
  const replies = planReplies([planQ(1, 'T1', 'verbatim', 'one'), planQ(2, 'T2', 'verbatim', 'two')]);
  expect(
    planTexts(replies, { 'thread-1': 'reply:T1', 'thread-2': 'fix:T2' }, { 'thread-1': ' one, edited ', 'thread-2': 'kept for later' })
  ).toEqual({ 'thread-1': 'one, edited' });
  expect(planTexts(replies, { 'thread-1': 'reply:T1' }, { 'thread-1': ' one ' })).toEqual({});
  expect(planTexts(replies, { 'thread-1': 'reply:T1' }, { 'thread-1': '  ' })).toBeNull();
  expect(planTexts(replies, { 'thread-1': 'skip:T1' }, { 'thread-1': '  ' })).toEqual({});
});
```

and the DOM tests in `respond-sheet-dom.test.tsx`, using the existing `planGate()` fixture (its `threadQuestion(n)` replies are verbatim `'fixed, with a test.'`); reuse or define `editButton`, `replyBox` and `typeInto` exactly as the post-step tests do:

```tsx
const planCards = () => [...document.body.querySelectorAll<HTMLElement>('section[data-gate-ctx="thread"]')];

test('a reply pick on the plan sheet can be edited and answers with its text', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'fixed in the next push, with a test.');
  expect(card.querySelector('[data-chip="edited"]')).not.toBeNull();
  await clickSubmit();
  expect((answer() as { answers: Record<string, unknown> }).answers['thread-1']).toEqual({
    value: 'reply:t1',
    text: 'fixed in the next push, with a test.',
  });
  expect((answer() as { answers: Record<string, unknown> }).answers['thread-2']).toBe('reply:t2');
});

test('a fix or skip pick offers no edit, and an edit made under reply is not sent after switching to fix', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('skip:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, 'an edit');
  await pick('fix:t1');
  expect(editButton(card)).toBeNull();
  expect(editButton(planCards()[1]!)).toBeNull();
  await clickSubmit();
  expect((answer() as { answers: Record<string, unknown> }).answers['thread-1']).toBe('fix:t1');
});

test('the dock says what happens next on the plan sheet', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  expect($('.tui-sheet-dock-next')!.textContent).toBe('Next, 2 replies post.');
  await pick('fix:t1');
  expect($('.tui-sheet-dock-next')!.textContent).toBe(
    'Next, 1 fix gets implemented, then you approve the fixed replies before anything posts.'
  );
  await pick('skip:t1');
  await pick('skip:t2');
  expect($('.tui-sheet-dock-next')!.textContent).toBe('Next, nothing posts.');
});

test('an emptied reply pick blocks submit with a reason; send-back mode ignores edits', async () => {
  await render(planGate());
  await pick('reply:t1');
  await pick('reply:t2');
  const card = planCards()[0]!;
  await React.act(async () => editButton(card)!.click());
  await typeInto(replyBox(card)!, '   ');
  expect(submit().disabled).toBe(true);
  expect(document.body.textContent).toContain('a reply is empty: write it or skip the thread');
  await click($('.tui-sheet-revise'));
  expect(document.body.textContent).not.toContain('a reply is empty');
});
```

If `planGate()`'s code-changes lacks the sentinel so the dock asks code-changes, pick `approve`/`skip` in the dock as the existing plan tests do; if the `send the plan back` button needs a different selector, use the one the existing send-back tests use.

- [ ] **Step 2: Run them to see them fail.** `bun run tui-kit:build`, then `bun test --cwd apps/board src/client/board/__tests__/respond-post.test.ts src/client/board/__tests__/respond-sheet-dom.test.tsx`.
- [ ] **Step 3: Implement the helpers** in `respond-post.ts`, with `postTexts` and `isEdited` delegating to the shared rule so their behavior and tests stay unchanged:

```ts
/** An edit counts only when it differs from the draft once surrounding
    whitespace is ignored. */
export function editedText(
  name: string,
  draft: string,
  texts: Record<string, string>
): boolean {
  const edit = texts[name];
  return edit !== undefined && edit.trim() !== draft.trim();
}

export function isEdited(
  pick: PostPick,
  texts: Record<string, string>
): boolean {
  return editedText(pick.name, pick.reply?.text ?? '', texts);
}

/** Null when an active item's edit is empty: an empty reply cannot post. */
function sendableTexts(
  items: Array<{ name: string; draft: string; active: boolean }>,
  texts: Record<string, string>
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const it of items) {
    if (!it.active) continue;
    const edit = texts[it.name];
    if (edit === undefined) continue;
    if (edit.trim() === '') return null;
    if (editedText(it.name, it.draft, texts)) out[it.name] = edit.trim();
  }
  return out;
}

export function postTexts(
  picks: PostPick[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  return sendableTexts(
    picks.map(p => {
      const v = selections[p.name];
      return {
        name: p.name,
        draft: p.reply?.text ?? '',
        active: Array.isArray(v) && v.includes(p.post),
      };
    }),
    texts
  );
}

/** A respond-plan thread whose reply is shown verbatim: the only kind the
    developer can edit before it posts. */
export interface PlanReply {
  name: string;
  label: string;
  draft: string;
  value: string;
}

export function planReplies(questions: GateQuestion[]): PlanReply[] {
  return questions.flatMap(q => {
    if (q.multi) return [];
    const ctx = parseGateCtx(q.context);
    if (ctx?.shape !== 'thread@1' || ctx.reply.kind !== 'verbatim') return [];
    const value = q.options.map(optionValue).find(v => v.startsWith('reply:'));
    return value ? [{ name: q.id, label: q.label, draft: ctx.reply.text, value }] : [];
  });
}

export function planTexts(
  replies: PlanReply[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  return sendableTexts(
    replies.map(r => ({
      name: r.name,
      draft: r.draft,
      active: selections[r.name] === r.value,
    })),
    texts
  );
}
```

(Check the `ThreadCtx` type in `gate-ctx.ts`: if a `reply` with kind `none` has no `text`, narrow before reading it.)

- [ ] **Step 4: Wire the sheet** in `RespondSheetBody`:
  - `const planReplyList = useMemo(() => (plan ? planReplies(gate.questions) : []), [plan, gate.questions]);`
  - `const edits = plan ? planTexts(planReplyList, form.selections, form.texts) : postTexts(picks, form.selections, form.texts);` (the existing payload expression already turns `null` into a disabled submit and passes `edits` to `sheetAnswers`; revise mode keeps using `reviseAnswers`, which sends no `text`).
  - Plan card (the `!q.multiple` branch that renders `<ThreadCard ctx={qctx} />`): when `planReplyList` has an entry for `q.name`, render `<ThreadCard ctx={{ ...qctx, reply: { kind: 'none' } }}>` with an `EditableReply` child: `label={q.prompt}`, `draft={pr.draft}`, `value={form.texts[q.name]}`, `canEdit={form.selections[q.name] === pr.value}`, `onChange={t => form.setText(q.name, t)}`, `onReset={() => form.clearText(q.name)}`; add `<EditedChip />` after the `SeverityPill` when `editedText(q.name, pr.draft, form.texts)`. Other cards render as today.
  - Dock copy: count `replies` as `mainQs` single-selects whose selection starts with `reply:`; `nextStep` is `Next, ${fixes} ${fixes === 1 ? 'fix gets' : 'fixes get'} implemented, then you approve the fixed replies before anything posts.` when `fixes > 0`, else `Next, ${replies} ${replies === 1 ? 'reply posts' : 'replies post'}.` when `replies > 0`, else `Next, nothing posts.`.
  - Empty-reply reason: show it only when `!revising && edits === null`, reading `a reply is empty: write it or skip the thread` on a plan gate and the existing `a reply is empty: write it or hold the thread` on a post gate.
- [ ] **Step 5: Gates and captures.** `bun run board:typecheck && bun run board:test && bun run format:check && sh scripts/repo-purity.sh`, then `bun run --cwd apps/board capture:compare` (re-pin only the plan-step shots this moves, and name them).
- [ ] **Step 6: Look at it.** Fixture board (`BOARD_FIXTURE=<tree>/apps/board/tests/fixture PORT=7941 bun run src/server.ts` from `apps/board`), Fast Browser only on the raw port, the respond-plan gate in the decision queue: a `reply:` card at rest, editing, and edited with its chip, and the dock copy for replies-only and with a fix; light and dark (`mrs-theme`), 1440x900. Look at each and report what reads wrong.
- [ ] **Step 7: Commit** `board: gate 1's replies are editable; the dock says what posts next`, with the trailer line.

### Task 4: the board:respond wrapper opens gate 2 only for fixed threads (apps)

**Files:**
- Modify: `apps/board/skills/respond/SKILL.md` (steps 5-7, the `respond-post` resume bullet, "Gate protocol (both gates)")
- Create: `docs/superpowers/tests/2026-09-23-respond-post-fixed-only/scenarios/wrap-*.md` and `board-respond.md` beside them

**Interfaces:**
- Consumes: receive-review's Task 1 contract (gate 2 offers fixed threads only; reply-only threads post from gate 1; with nothing offered it posts the replies and hands back no open).

- [ ] **Step 1: Load skills** (`superpowers:writing-skills`, `mattstack:editing-skills`).
- [ ] **Step 2: Scenarios**, modeled on `docs/superpowers/tests/2026-09-22-respond-post-per-thread/scenarios/wrap-counts.md` (invented data):
  - `wrap-replies-only.md`: the generic no-domain-skill path with a plan answer of two `reply:` threads (one with `text`) and `code-changes: skip`. Pass: no Gate 2 opens; both replies post (the edited one as edited); `respond-status ... done ... --posted 2 --threads 2`.
  - `wrap-fix-and-reply.md`: one `fix:` and one `reply:`, `code-changes: approve`, then a Gate 2 answer for the fixed thread only. Pass: Gate 2 offers only the fixed thread; the reply-only thread posts after Gate 2; `--posted 2`.
  - `wrap-resume-post.md`: a `respond-post` resume after a restart, the report carrying a reply-only thread's edited text. Pass: it posts the reply-only thread with the edited text alongside the Gate 2 picks.
- [ ] **Step 3: RED.** 5 reps each on the current wrapper, as `docs/superpowers/tests/2026-09-22-respond-post-per-thread/board-respond.md` describes. Expected: Gate 2 opens over reply-only threads.
- [ ] **Step 4: Edit the wrapper** so its Gate 2 section, resume bullet and counts say what the spec says: Gate 2 only for threads fixed in step 5; reply-only threads post from Gate 1's answer (`text` when present) after Gate 2, or right away when nothing is offered; `--posted` counts every thread that got a reply; `--held` counts `skip:` threads, fixes held out under `code-changes: skip`, and Gate 2 holds.
- [ ] **Step 5: GREEN.** 5 reps each of the three new scenarios (5/5 strict), then 5 reps each of `wrap-build`, `wrap-counts`, `wrap-none`, `wrap-edited` from the per-thread and edited-text records, updating any whose premise this retires and saying so.
- [ ] **Step 6: Gates.** `bun run board:test && bun run format:check && sh scripts/repo-purity.sh`; read the whole wrapper file with the Read tool.
- [ ] **Step 7: Commit** `board:respond: gate 2 only for fixed threads; replies post from gate 1`, with the trailer line.

### Checkpoint B (controller)

Final whole-branch review on the most capable model; screenshots looked at by the controller. Rebase on `origin/main`, push, open the apps PR, CodeRabbit (or an Opus reviewer) plus CI, merge with Matt's confirmation after Checkpoint A has shipped the skills side. Deploy: pull the canonical apps checkout, `bun run tui-kit:build`, `bun run board:build`, `deck restart board`.
