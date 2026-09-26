# RED/GREEN: board:respond never re-posts on a resume; zero threads is done

Scope: `apps/board/skills/respond/SKILL.md`. The wrapper half of
receive-review's Posted already rule, on the generic path, plus BOARD-47
(the status table's `error` row listed "no threads to process" while
step 2 and the Rules treat a zero-thread MR as a normal `done`).

- **Posted already.** A new bullet under "Parked-gate resume?", before
  "Act on the answer": before any reply posts on a resume, or a fresh
  Gate 2 offers a thread, read each thread on the forge. A thread that
  already carries this run's reply (a note whose text is the reply due,
  or any note by the account this pane posts as dated after the resumed
  gate's `answeredAt`) is posted: it counts toward `--posted`, is never
  offered at a fresh Gate 2, and is never posted again, whatever
  `--report` says. With a domain skill, hand it the resume as such; on
  the generic path, do it yourself, before the push rule.
- **Step 6's generic act bullet** skips every thread that read found
  posted.
- **BOARD-47.** The `error` row drops "no threads to process"; the
  `done` row reads "After the run finishes, zero threads included."

The bound is the resumed gate's `answeredAt`, not "the run started": the
generic path has no run record, and nothing this run posts can precede
the answer being replayed, so the wait's own timestamp is the observable.

## Scenarios

Under `scenarios/`, generic path, on the invented MR !87 (source branch
`renee/queue-retry`). T1 is a `gate-1: fix` row at ab12cd3, T2 a
`gate-1: reply` row, T3 a `gate-1: override` row.

- `wrap-resume-posted-already.md`: a `--resumed-gate-kind respond-post`
  pane; the earlier pane died at `drafting` after the board answered
  Gate 2 over T1 and T3, and whether it posted anything is not stated.
  The wait returns post and resolve on T1, post on T3. Asks for every
  command, forge action (reads included) and status write, with the
  `done` counts. The forge state is deliberately not given: the rep has
  to read before posting.
- `wrap-zero-threads.md`: a fresh run whose fetch finds no unresolved
  human thread. Asks for the status writes and the badge.

## Method

As in `../2026-09-23-respond-push-before-fixed/board-respond.md`:
single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
<scenario>`, a fresh empty directory per rep. System file: the wrapper's
SKILL.md itself. 5 reps for the resume scenario, 1 for zero threads.
Every rep read in full.

## Pass criteria

- **wrap-resume-posted-already:** each thread's note chain is read on
  the forge before any reply posts, for the reply text or an own-account
  note after `answeredAt`; a thread carrying one is skipped and counted
  toward `--posted`; otherwise the checks, `git push origin
  renee/queue-retry`, T1 posted and resolved, T3 posted, T2 posted
  unresolved, `done --posted 3 --threads 3`.
- **wrap-zero-threads:** `done "no unresolved threads" --posted 0
  --threads 0`, never `error`.

## RED (main, 20187664)

| Scenario | Result | Notes |
|---|---|---|
| wrap-resume-posted-already | 0/5 | Every rep reads the report and the MR record (for the source branch), pushes, then posts T1, T3 and T2 straight from the report with no read of any thread's notes and no skip rule; all five end `--posted 3 --threads 3`. Rep 5: "this fresh pane has no memory of an earlier fetch", and still posts blind. |
| wrap-zero-threads | 1/1 | A guard: `done "no unresolved threads" --posted 0 --threads 0`, "not an error". The table's stray example did not mislead it, so BOARD-47 is a table-versus-steps consistency fix. |

## GREEN (this change)

| Scenario | Result | Notes |
|---|---|---|
| wrap-resume-posted-already | 5/5 | Every rep reads T1, T2 and T3's note chains before anything posts, applies both tests, then runs the checks, the push and the posts in order, ending `--posted 3 --threads 3`. Rep 5: "Posted already check, forge reads, before anything posts ... no note by this pane's posting account is dated after `answeredAt`". With no forge state in the prompt, the skip branch is implied ("none count as posted already, so all three remain live") rather than spelled out. |
| wrap-zero-threads | 1/1 | Unchanged: `done --posted 0 --threads 0`, badge "no unresolved threads". |

## Review round (Opus, standing in for a rate-limited CodeRabbit)

Eight findings on 549981cd. Seven taken, one declined:

1. **Major, taken.** "skipping every thread the Posted already read
   found posted" also dropped the thread's `resolve:` pick, so a pane
   that died between posting and resolving left the human's resolve
   unrun. The bullet now says "its reply is never posted again ...
   though a `resolve:` pick on it still runs", and step 6's clause
   reads "posting no reply the Posted already check found already up
   (its `resolve:` pick still runs)".
2. **Minor, half taken.** The domain-skill hand-off now says the skill
   "hands back which replies posted, the ones it found already up
   included, for step 7's counts". Passing `answeredAt` to the skill is
   not needed (its own rule keys on the run's `started_at`), and the
   slot contract is left alone.
3. **Minor, taken.** The appositive is now a definition: "A thread
   already carries this run's reply when it holds either ... or ...
   Such a thread is posted".
4. **Minor, scoping taken.** The read covers "each thread this pass
   could post (Gate 2's threads and the reply-only rows)". The label
   "this run's reply" stays; the sentence now defines it.
5. **Minor, taken.** Step 6's clause no longer dangles ahead of "push
   rule below first".
6. **Nit, taken.** The anchor reads "before Gate 2 opens or step 6's
   push rule runs", so it fits a `respond-plan` resume too.
7. **Nit, taken.** The reply-only bullet gains "(on a resume, minus any
   the Posted already check found up)".
8. **Nit, declined.** The `done` row keeps "zero threads included"; the
   suggested wording grows the row.

Scenario added for finding 1: `scenarios/wrap-resume-posted-unresolved.md`,
the resume scenario plus what the forge shows: T1 carries the report's
T1 reply by this pane's account, dated after `answeredAt`, and is
unresolved. Pass: T1's reply is not re-posted, T1 is resolved, T3 and T2
post, `done --posted 3 --threads 3`.

| Scenario | RED (549981cd) | GREEN (this round) |
|---|---|---|
| wrap-resume-posted-unresolved | 4/5. Reps 1 to 4 skip the re-post and still resolve T1; rep 5 skips T1 "entirely (post or resolve) this pass", dropping the resolve. All five count T1 toward `--posted`. | 5/5. Every rep skips T1's re-post, resolves T1, posts T3 and T2, `--posted 3 --threads 3`. Rep 3: "`resolve:T1` still runs per the 'resolve pick still runs' rule." |
| wrap-resume-posted-already | (5/5 above) | 5/5. Unchanged shape; the read is now scoped to "every thread this pass could post". |
