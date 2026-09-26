# Editable Post Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the board's respond post step, the developer can edit a drafted reply before it posts, and the edited text is what reaches the forge.

**Architecture:** A gate answer's object form gains an optional `text` field (`{value, note?, text?}`), declared and validated in `@mattstack/rt-client`. The board's post card gets an edit button that writes a per-thread edit into the gate form and its draft; the sheet sends `{value, text}` for an edited thread that posts. receive-review and the board:respond wrapper post the answer's `text` in place of the drafted reply and record it.

**Tech Stack:** Bun, TypeScript, React 19 (board client), bun:test + happy-dom (board), vitest (gate-kit), Markdown skills compiled by `rt skills compile`.

**Spec:** `docs/superpowers/specs/2026-09-22-editable-post-replies-design.md` (this repo). Read it before any task.

## Repos and trees

This plan spans three repos, shipped in this order (readers before the writer):

| Part | Repo | Tree |
|---|---|---|
| A (Task 1) | `~/Documents/GitHub/repo-tools` (GitHub `m4ttstack/rt`, rt repo name `rt`) | `rt worktree provision --repo rt --branch answer-text-field --owner claude --json` |
| B (Task 2) | `~/Documents/GitHub/mattstack-skills` (rt identity `remote:github.com%2Fm4ttstack%2Fskills`) | `rt worktree provision --repo "remote:github.com%2Fm4ttstack%2Fskills" --branch respond-post-edited-text --owner claude --json` |
| C (Tasks 3-6) | this repo | this worktree, branch `editable-post-replies` |

Tasks 1 and 2 touch different repos and may run in parallel. Task 3 cannot start until Checkpoint A has published `@mattstack/rt-client@0.30.0`. Work in a provisioned tree by absolute path; never edit a canonical checkout (`~/Documents/GitHub/<repo>`) and never a plugin cache.

## Global Constraints

- The answer object form is exactly `{ value: string | string[]; note?: string; text?: string }`. `note` never replaces anything; `text` is replacement text for something the gate offered.
- Validator error strings, verbatim: `question <id> text must be a string`, `question <id> text must not be empty` (whitespace-only is empty).
- `@mattstack/rt-client` goes `0.29.0` -> `0.30.0`. The apps root catalog pins it exactly: `"@mattstack/rt-client": "0.30.0"`.
- A thread sends `text` only when its selection includes `post:<id>` and its trimmed edit differs from the trimmed draft; the sent `text` is the trimmed edit.
- Decision record entry for an edited, posted thread: `{"post": true, "resolve": <bool>, "text": "<the text that posted>"}`; unedited entries stay `{post, resolve}`.
- The in-pane form never sends `text`; only the board edits.
- Chip line with edits: `N posted (E edited), M resolved, K held`; `(E edited)` only when E > 0.
- Follow `~/.claude/rules/no-em-dashes.md`: no em or en dashes anywhere (code, comments, docs, commits), and none of the phrases it bans.
- Comments state constraints the code cannot show; never narrate, never cite tasks or reviews.
- Public repos: invented data only (no real people's names, no employer terms, no internal ticket ids in content).
- UI: read `docs/ui-authoring.md` before writing CSS; role tokens only; font weights 400, 500, 700 only.
- Board gates: `bun run tui-kit:build` before any board typecheck or test. Every apps task runs `bun run format:check` and `sh scripts/repo-purity.sh`.
- Skill edits: load `superpowers:writing-skills` and `mattstack:editing-skills` first; baseline before editing; `sh tests/certify.sh <dir>` exits 0; read compiled output in full (no grep).
- Implementers never push, merge, publish, or release. Commit on the task's branch only.
- Every commit ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- An edit, then hold, then post again: the edit survives and is what posts (Task 5 test).
- An edit whose trimmed text equals the draft sends no `text` and shows no `edited` chip (Task 4 helper test, Task 5 chip test).
- A stored draft from before this change (no `texts` key) restores its picks and notes unchanged (Task 3 draft test).
- Escape in the reply box collapses the box and never closes the sheet (Task 5 test).
- A whitespace-only edit blocks submit on a posting thread and does not block it on a held thread (Task 4 test).

---

### Task 1: rt-client answer `text` field (repo-tools)

**Files:**
- Modify: `packages/rt-client/src/commands.ts:136` (the `GateAnswer` interface)
- Modify: `packages/rt-client/src/gate-answers.ts`
- Modify: `packages/rt-client/package.json` (`"version": "0.30.0"`)
- Modify: `lib/mcp/tools.ts:133-147` (`ANSWER_VALUE_SCHEMA`)
- Test: `packages/rt-client/test/gate-answers.test.ts`, `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Produces: `GateAnswer['answers'][string]` accepts `{ value: string | string[]; note?: string; text?: string }`; `validateGateAnswers` returns the two new error strings above.

- [ ] **Step 1: Provision the tree** (see "Repos and trees"). All paths below are relative to it.

- [ ] **Step 2: Write the failing tests.** Append inside `describe("unwrapGateAnswerValue", ...)`:

```ts
  test("text form unwraps", () => expect(unwrapGateAnswerValue({ value: ["a"], text: "x" })).toEqual(["a"]));
```

Append inside `describe("validateGateAnswers", ...)`:

```ts
  test("text-form values validate by inner value", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a"], text: "edited reply" } })).toBeNull();
  });
  test("text rides beside a note", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: "n", text: "t" } })).toBeNull();
  });
  test("non-string text", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", text: 5 } })).toBe("question verdict text must be a string");
  });
  test("whitespace-only text is empty", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", text: "  \n" } })).toBe("question verdict text must not be empty");
  });
```

In `lib/mcp/__tests__/tools.test.ts`, inside `describe("mcpTools", ...)`:

```ts
  test("gate_answer's object answer form accepts text beside note", () => {
    const tool = mcpTools().find((t) => t.name === "gate_answer")!;
    const schema = tool.inputSchema as {
      properties: { answers: { additionalProperties: { oneOf: Array<{ type: string; properties?: Record<string, unknown> }> } } };
    };
    const objectForm = schema.properties.answers.additionalProperties.oneOf.find((b) => b.type === "object")!;
    expect(Object.keys(objectForm.properties!)).toEqual(["value", "note", "text"]);
  });
```

- [ ] **Step 3: Run them to see them fail.**

Run: `bun test packages/rt-client/test/gate-answers.test.ts lib/mcp/__tests__/tools.test.ts`
Expected: FAIL on "non-string text", "whitespace-only text is empty", and the schema keys test (the others already pass because unknown keys are ignored today).

- [ ] **Step 4: Implement.** In `commands.ts:136` change the answer union member to `{ value: string | string[]; note?: string; text?: string }`. In `gate-answers.ts`, replace `wrapperNoteIsValid` and its call with:

```ts
/** Both wire shapes carry the same value underneath: bare, or {value,
    note?, text?} when a panel attaches free text or a replacement for text
    the gate offered. Validation reads only the value. */
```

(this replaces the doc comment on `unwrapGateAnswerValue`), and:

```ts
function wrapperFieldError(qid: string, raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("value" in (raw as Record<string, unknown>))) {
    return null;
  }
  const { note, text } = raw as Record<string, unknown>;
  if (note !== undefined && typeof note !== "string") return `question ${qid} note must be a string`;
  if (text !== undefined && typeof text !== "string") return `question ${qid} text must be a string`;
  if (typeof text === "string" && text.trim() === "") return `question ${qid} text must not be empty`;
  return null;
}
```

and in `validateGateAnswers` replace `if (!wrapperNoteIsValid(raw)) return \`question ${qid} note must be a string\`;` with:

```ts
    const wrapperError = wrapperFieldError(qid, raw);
    if (wrapperError) return wrapperError;
```

In `lib/mcp/tools.ts` `ANSWER_VALUE_SCHEMA`'s object branch, add `text: { type: "string" },` after `note: { type: "string" },`. Bump `packages/rt-client/package.json` to `"version": "0.30.0"`.

- [ ] **Step 5: Rebuild dist and run the suites.**

Run: `cd packages/rt-client && bun run build && bun run check-types && cd ../.. && bun test packages lib/mcp`
Expected: PASS, including `packages/rt-client/test/dist-freshness.test.ts`.

- [ ] **Step 6: Commit.**

```bash
git add packages/rt-client/src/commands.ts packages/rt-client/src/gate-answers.ts packages/rt-client/package.json packages/rt-client/test/gate-answers.test.ts lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts
git commit -m "rt-client: gate answers carry an optional text replacement (0.30.0)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint A (controller, not an implementer task)

1. Push `answer-text-field`, open a PR on `m4ttstack/rt`, wait for CodeRabbit (an Opus reviewer when it is rate-limited) and CI; address every actionable finding.
2. Merge only with Matt's confirmation.
3. Publish from repo-tools `main` only, per repo-tools' CLAUDE.md "Publishing `@mattstack/rt-client` is release-class": pull `main`, `cd packages/rt-client && bun run build`, grep `dist/index.js` and `dist/gate.js` for `text must not be empty`, then `npm publish` with an OTP from `bw` (Matt unlocks the vault). Allow 3-5 minutes of registry lag, then confirm `npm view @mattstack/rt-client@0.30.0 version`.
4. The daemon picks up the validator on the next rt release; nothing here waits on it (an older daemon stores `text` untouched).

### Task 2: receive-review posts the answer's text (mattstack-skills)

**Files:**
- Modify: `attachments/gate-protocol/SKILL.md` ("## Answers are option values")
- Modify: `attachments/review/receive-review/SKILL.md` (step 6 act paragraph and decision record paragraph)
- Modify: `.claude-plugin/plugin.json` (`0.17.23` -> `0.17.24`), `CERTIFICATION.md` (one row each for receive-review and gate-protocol, appended directly under the last table row with no blank line)
- Create: `docs/superpowers/tests/2026-09-22-respond-post-edited-text/red-green.md`, `.../scenarios/post-act-edited.md`

**Interfaces:**
- Consumes: the answer object form from Task 1 (`text` beside `value`).
- Produces: receive-review posts `text` for a posted thread and records it.

- [ ] **Step 1: Load skills and provision.** Load `superpowers:writing-skills` and `mattstack:editing-skills`. Provision the tree (see "Repos and trees").

- [ ] **Step 2: Write the scenario.** Create `scenarios/post-act-edited.md` by copying `docs/superpowers/tests/2026-09-22-respond-post-per-thread/scenarios/post-act.md` verbatim, then replace its answer line with:

```
{"thread-1": {"value": ["post:T1", "resolve:T1"], "text": "Fixed in ab12cd3: enqueue() now drops non-retryable jobs before the retry loop, with a test."}, "thread-2": ["resolve:T2"], "thread-3": ["post:T4"], "next": "proceed"}
```

Pass criteria for the record: T1's posted reply is exactly the answer's `text` (not the drafted `reply@1` text) and T1 resolves; T2 resolves without a post; T4 posts its drafted text; the decision record carries `"T1": {"post": true, "resolve": true, "text": "Fixed in ab12cd3: ..."}` and no `text` on T2 or T4.

- [ ] **Step 3: RED.** Build the preview system file the way `docs/superpowers/tests/2026-09-22-respond-post-per-thread/respond-post.md` describes (rsync the tree to a scratch dir, roster receive-review in `pack/stubs.jsonc`, `rt skills compile --pack-dir <copy> --verb receive-review --preview`). Run 5 reps: `claude --model sonnet --tools "" --strict-mcp-config --append-system-prompt-file <system-file> -p "$(cat scenarios/post-act-edited.md)"`, a fresh empty directory per rep. Score by hand against the criteria; record each rep's T1 body and record entry. Expected: FAIL (the drafted text posts, or the record lacks `text`).

- [ ] **Step 4: Edit gate-protocol.** In "## Answers are option values", after the sentence ending `` `{"value": <verbatim value or array>, "note": "<free text>"}`. ``, add:

```
A surface that lets the human replace text the gate offered (an edited
reply) sends it as `text` on the same object, beside any note:
`{"value": <verbatim value or array>, "text": "<replacement>"}`. The
note never replaces anything; `text` replaces only what the verb's own
act step names.
```

- [ ] **Step 5: Edit receive-review step 6.** In the act paragraph, change `(a `{value, note}` object unwraps to its `value`; the note rides the decision record and never edits the approved reply)` to `(a `{value, note, text}` object unwraps to its `value`; the note rides the decision record and never edits the reply)`, and change `` `post:<threadId>` posts that thread's reply; `` to:

```
`post:<threadId>` posts that thread's reply, which is the answer's
`text` when it carries one and the `reply@1` context's `text` otherwise
(`text` on a thread with no `post:` posts nothing);
```

In the decision record paragraph, after `--decided-by <the answer's by>`. `, add: `An entry whose posted reply came from the answer's `text` adds it: `{"post":true,"resolve":true,"text":"<the text that posted>"}`.` Reflow both paragraphs to the file's existing wrap width.

- [ ] **Step 6: GREEN.** Recompile the preview and re-run 5 reps of `post-act-edited`. Expected: 5/5 meet every criterion. Then re-run 5 reps each of the existing `post-build`, `post-act`, `post-resume`, and `post-none` scenarios from `docs/superpowers/tests/2026-09-22-respond-post-per-thread/scenarios/` against the new system file. Expected: 5/5 each, as recorded there. Close any loophole a rep shows, and re-run.

- [ ] **Step 7: Certify and record.**

Run: `sh tests/certify.sh attachments/review/receive-review && sh tests/certify.sh attachments/gate-protocol && sh tests/repo-purity.sh`
Expected: exit 0 each. Bump `.claude-plugin/plugin.json` to `0.17.24`; add the two `CERTIFICATION.md` rows; write `red-green.md` (method, scenario, RED and GREEN tallies, the regression tallies). Read the final preview-compiled receive-review in full with the Read tool and confirm the act and record paragraphs read as one flow.

- [ ] **Step 8: Commit.**

```bash
git add attachments/gate-protocol/SKILL.md attachments/review/receive-review/SKILL.md .claude-plugin/plugin.json CERTIFICATION.md docs/superpowers/tests/2026-09-22-respond-post-edited-text
git commit -m "receive-review: post an answer's edited text and record it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint B (controller)

Merge `respond-post-edited-text` into skills `main` with Matt's confirmation, push, `rt skills sync --pack mattstack`, then `rt skills sync` for each other compiled pack. Diff each pack's cache versions with version stamps masked; read every file whose content changed in full. Dispose the tree.

### Task 3: pin rt-client 0.30.0 and teach gate-kit `text` (apps)

**Files:**
- Modify: `package.json` (catalog `"@mattstack/rt-client": "0.30.0"`), `bun.lock` (via `bun install`)
- Modify: `packages/gate-kit/src/payload.ts` (`UnwrappedGateAnswer`, `unwrapGateAnswer`)
- Modify: `packages/gate-kit/src/summary.ts` (`GateSummaryDetailRow.text`, detail rows, chip edited count)
- Modify: `packages/gate-kit/src/react/draft.ts` (`GateDraft.texts`)
- Test: `packages/gate-kit/test/payload.test.ts`, `summary.test.ts`, `draft.test.tsx`

**Interfaces:**
- Consumes: `@mattstack/rt-client@0.30.0` (Checkpoint A).
- Produces: `UnwrappedGateAnswer { value: string | string[]; note?: string; text?: string }`; `GateSummaryDetailRow.text?: string`; `GateDraft.texts?: Record<string, string>` (optional, so the console's draft callers compile unchanged).

- [ ] **Step 1: Pin and install.** Set the catalog entry to `"0.30.0"`, run `bun install` at the repo root, and confirm `node_modules/@mattstack/rt-client/package.json` reads `0.30.0`.

- [ ] **Step 2: Write the failing tests.** `payload.test.ts`:

```ts
test('the text form unwraps with its text beside the value', () => {
  expect(unwrapGateAnswer({ value: ['post:T1'], text: 'edited' })).toEqual({
    value: ['post:T1'],
    text: 'edited',
  });
});
```

`summary.test.ts`, beside "per-thread post questions add up across threads":

```ts
  test('an edited posted thread counts on the chip and carries its text in the detail', () => {
    const thread = (n: number, t: string): GateQuestion => ({
      id: `thread-${n}`,
      label: `${t}.ts:1`,
      multi: true,
      options: [
        { value: `post:${t}`, label: 'Post' },
        { value: `resolve:${t}`, label: 'Resolve' },
      ],
    });
    const { chip, detail } = answeredGateSummary({
      subject:
        'mr:https://gitlab.example.invalid/group/proj/-/merge_requests/87',
      kind: 'respond-post',
      status: 'answered',
      questions: [thread(1, 'T1'), thread(2, 'T2'), thread(3, 'T3')],
      answer: {
        answers: {
          'thread-1': {
            value: ['post:T1', 'resolve:T1'],
            text: 'edited reply',
          },
          'thread-2': ['post:T2'],
          'thread-3': [],
        },
        by: 'board',
        answeredAt: 1,
      },
    });
    expect(chip).toBe(
      'respond !87 · 2 posted (1 edited), 1 resolved, 1 held · by board'
    );
    expect(detail.find(d => d.id === 'thread-1')!.text).toBe('edited reply');
    expect(detail.find(d => d.id === 'thread-2')!.text).toBeUndefined();
  });
```

`draft.test.tsx`, inside its existing describe block (it already has `DRAFT`, `renderHook`, `act`, `gateDraftKey`, `useGateDraft`):

```ts
  test('texts round-trip, and a draft stored before texts existed still restores', () => {
    const withTexts: GateDraft = { ...DRAFT, texts: { flags: 'edited' } };
    const first = renderHook(() => useGateDraft('g-texts', true));
    act(() => first.result.current.save(withTexts));
    const again = renderHook(() => useGateDraft('g-texts', true));
    expect(again.result.current.initial).toEqual(withTexts);
    localStorage.setItem(gateDraftKey('g-old'), JSON.stringify(DRAFT));
    const old = renderHook(() => useGateDraft('g-old', true));
    expect(old.result.current.initial).toEqual(DRAFT);
  });

  test('an edit alone keeps the draft', () => {
    const { result } = renderHook(() => useGateDraft('g-edit', true));
    act(() =>
      result.current.save({
        selections: {},
        notes: {},
        texts: { q: 'e' },
        item: null,
      })
    );
    expect(localStorage.getItem(gateDraftKey('g-edit'))).not.toBeNull();
  });
```

- [ ] **Step 3: Run them to see them fail.**

Run: `bun run gate-kit:test`
Expected: FAIL on the four new tests.

- [ ] **Step 4: Implement.** `payload.ts`: add `text?: string;` to `UnwrappedGateAnswer`; in `unwrapGateAnswer` return `{ value, note: raw.note, ...(raw.text !== undefined ? { text: raw.text } : {}) }`; mention the text form in both doc comments (`{value, note, text}`). `summary.ts`: add `text?: string;` to `GateSummaryDetailRow`; in the detail map add `...(unwrapped?.text !== undefined ? { text: unwrapped.text } : {}),`; in the pairs loop keep the unwrapped answer and count `edited` when a posted thread's answer has `text`:

```ts
      let posted = 0;
      let edited = 0;
      let resolved = 0;
      for (const q of pairs) {
        const raw = answers?.[q.id];
        const unwrapped = raw === undefined ? null : unwrapGateAnswer(raw);
        const value = unwrapped?.value ?? [];
        const picked = Array.isArray(value) ? value : [value];
        if (picked.some(v => v.startsWith('post:'))) {
          posted++;
          if (unwrapped?.text !== undefined) edited++;
        }
        if (picked.some(v => v.startsWith('resolve:'))) resolved++;
      }
      fragments.push(
        [
          edited > 0 ? `${posted} posted (${edited} edited)` : `${posted} posted`,
          resolved > 0 ? `${resolved} resolved` : null,
          posted < pairs.length ? `${pairs.length - posted} held` : null,
        ]
          .filter(Boolean)
          .join(', ')
      );
```

`draft.ts`: add `texts?: Record<string, string>;` to `GateDraft` (update its doc comment: picks, notes, edited texts, step); in `parseDraft` read `texts`, reject a present non-object, copy string entries into `draft.texts` only when the stored draft had a `texts` object; in `draftIsEmpty` treat any `texts` key as content (`const edited = Object.keys(draft.texts ?? {}).length > 0;` and return `!picked && !noted && !edited`).

- [ ] **Step 5: Run the gates.**

Run: `bun run gate-kit:test && (cd packages/gate-kit && bun run typecheck) && bun run tui-kit:build && bun run board:typecheck && bun run console:typecheck && bun run format:check && sh scripts/repo-purity.sh`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add package.json bun.lock packages/gate-kit
git commit -m "gate-kit: carry an answer's text through unwrap, summary, and draft

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: the sheet sends an edited thread's text (apps)

**Files:**
- Modify: `apps/board/src/client/board/GateForm.tsx` (`useGateForm` texts state; `SummaryDetail` shows `row.text`)
- Modify: `apps/board/src/client/board/respond-post.ts` (`postTexts`, `isEdited`)
- Modify: `apps/board/src/client/board/RespondSheet.tsx` (`sheetAnswers` texts param; payload wiring)
- Test: `apps/board/src/client/board/__tests__/respond-post.test.ts`, `respond-sheet-dom.test.tsx`

**Interfaces:**
- Consumes: `GateDraft.texts`, `GateSummaryDetailRow.text` (Task 3); `PostPick` (existing).
- Produces: `GateFormState` gains `texts: Record<string, string>`, `setText(name: string, value: string): void`, `clearText(name: string): void`; `postTexts(picks: PostPick[], selections: GateSelections, texts: Record<string, string>): Record<string, string> | null`; `isEdited(pick: PostPick, texts: Record<string, string>): boolean`; `sheetAnswers(gate, shown, selections, notes, texts?: Record<string, string>)`.

- [ ] **Step 1: Write the failing helper tests** in `respond-post.test.ts`:

```ts
const pick = (name: string, id: string, text: string): PostPick => ({
  name,
  threadId: id,
  label: `${id}.ts:1`,
  reply: { thread: id, file: `${id}.ts:1`, verb: 'reply', text },
  post: `post:${id}`,
  resolve: `resolve:${id}`,
  defaults: [`post:${id}`],
});

test('postTexts sends a trimmed edit only for a posting thread whose edit differs', () => {
  const picks = [pick('thread-1', 'T1', 'draft one'), pick('thread-2', 'T2', 'draft two'), pick('thread-3', 'T3', 'draft three')];
  const selections = { 'thread-1': ['post:T1'], 'thread-2': ['resolve:T2'], 'thread-3': ['post:T3'] };
  const texts = { 'thread-1': '  edited one \n', 'thread-2': 'held edit', 'thread-3': ' draft three ' };
  expect(postTexts(picks, selections, texts)).toEqual({ 'thread-1': 'edited one' });
});

test('postTexts is null when a posting thread was emptied, never when a held one was', () => {
  const picks = [pick('thread-1', 'T1', 'd1'), pick('thread-2', 'T2', 'd2')];
  expect(postTexts(picks, { 'thread-1': ['post:T1'], 'thread-2': [] }, { 'thread-1': '   ' })).toBeNull();
  expect(postTexts(picks, { 'thread-1': [], 'thread-2': [] }, { 'thread-1': '   ' })).toEqual({});
});

test('isEdited ignores surrounding whitespace', () => {
  const p = pick('thread-1', 'T1', 'draft');
  expect(isEdited(p, {})).toBe(false);
  expect(isEdited(p, { 'thread-1': ' draft\n' })).toBe(false);
  expect(isEdited(p, { 'thread-1': 'draft, edited' })).toBe(true);
});
```

and the DOM tests in `respond-sheet-dom.test.tsx`, beside the per-thread tests (they seed the draft the way `DecisionQueueModal.stories.tsx` does, through `gateDraftKey`):

```tsx
const seedTexts = (texts: Record<string, string>, selections?: Record<string, string[]>) =>
  localStorage.setItem(
    `gate-kit:draft:g-post-threads`,
    JSON.stringify({
      selections: selections ?? { 'thread-1': ['post:r1', 'resolve:r1'], 'thread-2': ['post:r2'] },
      notes: {},
      texts,
      item: null,
    })
  );

test('an edited posting thread answers with its text; the others stay bare', async () => {
  seedTexts({ 'thread-1': '  Fixed, and the retry is now bounded.  ' });
  await render(perThreadPostGate(), withFixPlan());
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post-threads',
    answers: {
      'thread-1': { value: ['post:r1', 'resolve:r1'], text: 'Fixed, and the retry is now bounded.' },
      'thread-2': ['post:r2'],
    },
  });
});

test('a held thread keeps its edit out of the answer', async () => {
  seedTexts({ 'thread-2': 'edited but held' }, { 'thread-1': ['post:r1'], 'thread-2': [] });
  await render(perThreadPostGate(), withFixPlan());
  await clickSubmit();
  expect(answer()).toEqual({
    gateId: 'g-post-threads',
    answers: { 'thread-1': ['post:r1'], 'thread-2': [] },
  });
});

test('an emptied reply on a posting thread disables submit', async () => {
  seedTexts({ 'thread-2': '   ' });
  await render(perThreadPostGate(), withFixPlan());
  expect(submit().disabled).toBe(true);
});
```

Create `apps/board/src/client/board/__tests__/answered-chip-text-dom.test.tsx`:

```tsx
/** The answered chip counts an edited reply and shows the text that
    posted, once, in its detail. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { AnsweredChip } from '../GateForm.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

const thread = (n: number, t: string) => ({
  id: `thread-${n}`,
  label: `${t}.ts:1`,
  multi: true,
  options: [
    { value: `post:${t}`, label: 'Post' },
    { value: `resolve:${t}`, label: 'Resolve' },
  ],
});

test('an edited reply counts on the chip and shows once in the detail', async () => {
  await React.act(async () => {
    root.render(
      <AnsweredChip
        startOpen
        row={{
          subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
          kind: 'respond-post',
          status: 'answered',
          questions: [thread(1, 'T1'), thread(2, 'T2')],
          answer: {
            answers: {
              'thread-1': { value: ['post:T1'], text: 'Edited reply.' },
              'thread-2': ['post:T2'],
            },
            by: 'board',
          },
        }}
      />
    );
  });
  const text = container.textContent ?? '';
  expect(text).toContain('2 posted (1 edited)');
  expect(text.split('edited reply: Edited reply.').length - 1).toBe(1);
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `bun run tui-kit:build && cd apps/board && bun test src/client/board/__tests__/respond-post.test.ts src/client/board/__tests__/respond-sheet-dom.test.tsx src/client/board/__tests__/answered-chip-text-dom.test.tsx`
Expected: FAIL (`postTexts` and `isEdited` undefined; answers lack `text`; submit enabled; no edited reply line).

- [ ] **Step 3: Implement.** `respond-post.ts`:

```ts
/** A thread's edit counts only when it differs from the drafted reply once
    surrounding whitespace is ignored. */
export function isEdited(
  pick: PostPick,
  texts: Record<string, string>
): boolean {
  const edit = texts[pick.name];
  return edit !== undefined && edit.trim() !== (pick.reply?.text ?? '').trim();
}

/** The trimmed edit each posting thread sends, keyed by question id. Null
    when a posting thread's edit is empty: an empty reply cannot post, and
    holding the thread is how nothing posts. */
export function postTexts(
  picks: PostPick[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const p of picks) {
    const v = selections[p.name];
    if (!Array.isArray(v) || !v.includes(p.post)) continue;
    const edit = texts[p.name];
    if (edit === undefined) continue;
    if (edit.trim() === '') return null;
    if (isEdited(p, texts)) out[p.name] = edit.trim();
  }
  return out;
}
```

`GateForm.tsx` `useGateForm`: add `const [texts, setTexts] = useState<Record<string, string>>(() => draft?.texts ?? {});`, save `{ selections, notes, texts, item: step }` (and add `texts` to that effect's deps), add

```ts
  const setText = (name: string, value: string) =>
    setTexts(prev => ({ ...prev, [name]: value }));
  const clearText = (name: string) =>
    setTexts(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
```

clear texts in `resetAll` (`setTexts({})`), and return `texts, setText, clearText` beside `notes, setNote`. In `SummaryDetail`, after the `row.note` block, render:

```tsx
            {row.text && (
              <div className="tui-gate-summary-note" data-edited-reply="">
                edited reply: {row.text}
              </div>
            )}
```

`RespondSheet.tsx`: give `sheetAnswers` a fifth parameter `texts: Record<string, string> = {}` and build each answer as

```ts
    const note = id in sel ? (notes[id] ?? '').trim() : '';
    const text = texts[id];
    answers[id] =
      note || text
        ? { value, ...(note ? { note } : {}), ...(text ? { text } : {}) }
        : value;
```

(update its doc comment: an edited posting thread's trimmed text rides as `text`). In `RespondSheetBody`, after `const shown = ...`, add `const edits = postTexts(picks, form.selections, form.texts);` and make the non-revising payload `edits === null ? null : sheetAnswers(gate, shown, submitSelections, form.notes, edits)`.

- [ ] **Step 4: Run the gates.**

Run: `bun run board:typecheck && bun run board:test && bun run format:check && sh scripts/repo-purity.sh`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/board/src/client/board
git commit -m "board: an edited posting thread answers with its text

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: edit button, text box, and edited chip on the post card (apps)

**Files:**
- Modify: `apps/board/src/client/board/RespondCards.tsx` (new `EditableReply`)
- Modify: `apps/board/src/client/board/RespondSheet.tsx` (post-step cards use it; `edited` chip in the card head; empty-reply message)
- Modify: `apps/board/src/style.css` (reply box and its actions)
- Test: `apps/board/src/client/board/__tests__/respond-sheet-dom.test.tsx`

**Interfaces:**
- Consumes: `GateFormState.texts/setText/clearText`, `isEdited` (Task 4).
- Produces: `EditableReply` exported from `RespondCards.tsx`.

- [ ] **Step 1: Read `docs/ui-authoring.md`** and the existing rules this reuses: `.tui-thread-reply*` (style.css ~2470), `.tui-gate-note` (~2525), `.tui-sheet-reset` (~4360), and the Escape pattern at `CommentsDrawer.tsx:300`.

- [ ] **Step 2: Write the failing DOM tests.**

```tsx
const editButton = (card: HTMLElement) =>
  card.querySelector<HTMLButtonElement>('button[aria-label$=": edit reply"]');
const replyBox = (card: HTMLElement) =>
  card.querySelector<HTMLTextAreaElement>('textarea[aria-label$=": reply"]');
async function typeInto(el: HTMLTextAreaElement, text: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('edit opens the reply in a box seeded with the draft; done closes it', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  expect(replyBox(reply)).toBeNull();
  await React.act(async () => editButton(reply)!.click());
  expect(replyBox(reply)!.value).toBe('The delay is fixed by design.');
  await React.act(async () => [...reply.querySelectorAll('button')].find(b => b.textContent === 'done')!.click());
  expect(replyBox(reply)).toBeNull();
});

test('a changed reply shows the edited chip and posts; reset to draft clears both', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, 'The delay is fixed by design; see retry.ts.');
  expect(reply.querySelector('[data-chip="edited"]')).not.toBeNull();
  await React.act(async () => [...reply.querySelectorAll('button')].find(b => b.textContent === 'reset to draft')!.click());
  expect(reply.querySelector('[data-chip="edited"]')).toBeNull();
  expect(replyBox(reply)!.value).toBe('The delay is fixed by design.');
});

test('an edit survives hold and back to post, and is what posts', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, 'Kept on purpose.');
  await React.act(async () => control(reply, 'hold')!.click());
  expect(editButton(reply)).toBeNull();
  await React.act(async () => control(reply, 'post')!.click());
  await clickSubmit();
  expect((answer() as { answers: Record<string, unknown> }).answers['thread-2']).toEqual({
    value: ['post:r2'],
    text: 'Kept on purpose.',
  });
});

test('an emptied reply says so on its card', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await typeInto(replyBox(reply)!, '  ');
  expect(reply.textContent).toContain('the reply is empty');
  expect(submit().disabled).toBe(true);
});

test('Escape in the reply box closes the box, not the sheet', async () => {
  await render(perThreadPostGate(), withFixPlan());
  const reply = postCards()[1]!;
  await React.act(async () => editButton(reply)!.click());
  await React.act(async () => {
    replyBox(reply)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(replyBox(reply)).toBeNull();
  expect(document.body.querySelector('.tui-gate-sheet')).not.toBeNull();
});

test('a card whose reply did not fit the gate offers no edit', async () => {
  const gate = perThreadPostGate();
  gate.questions = [
    { ...gate.questions[0]!, context: undefined },
    gate.questions[1]!,
  ];
  await render(gate);
  const [unfit, fit] = postCards();
  expect(unfit!.textContent).toContain(
    'The reply text did not fit the gate; read it in the pane.'
  );
  expect(editButton(unfit!)).toBeNull();
  expect(editButton(fit!)).not.toBeNull();
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd apps/board && bun test src/client/board/__tests__/respond-sheet-dom.test.tsx`
Expected: FAIL (no edit button).

- [ ] **Step 4: Implement `EditableReply`** in `RespondCards.tsx` (import `useEffect`, `useState` from react and `useAutoGrowTextarea` from `@mattstack/tui-kit/hooks`):

```tsx
/** A post-step reply the developer may rewrite before it posts: the draft
    at rest, an auto-growing box while editing. `value` is the edit, absent
    when there is none; `canEdit` is false while the thread is held. */
function EditableReply({
  label,
  draft,
  value,
  canEdit,
  onChange,
  onReset,
}: {
  label: string;
  draft: string;
  value: string | undefined;
  canEdit: boolean;
  onChange: (text: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const open = editing && canEdit;
  const text = value ?? draft;
  const edited = value !== undefined && value.trim() !== draft.trim();
  const empty = canEdit && value !== undefined && value.trim() === '';
  const ref = useAutoGrowTextarea([open, text]);
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open, ref]);
  return (
    <div className="tui-thread-reply" data-kind="verbatim">
      <span className="tui-thread-reply-k">will post as reply</span>
      {open ? (
        <textarea
          ref={ref}
          className="tui-thread-reply-input"
          rows={1}
          value={text}
          aria-label={`${label}: reply`}
          onChange={e => onChange(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="tui-thread-reply-text">
          <Markdown unstyled linkTargetBlank>
            {text}
          </Markdown>
        </div>
      )}
      {empty && <span className="tui-gate-error">the reply is empty</span>}
      {canEdit && (
        <div className="tui-thread-reply-actions">
          {open ? (
            <>
              <button
                type="button"
                className="tui-thread-reply-action"
                onClick={() => setEditing(false)}
              >
                done
              </button>
              {edited && (
                <button
                  type="button"
                  className="tui-thread-reply-action"
                  onClick={onReset}
                >
                  reset to draft
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="tui-thread-reply-action"
              aria-label={`${label}: edit reply`}
              onClick={() => setEditing(true)}
            >
              edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

Export it with the others. The chip for the card head:

```tsx
function EditedChip() {
  return (
    <span className="tui-respond-chip" data-hue="accent" data-chip="edited">
      edited
    </span>
  );
}
```

(export it too).

- [ ] **Step 5: Wire the sheet.** In `RespondSheet.tsx`, add a helper inside `RespondSheetBody`:

```tsx
  const editableReply = (p: PostPick) => {
    const v = form.selections[p.name];
    const posting = Array.isArray(v) && v.includes(p.post);
    return (
      <EditableReply
        label={p.label}
        draft={p.reply!.text}
        value={form.texts[p.name]}
        canEdit={posting}
        onChange={text => form.setText(p.name, text)}
        onReset={() => form.clearText(p.name)}
      />
    );
  };
```

Joined path: give `PostStepCard` two optional props, `edited?: boolean` and `reply?: ReactNode`; when `reply` is given, pass `ThreadCard` `reply: { kind: 'none' }` and render `reply` right after the `ThreadCard`; render `<EditedChip />` after the `ThreadOutcome` when `edited`. In the `threadJoin.map`, pass `edited={pick ? isEdited(pick, form.texts) : false}` and `reply={pick?.reply ? editableReply(pick) : undefined}`. Unjoined path (`picks.map`): replace `<ReplyCard entry={p.reply} />` with `<div className="tui-thread-card">{editableReply(p)}</div>` and add `{isEdited(p, form.texts) && <EditedChip />}` after the head's `ThreadOutcome`. The legacy replies checklist (`PostChoice`) is unchanged. Remove `ReplyCard` from the imports if nothing else uses it (keep the export if other files import it; check with the typecheck).

- [ ] **Step 6: Style it** in `apps/board/src/style.css`, beside `.tui-thread-reply-k`:

```css
.tui-thread-reply-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  font: inherit;
  color: var(--text-1);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: none;
  overflow: hidden;
}
.tui-thread-reply-actions {
  display: flex;
  gap: 12px;
}
.tui-thread-reply-action {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: var(--text-4);
  cursor: pointer;
}
.tui-thread-reply-action:hover {
  color: var(--text-accent-small);
  text-decoration: underline;
}
```

Every token must exist in the board's token set; if `docs/ui-authoring.md` names a different role for an input surface or focus ring, use that and say so in the report.

- [ ] **Step 7: Run the gates and re-pin captures.**

Run: `bun run board:typecheck && bun run board:test && bun run format:check && sh scripts/repo-purity.sh`, then `cd apps/board && bun run capture:compare`; re-pin only the baselines whose post-step shots changed (`bun run capture:baseline` then keep only those files) and name them in the report.
Expected: PASS.

- [ ] **Step 8: Look at it.** Start the fixture board (`BOARD_FIXTURE=<tree>/apps/board/tests/fixture PORT=7941 bun run src/server.ts` from `apps/board`), open `http://localhost:7941/` in Fast Browser, open the decision queue, page to the respond-post gate for !1235, and screenshot at 1440x900 in light and dark (set localStorage `mrs-theme` to `light` / `dark` and reload): the card at rest, the box open, an edited card with its chip, and the empty-reply state. Look at every screenshot and list in the report anything that reads wrong (alignment with the reply label, the box against the green reply fill, the chip beside the outcome chip, contrast of the action links).

- [ ] **Step 9: Commit.**

```bash
git add apps/board/src apps/board/tests/baselines
git commit -m "board: edit a drafted reply on the post card before it posts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: the board:respond wrapper posts the answer's text (apps)

**Files:**
- Modify: `apps/board/skills/respond/SKILL.md` (step 6 "Act on the answer"; the `respond-post` resume line; "## Gate protocol (both gates)" answer reading)
- Create: `docs/superpowers/tests/2026-09-22-respond-post-per-thread/scenarios/wrap-edited.md`; append a section to `docs/superpowers/tests/2026-09-22-respond-post-per-thread/board-respond.md`

**Interfaces:**
- Consumes: the answer object form (Task 1), receive-review's rule (Task 2).

- [ ] **Step 1: Load skills.** `superpowers:writing-skills` and `mattstack:editing-skills`.

- [ ] **Step 2: Write the scenario.** Copy `scenarios/wrap-counts.md` to `scenarios/wrap-edited.md` and change it so the generic no-domain-skill path acts on a Gate 2 answer where `thread-1` is `{"value": ["post:T1"], "text": "Fixed in ab12cd3, with a test for the empty queue."}` and `thread-2` is `["post:T2"]`; ask for every forge action, in order, with each posted body, plus the `respond-status ... done` line. Pass criteria: T1's body is exactly the answer's `text`; T2's body is its report reply; `--posted 2`.

- [ ] **Step 3: RED.** Run 5 reps the way `board-respond.md` describes (the wrapper file as the system prompt, sonnet, tool-less). Expected: FAIL (T1 posts the report's reply).

- [ ] **Step 4: Edit the wrapper.** In step 6 "Act on the answer", change `` `post:<threadId>` posts that thread's reply, `` to `` `post:<threadId>` posts that thread's reply (the answer's `text` when it carries one, the report's finalized reply otherwise), ``. In the `respond-post` resume bullet, after `the wait's `{post: <answers>, by: <by>}``, add `(a thread answer's `text` replaces that thread's report reply)`. In "## Gate protocol (both gates)", change `unwrapping a `{value, note}` object to its `value`` to `unwrapping a `{value, note, text}` object to its `value`` and add after that sentence: `A Gate 2 answer's `text`, when present, is the reply to post for that thread; the note never is.` Reflow to the file's wrap width.

- [ ] **Step 5: GREEN.** Re-run 5 reps of `wrap-edited` (expected 5/5), then 5 reps each of `wrap-build`, `wrap-counts`, and `wrap-none` (expected 5/5 each, as recorded). Record the tallies in `board-respond.md`. Read the whole wrapper file with the Read tool afterwards.

- [ ] **Step 6: Run the board skill tests.**

Run: `bun run board:test && bun run format:check && sh scripts/repo-purity.sh`
Expected: PASS (`open-gate.test.ts` and any skill-text tests stay green).

- [ ] **Step 7: Commit.**

```bash
git add apps/board/skills/respond/SKILL.md docs/superpowers/tests/2026-09-22-respond-post-per-thread
git commit -m "board:respond posts an answer's edited text

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: the finished queue recaps what was decided (apps)

Added 2026-09-23 from a design pick in chat ("Recap", plus "some friendly touches"). Runs after Task 5 (both touch `apps/board/src/style.css`).

**Files:**
- Modify: `apps/board/src/client/board/decision-queue.ts` (`QueueView` exposes the answered gate ids in answer order)
- Modify: `apps/board/src/client/board/Board.tsx:1469` (hand the complete face its decided entries)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx` (`DecisionQueueComplete`)
- Modify: `packages/gate-kit/src/summary.ts` (expose the outcome fragments without the head and `by` suffix)
- Modify: `apps/board/src/style.css` (`.tui-triage-done*`)
- Modify: `apps/board/src/client/board/DecisionQueueModal.stories.tsx` (`QueueComplete` story with entries)
- Test: `packages/gate-kit/test/summary.test.ts`, `apps/board/src/client/board/__tests__/empty-queue-dom.test.tsx` (or a new `queue-complete-dom.test.tsx`)

**Interfaces:**
- Produces: `QueueView.answeredIds: string[]`; `GateSummary.outcome: string` (the chip's fragments joined, e.g. `2 posted (1 edited), 1 resolved`, with no subject head and no `by` suffix); `DecisionQueueComplete({ decided, onClose })` where `decided: Array<{ gate: GateRow; mr?: BoardMRWithReview }>` in answer order.

**Design (approved in chat):**
- Keep the full-screen `GateSheet` (the gate modal scope law); center a column about 560px wide.
- A check glyph in a round ok-tinted badge, then a heading `Queue cleared` (weight 500), then a count line: `1 decision this session` / `N decisions this session`.
- Friendly touches: the count line continues with a warm sign-off keyed by the local hour (`Enjoy the rest of your morning.` before 12, `...afternoon.` before 17, `Enjoy your evening.` after); the badge and heading ease in once (a short fade and rise, under 300ms), and `prefers-reduced-motion` turns that off.
- A recap card labelled `decided this session` (the same small-caps label style as the sheet's `decision context`): one row per decided gate, in answer order: `!iid` (mono), the gate's kind word (`domainForKind`), the MR title on one truncated line, and `summary.outcome` beneath or beside it. A gate whose row has no answer yet (poll lag) shows `answered` in the muted role; a gate with no MR shows its subject ref instead of `!iid` and title.
- The `done` button stays, below the card, focused on mount so Enter closes.
- No new colours: role tokens only, weights 400/500/700 only; read `docs/ui-authoring.md` first.

- [ ] **Step 1: Failing tests.** gate-kit: `answeredGateSummary(row).outcome` equals `'2 posted (1 edited), 1 resolved, 1 held'` for the Task 3 edited-thread fixture, and carries no subject head and no `· by` suffix. Board DOM: rendering `DecisionQueueComplete` with two decided entries (one respond gate answered with a text-edited thread, one respond-plan gate) shows `Queue cleared`, `2 decisions this session`, two recap rows carrying their `!iid` and outcome text, and the `done` button has focus; with an empty `decided` list the recap card is absent.
- [ ] **Step 2: Run them to see them fail.** `bun run gate-kit:test`; `bun run tui-kit:build` then the board test file.
- [ ] **Step 3: Implement** per the design and interfaces above.
- [ ] **Step 4: Gates.** `bun run gate-kit:test && bun run board:typecheck && bun run board:test && bun run console:typecheck && bun run format:check && sh scripts/repo-purity.sh`.
- [ ] **Step 5: Look at it.** Fixture board (`PORT=7941`), answer one gate in the decision queue so the complete face shows, screenshot at 1440x900 in light and dark (`mrs-theme`), and once with 3+ decided gates (the story or a fixture tweak). Look at each screenshot and report what reads wrong.
- [ ] **Step 6: Commit** `board: the finished decision queue recaps what was decided`, ending with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Checkpoint C (controller)

Final whole-branch review on the most capable model; screenshots looked at by the controller too. Push `editable-post-replies`, open the apps PR, CodeRabbit (or an Opus reviewer) plus CI, address findings, merge with Matt's confirmation. Deploy: pull the canonical apps checkout, `bun run tui-kit:build`, `bun run board:build`, `deck restart board`; confirm the live board on port 11006 serves the edit button.
