---
name: board:review
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to review an MR in a fresh
  herdr pane. Emits lifecycle status through the board's status CLI, then
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
board through its status CLI. This wrapper carries **no** repo-, team-, or
tool-specific knowledge — the board injects everything it needs as flags:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request to review |
| `--state <handle>` | opaque board handle for this MR's review. Pass it verbatim to `--status-bin` and the `gate` verbs; never read, stat, or write it. It looks like a `.json` path but no such file exists: board state lives in the board's database, and the path is only a key. Its absence on disk says nothing about whether the board is tracking this pass. |
| `--status-bin <path>` | absolute path to the board's status-writer CLI; run it to emit status |
| `--report <path>` | where to save the written review the board shows in a modal |
| `--skill <name>` | the domain skill that owns the actual review (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--re-review` | this is a re-review of an already-reviewed MR (optional; see "Re-review mode") |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh review (optional; see "Steps") |
| `--resumed-gate-kind <kind>` | the `kind` of the gate `--resumed-gate` names (e.g. `review-post`). Present exactly when `--resumed-gate` is, and the only way to learn it: `--state` is an opaque handle and `gate wait` returns only the answer. |

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

1. **Mark reviewing.** `<status-bin> review-status <state> reviewing`. If
   `--re-review` was passed, print that mode's announcement banner ("Re-review
   mode", step 0) before this write.
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

   A PreToolUse hook may deny native AskUserQuestion when no gate is open;
   that denial is the gate protocol speaking: open the gate as this section
   describes. When the daemon is down the hook allows the native form
   (degraded mode is unchanged).

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

     `<levels present>` is a placeholder: substitute the actual tier
     objects, e.g. `[{"value":"critical","label":"critical (1)"},
     {"value":"nit","label":"nit (2)"}]`. Don't copy it verbatim.

     When no levels are present (a clean review with no findings), omit the
     `tiers` question entirely and open the gate with `outcome` alone, so a
     clean review is approvable in one click:

     ```json
     [{"id": "outcome", "label": "Verdict", "multi": false, "options": ["comment", "approve"]}]
     ```

     Options carry display labels: the `tiers` question's options are
     `{"value": "<Tier>", "label": "<Tier> (<count>)"}` objects, the count being
     that tier's finding count from the report (e.g. value `Major`, label
     `Major (2)`); the `outcome` options stay bare strings unless marked as
     recommended. The `--context`
     text is the tier counts line followed by one line per finding title from
     the report, verbatim from the report file, never re-summarized.

     Mark the outcome you would recommend by listing it FIRST and giving it
     a label ending in " (recommended)", e.g.
     `[{"value": "approve", "label": "approve (recommended)"}, "comment"]`.
     The board lifts the suffix into a badge and the native form renders it
     as its own (Recommended) affordance, so every surface shows the one
     recommendation decided here. Mark at most one outcome option and never
     a tiers option; recommending is offering, and the human still decides.

   - **Open the gate:**
     `<status-bin> gate open <state> --kind review-post --questions <json> --context <context text>`
     The output is one JSON line: `{"gateId": "...", "presentation": "form"}` or `"wait"`.
     The context text is assembled from strings you already hold (see the fill
     rules above); if it would exceed 8192 UTF-8 bytes, omit `--context`
     entirely rather than trimming it.
   - **presentation "form":** follow `mattstack:gate-protocol`'s "Acting
     on the response" (form branch) and "CAS and the doorbell" sections
     (stable source checkout, machine-local by design: `cat
     ~/Documents/GitHub/mattstack-skills/attachments/gate-protocol/SKILL.md`)
     for the mechanical rendering rule (one form question per gate
     question in gate order, labels and values verbatim) and the
     conflict rule (a printed conflict answer, or a doorbell message
     while a form still sits open, means another surface won: proceed
     on the winning answer, never the one you were about to submit;
     the doorbell is verify-only, run `<status-bin> gate wait <state>
     --max-ms 1000` to read the recorded answer). Its `rt gate answer
     <id> --answers ... --by pane` is this CLI's `<status-bin> gate
     answer <state> --answers <json> --by pane`, unchanged. Four
     things stay specific to THIS gate, not covered there (gate-protocol
     never mentions a "(recommended)" suffix, framing placement, or
     folding one question's answer into another option, at all): a
     label's " (recommended)" suffix becomes the form's own
     (Recommended) affordance; your framing and reasoning go in the
     pane prose or option descriptions, never into rewritten question
     or option text; the question order is fixed (tiers before
     outcome: the human weighs the findings before choosing a
     verdict); and never as an option that folds another question's
     answer in -- there is never a "skip and approve clean" combo
     option, since "post nothing" is the `tiers` question answered as
     an explicit empty array, which the daemon records.
   - **presentation "wait":** follow `board:gate-cli-recipes`'s "Wait
     recipe" section (`cat ${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md`)
     for the background-wait mechanics, unchanged; the gate to name in
     `holding at gate <gateId>` is this one.
   - **Closed or missing gate.** Follow `board:gate-cli-recipes`'s "Closed
     or missing gate" section (same file) for the terminal handling,
     unchanged.
   - **In-pane escape hatch.** If a human interrupts the wait and answers you
     conversationally in the pane instead of through the board, record it so
     any parked resume stays in sync:
     `<status-bin> gate answer <state> --answers <json> --by pane`.
     - **Strict membership, CAS loss, reading answers back.** Follow
       `mattstack:gate-protocol`'s "Answers are option values" and "CAS and
       the doorbell" sections (stable source checkout, machine-local by
       design: `cat
       ~/Documents/GitHub/mattstack-skills/attachments/gate-protocol/SKILL.md`)
       for the shared mechanics, unchanged, and `board:gate-cli-recipes`'s
       "CAS loss and reading answers back" section (`cat
       ${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md`) for this CLI's own
       silent-success-versus-JSON-line contract. Specific to this gate: the note
       form example is `{"outcome": {"value": "comment", "note": "approve
       once CI is green"}}`, and a multi question's explicit empty array
       (`{"tiers": []}`) is also valid, recording the decision to post none
       of these findings.
   - **Degraded mode.** If `gate open` exits nonzero (the daemon was down at
     open time), fall back to ONE combined `AskUserQuestion` carrying the
     same questions the gate would have — both `tiers` and `outcome` when
     levels are present, `outcome` alone when they aren't — never the old
     two-gate pair, rendered by the same mechanical rules as presentation
     "form" above, and proceed on its answers. Follow
     `board:gate-cli-recipes`'s "A failing wait is not degradation" section
     for when to retry `gate wait` versus fall through to this same combined
     `AskUserQuestion`.
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

A resumed pane replays the whole prior session above your first message, so the
top of this pane shows the ORIGINAL review's prompt and transcript. That
scrollback is history, not your instructions. `--re-review` on THIS invocation
is what governs, and a reader scrolling from the top has no way to tell the two
apart, which is why step 0 exists.

0. **Announce the mode, as your first output, verbatim:**

   ```
   === RE-REVIEW !<iid>: prior review exists; scrollback above is history ===
   ```

   REQUIRED. It is the only marker that separates this pass from the replayed
   original above it. Print it before any tool call, including the `reviewing`
   status write.
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
  finished, so the board badge never gets stuck — except a closed or missing
  gate (see "Closed or missing gate" above): end without either, since a
  fresh pane may already own this MR's board state.
- The state handle, status-bin, and report paths are given to you. Write
  status only via `--status-bin`, and the review Markdown only to `--report`.
  `--report` is a real file you write; `--state` is a handle you only ever
  pass through (see the flag table).
  Always save the report before marking `done`.
- After marking done, stay in the pane so the human can act on the draft.
