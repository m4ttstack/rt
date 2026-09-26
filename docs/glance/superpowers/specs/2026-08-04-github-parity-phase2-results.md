# GitHub parity: phase 2 live verification

**Date:** 2026-08-04
**Status:** informational. The verification record for phase 2's three fixes.
**Companion to:** `docs/superpowers/specs/2026-08-04-github-parity-findings.md` (the phase 1
findings) and `docs/superpowers/plans/2026-08-04-github-parity-phase2-fixes.md` (the plan
this executed). This document does not amend the phase 1 findings. That document records
one run at one moment and amending it would destroy that property.

## What produced this document

A single run of `bun tests/live/runner.ts` against both fixture projects
(`m4ttheweric/glance-conformance` on GitHub, `m4tthew-dev/glance-test-repo` on GitLab), on
2026-08-04, after the phase 2 fixes landed on branch `phase2-provider-fixes`. One run was
budgeted deliberately: the pre-fix baseline is already recorded in the phase 1 findings, and
each run permanently adds a file and two commits to both fixtures' default branches.

Two independent checks were run afterward, by hand, against the live GitHub fixture. They
exist because the phase 1 review found that most of its defects were caught by being
suspicious of results that had **passed**. Both are reported below with their output.

## Result

```
github: 34 passed, 3 failed, 1 skipped
gitlab: 26 passed, 4 failed, 8 skipped
```

Compared with the phase 1 baseline (`github: 31 passed, 3 failed, 1 skipped`,
`gitlab: 26 passed, 1 failed, 7 skipped`), read carefully: the counts moved for three
different reasons, only one of which is this phase's fixes. See "Reading the count changes"
below before drawing conclusions from the totals.

### The two assertions this phase existed to flip

| Assertion | Phase 1 | This run |
| --- | --- | --- |
| `github mergePullRequest: the commitMessage we asked for actually reaches the commit (MAT-25)` | FAIL | **ok** |
| `github mergePullRequest: shouldRemoveSourceBranch actually deletes the source branch` | FAIL | **ok** |

The MAT-25 assertion is also strictly stronger than the one phase 1 ran: it now additionally
requires that `squashCommitMessage` does not appear in a non-squash merge commit. That half
was added before either fix existed, so it could not be tuned to a fix afterward.

<details>
<summary>Full verbatim runner output (click to expand)</summary>

```
=== github (m4ttheweric/glance-conformance) ===

  ok    github validateToken: returns a non-empty username
  ok    github fetchPullRequests: returns an array of well-formed PRs
  skip  github fetchPullRequests: projectPath mode returns only that project (no open PRs in the fixture project; scoping is unverified)
  ok    github fetchPullRequests: empty iids selects that mode and returns []
  ok    github fetchPullRequests: iids without projectPath throws
  ok    github fetchPullRequests: unparseable updatedAfter throws
  ok    github fetchBranchProtectionRules: returns rules for the default branch
  ok    github restRequest: authenticated GET succeeds
  ok    github fetchPullRequestByBranch: returns null for a branch with no MR
  ok    github rebasePullRequest: throws, and its capability flag is false
  ok    github unapprovePullRequest: throws, and its capability flag is false
  ok    github setAutoMerge: throws, and its capability flag is false
  ok    github cancelAutoMerge: throws, and its capability flag is false
  ok    github resolveDiscussion: throws, and its capability flag is false
  ok    github unresolveDiscussion: throws, and its capability flag is false
  ok    github watchMR: throws synchronously
  ok    github createPullRequest: opens a PR from a new branch
  ok    github fetchSingleMR: finds the PR just created
  ok    github fetchPullRequestByBranch: finds the PR by its source branch
  ok    github fetchPullRequestsByBranches: is absent, so callers feature-detect and fall back
  ok    github watchEvents: is absent, so callers feature-detect and fall back
  ok    github updatePullRequest: changes the title
  ok    github updatePullRequest: toggles draft on
  ok    github updatePullRequest: toggles draft off
  ok    github fetchMRDiscussions: returns a detail object
  ok    github approvePullRequest: self-approval is rejected with 422, proving request shape reaches GitHub
  ok    github createPullRequest: opens a PR for the merge cycle
  ok    github mergePullRequest: merges and reports merged state
  ok    github mergePullRequest: the commitMessage we asked for actually reaches the commit (MAT-25)
  ok    github mergePullRequest: shouldRemoveSourceBranch actually deletes the source branch
  ok    github fetchJobTrace: returns non-empty log text
  ok    github fetchJobDetail: returns a discriminated detail
  ok    github fetchDownstreamPipeline: resolves without throwing
  ok    github retryPipeline: accepts a retry request
  ok    github fetchJobTrace: returns the log of a job that actually failed
  FAIL  github retryJob: accepts a retry of the failed job
        retryJob failed: 403 Forbidden — {"message":"The workflow run containing this job is already running","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run","status":"403"}

=== gitlab (m4tthew-dev/glance-test-repo) ===

  ok    gitlab validateToken: returns a non-empty username
  ok    gitlab fetchPullRequests: returns an array of well-formed PRs
  ok    gitlab fetchPullRequests: projectPath mode returns only that project
  ok    gitlab fetchPullRequests: empty iids selects that mode and returns []
  ok    gitlab fetchPullRequests: iids without projectPath throws
  ok    gitlab fetchPullRequests: unparseable updatedAfter throws
  ok    gitlab fetchBranchProtectionRules: returns rules for the default branch
  ok    gitlab restRequest: authenticated GET succeeds
  ok    gitlab fetchPullRequestByBranch: returns null for a branch with no MR
  skip  gitlab rebasePullRequest: supported-path not exercised here (this provider declares it supported)
  skip  gitlab unapprovePullRequest: supported-path not exercised here (this provider declares it supported)
  skip  gitlab setAutoMerge: supported-path not exercised here (this provider declares it supported)
  skip  gitlab cancelAutoMerge: supported-path not exercised here (this provider declares it supported)
  skip  gitlab resolveDiscussion: supported-path not exercised here (this provider declares it supported)
  skip  gitlab unresolveDiscussion: supported-path not exercised here (this provider declares it supported)
  skip  gitlab watchMR: supported-path not exercised here (this provider declares it supported; invoking it would open a real websocket subscription)
  ok    gitlab createPullRequest: opens a PR from a new branch
  ok    gitlab fetchSingleMR: finds the PR just created
  ok    gitlab fetchPullRequestByBranch: finds the PR by its source branch
  ok    gitlab fetchPullRequestsByBranches: batch lookup maps the branch to the PR
  skip  gitlab watchEvents: supported-path not exercised here (this provider declares it supported; invoking it would start a real polling subscription with nothing in the harness to close it)
  ok    gitlab updatePullRequest: changes the title
  ok    gitlab updatePullRequest: toggles draft on
  ok    gitlab updatePullRequest: toggles draft off
  ok    gitlab fetchMRDiscussions: returns a detail object
  ok    gitlab approvePullRequest: a second identity can approve
  ok    gitlab unapprovePullRequest: the same identity can revoke
  ok    gitlab createPullRequest: opens a PR for the merge cycle
  ok    gitlab mergePullRequest: merges and reports merged state
  ok    gitlab mergePullRequest: the commitMessage we asked for actually reaches the commit (MAT-25)
  ok    gitlab mergePullRequest: shouldRemoveSourceBranch actually deletes the source branch
  FAIL  gitlab fetchJobTrace: returns non-empty log text
        trace was empty
  ok    gitlab fetchJobDetail: returns a discriminated detail
  ok    gitlab fetchDownstreamPipeline: resolves without throwing
  ok    gitlab retryPipeline: accepts a retry request
  FAIL  github deleteBranch: coverage: appears at least once in the report
        no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL  github requestReReview: coverage: appears at least once in the report
        no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL  gitlab deleteBranch: coverage: appears at least once in the report
        no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL  gitlab retryJob: coverage: appears at least once in the report
        no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL  gitlab requestReReview: coverage: appears at least once in the report
        no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it

============================================================

github: 34 passed, 3 failed, 1 skipped
  FAIL retryJob: accepts a retry of the failed job
       retryJob failed: 403 Forbidden — {"message":"The workflow run containing this job is already running","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run","status":"403"}
  FAIL deleteBranch: coverage: appears at least once in the report
       no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL requestReReview: coverage: appears at least once in the report
       no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
gitlab: 26 passed, 4 failed, 8 skipped
  FAIL fetchJobTrace: returns non-empty log text
       trace was empty
  FAIL deleteBranch: coverage: appears at least once in the report
       no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL retryJob: coverage: appears at least once in the report
       no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
  FAIL requestReReview: coverage: appears at least once in the report
       no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it
```

The dash in the `retryJob` error is GitHub's, reproduced verbatim, for the same reason the
phase 1 findings gives: this project's no-dash rule governs prose we author, not quoted
API output.

</details>

## The two independent checks

A green assertion is a claim by the harness about itself. These two check the same facts
from outside it.

**1. The branch deletion was ours, not GitHub's.** The assertion would pass for the wrong
reason if the fixture had `delete_branch_on_merge` enabled, since GitHub's own post-merge
cleanup would then delete the branch regardless of what the provider sent. It does not:

```
$ gh api repos/m4ttheweric/glance-conformance --jq .delete_branch_on_merge
false
```

**2. The commit really carries the merge message and not the squash message.** Read directly
from the fixture's default branch, not through the harness:

```
$ gh api repos/m4ttheweric/glance-conformance/commits/main --jq .commit.message
conformance-merge-msfhc83p merge-commit-message

conformance: merge cycle
```

The title is the `commitMessage` the harness asked for. `squash-commit-message` appears
nowhere, which is what MAT-25's fix is actually about: the run also passed
`squashCommitMessage`, and before the fix that value was what landed here. The body
(`conformance: merge cycle`, the PR's title) is GitHub's own generated text, since this
merge sent no `commit_message`.

Cleanup also verified: zero `conformance/`-prefixed branches remain on the fixture.

## Reading the count changes

The totals moved for three unrelated reasons. Attributing all of it to this phase's fixes
would be wrong.

1. **This phase's fixes: +2 passes on GitHub.** The two assertions in the table above went
   from FAIL to ok.
2. **`watchEvents` gained coverage during phase 1's own later fix waves, after the findings
   document was written: +1 pass on GitHub, +1 skip on GitLab.** The phase 1 findings and
   the phase 2 handoff both state that `watchEvents` is never exercised anywhere in the
   harness. That is no longer true, and was already no longer true before this phase began.
   Lines 21 and 64 of the output above are its checks.
3. **The `assertFullCoverage` results now appear in the per-provider tallies.** They are the
   five `coverage:` lines, and they account for the rest of the failure-count change
   (+2 on GitHub, +3 on GitLab) without anything having regressed. The phase 1 findings'
   verbatim output does not contain these lines at all.

So: no assertion that passed in phase 1 fails now, and no assertion that this phase did not
target changed state.

## Failures, and why each is expected

**`github retryJob: accepts a retry of the failed job` (FAIL).** Unchanged from phase 1, and
untouched by this phase. Tracked as MAT-128, deliberately deferred: the phase 1 findings
state plainly that the run-versus-job timing gap is "the evidence available, not a proven
root cause," and the harness still does not log when `retryJob` was actually called. This
run reproduces the same 403 with the same message, which is weak evidence that the cause is
stable rather than a one-off, and nothing more than that.

**`gitlab fetchJobTrace: returns non-empty log text` (FAIL).** Unchanged from phase 1, and
untouched by this phase. Root-caused in phase 1 to a harness gap, not a provider defect:
`latestPipelineAndJob` takes `jobs[0]` with no status filter and lands on a `skipped` job,
which genuinely has no trace. The fixture's `install` job fails on every pipeline by design,
so this will keep failing on every run until the harness's job selection is fixed.

**Five `coverage:` failures.** `deleteBranch` and `requestReReview` on both providers, and
`retryJob` on GitLab, are still never asserted on anywhere in the harness. This is the
harness reporting its own gaps honestly and is the documented reason the runner exits
non-zero even on a good run. The phase 2 handoff lists four such methods; it is three now
(across five provider-method pairs), because `watchEvents` gained coverage as described
above.

**Exit code.** Not captured: the command used `${PIPESTATUS[0]}` under zsh, where the
array is `pipestatus`, so the echoed value was empty. A non-zero exit is expected given the
failures above, and the runner is documented to exit non-zero whenever `assertFullCoverage`
reports gaps. This is a gap in this record, not evidence either way.

## What this run does not cover

Everything in the phase 1 findings' "What phase 1 did not cover" section still stands. None
of those gaps were closed by this phase, and the fixes here did not touch any of them. The
items most worth restating, because someone reading only this document could otherwise
assume the merge path is now fully proven:

- **The fork case for `shouldRemoveSourceBranch` is unexercised live.** The final review of
  this phase found that the first implementation deleted the source ref against the base
  repository, which for a pull request opened from a fork would delete nothing while
  reporting success. That is fixed and unit-tested, but both fixtures open pull requests
  from branches in the same repository, so the fork path has no live coverage here.
- **The squash path for MAT-25 is unexercised live.** The harness merges with no merge
  method, so `squashCommitMessage`'s selection is proven only by unit tests. Adding a live
  squash cycle would cost both fixtures another permanent commit per run, which is why it
  was not done.
- **MAT-131's failure path is unexercised live, by construction.** The fixture's protection
  read always succeeds. The live check added for it (`rule.raw !== undefined` on every
  returned rule) is a regression guard against the fabricated shape returning, not proof
  that the new throw behaves correctly. The throw is covered by unit tests only.
- **GitHub's `approvePullRequest` accept path** remains unverifiable with one identity. This
  run confirms only the 422 self-approval rejection, as phase 1 did.
- **This is one run at one moment.** GitHub Actions and GitLab CI/CD are live shared
  systems. The `retryJob` timing result in particular could plausibly go the other way on a
  different run.

## Open decision carried out of this phase

**MAT-131's throw has a wider blast radius than the plan documented.** The plan accepted the
trade for "a 403 on a private repository on GitHub's free plan". But
`GET /repos/{owner}/{repo}/branches/{branch}/protection` requires admin access, so any
non-admin token now turns a previously-resolving call into a throw. And because the throw is
inside the per-branch loop, one unreadable branch discards every rule already read
successfully. The direction is still right (an error beats four fabricated values a caller
cannot identify as fabricated), but the scope is larger than what was approved. Options:
keep it as it stands, or throw only when no branch could be read at all. Not decided here.
