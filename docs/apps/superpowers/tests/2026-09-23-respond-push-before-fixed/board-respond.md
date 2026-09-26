# RED/GREEN: board:respond pushes before a Fixed reply on the generic path

Scope: `apps/board/skills/respond/SKILL.md`, step 6 (the act bullet and a
new "Push before any Fixed reply" paragraph) and the `respond-post` resume
bullet. The same rules receive-review carries for the domain path, fitted
to the wrapper:

- **Push first, only when needed.** Only when Gate 2's picks post or
  resolve a fixed thread (a `gate-1: fix` row): check that `git branch
  --show-current` is the MR's source branch and `git rev-parse
  --abbrev-ref @{push}` is that branch on its remote, then push that one
  branch explicitly with `git push origin <source branch>`, never a bare
  `git push`. Gate 2's answer is the authorization.
- **A failed push** (a target mismatch or a push error) holds those
  threads (no post, no resolve), reports the output verbatim in the pane,
  and never switches branches, forces, rebases or merges. Every other
  reply posts either way.
- **Record.** The wrapper writes no run records, and a resumed pane reads
  `--report`, so the held ids go into one report line,
  `respond-post-held: <ids>`, in the style of `gate-1-context: dropped`.
  A resume that finds it acts only on the listed threads once the check
  and push succeed, then deletes it.
- **Open run.** Step 7 still marks done, counting each held thread as
  neither posted nor held, so the partial badge makes the board offer a
  resume.

## Scenarios

All on the invented MR !87 (source branch `renee/queue-retry`), generic
path, committed under `scenarios/`. T1 is a `gate-1: fix` row at ab12cd3,
T2 a `gate-1: reply` row, T3 a `gate-1: override` row.

- `wrap-push-before-fixed.md`: Gate 2 over T1, answered post and resolve.
  Nothing about the branch is given.
- `wrap-push-fails-override.md`: Gate 2 over T1 and T3, both picked
  `post:`; the target check matches but the push is rejected, and the
  pane may close right after.
- `wrap-push-no-fix-picked.md`: Gate 2 over T1 and T3, T1 answered `[]`;
  any push is rejected.
- `wrap-push-wrong-branch.md`: Gate 2 over T1; the checkout is on
  `renee/retry-docs` with `@{push}` `origin/renee/retry-docs`.

## Method

As in `../2026-09-23-respond-post-fixed-only/board-respond.md`:
single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
<scenario>`, a fresh empty directory per rep, 5 reps per scenario. System
file: the wrapper's SKILL.md itself. Every rep read in full, with a grep
tally of the `done` counts and the report line on the final round.

## Pass criteria

- **wrap-push-before-fixed:** both target checks, then `git push origin
  renee/queue-retry` (the explicit refspec, never a bare `git push`),
  before T1's reply; T1 posts and resolves; T2 posts unresolved;
  `done --posted 2 --threads 2`.
- **wrap-push-fails-override:** the checks, the push, no T1 post or
  resolve, T2 and T3 post unresolved, the error verbatim,
  `respond-post-held: T1` in the report, `done --posted 2 --threads 3`
  with no `--held`.
- **wrap-push-no-fix-picked:** no git command; T2 and T3 post; no report
  line; `done --posted 2 --threads 3 --held 1`.
- **wrap-push-wrong-branch:** no push; T1 held; T2 posts; the mismatch
  reported; `respond-post-held: T1`; `done --posted 1 --threads 2`.

## RED (the wrapper before this change)

| Scenario | Result | Notes |
|---|---|---|
| wrap-push-before-fixed | 0/5 | No rep checks the branch or push target. Reps 3 and 4 refuse to push and stop to ask: "Pushing is outward-facing, and neither gate approved it." Reps 1, 2 and 5 push by explicit refspec, and on a failed push would emit `error` and post nothing, T2 included. |
| wrap-push-fails-override | 1/5 | Every rep holds T1, posts T2 and T3, and ends `--posted 2 --threads 3`. Only rep 1 runs the target check; rep 5 refuses to push. Each rep invents its own held marker (a `T1-push:` line, a `T1 · hold:` line, row suffixes `gate-2: held` or `HELD`), so a resume has no defined line to read. |
| wrap-push-no-fix-picked | 5/5 | A guard: no rep pushes, and each ends `--held 1`. |
| wrap-push-wrong-branch | 2/5 | A guard for the mismatch path; the scenario names the check commands. No rep pushes, but reps 1, 3 and 5 emit `error` instead of `done`, and rep 3 also holds the plain reply T2. |

## GREEN round 1

Rounds 1 and 2 ran against the plain `git push` wording; the explicit
refspec (round 3, below) replaced it after review.

| Scenario | Result | Notes |
|---|---|---|
| wrap-push-before-fixed | 5/5 | Checks then push in every rep. In the hypothetical failure branch, reps 2 and 4 read "leave the run open for a resume" as skipping `done`. |
| wrap-push-fails-override | 5/5 | Converged: `respond-post-held: T1`, T2 and T3 posted, `done --posted 2 --threads 3`. |
| wrap-push-no-fix-picked | 5/5 | |
| wrap-push-wrong-branch | 5/5 | |

Loophole: the failure branch's "leave the run open" read as "skip done".

- Before: "and leave the run open for a resume: step 7 counts each held
  thread as neither posted nor held, so the board offers one."
- After: "and still mark done in step 7, counting each held thread as
  neither posted nor held: that partial badge is what leaves the run
  open, since the board then offers a resume."

## GREEN round 2 (the first commit, 2448953e)

| Scenario | Result | Notes |
|---|---|---|
| wrap-push-before-fixed | 5/5 | Four reps state `done --posted 1 --threads 2` on the failure branch; none skips done. |
| wrap-push-fails-override | 5/5 | `respond-post-held: T1` and `done --posted 2 --threads 3` in every rep. |
| wrap-push-no-fix-picked | 5/5 | No git command, no report line, `--held 1`. |
| wrap-push-wrong-branch | 5/5 | No push, T2 posted, `respond-post-held: T1`, `done --posted 1 --threads 2`. |

## Review round: where the source branch comes from

The push check compares against "the MR's source branch", but the launch
prompt carries only the MR url and flags, and every scenario above hands
the branch in, so no rep ever had to find it. Step 1 of the push rule now
names it: "from the forge's MR record for this MR, read when step 2
fetched the threads".

Scenario: `scenarios/wrap-push-branch-unknown.md` is wrap-push-before-fixed
with the source branch removed, plus a line inviting the agent to name
the call it would make for any missing value. 3 reps per arm.

| Wording | Result | Notes |
|---|---|---|
| 2448953e (before the clause) | 3/3 | Not a RED. Every rep reads `.source_branch` from the forge's MR record (`glab api projects/acme%2Fqueue/merge_requests/87`) before the check. The scenario's invitation to name a call likely cues it. |
| with the clause | 3/3 | Every rep reads `.source_branch` and ties it to step 2's fetch. Rep 1: "It is the record step 2 read when it fetched the threads." |

The clause states the provenance rather than fixing an observed failure.

## GREEN round 3: the explicit refspec

A bare `git push` follows any configured push refspec or mirror remote,
so it can publish other local refs that the `@{push}` check never looks
at. Step 2 now pushes the verified branch alone: `git push origin <source
branch>`, never a bare `git push`.

| Scenario | Result | Notes |
|---|---|---|
| wrap-push-before-fixed | 5/5 | Every rep runs both checks, then `git push origin renee/queue-retry`, before T1's reply; T1 posts and resolves, T2 posts unresolved, `done --posted 2 --threads 2`. Rep 3: "It names the branch explicitly and is never a bare `git push`." |
