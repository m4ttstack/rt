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
