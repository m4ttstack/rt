---
name: board:review
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to review an MR in a fresh
  herdr pane. Emits lifecycle status to a state file the board reads, then
  delegates the actual review to the skill named by --skill (or reviews
  generically when none is given). Invoked as "/board:review
  <mrUrl> --state <path> --status-bin <path> [--report <path>] [--skill <name>]
  [--re-review]". When no --skill is given, the domain skill is resolved from
  the review slot binding in .mattstack/skills.jsonc. Not for manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "review"
  slot-review: "required mr-review@2 -- owns the domain review flow for one MR: resolving the MR/ticket, producing the draft review, writing the report, reporting the severity levels present, and executing the posting once handed the human's decision. Never presents posting gates or decides disposition."
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
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh review (optional; see "Steps") |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> review-status <state> <status> [message] [--outcome <comment|approve>]
```

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time — not a flag and not part of the MR. Honor it throughout
the review (e.g. "focus on the migration files", "skip the vendored code") and
pass it along to the domain skill as context. It never overrides the gate
protocol or the status contract.

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

**Parked-gate resume?** If `--resumed-gate <gateId>` was passed to this
invocation, it is a parked-gate resume: a human already answered the gate
opened by an earlier pane on this MR, and the board is replaying that answer
into a fresh pane. Do **not** re-review and do **not** run `gate open` — the
gate lives in the rt daemon's registry, and re-opening would mint a new
`gateId` and orphan the answer already recorded against the old one.
Instead:

- `<status-bin> review-status <state> reviewing`
- `<status-bin> gate wait <state>` — the verb is registry-status-first, so on
  an already-answered gate it returns the recorded answer at once instead of
  blocking.
- Act on the answer (hand `{tiers, outcome}` to the domain skill, or post
  directly on the generic no-domain-skill path).
- `<status-bin> review-status <state> done "<one-line summary>" --outcome <comment|approve>`

Every other step below (delegating to the domain skill, writing the report,
`gate open`) is skipped. This invocation supersedes any earlier gate contract
remembered in the conversation.

**Otherwise, a fresh review:**

1. **Mark reviewing.** `<status-bin> review-status <state> reviewing`
2. **Review.** If `--re-review` was passed, read "Re-review mode" below first —
   it changes how you frame this step (and what you hand the `--skill`).
   - **If a domain skill resolved** (explicit `--skill`, else the `review`
     slot per "Resolving the domain skill"): invoke that skill with the MR url and the
     `--report <path>`. It owns the actual review — resolving the MR/ticket,
     producing the draft, and writing the report — then reports back to you
     the severity levels present in its findings. It never presents posting
     gates or decides disposition; this wrapper owns the single event gate
     (step 4, "Gate protocol") and hands the domain skill `{tiers, outcome}`
     to execute the posting once the human has answered. Under `--re-review`,
     also pass it the re-review framing (prior review + "check what the
     author addressed, else fall back").
   - **If no domain skill resolved:** review the MR yourself. Fetch the diff, read it
     critically, and produce findings (severity, `file:line`, what to change).
3. **Save the review** to `--report <path>` as Markdown (a short summary line,
   then the findings). Write it **before** the gate below, so the board makes
   the "reviewing…" badge clickable to open the review modal while you hold at
   the gate. (Whoever produces the review — the domain skill or you — is
   responsible for this file existing before `done`.)
4. **Run the gate protocol, then mark done with the outcome.**

   The outcome is NOT yours to decide, and do not mark `done` autonomously.
   This wrapper presents exactly **one** event gate — carrying `outcome` and,
   when findings have severity levels, `tiers` alongside it — never a
   "disposition gate" and a "severity gate" as two separate gates.
   Never map a "clean review" to Approve on your own — a clean review just
   means Approve is the sensible pick to *offer*. This is the gate contract
   for this invocation; it supersedes any two-gate or per-skill posting-gate
   protocol you might recall from an earlier transcript or session.

   - **Build the questions.** Always one `outcome` question (single-select,
     comment/approve). Add a `tiers` question (multi-select over the
     severity levels the domain skill reported present, or your own
     findings' levels on the generic no-domain-skill path) only when at
     least one level is present:

     ```json
     [
       {"id": "tiers", "label": "Post which findings?", "multi": true, "options": [<levels present>]},
       {"id": "outcome", "label": "Verdict", "multi": false, "options": ["comment", "approve"]}
     ]
     ```

     `<levels present>` is a placeholder — substitute the actual level
     strings, e.g. `["critical","important","nit"]`. Don't copy it verbatim.

     When no levels are present (a clean review with no findings), omit the
     `tiers` question entirely and open the gate with `outcome` alone, so a
     clean review is approvable in one click:

     ```json
     [{"id": "outcome", "label": "Verdict", "multi": false, "options": ["comment", "approve"]}]
     ```

   - **Open the gate:**
     `<status-bin> gate open <state> --questions <json>`
   - **Wait for the answer:**
     `<status-bin> gate wait <state>`
     Prints `{"answers": {"tiers": [...], "outcome": "..."}, "by": "...", "answeredAt": ...}` when
     the gate carried both questions, or `{"answers": {"outcome": "..."}, "by": "...", "answeredAt": ...}`
     when it carried `outcome` alone. Read `answers.outcome`, and `answers.tiers` when the gate
     carried it. The gate and any answer are persisted daemon state, so the wait survives a
     daemon restart: if `gate wait` exits nonzero and the error is not the closed message below,
     it was a transient failure — just re-run it. Re-entering the wait can never lose an answer
     already recorded.
   - **Closed gate.** If `gate wait` instead fails with
     `gate <id> closed (<reason>)`, the decision site itself was abandoned —
     superseded by a re-review, abandoned, or pruned when the MR left the
     board. End cleanly: say so in the pane and stop. Do not invent an
     answer, do not mark `done`, and do not write `error` either — when the
     reason is a re-review superseding this gate, a fresh pane already owns
     this MR's state file, and a late write here would stomp it.
   - **In-pane escape hatch.** If a human interrupts the wait and answers you
     conversationally in the pane instead of through the board, record it so
     any parked resume stays in sync:
     `<status-bin> gate answer <state> --answers <json> --by pane`.
     - **Strict membership.** Each recorded answer value must be one of that
       question's option strings, verbatim (e.g. `"comment"`,
       `["critical","nit"]`) — the daemon rejects anything else. Carry the
       human's phrasing, hedges, or nuance in the note form instead:
       `{"outcome": {"value": "comment", "note": "approve once CI is green"}}`.
     - **CAS loss.** `gate answer` prints nothing and exits 0 when the
       pane's answer was recorded and stands. If it instead prints one JSON
       line, someone answered first through another surface — that printed
       answer is the recorded one. Proceed on it, not on the conversational
       answer given in the pane, and tell the human which answer won.
     - **Reading answers back.** Whether from `gate wait` or a CAS-loss
       line, a question's answer may be the bare option string/array or the
       `{value, note}` object — read `value` in the object case.
   - **Degraded mode.** If `gate open` exits nonzero (the daemon was down at
     open time), fall back to ONE combined `AskUserQuestion` carrying the
     same questions the gate would have — both `tiers` and `outcome` when
     levels are present, `outcome` alone when they aren't — never the old
     two-gate pair, and proceed on its answers. A failing `gate wait` is not
     itself degradation — per "Wait for the answer" above, re-run it; only
     if it keeps failing (and never with the closed message) fall back to
     the same combined `AskUserQuestion`, and tell the human why.
   - **Act on the answer.** Hand `{tiers, outcome}` to the domain skill so it
     can execute the posting — `tiers` is empty when the gate carried
     `outcome` alone, since a clean review has no findings to post — or post
     the selected findings yourself on the generic no-domain-skill path.

   Only after posting, mark done with the chosen outcome:
   `<status-bin> review-status <state> done "<one-line summary>" --outcome <comment|approve>`

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
   `<status-bin> review-status <state> error "<what went wrong>"`
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

Everything else (status writes, saving the report to `--report`, the gate
protocol) is unchanged — a re-review is still a review.

## Rules

- Always write `reviewing` before starting and a terminal `done`/`error` when
  finished, so the board badge never gets stuck — except a closed gate (see
  "Closed gate" above): end without either, since a fresh pane may already
  own the state file.
- The state, status-bin, and report paths are absolute and given to you. Write
  status only via `--status-bin`, and the review Markdown only to `--report`.
  Always save the report before marking `done`.
- After marking done, stay in the pane so the human can act on the draft.
