# RED/GREEN: board:respond's Gate 2 asks post and resolve per thread

Scope: `apps/board/skills/respond/SKILL.md`, step 6 (the handed-back
file's form branch, the self-built gate, the open note, the form rule
and form recipe, the act paragraph), step 7's `--posted` / `--held`
definitions, and the "Gate protocol (both gates)" answer-reading,
empty-array and degraded-mode lines. A Gate 2 opened in the retired
shape (a `replies` multi plus `disposition`) keeps one line saying how
it still reads.

Two scenarios, committed beside this record as `scenarios/wrap-build.md`
(the generic no-domain-skill path builds Gate 2 itself) and
`scenarios/wrap-counts.md` (a handed-back per-thread open answered, then
the `done` counts), both on one invented MR (!87).

Method: single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
<scenario>`, a fresh empty directory per rep, 5 reps per scenario. System
file: the wrapper's SKILL.md itself, before (RED) and after (GREEN) the
edit. Build reps were scored by a script that parses the `--questions`
json; count reps by their `respond-status ... done` line.

## Pass criteria

Build: the questions are exactly `thread-1` (T1) and `thread-2` (T2), T3
(skipped) absent; each `multi` with options exactly `post:<id>` then
`resolve:<id>`; `post` recommended on both, `resolve` on T1 (the fix)
only; opened with `--kind respond-post`.

Counts: `done ... --posted 1 --threads 4 --held 3` for an answer that
posts and resolves T1, resolves T2 without posting, and leaves T4
untouched, with T3 skipped at Gate 1.

## RED (the wrapper before this edit)

Build: 0/5 PASS. Every rep built the retired gate, a `replies` multi over
bare thread ids plus `disposition` (`resolve-addressed` / `leave-open`).
Failure class: structural, the old recipe has no per-thread resolve.

Counts: 5/5 PASS. Handed a per-thread answer, every rep already counted
`post:` threads as posted and the rest as held, so the count text needed
only to stop naming the retired `replies-*` union, not new teaching.

## GREEN (the edited wrapper)

Build: 5/5 PASS. Counts: 5/5 PASS. First pass, no iteration.

## Review fix wave

An opus review asked for a rule on a run where no thread is offered.
`scenarios/wrap-none.md` is that run on the generic path, both threads
skipped. RED (the wrapper before any wording): 5/5 already opened no
Gate 2 and wrote `done ... --posted 0 --threads 2 --held 2`, so no
wording was added for it (the receive-review engine, which did fail
this case, carries the rule). The same wave reads a retired Gate 2's
`replies-1`, `replies-2`, ... chunks as one union and drops an em dash
from the act paragraph; neither changes a scenario outcome.

## Verdict

The self-built Gate 2 now matches the receive-review engine's
per-thread shape, and the count definitions read off `post:` directly.

## Editable replies: the answer's `text`

Scope: step 6's act paragraph and form branch, the `respond-post` resume
bullet, and the "Gate protocol (both gates)" answer reading. A Gate 2
answer's object form may now carry `text`, the reply the developer edited
on the board.

`scenarios/wrap-edited.md`: the generic path acts on a Gate 2 answer
where `thread-1` is `{"value": ["post:T1"], "text": "Fixed in ab12cd3,
with a test for the empty queue."}` and `thread-2` is `["post:T2"]`.
Pass: T1's body is exactly the answer's `text`, T2's body is its report
reply, and `done ... --posted 2 --threads 2`. Same method as above.

Three probes for loopholes the edit could open, committed beside it:

- `scenarios/wrap-text-no-post.md`: `thread-1` carries `text` with only
  `resolve:T1`. Pass: T1 resolved with nothing posted, T2 posts its
  report reply, `--posted 1 --threads 2 --held 1`.
- `scenarios/wrap-pane-note.md`: the in-pane form, where the human ticks
  post on both and types a full replacement for T1 in the free-text
  field. Pass: the `gate answer` json carries no `text`, the typed
  string rides as `note`, and T1 posts its report reply.
- `scenarios/wrap-resume-edited.md`: a parked `respond-post` resume on
  the generic path whose answer carries `text` for T1. Pass: `drafting`
  first, T1 posts the `text` and then resolves, T2 posts its report
  reply, `--posted 2 --threads 2`.

### RED (the wrapper before this edit)

wrap-edited: 0/5 PASS. Every rep posted T1's report reply and dropped
`text`; the counts were right in all five. Failure class: omission, the
answer reading unwrapped `{value, note}` and had no place for `text`.

### GREEN

wrap-edited: 5/5 PASS on the first wording. Probes on that wording:
wrap-text-no-post 5/5, wrap-resume-edited 3/5, wrap-pane-note 0/5.

- The pane probe failed in every rep: each wrote the typed replacement
  as `text` and posted it. The wrapper before any edit scored 4/5 on the
  same probe (the note rides and the report reply posts; one rep
  appended the note to the reply), so the edit opened this. The Gate 2
  form branch now says the pane's answer never carries `text`, which is
  receive-review's own rule.
- The two resume misses posted the right bodies but read the report
  before re-emitting `drafting`. The wrapper before any edit put
  `drafting` first in 5/5 (while posting the report reply for T1 in all
  five), and the final wording, whose resume bullet is unchanged from
  the first, put it first in 10/10, so no wording was added for it.

Final wording: wrap-edited 5/5, wrap-pane-note 5/5, wrap-text-no-post
5/5, wrap-resume-edited 10/10. Regressions: wrap-build 5/5 (scored by a
script that parses the `--questions` json), wrap-counts 5/5, wrap-none
5/5.
