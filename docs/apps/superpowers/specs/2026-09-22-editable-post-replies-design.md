# Editable replies on the respond post step

Date: 2026-09-22. Status: design approved in chat, spec under review.

## Goal

On the board's respond post step (gate 2), the developer can change a
drafted reply before it posts. The reply that reaches the forge is the
edited text; everything else about the per-thread post/hold and resolve
choice stays as it shipped in apps#116 and mattstack 0.17.22.

Decided in chat:

- Editing lives on the board only. The in-pane form stays read-only and
  never sends edited text.
- Fix replies and pushback replies are both editable.
- An edit only matters when its thread is set to post.
- The card uses an edit button (not an always-open text box).
- The edited text travels in a new, declared answer field, not in `note`.

## 1. Answer contract (repo-tools, `@mattstack/rt-client`)

An answer's object form grows one optional field:

```ts
answers: Record<string, string | string[] | { value: string | string[]; note?: string; text?: string }>
```

- `text` is the answerer's replacement for text the gate offered. On a
  respond-post thread it is the reply to post in place of the drafted
  `reply@1` `text`.
- `note` keeps its meaning: a comment to the agent. It never replaces
  anything.
- `validateGateAnswers` adds two pinned error strings, checked on the
  object form only: `question <id> text must be a string` and
  `question <id> text must not be empty` (whitespace-only is empty).
- The MCP `gate_answer` tool's `ANSWER_VALUE_SCHEMA` object branch adds
  `text: { type: "string" }` (it is `additionalProperties: false` today).
- `rt-client` goes 0.29.0 -> 0.30.0 (a new optional field), published from
  repo-tools `main` per its release rules (rebuilt `dist/`, bundle grepped
  before publish). An rt release carries the validator into the daemon.

The daemon stores the answers object verbatim and every reader (`rt gate
wait`, `rt herd answer`, the MCP list) prints it verbatim, so a daemon
that has not updated yet already carries `text` untouched; it just does
not validate it.

## 2. Skills (mattstack-skills, then each compiled pack's recompile)

- **gate-protocol, "Answers are option values":** alongside the note form,
  the text form: `{"value": <verbatim value or array>, "text":
  "<replacement>"}` carries replacement text for something the gate
  offered; `note` never replaces anything.
- **receive-review step 6, act paragraph:** `post:<threadId>` posts the
  thread answer's `text` when it carries one, the `reply@1` context's
  `text` otherwise. `text` on a thread that is not posted does nothing.
  The note still never edits the reply.
- **Decision record:** an edited thread's entry adds the text that posted:
  `{threads: {T1: {post: true, resolve: true, text: "..."}}}`. Unedited
  threads keep `{post, resolve}` only.
- **In-pane form recipe:** unchanged; a pane answer never carries `text`.

## 3. Board (mattstack-apps)

**Pin:** the root catalog's `@mattstack/rt-client` goes to `0.30.0`.

**Card at rest (`RespondSheet.tsx` post step, `RespondCards.tsx`
`ReplyBlock`):** as today, plus an `edit` button after the reply text,
shown while the thread is set to post. The "reply text did not fit the
gate" fallback card has no draft to start from and gets no edit button.

**Editing:** the reply block becomes the auto-growing textarea the row
note uses (`useAutoGrowTextarea` from `@mattstack/tui-kit/hooks`), caret at
the end. `done` (or Escape) collapses it; `reset to draft` restores the
drafted text. An `edited` chip joins the card's chips whenever the
trimmed text differs from the trimmed draft.

**Persistence (gate-kit `react/draft.ts`):** `GateDraft` gains `texts:
Record<string, string>` keyed by question id, saved and restored with the
picks, so queue paging and a reload keep an edit. Reset deletes the key.

**Answer (the board's `sheetAnswers`, which already wraps notes):** a
thread whose selection includes `post:<id>` and whose text is edited
answers `{value: [...], text: <trimmed text>}`; every other thread
answers the bare array as today. A held thread keeps its edit in the
draft and sends nothing.

**Empty edit:** a thread set to post whose edited text is empty disables
submit, and the card says "the reply is empty". Hold is how nothing posts.

**Decided view (the answered chip):** `unwrapGateAnswer` carries `text`
through, and the chip's detail row for an edited thread shows the text
that posted, labelled as an edited reply. The chip line reads
`2 posted (1 edited), 1 resolved, 1 held`; the edited count appears only
when non-zero.

**board:respond wrapper (`apps/board/skills/respond/SKILL.md`):** its
gate-2 act paragraph and answer-reading line get the same `text` rule and
record entry as receive-review. `--posted` and `--held` counts are
unchanged.

## Ship order

Readers ship before the writer, so no edited reply can reach a skill that
would post the draft instead:

1. repo-tools PR: contract, validator, MCP schema, tests. After merge,
   publish rt-client 0.30.0 and cut an rt release (both need Matt's go:
   npm OTP, outward-facing).
2. mattstack-skills PR: gate-protocol and receive-review read `text`;
   release, `rt skills sync` for mattstack and each compiled pack, full reads.
3. mattstack-apps PR: pin bump, gate-kit, board card, wrapper skill;
   deploy the board.

(The chat ruling listed apps before skills; this order swaps them for the
reason above. Step 2 is harmless alone: nothing sends `text` until step 3.)

## Testing

- **rt-client:** `gate-answers.test.ts` cases for a valid `text`, a
  non-string `text`, a whitespace-only `text`, and `text` beside `note`;
  the MCP schema accepts `text`; `dist-freshness.test.ts` stays green.
- **Skills (writing-skills TDD):** a new `post-act-edited` scenario where
  one thread's answer carries `text`. RED on today's receive-review
  (expected: posts the draft), GREEN after (posts the edit, records it),
  5 reps each on sonnet, tool-less. Re-run post-build, post-act,
  post-resume, and post-none to show no regression. Certify, then full
  reads of the preview-compiled receive-review, each pack's compiled
  receive-review and gate-protocol carriers after sync, and the wrapper.
- **gate-kit:** draft round-trip of `texts`, `unwrapGateAnswer` carries
  `text`, summary detail row carries `text`, chip edited count.
- **Board:** answer building (edited+post sends `{value, text}`, hold and
  unedited send the bare array), and RespondSheet tests for the edit
  button, seeded textarea, edited chip, reset, empty-edit submit disable,
  hold dropping the text, and the answered chip showing the posted text. Capture baselines
  re-pinned where the post step changes. Fast Browser screenshots of rest,
  editing, edited, and decided, in both schemes, looked at.

## Out of scope

- Editing at gate 1 (respond plan) or on review gates.
- Editing from the in-pane form.
- A markdown preview of the edited reply.
