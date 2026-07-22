---
name: mr-board:review
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to review an MR in a fresh
  herdr pane. Emits lifecycle status to a state file the board reads, then
  delegates the actual review to the skill named by --skill (or reviews
  generically when none is given). Invoked as "/mr-board:review
  <mrUrl> --state <path> --status-bin <path> [--report <path>] [--skill <name>]
  [--channel <name>] [--re-review]". Not for manual use.
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
| `--channel <name>` | slack channel (no `#`) for the "looking" signal (optional) |
| `--re-review` | this is a re-review of an already-reviewed MR (optional; see "Re-review mode") |

Write status **only** by running the injected `--status-bin`:

```
bun run <status-bin> <state> <status> [message] [--outcome <comment|approve>]
```

## Steps

1. **Mark reviewing.** `bun run <status-bin> <state> reviewing`
2. **Signal "looking" in Slack** (only if `--channel` was given). Add a 👀
   reaction to the author's review-request message so teammates know this MR is
   being looked at right now. See "Slack looking signal" below. Best-effort:
   if Slack tooling isn't available or there's no confident match, skip it and
   print a one-line note; never block the review on it.
3. **Review.** If `--re-review` was passed, read "Re-review mode" below first —
   it changes how you frame this step (and what you hand the `--skill`).
   - **If `--skill` was given:** invoke that skill with the MR url and the
     `--report <path>`. It owns the actual review — resolving the MR/ticket,
     producing the draft, writing the report, and running its own posting
     gates. Follow it exactly. Do **not** post or approve anything until the
     human answers its gates. Under `--re-review`, also pass it the re-review
     framing (prior review + "check what the author addressed, else fall back").
   - **If no `--skill`:** review the MR yourself. Fetch the diff, read it
     critically, and produce findings (severity, `file:line`, what to change).
4. **Save the review** to `--report <path>` as Markdown (a short summary line,
   then the findings). Write it **before** the gate below, so the board makes
   the "reviewing…" badge clickable to open the review modal while you hold at
   the gate. (Whoever produces the review — the domain skill or you — is
   responsible for this file existing before `done`.)
5. **Clear the posting gate, then mark done with the outcome.**

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

   The board consumes the outcome to drop the matching reaction on the MR's
   slack message directly — you do **not** need to react in slack yourself.
   The 👀 "looking" reaction at the start still applies.

   The summary is short, e.g. `"2 issues: 1 critical, 1 minor"` or
   `"looks solid"` — the same one-liner as the report's summary line.

   If the human ends the pane without answering the gate, leave it there
   (report written and readable from the badge, no `done`, no outcome) — an
   unanswered verdict is not an approve.
6. **On failure.** If the review can't proceed (bad MR link, mismatched
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
gates, the Slack signal) is unchanged — a re-review is still a review.

## Slack looking signal

Only when `--channel` was passed. Goal: add 👀 to the message in that channel
where the MR's author asked for review (the one containing this MR's link).

Prefer the Slack MCP tools (`mcp__claude_ai_Slack__slack_search_public` to find
the message, `mcp__claude_ai_Slack__slack_add_reaction` to react). If those
aren't present, the `slack:slack-search` / `slack:slack-api` skills do the same
over the Web API. If neither is available, skip and note it.

1. **Know the author.** Get the MR author fast if you don't have it:
   `glab mr view <mrUrl>` (the mrUrl carries the project path, so no repo flag
   is needed) and read the author.
2. **Find the message.** Search the channel for this MR's link:
   `slack_search_public` with `query = "<mrUrl> in:#<channel>"`. If that returns
   nothing, retry with just the MR number (`!<iid>`) plus `in:#<channel>`.
   Narrow with a `from:` modifier when noisy.
3. **Pick the one message, confidently.** Accept a result only when it is
   clearly the MR author's own message AND references this MR. If there are zero
   matches, several you can't disambiguate, or the only match isn't from the
   author, **skip** rather than guess.
4. **React.** Take the chosen result's `channel_id` and message `ts`, then
   `slack_add_reaction(channel_id, message_ts, emoji="eyes")`. Print a one-line
   confirmation (or the skip reason) and continue.

## Rules

- Always write `reviewing` before starting and a terminal `done`/`error` when
  finished, so the board badge never gets stuck.
- The state, status-bin, and report paths are absolute and given to you. Write
  status only via `--status-bin`, and the review Markdown only to `--report`.
  Always save the report before marking `done`.
- The Slack 👀 is best-effort and must never block or fail the review.
- After marking done, stay in the pane so the human can act on the draft.
