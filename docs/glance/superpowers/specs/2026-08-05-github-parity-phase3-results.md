# GitHub parity: phase 3 live verification

**Date:** 2026-08-05
**Status:** informational. The verification record for phase 3's Octokit transport swap.
**Companion to:** the phase 1 findings, the phase 2 results, and
`docs/superpowers/plans/2026-08-04-github-parity-phase3-octokit.md`. This document amends
neither earlier record: each is a snapshot of one run at one moment.

## What produced this document

A single run of `bun tests/live/runner.ts` against both fixture projects
(`m4ttheweric/glance-conformance` on GitHub, `m4tthew-dev/glance-test-repo` on GitLab), on
2026-08-05, after the Octokit swap landed on branch `phase3-octokit-swap`. One run was
budgeted: the phase 2 record is the baseline, and each run permanently adds a file and two
commits to both fixtures' default branches.

The promise this phase made was that it changes no behavior a caller or the harness can
observe. The test of that promise is not "did the run pass" but "is the run identical".

## Result: one line changed, and it changed for the better

```
github: 35 passed, 2 failed, 1 skipped     (phase 2: 34 passed, 3 failed, 1 skipped)
gitlab: 26 passed, 4 failed, 8 skipped     (phase 2: identical)
```

A line-by-line diff of this run's assertion output against the phase 2 record produces
**exactly one difference**:

```
- FAIL  github retryJob: accepts a retry of the failed job
-       retryJob failed: 403 Forbidden ... "The workflow run containing this job is already running"
+ ok    github retryJob: accepts a retry of the failed job
```

Every other assertion, on both providers, is byte-identical. Nothing regressed.

## The retryJob flip is evidence about MAT-128, not a fix

Nothing in this phase touched `retryJob`. MAT-128 remains open and unfixed.

Phase 1 recorded a hypothesis it could not prove: the 403 happens because the harness calls
`retryJob` inside the few-second gap between the *job* reporting `completed` and the *run*
as a whole reporting `completed`, and GitHub's error text is about the run. Phase 1 stated
plainly that this was "the evidence available, not a proven root cause", and phase 2
reproduced the same 403.

This phase adds real wall clock before that call. Octokit's throttling plugin paces writes
through a `notifications` Bottleneck group at roughly 1 second plus 3 seconds for the
endpoints the merge and CI cycles use. That delay is incidental to the transport swap and
was not introduced to affect `retryJob`. With it, the call now lands after the run has
finished, and it succeeds.

That is meaningful corroboration of phase 1's hypothesis: adding a few seconds of delay
before the call changed a reproducible failure into a pass. It is not proof, and it does
not close MAT-128. A future run with different Actions timing could fail again, and the
harness still does not log when `retryJob` is actually called, which is the instrumentation
MAT-128 needs before anyone fixes it.

## The two independent checks

A green assertion is the harness making a claim about itself. These check the same facts
from outside it, and they matter more here than in phase 2: the transport underneath every
one of those assertions was replaced.

**1. The branch deletion was ours, not GitHub's.**

```
$ gh api repos/m4ttheweric/glance-conformance --jq .delete_branch_on_merge
false
```

**2. The commit carries the merge message and not the squash message.**

```
$ gh api repos/m4ttheweric/glance-conformance/commits/main --jq .commit.message
conformance-merge-msfr7yje merge-commit-message

conformance: merge cycle
```

Cleanup verified: zero `conformance`-prefixed branches remain on the fixture.

## The capability this phase added, proven separately

`GitHubProvider` emitted zero `onRequest` instrumentation before this phase. That is not a
harness assertion, so it was proven with a short script against the live API:

```
events: 6
  rest     200  GET /user (279ms)
  rest     200  GET /repos/m4ttheweric/glance-conformance/pulls/1 (588ms)
  rest     200  GET /user (163ms)
  graphql  200  POST /graphql (245ms)
  rest     200  GET https://api.github.com/repos/.../pulls/1/reviews?per_page=100 (236ms)
  rest     200  GET /repos/.../commits/364a7dc.../check-runs?per_page=100 (309ms)
```

Before this phase that array was always empty. Note the GraphQL event is correctly labelled
`transport: 'graphql'`, which the `RequestInfo` type has always defined and nothing ever
emitted. One cosmetic inconsistency is visible above and is not worth a fix on its own: the
paginated request reports an absolute URL in `path` where the others report a relative one.

## What `fetchJobTrace` settled

This was the single thing no offline work could establish. Octokit parses a response by its
content type, and the Actions logs endpoint redirects to blob storage, so which of three
branches fires (string, ArrayBuffer, or parsed JSON) depended on a header nobody could
observe without running. Phase 1's live evidence did not carry over, because it was gathered
against the hand-rolled `res.text()`, which is content-type agnostic.

Both assertions passed, including the stronger one that requires the returned text to
contain the fixture's own `fail-marker present` line. So the endpoint works through Octokit
and returns real log content. The run does not reveal which branch fired, and all three are
handled, so this is settled for practical purposes without being fully characterised.

## Deliberate behavior changes, recorded

These are visible to an external consumer of the published package. None is visible to the
harness, and each was reviewed and accepted rather than discovered.

- **Automatic retry is disabled for non-idempotent verbs.** Octokit's retry plugin retries
  5xx for everything by default. A 502 arriving after a merge already landed would retry and
  either duplicate the write or report a successful merge as failed. GET and HEAD still
  retry. The throttling plugin's separate 403 and 429 retry still applies to writes, which
  is correct: a rate-limit refusal means nothing landed.
- **Six sub-requests now surface failures.** `createPullRequest` and `updatePullRequest`
  each issue reviewers, assignees, and labels calls that previously discarded their response
  and swallowed HTTP failures silently. They now throw, with an operation label naming the
  sub-call and the PR number, so a caller can find the PR that does exist. MAT-24 owns these
  fields.
- **Pagination no longer truncates.** The hand-rolled `fetchAllPages` returned the pages it
  had on a failed page. Those pages feed the reviews fetch, and approval counts are computed
  from reviews, so a failed second page could silently under-report approvals. It now
  rejects. Two consequences are follow-up scope, recorded below.
- **A transport failure while verifying a branch deletion is now reported as a deletion
  failure rather than a merge failure.** The merge did succeed, so this is the accurate
  reading; the previous split (a 500 on the verification produced the deletion message, a
  dropped connection did not) was accidental.
- **GraphQL requests are now paced.** They are POSTs, so they share the write queue.
  `fetchUnresolvedThreadCounts` batches 50 node ids per query, so a twenty-PR dashboard
  costs one call, not twenty. Measured cost is roughly 1 second on `createPullRequest` and 2
  on a draft-toggling `updatePullRequest`.
- **`restRequest`'s Response cannot carry a `url`.** It is reconstructed rather than
  returned from `fetch`, and the platform only populates `url` on a real fetch response. All
  headers and `statusText` are forwarded; `url` is empty and cannot be faked. This is not
  documented in the public JSDoc yet and should be.
- **Request headers changed.** `Accept` is now `application/vnd.github.v3+json` rather than
  `application/vnd.github+json`, and `Authorization` is `token <tok>` rather than
  `Bearer <tok>`. Both are Octokit defaults and both are accepted by GitHub. The
  `X-GitHub-Api-Version: 2022-11-28` pin was silently dropped by the swap and has been
  restored explicitly, because its whole purpose is protecting this SDK against a future
  REST version bump.

## What this run does not cover

Everything in the phase 1 findings' "What phase 1 did not cover" section still stands, and
this phase closed none of it. Additionally:

- **GitHub Enterprise is entirely unexercised.** No fixture exists. `octokit.graphql`
  rewriting an enterprise REST base to `/api/graphql` is proven by unit test only, and the
  GraphQL rate-limit swallow behaves differently there because the throttling plugin's own
  GraphQL detection never matches an enterprise path.
- **The `fetchSingleMR` catch-to-null path.** After the pagination fix, a failing reviews
  page rejects, and `fetchSingleMR` catches everything to `null`. A rate-limited page can
  therefore make a live PR look nonexistent, signalled only by a log line. Follow-up scope.
- **`MRDashboard.batchFetch`** catches `fetchPullRequests` into `null`, so one PR's failing
  reviews fetch now fails an entire dashboard refresh rather than one row. Follow-up scope.
- **Real rate-limit and throttling behavior** was measured against stubbed responses, not
  against live GitHub under genuine rate limiting.
- **This is one run at one moment.** The `retryJob` result above is the clearest example of
  a result that has now gone both ways across three runs.

## Full verbatim runner output

<details>
<summary>Click to expand</summary>

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
  ok    github retryJob: accepts a retry of the failed job

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

github: 35 passed, 2 failed, 1 skipped
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

The exit code was 1, as in every prior run: `assertFullCoverage` still reports that
`deleteBranch` and `requestReReview` on both providers, and GitLab's `retryJob`, are never
asserted on anywhere in this harness.

</details>
