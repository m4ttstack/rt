# RED/GREEN: board:respond opens Gate 2 only for replies not yet seen

Scope: `apps/board/skills/respond/SKILL.md`, the `respond-plan` and
`respond-post` resume bullets, step 4's form branch (the pane answer
never carries `text`), step 5 (a `reply:` answer's `text`, recording
Gate 1's verb in each report row, the reply override, the
`code-changes: skip` branch), step 6 (the reply-only, nothing-to-offer
and offered cases, the self-built gate over offered threads only, the act
paragraph), step 7's `--posted` / `--held` definitions, the "Gate
protocol (both gates)" `text` line and the "Both gates are
non-negotiable" rule.

Method: the same as
`docs/superpowers/tests/2026-09-22-respond-post-per-thread/board-respond.md`.
Single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
<scenario>`, a fresh empty directory per rep, 5 reps per scenario. System
file: the wrapper's SKILL.md itself. The first round's reps were read in
full; later rounds were scored by script (Gate 2 `--questions` parsed as
json, bodies, order and the `done` line matched), with every flagged rep
and a sample of passing reps read in full.

Wrapper versions below: **before** (the wrapper before this change),
**v1** (Gate 2 for fixed threads only), **v2** (plus the reply override
and report-row rulings), **v3** (plus the `gate-1` field, noted replies
and `text` precedence), **v4** (the fix round: dropped context,
`drafting` before every Gate 2, the legacy-resume guard, the domain-path
wording) and **v5** (the final-review round: the Gate 1 opener records
a dropped context in the report). v5 is the committed wording; see
"Final wording coverage" and "Fix round 2 (final review): v5".

## Scenarios

All on one invented MR (!87), committed under `scenarios/`.

- `wrap-replies-only.md`: generic path, Gate 1 answered with two `reply:`
  threads (T1 carrying `text`) and `code-changes: skip`. Pass: no Gate 2
  opens; T1 posts the `text`, T2 its draft, neither resolved;
  `done ... --posted 2 --threads 2`.
- `wrap-fix-and-reply.md`: generic path, `fix:T1`, `reply:T2` with
  `text`, `code-changes: approve`, then a Gate 2 answer for T1 only.
  Pass: Gate 2's questions are exactly `thread-1` over `post:T1` /
  `resolve:T1`, both recommended; after it, T1 posts and resolves, T2
  posts its Gate 1 `text` unresolved; `--posted 2 --threads 2`.
- `wrap-resume-post.md`: a `respond-post` resume whose report rows carry
  Gate 1's verb, an edited reply's text in place of its draft. T1 fixed,
  T2 `reply` (edited), T3 `skip`, and T4 recommended `reply` but
  answered `skip` with its draft still in the row. Pass: `drafting`
  first; T1 posts and resolves; T2 posts the edited text unresolved; T4
  does not post; `--posted 2 --threads 4 --held 2`.
- `wrap-plan-pane-note.md` (a probe for a loophole the edit could open):
  the in-pane Gate 1 form, where the human picks reply on both and types
  a replacement for T1 in the free-text field. Pass: the `gate answer`
  json carries no `text` and the typed string rides as `note`; no Gate 2
  opens; both drafts post unresolved; `--posted 2 --threads 2`.
- `wrap-reply-override.md`: T1 recommended `fix` (its card showed only
  the fix direction) answered `reply:T1` with no `text`; T2 recommended
  `reply` answered `reply:T2`; `code-changes: skip`. Pass: Gate 2's
  questions are exactly `thread-1` with `post:T1` (recommended) then
  `resolve:T1` (not recommended); T2 posts only after Gate 2's answer;
  T1 posts its reply drafted after Gate 1; neither resolved;
  `--posted 2 --threads 2`.

## RED

- wrap-replies-only, before: 0/5. Every rep opened a `respond-post` gate
  over both reply threads and posted nothing before it. All five did take
  T1's `text` as its reply, so reading `text` needed no teaching; the
  failure is structural.
- wrap-fix-and-reply, before: 0/5. Every rep offered T2 at Gate 2 beside
  T1, then posted only T1 (the answer had no `thread-2` key) and wrote
  `--posted 1 --threads 2 --held 1`.
- wrap-resume-post, before: 0/5. Every rep posted and resolved T1 and
  never posted T2 (`--posted 1`). The first run used a three-thread
  report without T4 (0/5, the same failure); the four-thread report
  scored 0/5 again, `--held 2` or `--held 3`. On v1 the four-thread
  report scored 5/5: T4 stayed down in every rep, so its case guards
  against regression.
- wrap-plan-pane-note, before: 0/5. The answer json was already
  `note`-only in 5/5, but every rep opened a Gate 2 over both threads,
  and every rep folded the typed note into T1's report reply.
- wrap-reply-override, before: 0/5. Every rep offered both T1 and T2 at
  Gate 2 and posted only T1 (`--posted 1`).
- wrap-reply-override, v1: 0/5. Every rep improvised a Gate 2 for T1, but
  four dropped the `resolve:T1` option, and three posted T2 before
  Gate 2 opened.

## GREEN

v1, first wording: wrap-replies-only 5/5, wrap-fix-and-reply 5/5 (parsed:
exactly `thread-1`, `post:T1` then `resolve:T1`, both recommended),
wrap-resume-post (three-thread report) 5/5, wrap-plan-pane-note 5/5. The
full read then found step 4's option-value paragraph still unwrapping
`{value, note}`; it now says `{value, note, text}` like the rest, and the
four re-ran on that file at 5/5 each.

v2, the final wording, first pass, 5/5 in every scenario:

- wrap-replies-only 5/5.
- wrap-fix-and-reply 5/5, parsed.
- wrap-resume-post 5/5: `drafting` first, T4 never posted.
- wrap-plan-pane-note 5/5.
- wrap-reply-override 5/5, parsed: `resolve:T1` present and not
  recommended; T2 posted after the answer in all five.

## Regressions, and the scenarios this retires

The per-thread record's premise that Gate 2 offers every thread with a
finalized reply is retired: a reply-only thread no longer appears in
Gate 2. Its scenario files stay as they were, as a record; the
updated versions live here. All on v2:

- `wrap-build` (the per-thread file, unchanged; pass criteria updated):
  the questions are now exactly `thread-1` (T1) with `post:T1` then
  `resolve:T1`, both recommended, `--kind respond-post`; T2 (reply-only)
  and T3 (skipped) absent; nothing posts before the wait. 5/5, parsed
  (also 5/5 on v1).
- `wrap-counts` (updated here): the fitted open file now offers only the
  fixed threads T1 and T4; T4 is answered resolve-only and the domain
  skill reports T2's reply posted from Gate 1. Pass:
  `--posted 2 --threads 4 --held 2`. 5/5 (also 5/5 on v1). The wrapper
  before this change also wrote the right counts in 5/5, but every rep
  called T2's post a gate bypass and flagged it to the human.
- `wrap-none` (the per-thread file, unchanged): 5/5, no Gate 2,
  `--posted 0 --threads 2 --held 2` (also 5/5 on v1).
- `wrap-edited` (updated here): Gate 2 now offers T1 only, answered
  `{"value": ["post:T1"], "text": "..."}`. Pass: T1 posts the `text`, T2
  posts its report reply unresolved, `--posted 2 --threads 2`. 5/5 (also
  5/5 on v1). The wrapper before this change scored 0/5: every rep
  posted only T1 and called leaving T2 out of Gate 2 its own mistake.

`wrap-text-no-post`, `wrap-pane-note` and `wrap-resume-edited` in the
per-thread record also put the reply-only T2 into Gate 2; they were not
re-run. `wrap-resume-post` here covers a resume with edited text.

## Follow-up: the `gate-1` field, noted replies, `text` precedence

Scope: the spec's "Report rows" now name a `gate-1` field (`reply`, `fix`,
`skip`, `override`), and a `reply:` answer carrying a note is an override
too. `text` wins: a `reply:` answer with `text` posts it, note or not.
Edits: the `respond-post` resume bullet (reply-only is `gate-1: reply`),
step 4's pane rule (a typed note makes a `reply:` pick an override), step
5's recording sentence and override paragraph, step 6's reply-only bullet,
and step 7's counts (Gate 2 threads are fixed or override). **v3** is this
wording.

Scenario changes, superseding the pass criteria above:

- `wrap-plan-pane-note.md` now expects Gate 2: the pane answer carries
  `note` and no `text`; Gate 2's questions are exactly `thread-1` with
  `post:T1` (recommended) and `resolve:T1` (not); T1 posts the redraft
  (the typed words); T2 posts its draft after the answer; neither
  resolved; `--posted 2 --threads 2`.
- `wrap-resume-post.md` rows now carry `gate-1:`, and a fifth thread T5
  is `gate-1: override`, offered at Gate 2 and held there with `[]`.
  Pass: `drafting` first; T1 posts and resolves; T2 posts its edit; T3,
  T4 and T5 do not post; `--posted 2 --threads 5 --held 3`.
- New `wrap-noted-reply.md`: board answer with T1
  `{"value": "reply:T1", "note": ...}`, T2 `{"value": "reply:T2",
  "text": ..., "note": ...}`, T3 plain `reply:T3`, `code-changes: skip`;
  Gate 2 answers T1 with `[]`. Pass: Gate 2 is exactly `thread-1` (T1's
  redraft; `resolve` not recommended); T1 does not post; T2 posts its
  `text`, T3 its draft, both after the answer, unresolved;
  `--posted 2 --threads 3 --held 1`.

RED (the wrapper at the previous commit):

- wrap-noted-reply 0/5: no Gate 2 in any rep; T1's draft, T2's `text`
  and T3's draft all posted; `--posted 3 --threads 3`.
- wrap-plan-pane-note 0/5 (on its new criteria): no Gate 2; T1's draft
  posted.
- wrap-reply-override 5/5 and wrap-resume-post (five-thread) 5/5: the
  override row was already held out; both are regression guards here.

GREEN, v3, first pass, 5/5 strict each:

- wrap-reply-override 5/5, parsed.
- wrap-resume-post 5/5: T5's reply never posted in any rep.
- wrap-plan-pane-note 5/5: the answer json is `note`-only in all five;
  the Gate 2 shape was parsed.
- wrap-noted-reply 5/5, parsed; T2 posted its `text`, never its draft.

## Fix round (review): v4

Edits: a `reply:` with no `text` whose question context never reached
Gate 1 (dropped for the budget, a `fits: false` open, or `contextOmitted`)
is an override; an override's drafted reply is written into its row;
`drafting` is re-emitted right before Gate 2 on every path (the status
table row and the `respond-plan` resume bullet say so); "Nothing to
offer" never applies on `code-changes: revise`; the skip branch names the
reply-only (`gate-1: reply`) threads; the act paragraph lets an answer
that names or was offered a `gate-1: reply` thread decide it, with no
reply posted twice; step 2 hands `{post}` only when Gate 2 opened; the
slot note says a bound provider posts the reply-only threads on `{plan}`
when nothing is offered.

New scenarios:

- `wrap-dropped-context.md`: T1 recommended `reply` but its Gate 1
  context was dropped for the budget, answered `reply:T1` with no `text`;
  T2 plain `reply:T2`; `code-changes: skip`. Pass: `drafting` before
  Gate 2; Gate 2 is exactly `thread-1` (T1, `resolve` not recommended);
  T2 posts after the answer; `--posted 2 --threads 2`.
- `wrap-resume-legacy.md` (a reworked `wrap-resume-edited`, the
  parked-across-deploy guard): a `respond-post` resume whose gate the old
  wrapper opened over every reply; T1 `fix` answered with `text`, post
  and resolve; T2 `gate-1: reply` answered `post:T2`; T3 `gate-1: reply`
  answered `resolve:T3`. Pass: `drafting` first; T1 posts the `text` and
  resolves; T2 posts once; T3 is resolved and never posted;
  `--posted 2 --threads 3 --held 1`.
- `wrap-domain-none.md`: domain path, nothing offered; the skill reports
  it posted both replies on `{plan}`. Pass: the wrapper takes no forge
  action and opens no Gate 2; `--posted 2 --threads 2`.
- `wrap-domain-resume-post.md`: domain-path `respond-post` resume. Pass:
  `drafting` first; the wrapper hands `{post: <answers>, by: "board-ui"}`
  to the skill and takes no forge action itself;
  `--posted 2 --threads 3 --held 1`.

Changed scoring: `wrap-counts` now also passes only when the wrapper
does not post T2 itself and does not flag T2's post as a gate bypass.
`wrap-resume-post` drops its "open file for gate g-42" line, which a
generic-path resume never has.

RED (v3, the wording at the previous commit):

- wrap-dropped-context 0/5 strict: every rep already offered T1 at
  Gate 2 and posted T2 after it, but none re-emitted `drafting` first.
- Guards at 5/5 already: wrap-resume-legacy (each rep reasoned its way to
  letting the old gate's answer decide T2 and T3), wrap-domain-none,
  wrap-domain-resume-post, wrap-counts on its new scoring, and
  wrap-resume-post without the open-file line.

## Final wording coverage

Every scenario in `scenarios/`, plus the per-thread record's `wrap-build`
and `wrap-none`, ran 5 reps each on v4, the committed text. All strict:

| scenario | v4 |
|---|---|
| wrap-replies-only | 5/5 |
| wrap-fix-and-reply | 5/5 (parsed; `drafting` before Gate 2) |
| wrap-build | 5/5 (parsed; nothing posted before the wait) |
| wrap-counts | 5/5 (no own post, no bypass flag) |
| wrap-none | 5/5 |
| wrap-edited | 5/5 |
| wrap-reply-override | 5/5 (parsed; `drafting` before Gate 2) |
| wrap-resume-post | 5/5 (T5 never posted) |
| wrap-plan-pane-note | 5/5 (`note`-only answer; parsed) |
| wrap-noted-reply | 5/5 (parsed; T2's `text` posted) |
| wrap-dropped-context | 5/5 (parsed; `drafting` before Gate 2) |
| wrap-resume-legacy | 5/5 (T2 once, T3 resolved only) |
| wrap-domain-none | 5/5 (no own forge action) |
| wrap-domain-resume-post | 5/5 (handed `{post}`, no own forge action) |

Not run on v4: the per-thread record's `wrap-text-no-post`,
`wrap-pane-note` and `wrap-resume-edited` (retired premise; the last is
superseded by `wrap-resume-legacy`).

## Fix round 2 (final review): v5

The final whole-branch review (finding I1) found the dropped-context
trigger rested on facts only the pane that opened Gate 1 holds: the
`fits: false` file, the `contextOmitted` output, or its own budget
drop. Nothing wrote them into `--report`. A parked `respond-plan`
resume in a fresh pane therefore read a no-`text` `reply:` on a
recommended-reply thread as `gate-1: reply` and posted a draft the board
never showed.

Edits (v5):

- Step 4 gains **Record a dropped context**. On either path, when the
  open was a `fits: false` file, its output carried
  `"contextOmitted": true`, or the wrapper dropped any question context
  for the byte budget, it writes one line, `gate-1-context: dropped`,
  into `--report` right after the open and before waiting on any answer.
  The fitted-file path now skips to that bullet, not straight to the
  presentation branches.
- Step 5's override paragraph: on a resume, `--report` carrying that
  line counts every question's context as dropped. The rule now says it
  holds whoever answered, the pane included (the review's deferred
  minor).
- The `respond-plan` resume bullet names the line.

receive-review (mattstack-skills, same round) writes and reads the
identical line.

New scenarios:

- `wrap-plan-dropped-open.md`: domain path. The domain skill hands back
  a `fits: false` Gate 1 file, and open-gate.sh prints no
  `contextOmitted`. Pass: open-gate.sh with the file untouched, then the
  line appended to `/tmp/st/report.md` with the rows unchanged, both
  before the wait.
- `wrap-resume-plan-dropped.md`: a generic-path `respond-plan` resume in
  a fresh pane. The report holds two recommended-reply rows and the line;
  the answer is `reply:T1`, `reply:T2`, neither with `text`, and
  `code-changes: skip`. Pass: `implementing` first; both rows
  `gate-1: override`; `drafting` before Gate 2; Gate 2 is exactly
  `thread-1` (T1) and `thread-2` (T2), `post` recommended and `resolve`
  not; nothing posts before its answer; then T1 posts its draft and T2
  nothing; `--posted 1 --threads 2 --held 1`.
- A control, not committed: `wrap-resume-plan-dropped.md` without its
  `gate-1-context: dropped` line, which is the report v4 leaves behind.

RED (v4, the wording at the previous commit):

| scenario | v4 | notes |
|---|---|---|
| wrap-plan-dropped-open | 0/5 | Every rep opens the file untouched and writes nothing ("Files written or changed: none"). Four reps say they will count the contexts as dropped when they act on the answer in step 5, knowledge that lives only in this pane. |
| control: resume, report without the line | 0/5 | Every rep posts both drafts at once, opens no Gate 2 and writes `--posted 2 --threads 2`. Reps 2 and 5 note the report does not say whether contexts were dropped and assume they were shown. This is I1's unseen post. |
| wrap-resume-plan-dropped (with the line) | 5/5 | A guard: v4 already read the self-describing line ("The report says `gate-1-context: dropped`, so Gate 1 never showed either reply"). The failing half is the writer. |

GREEN (v5, the committed wording), 5 reps each:

| scenario | v5 | notes |
|---|---|---|
| wrap-plan-dropped-open | 5/5 | Open first, then the line with the rows unchanged, then the wait recipe. Every rep names the `fits: false` file alone as the trigger, since the output carried no `contextOmitted`. |
| wrap-resume-plan-dropped | 5/5 | Parsed: both rows `gate-1: override`, Gate 2 over T1 and T2 with `resolve` unrecommended, T1 posted after the answer, `--posted 1 --threads 2 --held 1`. |

Regressions on v5, 5 reps each, strict to each scenario's criteria:

| scenario | v5 | notes |
|---|---|---|
| wrap-resume-post | 5/5 | T5 never posted; `--posted 2 --threads 5 --held 3`. |
| wrap-resume-legacy | 5/5 | T2 once, T3 resolved only. |
| wrap-domain-resume-post | 5/5 | Hands `{post: ..., by: "board-ui"}`, no own forge action. |
| wrap-dropped-context | 5/5 | The same pane still offers T1 alone and posts T2 after the answer. Every rep also writes or confirms the line; none counts T2's context as dropped. |
| wrap-plan-pane-note | 5/5 | `note`-only answer; Gate 2 over T1. |

Not re-run on v5, whose last run is the v4 table above: wrap-replies-only,
wrap-fix-and-reply, wrap-build, wrap-counts, wrap-none, wrap-edited,
wrap-reply-override, wrap-noted-reply and wrap-domain-none. Some of
them read text v5 changed: wrap-reply-override and wrap-noted-reply read
step 5's override paragraph, which gained two sentences. Those sentences
only add triggers: the pane rule, and the report line on a resume. None
of these scenarios is a resume, carries the line or answers in the pane,
so every rule they exercise reads as before. v5's other edits (the step 4
bullet, the fitted-file skip and the resume-bullet sentence) apply only
after an over-budget open or on a `respond-plan` resume, and none of
these scenarios has either. wrap-dropped-context and wrap-plan-pane-note
read the changed paragraph most directly, and both re-ran at 5/5 above.

A later re-review text round moved "This holds whoever answered, the
pane included." to right after "(then count every question's context as
dropped)", so it is not read as resume-only. That wording was not re-run
in full: a usage limit cut the re-run of wrap-resume-plan-dropped,
wrap-dropped-context and wrap-plan-pane-note to 6 of 15 reps. All 6 pass.

## CodeRabbit round (receive-review): no wrapper change

CodeRabbit on the mattstack-skills PR found two receive-review gaps. Fix
round 5 in that repo's record covers them. This section checks whether
the wrapper needs a matching line:

- **`notes` in the respond-plan record.** The wrapper writes no `rt runs`
  decision record. On its generic path it records Gate 1 in the report
  rows only, and a noted override's redraft (note folded in) lives in its
  row. So it has nothing to add; receive-review keeps the record on the
  domain path.
- **A handed `post` decides first.** The wrapper never hands
  `{plan, post}` together. It hands `{plan}` after Gate 1, and `{post}`
  only when a Gate 2 opened or on a `respond-post` resume. On the generic
  path it already lets a retired-shape Gate 2 answer decide a
  `gate-1: reply` thread (step 6's act paragraph and the "Gate protocol"
  retired-shape line).

New guard scenario, `wrap-resume-retired-empty.md`: a generic-path
`respond-post` resume whose old-wrapper gate returns
`{"replies": [], "disposition": "leave-open"}`, with one `gate-1: reply`
row, T1. Pass: `drafting` first; T1 neither posted nor resolved;
`--posted 0 --threads 1 --held 1`. On the current wording (v5 plus the
text round): 5/5. Every rep reasons that the old gate offered T1, so its
empty list decides it.

A stand-in review then found that step 7's `--held` list did not cover
that expected `--held 1`. The list now adds "a `gate-1: reply` thread an
older Gate 2's answer kept down (a retired `replies` list that leaves it
out, or an answer that names it without `post:`)". It was a guard before
the edit (5/5, above) and is 5/5 after it. wrap-resume-legacy (T3 named
without `post:`) and wrap-resume-post re-ran at 5/5 each on the new
wording, and one legacy rep cites the new clause for T3's `--held 1`.

## Verdict

On the 14 scenarios above, the v4 wording makes Gate 2 offer exactly the
replies the developer has not yet seen word for word. Those are fixed
threads, and reply overrides: a `reply:` with no `text` whose card did
not show the reply (recommended fix or skip, or its context dropped), or
that carries a note. Reply-only (`gate-1: reply`) threads post from
Gate 1's answer, its `text` when present, and never twice. The counts
include them. Nothing outside those scenarios is claimed.

v5 adds that a dropped Gate 1 context survives a resume. The pane that
opens Gate 1 writes `gate-1-context: dropped` into the report, and a
resumed pane that finds the line offers every no-`text` `reply:` at
Gate 2 instead of posting its draft. The writer went from 0/5 to 5/5,
the resume is 5/5, and the five re-run scenarios hold at 5/5.
