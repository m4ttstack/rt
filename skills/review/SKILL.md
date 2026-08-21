---
name: mr-board:review
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to review an MR in a fresh
  herdr pane. Emits lifecycle status to a state file the board reads, then
  delegates the actual review to the skill named by --skill (or reviews
  generically when none is given). Invoked as "/mr-board:review
  <mrUrl> --state <path> --status-bin <path> [--report <path>] [--skill <name>]
  [--re-review]". When no --skill is given, the domain skill is resolved from
  the review slot binding in .mattstack/skills.jsonc. Not for manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "review"
  slot-review: "required mr-review@1 -- owns the domain review flow for one MR: resolving the MR/ticket, producing the draft review, writing the report, and its own posting gates"
---

# mr-board review runner

The mr-board spawned this pane to review one MR and report status back to the
board via a state file. This wrapper carries **no** repo-, team-, or
tool-specific knowledge — the board injects everything it needs as flags:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request to review |
| `--state <path>` | lifecycle status file the board polls |
| `--status-bin <path>` | absolute path to the board's status-writer CLI; run it to emit status |
| `--report <path>` | where to save the written review the board shows in a modal |
| `--skill <name>` | the domain skill that owns the actual review (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--re-review` | this is a re-review of an already-reviewed MR (optional; see "Re-review mode") |

Write status **only** by running the injected `--status-bin`:

```
bun run <status-bin> <state> <status> [message] [--outcome <comment|approve>]
```

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time — not a flag and not part of the MR. Honor it throughout
the review (e.g. "focus on the migration files", "skip the vendored code") and
pass it along to the domain skill as context. It never overrides the posting
gates or the status contract.

## Resolving the domain skill

The domain skill that owns the actual review comes from the first source that
answers; the order is fixed:

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. This is the historical launch path, unchanged. When
   the board also passed `--skill-path <path>`, read the SKILL.md at that
   absolute path directly and treat it exactly as the domain skill named by
   `--skill` (same idiom as step 2's `resolved.review.path` below).
2. **Otherwise resolve the `review` slot.** Run the vendored resolver:

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
   ```

   On exit 0, read the SKILL.md at `resolved.review.path` and treat that skill
   exactly as if it had been passed via `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's JSON
   `errors` verbatim in the pane. Never guess or substitute a binding; the
   script is the only enforcement point. Then proceed with the generic
   domain-free review described in the steps below, so an unbound board still
   gets a review... just never a silently mis-bound one.

## Steps

1. **Mark reviewing.** `bun run <status-bin> <state> reviewing`
2. **Review.** If `--re-review` was passed, read "Re-review mode" below first —
   it changes how you frame this step (and what you hand the `--skill`).
   - **If a domain skill resolved** (explicit `--skill`, else the `review`
     slot per "Resolving the domain skill"): invoke that skill with the MR url and the
     `--report <path>`. It owns the actual review — resolving the MR/ticket,
     producing the draft, writing the report, and running its own posting
     gates. Follow it exactly. Do **not** post or approve anything until the
     human answers its gates. Under `--re-review`, also pass it the re-review
     framing (prior review + "check what the author addressed, else fall back").
   - **If no domain skill resolved:** review the MR yourself. Fetch the diff, read it
     critically, and produce findings (severity, `file:line`, what to change).
3. **Save the review** to `--report <path>` as Markdown (a short summary line,
   then the findings). Write it **before** the gate below, so the board makes
   the "reviewing…" badge clickable to open the review modal while you hold at
   the gate. (Whoever produces the review — the domain skill or you — is
   responsible for this file existing before `done`.)
4. **Clear the posting gate, then mark done with the outcome.**

   <HARD-GATE>
   The outcome is NOT yours to decide. Do not pick approve/comment yourself and
   do not mark `done` autonomously. Present the gate and let the human choose:
   - **Gate 1 (disposition):** Comment (default) / Approve.
   - **Gate 2 (severity levels):** multi-select over the levels present.

   When a `--skill` is in play, run **its** posting gates and use the
   disposition the human picks. Never map a "clean review" to Approve on your
   own — a clean review just means Approve is the sensible pick to *offer*.
   </HARD-GATE>

   Only after the human has answered and you have posted accordingly, mark done
   with their disposition as the outcome:
   `bun run <status-bin> <state> done "<one-line summary>" --outcome <comment|approve>`

   The board turns your status writes into the slack reactions on this MR's
   review-request message -- 👀 when you mark `reviewing`, 💬 or ✅ when you mark
   `done` with an outcome. You never react in slack yourself.

   The summary is short, e.g. `"2 issues: 1 critical, 1 minor"` or
   `"looks solid"` — the same one-liner as the report's summary line.

   If the human ends the pane without answering the gate, leave it there
   (report written and readable from the badge, no `done`, no outcome) — an
   unanswered verdict is not an approve.
5. **On failure.** If the review can't proceed (bad MR link, mismatched
   MR/ticket, fetch failure, delegated skill failed):
   `bun run <status-bin> <state> error "<what went wrong>"`
   then stop and report to the human in the pane.

## Re-review mode

Only when `--re-review` was passed. This MR was reviewed before and the author
should have responded to that feedback — replied to or resolved comment threads,
and/or pushed new commits. Your job is to re-review with that in mind, not to
start from a blank slate.

1. **Load the prior review, if any.** If a file exists at `--report <path>`, it
   holds the previous review — read it first so you know exactly what was flagged.
   (If it's missing, there's no board record of a prior review; carry on with the
   re-review framing anyway — a human may have reviewed outside the board.)
2. **Check whether the author actually acted.** Look at the MR's discussions and
   new commits since the last review. Did the author address the prior feedback?
3. **Branch:**
   - **Author acted** → re-review focused on that: for each prior comment, was it
     adequately addressed? Are the new changes sound? Note anything still open.
   - **No action found** (no threads addressed, no relevant new changes since the
     last review) → **say so explicitly** in your report's summary line, e.g.
     `"no author action found since last review"`, and **fall back to a normal
     full review** of the whole MR so the pass is still useful.
4. **Delegating to `--skill`?** Hand it the same framing: the prior review (from
   `--report`), "check what the author addressed since the last review", and the
   "flag + fall back to a full review if nothing was acted on" instruction.

Everything else (status writes, saving the report to `--report`, the posting
gates) is unchanged — a re-review is still a review.

## Rules

- Always write `reviewing` before starting and a terminal `done`/`error` when
  finished, so the board badge never gets stuck.
- The state, status-bin, and report paths are absolute and given to you. Write
  status only via `--status-bin`, and the review Markdown only to `--report`.
  Always save the report before marking `done`.
- After marking done, stay in the pane so the human can act on the draft.
