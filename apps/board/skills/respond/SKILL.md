---
name: board:respond
description: >-
  Thin, domain-agnostic wrapper the mr-board launches to process review feedback
  on your OWN MR in a fresh herdr pane. Emits lifecycle status through the
  board's status CLI, then delegates the actual work to the skill named by --skill.
  Invoked as "/board:respond <mrUrl> --state <path> --status-bin
  <path> [--report <path>] [--skill <name>]". When no --skill is given, the domain skill is
  resolved from the respond slot binding in .mattstack/skills.jsonc. Not for
  manual use.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*), Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)
metadata:
  slots: "respond"
  slot-respond: "required mr-respond@2 -- owns processing review feedback on one MR: fetching threads, adjudicating, drafting, implementing decided fixes, and executing posting once handed the decisions. Never presents decision gates or decides what posts. When gate 2 offers nothing, posts the reply-only threads on {plan}."
---

# mr-board respond runner

The mr-board spawned this pane to process the review feedback on ONE of your own
MRs and report status back to the board through its status CLI. This wrapper carries
**no** domain knowledge — the board injects it:

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | your merge request whose feedback to process |
| `--state <handle>` | opaque board handle for this MR's response. Pass it verbatim to `--status-bin` and the `gate` verbs; never read, stat, or write it. It looks like a `.json` path but no such file exists: board state lives in the board's database, and the path is only a key. Its absence on disk says nothing about whether the board is tracking this pass. |
| `--status-bin <path>` | absolute path to the board's status-writer CLI |
| `--report <path>` | where the fill saves the adjudication table and drafted/finalized replies; a resumed pane posts from it |
| `--skill <name>` | the domain skill that owns the actual work (optional) |
| `--skill-path <path>` | absolute path to that skill's SKILL.md, when the board already resolved it (optional; see "Resolving the domain skill") |
| `--resumed-gate <gateId>` | this invocation is a parked-gate resume, not a fresh run (optional; see "Steps") |
| `--resumed-gate-kind <kind>` | the `kind` of the gate `--resumed-gate` names (e.g. `respond-post`). Present exactly when `--resumed-gate` is, and the only way to learn it: `--state` is an opaque handle and `gate wait` returns only the answer. |
| `--round <n>` | the round to delegate at, carried over from an earlier pane on this MR (step 3's `--round` flag on `respond-status`). Present on a parked-gate resume when a prior pane got as far as recording one, or on a fresh run when the board found a prior recorded round for this MR (a new run responding to a further round of review); absent means round 1, either because this is the MR's first round or because the prior pane predates this flag. |

Write status **only** by running the injected `--status-bin`:

```
<status-bin> respond-status <state> <status> [message]
<status-bin> respond-status <state> done <message> --posted <n> --threads <n> [--held <n>]
```

The board tracks five in-flight statuses; emit each as you cross the milestone:

| Status | When to emit |
|--------|--------------|
| `triaging` | Immediately, before fetching threads. |
| `implementing` | Only after Gate 1's `code-changes` question comes back `approve`, before touching code. Skip when no threads need code changes. |
| `drafting` | When presenting the verdict table + drafted replies (before Gate 1), and again right before Gate 2 opens, on every path: after implementing, and after drafting a reply override with nothing implemented. |
| `done` | After the run finishes. REQUIRED: `--posted <n> --threads <n>`, plus `--held <n>` whenever a gate decision kept any reply from posting (see step 7). |
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
  `--resumed-gate-kind` to learn which gate `--resumed-gate` names, never
  guessing it from context, and re-emit the status it actually implies:
  - `respond-plan` → `<status-bin> respond-status <state> implementing`
    (already correct, but emit it anyway so a stale write can never linger).
  - `respond-post` → `<status-bin> respond-status <state> drafting`
    (corrects the wrong transient — a Gate 2 resume is finalized replies
    waiting to post, not code changes waiting to be written).
- **Recover the round.** Read `--round <n>`; absent means round 1. This
  pane's own conversation has no memory of the round an earlier pane was
  on, so this flag is the only way to know it. Use it as the current round
  for anything below that needs one: telling the domain skill the round
  when handing it a resumed adjudication, and as the base for "the next
  round number" on a further `revise` (step 5). If revising produces a new
  round, record it the same way step 3 does, before that round's Gate 1
  reopens: `<status-bin> respond-status <state> drafting --round <n+1>`.
- `<status-bin> gate wait <state>` — the verb is registry-status-first, so on
  an already-answered gate it returns the recorded answer at once instead of
  blocking.
- **Act on the answer, by `--resumed-gate-kind`.** Read `--report <path>` first: it
  holds the adjudication table and drafted/finalized replies a fresh pane has
  no other way to recover once the pane that produced them is gone. Never
  re-adjudicate and never re-implement from scratch:
  - `respond-plan` → implement from the report's decided plan: the wait's
    `{plan: <answers>, by: <by>}` select among the report's threads. Join
    each answer to its report row by the thread id inside the option VALUE
    (every `answers` key other than `code-changes` holds one
    `<verb>:<threadId>`, or a `{value, note, text}` object around it: unwrap
    `value` first, then split at the first `:`), never by the `thread-<n>`
    question id, which is only a container. A report carrying the line
    `gate-1-context: dropped` makes every `reply:` answer with no `text`
    an override (step 5). Hand the report
    and those answers to the domain skill exactly as step 5 would have, then
    carry on exactly as steps 5-6 describe below: emit `drafting` and open
    Gate 2 **fresh** over only the threads step 6 offers (even with nothing
    implemented, e.g. `code-changes: skip` with a reply override), and the
    reply-only threads post as step 6 says.
  - `respond-post` → execute posting FROM THE REPORT's finalized replies plus
    the wait's `{post: <answers>, by: <by>}` (a thread answer's `text`
    replaces that thread's report reply), never re-adjudicating or
    re-implementing. The report's reply-only threads (rows with
    `gate-1: reply`, read from the rows, never from the recommendation)
    post in the same pass, each with the reply its row records,
    unresolved, unless the answer names one (step 6's act paragraph).
    Hand both to the domain skill exactly as step 6 would have.
- `<status-bin> respond-status <state> done "<one-line summary>" --posted <n> --threads <n> [--held <n>]`
  (the counts follow step 7's definitions, `--held` included)

Every other step below (delegating to the domain skill for adjudication,
opening a gate, `gate open`) that precedes the resumed gate is skipped. This
invocation supersedes any earlier gate contract remembered in the
conversation.

**Otherwise, a fresh run:**

1. **Mark triaging.** `<status-bin> respond-status <state> triaging`
2. **Adjudicate.**
   - **If a domain skill resolved** (explicit `--skill`, else the `respond`
     slot per "Resolving the domain skill"): delegate to that skill, telling
     it exactly these four things:
     - the MR url;
     - the `--report <path>`;
     - the round: `1` on this first delegation, one more for each `revise`
       re-adjudication (step 5) -- unless this launch itself carries
       `--round <n>` (a fresh run the board started for an MR with a prior
       recorded round, e.g. responding to a further round of review), in
       which case use that `<n>` as this run's round instead of defaulting
       to 1; step 3 records the round via `--round` so a parked-then-resumed
       pane can recover it (see "Parked-gate resume?");
     - that this wrapper owns both gates, so it opens neither: it hands
       back instead, including the path of each fitted open file it builds.

     It owns the real work — resolving the
     MR/ticket, fetching unresolved human threads, adjudicating each one, and
     drafting replies and proposed fixes — then reports back to you the
     adjudication: a
     verdict table (one row per thread, with its recommended reply/fix/skip)
     plus whether it is proposing code changes, and the absolute path of a
     fitted Gate 1 open file when it built one. It never presents a gate or decides what gets implemented or
     posted; this wrapper owns both facility gates (steps 4 and 6) and hands
     the domain skill `{plan: ...}` to act on once a human has answered, and
     `{post: ...}` only when Gate 2 opened.
   - **If no domain skill resolved:** Before drafting, call
     `mcp__plugin_mattstack_mattstack__rt_verb` with
     `{"args": ["skills", "writing-style", "show"]}` and load the skill its `skill`
     names. That load is step one: compose in that voice from the first word, never as
     a pass over a finished draft. If the tool is unavailable, refused, or fails, load
     the skill named on the `writing-style:` line of
     `~/.mattstack/user/skills/preferences.md` if there is one. If that is missing
     too, or the skill will not load, load `mattstack:writing-style-conversational`.
     Then fetch the MR's unresolved review threads yourself, adjudicate each on its
     merits, and draft replies and any proposed fixes. Build your own verdict table
     for the gates below.
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
   opens.) Then: `<status-bin> respond-status <state> drafting --round <n>`
   (the round from step 2, so a pane that parks and later resumes can
   recover it instead of guessing 1)
4. **Gate 1 — plan.** **Handed a fitted open file?** Then that file IS
   this gate: `gate-ctx.sh fit` output whose `.questions` already have the
   shape below, each thread's structured context on its question and the
   planned fix on its `fix` option. Open it with:

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> respond-plan <open-file>
   ```

   It prints the same one-line `{"gateId": ..., "presentation": ...}` as
   `gate open`, with `"contextOmitted": true` added when the daemon dropped
   the question contexts, and exits with its status. A `fits: false` file is still
   over the shared context budget; the script drops whole question
   contexts, largest first, until it fits, so the file goes in untouched:
   never rebuilt, re-ordered, trimmed, or hand-edited. Then skip to
   "Record a dropped context" below.

   **Otherwise, build the gate yourself.** Build ONE single-select question per unresolved
   thread, in verdict-table order, plus one `code-changes` question, per
   the shape below. A thread question's id is `thread-<n>` by 1-based
   position, its label is that thread's `<file>:<line>`, and its three
   options carry the verb plus the thread id VERBATIM in the value and the
   bare verb in the label (the ids shown are placeholders; substitute the
   real ones):

   ```json
   [
     {"id": "thread-1", "label": "<file>:<line>", "multi": false,
      "context": "<this thread's reviewer comment quoted verbatim, then the drafted reply or fix summary for it>",
      "options": [{"value": "reply:<threadId>", "label": "reply"}, {"value": "fix:<threadId>", "label": "fix"}, {"value": "skip:<threadId>", "label": "skip"}]},
     {"id": "thread-2", "label": "<file>:<line>", "multi": false,
      "context": "<thread 2's own quote + draft>",
      "options": ["... the next thread's reply/fix/skip triple, its own id and context verbatim; one such question per thread"]},
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
   `code-changes`, unwraps a `{value, note, text}` object to its `value`, splits
   at the first `:`, and joins the thread id to the report row. The `thread-<n>` id is a container; nothing keys
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
     The output is one JSON line: `{"gateId": "...", "presentation": "form"}` or `"wait"`,
     with `"contextOmitted": true` added when the daemon dropped the question
     contexts; step 5 then counts every thread's context as dropped.
     Each thread's material rides its own question's `context` field (the
     shape above), so every surface shows the quote and draft WITH the
     question it belongs to. `--context` itself carries only what is shared
     across threads (the MR and round, one or two lines); `--context` plus
     every question `context` share one 8192 UTF-8 byte budget, and when the
     total would exceed it, drop question `context` fields first, then
     `--context`, never trimming any of them mid-text.
   - **Record a dropped context.** On either path, when the open was a
     `fits: false` file, its output carried `"contextOmitted": true`, or
     you dropped any question context for the byte budget, write one
     line, `gate-1-context: dropped`, into `--report <path>` right after
     the open and before waiting on any answer. A resumed pane has no
     other way to know those cards never showed their drafts (step 5).
   - **presentation "form":** follow `mattstack:gate-protocol`'s "Acting
     on the response" (form branch) and "CAS and the doorbell" sections
     (stable source checkout, machine-local by design: `cat
     ~/Documents/GitHub/mattstack-skills/attachments/gate-protocol/SKILL.md`)
     for the mechanical rendering rule and the conflict rule (a printed
     conflict answer, or a doorbell message while a form still sits
     open, means another surface won: proceed on the winning answer,
     never the one you were about to submit; the doorbell is
     verify-only, run `<status-bin> gate wait <state> --max-ms 1000` to
     read the recorded answer). Three things stay local, not covered there
     (gate-protocol never mentions framing placement or folding one
     question's answer into another option, at all): your framing and
     reasoning go in the pane prose or option descriptions, never into
     rewritten question or option text; never as an option that folds
     another question's answer in; and Gate 1's own wrinkle -- the form
     tool takes at most four questions per call, so chunk: the thread
     questions in order, up to four per call, until every thread is
     asked; then, if any thread's answer is a `fix:` value, ask
     `code-changes` in one more call, otherwise fill `code-changes:
     "skip"` without asking (the same hide rule the board and console
     cards apply). Submit exactly one `<status-bin> gate answer
     <state> --answers <json> --by pane` after the LAST call, carrying
     every thread question's answer plus `code-changes`; never one per
     chunk. That answer never carries `text`: whatever the human types in
     the form's free-text field, a full replacement reply included, rides
     as `note`, which makes a `reply:` pick a reply override (step 5).

     Each thread's form question: header `Thread <n>`; question text its
     label, a newline, its prose context, then `Reply, fix, or skip?`;
     options with the gate's labels and descriptions. A gate opened from
     a fitted file never shows its JSON in the form: run the
     `gate-ctx.sh` the domain skill fitted it with in `prose` mode on the
     source file beside it (`sh <gate-ctx.sh> prose <
     <dir>/respond-plan.source.json`), take each thread's prose `context`
     from that output, and print its `.context` as one pane line before
     the first form call.
   - **presentation "wait":** follow `board:gate-cli-recipes`'s "Wait
     recipe" section (`cat ${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md`)
     for the background-wait mechanics, unchanged; the gate to name in
     `holding at gate <gateId>` is this one.
5. **Act on the plan.** Hand `{plan: <answers>, by: <by>}` to the domain
   skill (or act on it yourself on the generic no-domain-skill path); `by`
   is the wait's own decider field, so the domain skill's decision record
   names who actually decided instead of guessing. Each thread's
   disposition is the verb in its answer value (`reply:<id>`, `fix:<id>`,
   or `skip:<id>`, read off every key other than `code-changes`, taking
   `value` first when the answer is a `{value, note, text}` object), and the
   `code-changes` answer decides whether anything gets implemented this
   round. A `reply:` answer's `text`, when present, is the edited reply:
   it replaces the drafted one for that thread. First record the answer
   in `--report <path>` (the domain skill does this on its path): each
   row gains a `gate-1` field (`reply`, `fix`, `skip`, or `override`), and
   an edited reply's `text` replaces the draft in its row, so posting (a
   resume included) reads which threads are reply-only (`gate-1: reply`)
   from the rows, never from the recommendation.

   A `reply:` answer that carries `text` posts that text, note or not: the
   human wrote the exact words. A `reply:` answer with no `text` is a
   **reply override** when its Gate 1 card did not show its reply word for
   word, or when the answer carries a `note` (in the pane form a note is
   the only place a typed replacement can go). A card did not show its
   reply when the verdict table recommended `fix` or `skip` (the card
   showed a fix direction or nothing), or when its question context never
   reached the gate: you dropped it for the byte budget, or the open was a
   `fits: false` file or its `gate open` output flagged `contextOmitted`
   (then count every question's context as dropped). This holds whoever
   answered, the pane included. On a resume, `--report` carrying the
   line `gate-1-context: dropped` (step 4) counts every question's
   context as dropped too. Draft an override's
   reply after Gate 1, with its note when it has one, write that reply
   into its row, and set the row to `gate-1: override` (the domain skill
   does this on its path). Step 6 offers it at Gate 2.

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
     revise the proposal, telling it the next round number (the current
     round plus one; see "Recover the round" above when this pane is
     resuming one); if it reports a
     fresh adjudication table, treat
     that as a new round of step 3-4 (a new `respond-plan` gate, same
     shape, opened from its fresh open file when it hands one back, and the
     report update from step 3 applies again, recording the new round). On `skip`,
     go to step 6 with no fixed thread: Gate 2 opens only for a reply
     override, and otherwise the reply-only (`gate-1: reply`) threads post
     right away. A thread answered `fix:` under `skip` stays unimplemented
     and has no finalized reply, so nothing posts for it and step 7 counts
     it as held.
6. **Post; Gate 2 only for replies not yet seen.** Gate 1 already approved
   each reply it showed word for word, so Gate 2 (`respond-post`) offers
   exactly the replies the human has not yet seen: each thread a fix
   finalized in step 5, and each reply override.
   - **Reply-only threads** (rows with `gate-1: reply`) post the reply
     their row records (Gate 1's `text` when present, the draft
     otherwise), never resolved, so the reviewer can answer. On the
     generic path you post them; with a domain skill it posts them, so
     never post one twice.
   - **Nothing to offer** (no fixed thread and no reply override; never on
     `code-changes: revise`, which posts nothing and reopens Gate 1): open
     no Gate 2. The reply-only threads post right after Gate 1 (a domain
     skill posts them on `{plan: ...}` and hands back no Gate 2 file, so
     post nothing yourself); then go to step 7.
   - **Threads to offer:** emit `drafting`
     (`<status-bin> respond-status <state> drafting`), then open Gate 2
     over them as below, whether or not anything was implemented. The
     reply-only threads wait for its answer, then post together with its
     picks.

   **Handed a fitted open file?** (the domain skill hands one back with
   its finalized replies when it builds one.) Open it exactly as Gate 1's
   file, with kind `respond-post`:

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> respond-post <open-file>
   ```

   Its questions end with a pane-only `next` navigation question this
   wrapper does not ask; the script drops it, and applies the same budget
   rule. In the form branch, flatten the source beside it the same way
   (`respond-post.source.json`) and leave `next` out. Then skip to the
   presentation branches below.

   **Otherwise, build the gate yourself** from the finalized replies: ONE
   multi-select question per offered thread, in verdict-table order (a
   reply-only or `skip:` thread gets none). Its id is `thread-<n>` by 1-based
   position among these threads, its label the thread's `<file>:<line>`,
   and its two options `post:<threadId>` and `resolve:<threadId>`, thread
   id VERBATIM:

   ```json
   [
     {"id": "thread-1", "label": "<file>:<line>", "multi": true,
      "context": "<this thread's file:line, then the reply text that will post>",
      "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                  {"value": "resolve:<threadId>", "label": "resolve", "recommended": true, "description": "resolve the thread"}]},
     {"id": "thread-2", "label": "<file>:<line>", "multi": true,
      "context": "<thread 2's file:line and reply>",
      "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                  {"value": "resolve:<threadId>", "label": "resolve", "description": "resolve the thread"}]}
   ]
   ```

   `post` is recommended on every offered thread; `resolve` only on a
   thread whose reply finalizes a fix, so a reply override stays open for
   the reviewer unless the human ticks it. Post and resolve are
   independent: both, either one, or neither.

   - **Open the gate:**
     `<status-bin> gate open <state> --kind respond-post --questions <json> --context <context text>`
     The output is one JSON line: `{"gateId": "...", "presentation": "form"}` or `"wait"`,
     with `"contextOmitted": true` added when the daemon dropped the question
     contexts.
     Each thread's finalized reply rides its own question's `context`, so
     the decision material sits with the question. `--context` carries only the shared
     frame (the MR and round); `--context` plus question `context` fields
     share one 8192 UTF-8 byte budget, dropped question-contexts-first when
     the total would exceed it, never trimmed mid-text.
   - **presentation "form":** follow `mattstack:gate-protocol`'s "Acting
     on the response" (form branch) and "CAS and the doorbell" sections
     (stable source checkout, machine-local by design: `cat
     ~/Documents/GitHub/mattstack-skills/attachments/gate-protocol/SKILL.md`)
     for the mechanical rendering rule and the conflict rule (a printed
     conflict answer, or a doorbell message while a form still sits
     open, means another surface won: proceed on the winning answer,
     never the one you were about to submit; the doorbell is
     verify-only, run `<status-bin> gate wait <state> --max-ms 1000` to
     read the recorded answer). Its `rt gate answer <id> --answers ...
     --by pane` is this CLI's `<status-bin> gate answer <state>
     --answers <json> --by pane`, unchanged. Three things stay local,
     not covered there (gate-protocol never mentions framing placement
     or folding one question's answer into another option, at all):
     your framing and reasoning go in the pane prose or option
     descriptions, never into rewritten question or option text; never
     as an option that folds another question's answer in; and a thread
     with neither picked is its question answered as an explicit empty
     array, which the daemon records -- Gate 2's own reminder.

     Each thread's form question: header `Thread <n>`; question text its
     label, a newline, its prose context (for a fitted file, that
     thread's line from `gate-ctx.sh prose` on the source beside it:
     `<file> FIX · <sha>: <text>` or `<file> REPLY: <text>`), then `Post,
     resolve, both, or neither?`; a multi-select with the gate's labels
     and descriptions. Ask the thread questions in order, up to four per
     call, and submit exactly one `<status-bin> gate answer <state>
     --answers <json> --by pane` after the last call, carrying every
     thread question's answer. That answer never carries `text`: whatever
     the human types in the form's free-text field, a full replacement
     reply included, rides as `note`, and the report's finalized reply
     posts.
   - **presentation "wait":** follow `board:gate-cli-recipes`'s "Wait
     recipe" section (`cat ${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md`)
     for the background-wait mechanics, unchanged; the gate to name in
     `holding at gate <gateId>` is this one.
   - **Act on the answer.** Hand `{post: <answers>, by: <by>}` to the domain
     skill so it can execute the posting, the reply-only threads included,
     or act yourself on the generic no-domain-skill path: per Gate 2
     thread, `post:<threadId>` posts that thread's
     reply (the answer's `text` when it carries one, the report's finalized
     reply otherwise), `resolve:<threadId>` resolves the thread (after the
     reply when both are picked), and an empty array leaves it untouched;
     then post each reply-only thread's recorded reply, unresolved. When
     Gate 2 offered a `gate-1: reply` thread, or an answer value names one
     (a gate opened before this rule), that thread's answer decides it
     instead, an empty array included, and no reply posts twice.
     `by` is the wait's own decider field, so the domain skill's decision
     record names who actually decided instead of guessing.
7. **Mark done, with the counts.** After the run wraps, report what actually
   happened to the replies:
   `<status-bin> respond-status <state> done "<one-line summary>" --posted <n> --threads <n> [--held <n>]`
   - `--threads` is the number of unresolved human threads the run set out to
     answer, i.e. the rows in the verdict table.
   - `--posted` is how many of those actually received a posted reply:
     every thread that got a reply, i.e. each reply-only thread whose
     reply went up plus each Gate 2 thread (fixed or override) whose
     answer carries `post:`. Resolving counts toward neither number.
   - `--held` is how many of those deliberately got NO posted reply because
     a gate decided so: a `skip:` thread, a `fix:` thread held out under
     `code-changes: skip`, a Gate 2 thread (fixed or override) answered
     without `post:`, or a `gate-1: reply` thread an older Gate 2's answer
     kept down (a retired `replies` list that leaves it out, or an answer
     that names it without `post:`). Count a thread here only when a gate answer settled
     it without a reply going up; a thread the run simply never got to is
     neither posted nor held.

   The board derives the badge from these counts, so a wrong count is a
   wrong badge: `3/3` reads "replies posted", `2/3` reads "2 of 3 posted"
   and nags with a resume offer, `2/3 + 1 held` reads "replies posted,
   1 held" and finishes clean, `0/3` reads "replies drafted, not posted".
   Omitting `--held` for a gate-held reply leaves the board offering a
   pointless resume forever on a thread the human already settled. Keep the
   message short, e.g. `"3 threads: 2 fixed, 1 pushback"` or
   `"2 threads: 1 fixed, 1 reply held per gate"`.
8. **On failure.** `<status-bin> respond-status <state> error "<what went wrong>"`,
   then stop and report to the human in the pane.

## Gate protocol (both gates)

Both Gate 1 (`respond-plan`) and Gate 2 (`respond-post`) share the same
closed-gate/escape-hatch/degraded-mode mechanics, self-contained here since
each gate follows it independently. (The open/presentation/wait mechanics are
inline at each gate above, since the questions and context differ per gate.)
`gate wait`'s answered form is `{"answers": {...}, "by": "...", "answeredAt": ...}`,
keyed by that gate's own question ids: for Gate 1, one `thread-<n>` id per
unresolved thread plus `code-changes`; for Gate 2, one `thread-<n>` id per
offered thread, each an array of `post:<threadId>` and/or
`resolve:<threadId>`. Read either gate's thread answers by iterating every
key other than `code-changes`, unwrapping a `{value, note, text}` object to
its `value`, and splitting each value at the first `:` into the verb and
the thread id: the thread id is in the value, and the `thread-<n>` key is
never a join key. A Gate 1 `reply:` answer's or a Gate 2 answer's `text`,
when present, is the reply to post for that thread; the note never is. A
Gate 2 opened before this shape (a `replies` multi, or its `replies-1`,
`replies-2`, ... chunks, of bare thread ids plus `disposition`) still
reads as it did: post the union of the selected replies, and resolve them
only on `resolve-addressed`.

A PreToolUse hook may deny native AskUserQuestion when no gate is open; that
denial is the gate protocol speaking: open the gate as this section
describes. When the daemon is down the hook allows the native form
(degraded mode is unchanged).

- **Closed or missing gate.** Follow `board:gate-cli-recipes`'s "Closed or
  missing gate" section (`cat
  ${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md`) for the terminal
  handling, unchanged.
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
    silent-success-versus-JSON-line contract. Specific to these gates: the note
    form example is `{"code-changes": {"value": "approve", "note": "approve
    but hold off on thread 3"}}`, and a Gate 2 thread's explicit empty
    array (`{"thread-2": []}`) is also valid, recording the decision to
    neither post its reply nor resolve it.
- **Degraded mode.** If `gate open` exits nonzero (the daemon was down at
  open time), fall back to the native form alone, chunked exactly as that
  gate's form branch describes (Gate 1: thread questions four per call,
  then `code-changes` only after a fix; Gate 2: its thread questions four
  per call), and proceed on the combined answers. Follow
  `board:gate-cli-recipes`'s "A failing wait is not degradation" section for
  when to retry `gate wait` versus fall through to this same
  `AskUserQuestion`.

## Rules

- Always write `triaging` first and a terminal `done`/`error` when finished,
  so the board badge never gets stuck — except a closed or missing gate (see
  "Closed or missing gate" above): end without either, since a fresh pane may
  already own this MR's board state. The board owns `queued`; you own the middle.
- The state handle, status-bin, and report paths are given to you. Only
  write status via `--status-bin`, and drafted/finalized replies only to
  `--report`. Always save the report before Gate 1 opens, and update it with
  finalized replies before Gate 2 opens. Never try to read or write `--state`
  yourself; it is a handle, not a file (see the flag table).
- Both gates are non-negotiable. Never implement fixes or post replies
  without the human's explicit answer at the relevant gate (Gate 1's
  `reply:` for a reply-only thread, Gate 2 for a fixed thread or a reply
  override), even to hurry the badge to `done`. `done` follows the human's
  gate answers, not your own call: `--posted` counts what actually went up,
  never what you drafted, and `--held` counts only what a gate answer kept
  down.
- After marking done, stay in the pane so the human can act on leftover drafts.
- If there are zero unresolved human threads, mark
  `done "no unresolved threads" --posted 0 --threads 0`. That is not an
  error condition, and neither gate opens.
