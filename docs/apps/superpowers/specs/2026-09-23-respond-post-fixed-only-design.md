# The respond post step asks only about replies not yet seen

Date: 2026-09-23. Status: approved; implemented on this branch.

## Problem

Gate 1 (respond-plan) already shows a reply-only thread's exact reply
(`thread@1` `reply.kind: verbatim`). Gate 2 (respond-post) then asks
whether to post that same text. A review with two pushbacks and no fixes
produced two identical decisions in a row: reply, reply at gate 1, then
post, post at gate 2.

Gate 2 only adds something when a fix rewrote a reply after gate 1: a
fixed thread's reply is finalized in step 5 ("Fixed: file:line", with the
commit), text the developer has not seen yet.

## Decided in chat

- Gate 2 lists only threads whose reply was written after a fix.
- Reply-only threads post from gate 1's answer, unresolved, so the
  reviewer can answer them.
- No fixes, no gate 2.
- The edit button moves onto gate 1's reply text too, so every reply
  stays editable before it posts.

## Flow

- **Gate 1** keeps its shape: one `reply:` / `fix:` / `skip:` question per
  thread, plus `code-changes`. A `reply:` answer may carry `text`, the
  edited reply (`{"value": "reply:<id>", "text": "..."}`, the same answer
  field rt-client 0.30.0 already declares).
- **Nothing to offer** (no fixed thread and no reply override, below):
  post every reply-only thread's reply (the answer's `text` when present,
  the drafted `reply.text` otherwise), never resolving; record; close. No
  gate 2.
- **Something to offer:** implement the `fix:` threads on
  `code-changes: approve` (step 5) and draft any reply override, then
  gate 2 offers exactly those threads, post/resolve as today. After gate 2
  proceeds, the reply-only threads post from gate 1 together with gate 2's
  picks, so the reviewer gets every reply in one pass.
- **A `reply:` override:** when the developer answers `reply:` on a thread
  whose gate 1 reply was not shown verbatim (step 3 recommended `fix` or
  `skip`, so the card showed a direction or no reply), and the answer
  carries no `text`, that thread is drafted and offered at gate 2 like a
  fixed thread. A `reply:` answer that carries a note is an override too:
  the note may change the reply (in the pane form it is the only place a
  typed replacement can go), so the reply is redrafted with it and offered
  at gate 2. So is a `reply:` answer (no `text`) on a thread whose gate 1
  question context never reached the gate (dropped for the size budget,
  or the open reported `contextOmitted`), since its draft was never shown.
  Gate 2 offers exactly the replies the developer has not yet seen word for
  word.
- **`code-changes: revise`:** unchanged.
- **`skip:`** still means no reply and no fix; it is how a reply is held
  at gate 1.

## Report rows

After gate 1, each thread's report row gains a `gate-1` field: `reply`,
`fix`, `skip`, or `override` (a reply override, above). An edited reply's
text replaces the draft in its row. Posting, a resume included, reads which
threads are reply-only (`gate-1: reply`) from those rows, never from step
3's recommendation. receive-review and the board:respond wrapper write and
read this same field.

## Records

- `respond-plan` gains an optional sibling map for edited replies, so the
  existing `threads` map keeps its string values:
  `{"threads": {"T1": "reply", "T2": "fix"}, "texts": {"T1": "<edited reply>"}, "code-changes": "approve"}`.
  It also lists reply overrides, so a run resumed from its record alone
  never posts a draft an override was meant to replace:
  `"overrides": ["T3"]` (omitted when empty).
- `respond-post` covers only the threads gate 2 offered, as today. With
  nothing offered there is no `respond-post` gate and no `respond-post`
  record; the plan record covers the replies that posted.

## Skills

- **receive-review:** step 4 reads a `reply:` answer's `text` and records
  it; step 6 offers fixed threads and reply overrides and posts the
  reply-only threads from gate 1; the "no thread offered" rule becomes
  "post the reply-only threads, open no gate 2". The in-pane form never
  sends `text`, as today.
- **board:respond wrapper:** the same flow. `--posted` counts every
  thread that got a reply, reply-only threads included; `--held` counts
  `skip:` threads, fixes held out under `code-changes: skip`, and gate 2
  holds.

## Board

- **Plan sheet:** a thread card picked `reply:` with a verbatim reply gets
  the post card's editable reply (edit / done / reset to draft, the grey
  `edited` chip). `fix:` threads keep their direction text (the reply is
  written after the fix); `skip:` threads show nothing to edit.
- **Answer:** an edited `reply:` thread answers
  `{"value": "reply:<id>", "text": "<trimmed edit>"}`, only when the edit
  differs from the draft; an emptied reply blocks submit with the same
  dock reason.
- **Dock copy:** with no fix picked, "Next, the replies post."; with
  fixes, "Next, N fixes get implemented, then you approve the fixed
  replies before anything posts."
- **Recap outcome:** a plan gate with an edit reads like
  `2 replies (1 edited)`; the console chip is unchanged.

## Ship order

Readers first: receive-review in mattstack-skills (it reads gate 1's
`text` and stops offering reply-only threads at gate 2), then the apps PR
(the wrapper and the plan-sheet edit). Until the apps PR lands, the board
sends no gate 1 `text`, so the skills change is safe alone.

## Testing

- **Skills (writing-skills TDD):** a plan answer with two replies (one
  edited) and no fixes posts both, the edited text for one, and opens no
  gate 2; a plan with one fix and one reply offers only the fixed thread at
  gate 2 and posts the reply-only thread with it; post-build and the
  per-thread scenarios re-run with no regression; full reads after sync.
- **Board:** plan-sheet DOM tests for the edit on a `reply:` card, none on
  `fix:` / `skip:`, the answer shape, the dock copy; Fast Browser
  screenshots of the plan card at rest, editing and edited, both schemes.

## Out of scope

- Resolving reply-only threads (they stay open for the reviewer).
- Editing in the in-pane form.
