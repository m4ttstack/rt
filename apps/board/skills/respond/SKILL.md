---
name: board:respond
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to process review feedback
  on your OWN MR in a fresh herdr pane. Emits lifecycle status to a state file
  the board reads, then delegates the actual work to the skill named by --skill.
  Invoked as "/board:respond <mrUrl> --state <path> --status-bin
  <path> [--report <path>] [--skill <name>]". When no --skill is given, the domain skill is
  resolved from the respond slot binding in .mattstack/skills.jsonc. Not for
  manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  slots: "respond"
  slot-respond: "required mr-respond@2 -- owns processing review feedback on one MR: fetching threads, adjudicating, drafting, implementing decided fixes, and executing posting once handed the decisions. Never presents decision gates or decides what posts."
---

# mr-board respond runner

The mr-board spawned this pane to process the review feedback on ONE of your own
MRs and report status back to the board via a state file. This wrapper carries
**no** domain knowledge — the board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | your merge request whose feedback to process |
| `--state <path>` | lifecycle status file the board polls |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--report <path>` | where the fill saves the adjudication table and drafted/finalized replies; a resumed pane posts from it |
| `--skill <name>` | the domain skill that owns the actual work (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh run (optional; see "Steps") |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> respond-status <state> <status> [message]
<status-bin> respond-status <state> done <message> --posted <n> --threads <n>
```

The board tracks five in-flight statuses; emit each as you cross the milestone:

| Status | When to emit |
|--------|--------------|
| `triaging` | Immediately, before fetching threads. |
| `implementing` | Only after Gate 1's `code-changes` question comes back `approve`, before touching code. Skip when no threads need code changes. |
| `drafting` | When presenting the verdict table + drafted replies (before Gate 1), and again once implementation is finished and finalized replies are ready to post (before Gate 2). |
| `done` | After the run finishes. REQUIRED: `--posted <n> --threads <n>` (see step 7). |
| `error` | Anything unrecoverable (bad MR, no threads to process, delegated skill failed). |

## Operator note

The launch prompt may end with a paragraph beginning `Operator note (from the
human who launched this pane):`. That is direct instruction from the human,
typed at launch time — not a flag and not part of the MR. Honor it while
processing the feedback (e.g. "push back on the naming comment", "only handle
thread 2") and pass it along to the domain skill as context. It never overrides
the status contract or either gate.

## Resolving the domain skill

The domain skill that owns the actual work comes from the first source that
answers; the order is fixed:

1. **Explicit `--skill <name>` wins.** When the board passed it, use it and do
   not run the resolver. This is the historical launch path, unchanged. When
   the board also passed `--skill-path <path>`, read the SKILL.md at that
   absolute path directly and treat it exactly as the domain skill named by
   `--skill` (same idiom as step 2's `resolved.respond.path` below).
2. **Otherwise resolve the `respond` slot.** Run the vendored resolver:

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
   ```

   On exit 0, read the SKILL.md at `resolved.respond.path` and treat that
   skill exactly as if it had been passed via `--skill`.
3. **Otherwise degrade loudly.** On a nonzero exit, print the resolver's JSON
   `errors` verbatim in the pane. Never guess or substitute a binding; the
   script is the only enforcement point. Then proceed with the generic
   domain-free flow described in the steps below.

## Steps

**Parked-gate resume?** If `--resumed-gate <gateId>` was passed to this
invocation, it is a parked-gate resume: a human already answered one of the
two gates opened by an earlier pane on this MR, and the board is replaying
that answer into a fresh pane. Do **not** re-adjudicate and do **not** run
`gate open` — the gate lives in the rt daemon's registry, and re-opening
would mint a new `gateId` and orphan the answer already recorded against the
old one. Instead:

- **Re-emit the correct status first, before anything else.** The board's
  resume plumbing always lands this pane's state at `implementing` regardless
  of which gate resumed it, so your first act must correct that: read
  `gateKind` off the state file to learn which gate `--resumed-gate` names —
  never guess it from context — and re-emit the status it actually implies:
  - `respond-plan` → `<status-bin> respond-status <state> implementing`
    (already correct, but emit it anyway so a stale write can never linger).
  - `respond-post` → `<status-bin> respond-status <state> drafting`
    (corrects the wrong transient — a Gate 2 resume is finalized replies
    waiting to post, not code changes waiting to be written).
- `<status-bin> gate wait <state>` — the verb is registry-status-first, so on
  an already-answered gate it returns the recorded answer at once instead of
  blocking.
- **Act on the answer, by `gateKind`.** Read `--report <path>` first — it
  holds the adjudication table and drafted/finalized replies a fresh pane has
  no other way to recover once the pane that produced them is gone. Never
  re-adjudicate and never re-implement from scratch:
  - `respond-plan` → implement from the report's decided plan: the wait's
    `{plan: <answers>, by: <by>}` select among the report's threads. Join
    each answer to its report row by the thread id inside the option VALUE
    (every `answers` key other than `code-changes` holds one
    `<verb>:<threadId>`; split at the first `:`), never by the `thread-<n>`
    question id, which is only a container. Hand the report
    and those answers to the domain skill exactly as step 5 would have. When
    it's back to finalized replies, update the report with them, emit
    `drafting`, then run Gate 2 **fresh** (open it, wait, hand `{post: ...}`
    down) exactly as steps 5-6 describe below.
  - `respond-post` → execute posting FROM THE REPORT's finalized replies plus
    the wait's `{post: <answers>, by: <by>}`, never re-adjudicating or
    re-implementing.
    Hand both to the domain skill exactly as step 6 would have.
- `<status-bin> respond-status <state> done "<one-line summary>" --posted <n> --threads <n>`

Every other step below (delegating to the domain skill for adjudication,
opening a gate, `gate open`) that precedes the resumed gate is skipped. This
invocation supersedes any earlier gate contract remembered in the
conversation.

**Otherwise, a fresh run:**

1. **Mark triaging.** `<status-bin> respond-status <state> triaging`
2. **Adjudicate.**
   - **If a domain skill resolved** (explicit `--skill`, else the `respond`
     slot per "Resolving the domain skill"): delegate to that skill with the
     MR url and the `--report <path>`. It owns the real work — resolving the
     MR/ticket, fetching unresolved human threads, adjudicating each one, and
     drafting replies and proposed fixes — then reports back to you the
     adjudication: a
     verdict table (one row per thread, with its recommended reply/fix/skip)
     plus whether it is proposing code changes. It never presents a gate or decides what gets implemented or
     posted; this wrapper owns both facility gates (steps 4 and 6) and hands
     the domain skill `{plan: ...}` and later `{post: ...}` to act on once a
     human has answered.
   - **If no domain skill resolved:** fetch the MR's unresolved review threads
     yourself, adjudicate each on its merits, and draft replies and any
     proposed fixes. Build your own verdict table for the gates below.
   - **Zero unresolved threads?** Skip straight to step 7:
     `done "no unresolved threads" --posted 0 --threads 0`. That is not an
     error condition, and neither gate opens.
3. **Save the report and emit `drafting`.** Before Gate 1 opens, `--report
   <path>` must hold the verdict table + per-thread draft replies as
   Markdown — a resumed pane has no other way to recover them once this
   pane's session ends. Every row carries its thread id VERBATIM as the
   row key — the same `<threadId>` the gate's `reply:<threadId>` /
   `fix:<threadId>` / `skip:<threadId>` option strings use — so a resumed
   pane can mechanically join the wait's answers back to the report's rows. (Whoever produces the adjudication — the domain
   skill or you — is responsible for this file existing before Gate 1
   opens.) Then: `<status-bin> respond-status <state> drafting`
4. **Gate 1 — plan.** Build ONE single-select question per unresolved
   thread, in verdict-table order, plus one `code-changes` question, per
   the shape below. A thread question's id is `thread-<n>` by 1-based
   position, its label is that thread's `<file>:<line>`, and its three
   options carry the verb plus the thread id VERBATIM in the value and the
   bare verb in the label (the ids shown are placeholders; substitute the
   real ones):

   ```json
   [
     {"id": "thread-1", "label": "<file>:<line>", "multi": false,
      "options": [{"value": "reply:<threadId>", "label": "reply"}, {"value": "fix:<threadId>", "label": "fix"}, {"value": "skip:<threadId>", "label": "skip"}]},
     {"id": "thread-2", "label": "<file>:<line>", "multi": false,
      "options": ["... the next thread's reply/fix/skip triple, its own id verbatim; one such question per thread"]},
     {"id": "code-changes", "label": "Approve the proposed code changes?", "multi": false,
      "options": ["approve", "revise", "skip"]}
   ]
   ```

   One question per thread keeps every question at three options, under
   the native form's per-question cap, so `gate open` stamps `form` for
   any thread count; never fold several threads into one multi-select. It
   also makes reply/fix/skip mutually exclusive per thread by
   construction, so no contradictory selection can arrive.

   The thread id lives in the option VALUE, never in the question id:
   every consumer of the answer (step 5 here, a `--resumed-gate` pane, the
   board card, the console card) reads every `answers` key other than
   `code-changes`, splits the value at its first `:`, and joins the thread
   id to the report row. The `thread-<n>` id is a container; nothing keys
   on it.

   Option labels cap at 200 UTF-8 bytes (the bare verbs sit far under it).
   Keep a question label to the thread's path and line; when a path is
   long, middle-truncate the path portion (keep the filename and line).
   Never alter a value string.

   `skip` is the no-code-changes sentinel: surfaces hide the code-changes
   question until a `fix:` value is selected and submit `skip` for it while
   hidden, so it must always be present in the options.

   - **Open the gate:**
     `<status-bin> gate open <state> --kind respond-plan --questions <json> --context <context text>`
     The output is one JSON line: `{"gateId": "...", "presentation": "form"}` or `"wait"`.
     The context text is the reviewer thread quoted verbatim plus the drafted
     reply or fix summary for each thread, within the 8192 UTF-8 byte cap; if
     it would exceed the cap, omit `--context` entirely rather than trimming
     it.
   - **presentation "form":** present the SAME questions as the native
     structured-question form. The form tool takes at most four questions
     per call, so chunk: the thread questions in order, up to four per
     call, until every thread is asked; then, if any thread's answer is a
     `fix:` value, ask `code-changes` in one more call, otherwise fill
     `code-changes: "skip"` without asking (the same hide rule the board
     and console cards apply). Render each option's `label` and submit the
     chosen option's `value` verbatim; never an index, never a paraphrase.
     Submit exactly one
     `<status-bin> gate answer <state> --answers <json> --by pane` after
     the LAST call, carrying every thread question's answer plus
     `code-changes`; never one per chunk. A printed conflict answer means
     another surface won: say so in one line and proceed on the printed
     winning answer. If the form is dismissed
     under you and a message arrives saying the gate was answered elsewhere,
     that message is a verify-only signal and never carries the answer: run
     `<status-bin> gate wait <state> --max-ms 1000`, read the recorded
     answer, and proceed on it.
   - **presentation "wait":** do NOT present a form. Launch ONE background
     shell command (the shell tool's run-in-background mode) that loops
     `<status-bin> gate wait <state> --max-ms 90000`, re-running while it
     prints `{"status":"pending"}`, and exits printing the answered JSON as
     its last stdout. Then END YOUR TURN in one line: `holding at gate
     <gateId>`. The pane is idle but armed: typed input lands instantly, and
     the loop's completion re-invokes this pane with the answer as the tool
     result. On re-invoke, proceed on the answer exactly as the form branch
     does. A wait that fails with a closed or not-found message is terminal:
     follow this wrapper's existing closed-gate rules.
5. **Act on the plan.** Hand `{plan: <answers>, by: <by>}` to the domain
   skill (or act on it yourself on the generic no-domain-skill path); `by`
   is the wait's own decider field, so the domain skill's decision record
   names who actually decided instead of guessing. Each thread's
   disposition is the verb in its answer value (`reply:<id>`, `fix:<id>`,
   or `skip:<id>`, read off every key other than `code-changes`), and the
   `code-changes` answer decides whether anything gets implemented this
   round:

   - **`code-changes: approve`**: emit `implementing`
     (`<status-bin> respond-status <state> implementing`) before touching
     code, implement the `fix:` threads one at a time, verified, then update
     `--report <path>` with the finalized replies (each fixed thread's reply
     text now reads e.g. `"Fixed: file:line"`) and emit `drafting` again;
     before Gate 2 opens, the report must hold what will actually be
     posted, not the earlier draft.
   - **`code-changes: skip`** (the no-code-changes sentinel every surface
     submits while the question is hidden) **or `code-changes: revise`**:
     nothing gets implemented this round. On `revise`, let the domain skill
     revise the proposal; if it reports a fresh adjudication table, treat
     that as a new round of step 3-4 (a new `respond-plan` gate, same
     shape, and the report update from step 3 applies again). On `skip`,
     go straight to Gate 2: reply and skip threads still get their drafted
     replies posted, there is just nothing to implement first. A thread
     answered `fix:` under `skip` stays unimplemented and has no finalized
     reply, so it is held out of Gate 2 rather than posted as a draft.
6. **Gate 2 — post.** Build the post questions from the finalized replies:

   ```json
   [
     {"id": "replies", "label": "Post which replies?", "multi": true, "options": ["<threadId> per drafted reply"]},
     {"id": "disposition", "label": "Disposition", "multi": false, "options": ["resolve-addressed", "leave-open"]}
   ]
   ```

   - **Open the gate:**
     `<status-bin> gate open <state> --kind respond-post --questions <json> --context <context text>`
     The output is one JSON line: `{"gateId": "...", "presentation": "form"}` or `"wait"`.
     The context text is the reviewer thread quoted verbatim plus the drafted
     reply or fix summary for each thread, within the 8192 UTF-8 byte cap; if
     it would exceed the cap, omit `--context` entirely rather than trimming
     it.
   - **presentation "form":** present the SAME questions as the native
     structured-question form. Render each option's `label` when it has one
     and submit the chosen option's `value` verbatim; never an index, never a
     paraphrase. Submit exactly one
     `<status-bin> gate answer <state> --answers <json> --by pane` after the
     form. A printed conflict answer means another surface won: say so in one
     line and proceed on the printed winning answer. If the form is dismissed
     under you and a message arrives saying the gate was answered elsewhere,
     that message is a verify-only signal and never carries the answer: run
     `<status-bin> gate wait <state> --max-ms 1000`, read the recorded
     answer, and proceed on it.
   - **presentation "wait":** do NOT present a form. Launch ONE background
     shell command (the shell tool's run-in-background mode) that loops
     `<status-bin> gate wait <state> --max-ms 90000`, re-running while it
     prints `{"status":"pending"}`, and exits printing the answered JSON as
     its last stdout. Then END YOUR TURN in one line: `holding at gate
     <gateId>`. The pane is idle but armed: typed input lands instantly, and
     the loop's completion re-invokes this pane with the answer as the tool
     result. On re-invoke, proceed on the answer exactly as the form branch
     does. A wait that fails with a closed or not-found message is terminal:
     follow this wrapper's existing closed-gate rules.
   - **Act on the answer.** Hand `{post: <answers>, by: <by>}` to the domain
     skill so it can execute the posting, or post the selected replies
     yourself on the generic no-domain-skill path — `by` is the wait's own
     decider field, so the domain skill's decision record names who actually
     decided instead of guessing.
7. **Mark done, with the counts.** After the run wraps, report what actually
   happened to the replies:
   `<status-bin> respond-status <state> done "<one-line summary>" --posted <n> --threads <n>`
   - `--threads` is the number of unresolved human threads the run set out to
     answer, i.e. the rows in the verdict table.
   - `--posted` is how many of those actually received a posted reply, per
     Gate 2's `replies` answer.

   The board derives the badge from this pair, so a wrong count is a wrong
   badge: `3/3` reads "replies posted", `2/3` reads "2 of 3 posted", `0/3`
   reads "replies drafted, not posted". Keep the message short, e.g.
   `"3 threads: 2 fixed, 1 pushback"` or
   `"no valid threads... replied with technical pushback"`.
8. **On failure.** `<status-bin> respond-status <state> error "<what went wrong>"`,
   then stop and report to the human in the pane.

## Gate protocol (both gates)

Both Gate 1 (`respond-plan`) and Gate 2 (`respond-post`) share the same
closed-gate/escape-hatch/degraded-mode mechanics, self-contained here since
each gate follows it independently. (The open/presentation/wait mechanics are
inline at each gate above, since the questions and context differ per gate.)
`gate wait`'s answered form is `{"answers": {...}, "by": "...", "answeredAt": ...}`,
keyed by that gate's own question ids: `replies`/`disposition` for Gate 2,
read as `answers.<id>`; for Gate 1, one `thread-<n>` id per unresolved
thread plus `code-changes`. Read Gate 1's thread answers by iterating every
key other than `code-changes` and splitting each value at its first `:`
into the verb and the thread id: the thread id is in the value, and the
`thread-<n>` key is never a join key.

- **Closed or missing gate.** If `gate wait` fails with `gate <id> closed (<reason>)`,
  the decision site itself was abandoned — superseded, abandoned, or pruned
  when the MR left the board. A `not-found` error or `no gate open for <url>`
  mean the same thing from a different angle: the gate this pane was
  tracking no longer exists to wait on. All three are terminal, not
  transient — do not re-run any of them. End cleanly: say so in the pane and
  stop. Do not invent an answer, do not mark `done`, and do not write `error`
  either — when the reason is a fresh pane superseding this one, that fresh
  pane already owns this MR's state file, and a late write here would stomp
  it.
- **In-pane escape hatch.** If a human interrupts the wait and answers you
  conversationally in the pane instead of through the board, record it so
  any parked resume stays in sync:
  `<status-bin> gate answer <state> --answers <json> --by pane`.
  - **Strict membership.** Each recorded answer value must be one of that
    question's option strings, verbatim (e.g. `"approve"`,
    `"fix:t1"`) — the daemon rejects anything else. Carry the
    human's phrasing, hedges, or nuance in the note form instead:
    `{"code-changes": {"value": "approve", "note": "approve but hold off on thread 3"}}`.
  - **CAS loss.** `gate answer` prints nothing and exits 0 when the pane's
    answer was recorded and stands. If it instead prints one JSON line,
    someone answered first through another surface — that printed answer is
    the recorded one. Proceed on it, not on the conversational answer given
    in the pane, and tell the human which answer won.
  - **Reading answers back.** Whether from `gate wait` or a CAS-loss line, a
    question's answer may be the bare option string/array or the
    `{value, note}` object — read `value` in the object case.
- **Degraded mode.** If `gate open` exits nonzero (the daemon was down at
  open time), fall back to ONE `AskUserQuestion` carrying that gate's own
  questions and proceed on its answers. A failing `gate wait` is not itself
  degradation — per the presentation branches above, re-run it; only if it keeps
  failing, and never with the closed message or the terminal errors above
  (those end cleanly per "Closed or missing gate" instead), fall back to the
  same `AskUserQuestion`, and tell the human why.

## Rules

- Always write `triaging` first and a terminal `done`/`error` when finished,
  so the board badge never gets stuck — except a closed or missing gate (see
  "Closed or missing gate" above): end without either, since a fresh pane may
  already own the state file. The board owns `queued`; you own the middle.
- The state, status-bin, and report paths are absolute and given to you. Only
  write status via `--status-bin`, and drafted/finalized replies only to
  `--report`. Always save the report before Gate 1 opens, and update it with
  finalized replies before Gate 2 opens. Never touch the state file directly.
- Both gates are non-negotiable. Never implement fixes or post replies
  without the human's explicit answer at the relevant gate, even to hurry
  the badge to `done`. `done` follows the human's Gate 2 pick, not your own
  call, and `--posted` counts what actually went up, never what you drafted.
- After marking done, stay in the pane so the human can act on leftover drafts.
- If there are zero unresolved human threads, mark
  `done "no unresolved threads" --posted 0 --threads 0`. That is not an
  error condition, and neither gate opens.
