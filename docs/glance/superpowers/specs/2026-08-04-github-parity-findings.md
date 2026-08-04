# GitHub parity: phase 1 findings

**Date:** 2026-08-04
**Status:** informational. Input to the phase 2, 3, and 4 plans.
**Companion to:** `docs/superpowers/specs/2026-08-04-github-parity-design.md` (the design
doc). This document does not repeat that doc's decisions or architecture; it records what
the phase 1 harness actually observed, live, when it was run.

## What produced this document

A single, complete run of `bun tests/live/runner.ts` against both fixture projects
(`m4ttheweric/glance-conformance` on GitHub, `m4tthew-dev/glance-test-repo` on GitLab), on
2026-08-04. The run exercised every conformance stage in one pass, in this order: read,
unsupported-method, write cycle, merge cycle, CI. Every finding below that is marked
**live-verified** comes from this one run, so results across stages are internally
consistent (same run, same moment), not stitched together from separate runs at different
times. The complete verbatim output is reproduced in full under "Final per-provider summary
and full output" below.

A small number of findings needed a follow-up read-only query (`GET` requests only, no
mutation) against the fixture projects to root-cause a result the raw error string alone
did not explain. Those are marked and their evidence is inlined here.

## How to read this document

- **Live-verified**: this harness actually called the method against a real API and
  recorded the result.
- **Code-read**: found by reading `GitHubProvider.ts` / `GitLabProvider.ts` source, not
  (yet) exercised by a live run. Phase 1 did not touch `src/`; these are carried forward
  from planning and from the design doc, and are explicitly not claimed as live-confirmed
  here.
- **Skipped does not mean passing.** A skip means the assertion did not run at all, for a
  stated reason: no data to test against, a provider that doesn't support the path, or (in
  one case below) real risk in running the check unbounded. An unexercised method is not a
  working method. Every skip in this run is listed below with its reason.

## Final per-provider summary and full output

```
github: 31 passed, 3 failed, 1 skipped
gitlab: 26 passed, 1 failed, 7 skipped
```

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
  ok    github updatePullRequest: changes the title
  ok    github updatePullRequest: toggles draft on
  ok    github updatePullRequest: toggles draft off
  ok    github fetchMRDiscussions: returns a detail object
  ok    github approvePullRequest: self-approval is rejected, proving request shape reaches GitHub
  ok    github createPullRequest: opens a PR for the merge cycle
  ok    github mergePullRequest: merges and reports merged state
  FAIL  github mergePullRequest: the commitMessage we asked for actually reaches the commit (MAT-25)
        commitMessage was dropped. Head commit was: conformance-merge-msf8ztu9 squash-commit-message
  FAIL  github mergePullRequest: shouldRemoveSourceBranch actually deletes the source branch
        branch still exists after merging with shouldRemoveSourceBranch: true
  ok    github fetchJobTrace: returns non-empty log text
  ok    github fetchJobDetail: returns a discriminated detail
  ok    github fetchDownstreamPipeline: resolves without throwing
  ok    github retryPipeline: accepts a retry request
  ok    github fetchJobTrace: returns the log of a job that actually failed
  FAIL  github retryJob: accepts a retry of the failed job
        retryJob failed: 403 Forbidden ... see "Failures" below for the full text

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

============================================================

github: 31 passed, 3 failed, 1 skipped
gitlab: 26 passed, 1 failed, 7 skipped
```

The exit code of the run was 1 (both providers had failures), as expected. The complete
transcript, including the one long line this table shortened, is in the (untracked) working
report `task-7-report.md`; the full verbatim errors are inlined below so this document
stands on its own.

</details>

## Failures (live-verified), verbatim

### GitHub

**1. `mergePullRequest`: "the commitMessage we asked for actually reaches the commit
(MAT-25)"**

```
commitMessage was dropped. Head commit was: conformance-merge-msf8ztu9 squash-commit-message
```

Confirmed again in this run, matching Task 6's original finding exactly. `commitMessage`
and `squashCommitMessage` both land on GitHub's `body.commit_title`, so the second silently
overwrites the first. **Cross-provider comparison (live-verified, this run):** the identical
assertion passed on GitLab, whose head commit was `"conformance-merge-msf8ztu9(gitlab-run's-own-marker)
... merge-commit-message"`, i.e. it carried the `commitMessage`, not the squash message
(`GitLabProvider` maps the two fields to distinct API parameters). This defect is
GitHub-specific, not a shared platform limitation.

**Owner: phase 2.** Already ticketed (MAT-25) and already named in the design doc.

**2. `mergePullRequest`: "shouldRemoveSourceBranch actually deletes the source branch"**

```
branch still exists after merging with shouldRemoveSourceBranch: true
```

Confirmed again in this run. `GitHubProvider.ts:965` sends a `delete_branch` field to
GitHub's merge endpoint, which has no such parameter and silently ignores it.
**Cross-provider comparison (live-verified, this run):** the identical assertion passed on
GitLab, whose source branch was gone immediately after merge (GitLab's merge endpoint has a
real `should_remove_source_branch` parameter and honors it). GitHub-specific.

**Owner: phase 2.** Named in the design doc, not yet in Linear as of the design doc's
writing.

**3. `retryJob`: "accepts a retry of the failed job"**

```
retryJob failed: 403 Forbidden — {"message":"The workflow run containing this job is already running","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run","status":"403"}
```

The dash in that string is GitHub's, reproduced verbatim. This project's no-dash rule
governs prose we author, not quoted evidence: a findings document that later plans are
built from has to reproduce errors exactly, and silently editing an API's own message
would be the wrong trade.

This is the only place in the entire suite `retryJob` is exercised against a job that
genuinely failed (see "What phase 1 did not cover" below), so this result is load-bearing. **This is a new finding from this task; it is not
in the design doc and not yet ticketed.**

A follow-up read-only query against the fixture's Actions run history, after the harness
run finished, showed:

```
run 30957694970  branch=conformance/msf901hv-failjob  status=completed  conclusion=failure
  job controllable    completed 2026-08-04T22:47:23Z  conclusion=failure
  job always-passes   completed 2026-08-04T22:47:27Z  conclusion=success
  run itself: updated_at=2026-08-04T22:47:27Z
```

The harness's poll finds and reports on the `controllable` job as soon as it individually
reaches `completed`/`failure` (at `:23`), which can happen up to several seconds before the
*run* as a whole (both jobs together) reaches `completed` (the run's own `updated_at` is
`:27`, matching when the second job finished). The harness calls `retryJob` immediately
after its poll returns. GitHub's error text is specifically about the *run*, not the job:
"the workflow run containing this job is already running." This is consistent with the call
landing inside that few-second gap between "this job is done" and "the run is done," though
the harness does not log the exact timestamp of the `retryJob` call itself, so this is the
evidence available, not a proven root cause.

**Owner: recommend phase 2**, as a companion to phase 2d (which documents the equivalent
shape of problem on GitLab's `mergePullRequest`: a sub-resource's completion state can
report "done" slightly before the umbrella resource does, and the API returns the same
error for "try again shortly" as it does for a permanent block). Whether the fix belongs in
`GitHubProvider.retryJob` (wait for the run, not just the job) or is better left to phase 3
(a retry policy in the Octokit transport swap) is a decision for whoever writes that plan;
this document records the finding, not the fix.

### GitLab

**1. `fetchJobTrace`: "returns non-empty log text"**

```
trace was empty
```

**Root-caused, live, to a harness gap, not a `GitLabProvider` defect.** A follow-up
read-only query showed the pipeline `latestPipelineAndJob` had just probed:

```
jobs in order returned by the API:
  build    (stage build)    status=skipped
  test     (stage test)     status=skipped
  lint     (stage lint)     status=skipped
  install  (stage install)  status=failed
```

`latestPipelineAndJob`'s GitLab branch (transcribed from the brief verbatim) takes
`jobs[0]` unfiltered by status; here that was `build`, which never ran because the
fixture's `install` job fails on every pipeline (`npm ci` fails; `lint`/`test`/`build` all
carry `needs: [install]` and report `skipped`; this cascade was already established live in
Task 6). A direct `GET` of that same job's trace, run separately as part of this
investigation, also returned `200` with a zero-length body: GitLab genuinely has no trace
text for a job that never ran. `GitLabProvider.fetchJobTrace` returned exactly what the API
gave it.

**Owner: none of phase 2/3/4.** No provider code is implicated. This is a harness coverage
gap: `latestPipelineAndJob` needs to select a job that actually ran (e.g. filter out
`skipped`/`manual`) to give GitLab's `fetchJobTrace` a real trace to fetch. Until that
changes, **GitLab's `fetchJobTrace` has not been meaningfully exercised by this harness at
all** (see "What phase 1 did not cover").

## Skipped / inconclusive (live-verified), and why

Skipped means the assertion did not run. It is not evidence the method works.

**GitHub (1 skip):**

| Method | Reason |
| --- | --- |
| `fetchPullRequests` ("projectPath mode returns only that project") | No open PRs existed in the fixture project at the moment this check ran, so the scoping behavior (does the provider actually filter by `projectPath`, or does it return everything and happen to look right) could not be verified either way. |

**GitLab (7 skips):**

| Method | Reason |
| --- | --- |
| `rebasePullRequest` | GitLab declares this supported; the harness's `runUnsupportedConformance` only exercises the *unsupported* path (assert-throws) on providers that declare a method unsupported. GitLab's real, working `rebasePullRequest` behavior has never been invoked by this harness. |
| `unapprovePullRequest` | Same shape: GitLab's approve/unapprove is exercised elsewhere in the write cycle (see below), but this specific "unsupported-path" probe skips it because the method is, correctly, supported. Note this is distinct from the write-cycle's own `unapprovePullRequest` check, which **did** run live and pass (see the full output above); this particular skip line is an artifact of the same method being probed twice in two different roles. |
| `setAutoMerge` | Declared supported; never actually invoked, anywhere in this harness, on either provider. |
| `cancelAutoMerge` | Same: declared supported; never invoked. |
| `resolveDiscussion` | Declared supported; never invoked. This is notable beyond the general gap: MAT-27's phase 4 GitHub implementation will need a working reference to model against, and this run provides no live evidence that GitLab's own `resolveDiscussion` currently works. |
| `unresolveDiscussion` | Same concern as `resolveDiscussion`, and for the same reason. |
| `watchMR` | Declared supported. Explicitly not invoked: doing so would open a real ActionCable WebSocket subscription against a PR with nothing in the harness to close it. GitLab's real subscribe/receive/dispose behavior is entirely unverified by this harness. |

(`unapprovePullRequest` above needs one more word of precision: the *harness* records two
separate line items with that method name, one from the unsupported-probe loop (skipped, as
listed) and one from the write cycle's real approve-then-unapprove-with-a-second-identity
flow (passed, live, listed under the main output). Both are true simultaneously; they are
not a contradiction, just two different checks sharing a method name.)

## Passed unexpectedly

**GitHub `fetchJobTrace` passed, twice, live.** The design doc's phase 3 section
(`docs/superpowers/specs/2026-08-04-github-parity-design.md`, "What this fixes
structurally") predicted this call would fail: "The Actions logs endpoint returns 302 to
signed blob storage. Forwarding the `Authorization` header to that redirect target
typically fails with 400." This run contradicts that prediction on both occasions
`fetchJobTrace` was called against GitHub:

- Against the latest completed pipeline's job (the general CI probe): passed, non-empty log
  text, did not look like an HTML/XML error page.
- Against the genuinely-failed `controllable` job (the `withFailedGitHubJob` path): passed,
  and the returned text specifically contained the fixture's own failure line,
  `fail-marker present`, confirming this was not just "some text," but the real log of the
  real failure.

One distinction worth being precise about: `expectations.ts` (the harness's own expectation
table) already declared GitHub `fetchJobTrace` as `{ support: 'supported' }`, with no
caveat, so this run does not contradict the expectation table the harness is graded against
-- it contradicts a piece of free-text reasoning in the design doc that was written to
justify part of phase 3. This document records the contradiction and stops there, per this
phase's own rule: it does not speculate about which client behavior (redirect-following,
header-stripping, or something else in how `fetch` handled the 302) explains why the
predicted failure did not reproduce, because nothing in this run's output evidences that
mechanism either way.

**Practical implication:** this does not remove the case for phase 3's Octokit swap, which
rests on more than this one call (rate limiting, pagination, typed responses,
instrumentation). It does mean phase 3's plan should not cite "`fetchJobTrace` currently
fails" as one of its justifications without re-verifying it, since live evidence from phase
1 says otherwise as of this run.

## Code-read findings (not live-verified by this run), carried forward

These were established by reading `GitHubProvider.ts` during planning, before phase 1's
harness existed to check them live. Phase 1's harness does not exercise any of these code
paths, so they remain exactly as uncertain as they were when written; nothing below should
be read as "phase 1 confirmed this."

- **`fetchPullRequestsByBranches` and `watchEvents` are entirely unimplemented on
  `GitHubProvider`.** The properties are `undefined`, so callers feature-detect and
  silently take a slower fallback path. Partial live update: this run's own check
  (`ok github fetchPullRequestsByBranches: is absent, so callers feature-detect and fall
  back`) does confirm, live, that `provider.fetchPullRequestsByBranches === undefined` on
  the real, constructed `GitHubProvider` instance -- so that half is now live-verified, not
  merely code-read. **`watchEvents` has no equivalent check anywhere in this harness** (see
  "What phase 1 did not cover"); its absence remains code-read only.
  **Owner: phase 2a** (documented gap) for `fetchPullRequestsByBranches`; **phase 4** for
  implementing `watchEvents`.

- **`restRequest` is not portable despite its docstring claiming implementations translate
  paths.** GitLab needs an explicit `/api/v4` prefix; GitHub must not have one. Partial live
  update: the harness's own `apiPath()` helper (in `conformance.ts`) had to be written to
  work around exactly this, and every `restRequest` call site in the harness routes through
  it. That is strong circumstantial live confirmation that the portability gap is real (the
  harness could not have been written without the workaround), but there is no dedicated
  assertion in this run that calls `restRequest` the "wrong" way on purpose and checks that
  it fails the way the docstring implies it shouldn't.
  **Owner: phase 2b.**

- **`fetchBranchProtectionRules` fabricates an all-false rule when a per-branch protection
  read fails** (`GitHubProvider.ts:697-706`). This run only exercised the success path
  (`ok github fetchBranchProtectionRules: returns rules for the default branch`, with the
  exact expected values). The failure-fabrication branch was never triggered, since the
  fixture's protection read always succeeds. Still entirely code-read.
  **Owner: phase 2c.**

- **GitLab's `mergePullRequest` races mergeability**: for about a second after MR creation
  it returns HTTP 405, the same status as a permanent policy block. This one has since been
  **live-verified**, in Task 6 (not this run): a diagnostic script observed
  `detailedMergeStatus` sitting in `checking`/`preparing` for roughly a second before
  settling, during which a merge attempt returns the identical 405 GitLab uses for "this can
  never merge." The harness's own `waitForMergeReadiness` polls around it, and this run's
  clean `gitlab mergePullRequest: merges and reports merged state` pass is consistent with
  that workaround still holding. The underlying SDK-level race is unchanged.
  **Owner: phase 2d.**

- **`GitHubProvider.graphql()` swallows all errors and returns `null`**, defensible for
  reads, dangerous for the mutations phase 4 will add. Partial live update: `graphql()` is
  not dead code -- it is called internally by `setDraft` (from `updatePullRequest` toggling
  `draft`) and by `fetchUnresolvedThreadCounts` (from the PR-enrichment path used by
  `fetchPullRequests`, `fetchSingleMR`, `createPullRequest`, and `updatePullRequest`). Every
  one of those call paths ran live in this run and passed, meaning `graphql()` returned real
  data every time it was exercised; the swallow-to-`null` branch itself was never observed
  to trigger. `setDraft` already null-checks and throws on a `null`/mismatched result (the
  same pattern the design doc says phase 4's new mutations must copy), and this run's
  `updatePullRequest: toggles draft on/off` passes are live evidence that pattern currently
  works end to end. What remains genuinely untested is the specific risk the design doc
  raises: a *new* mutation (like phase 4's planned `enablePullRequestAutoMerge`) hitting the
  swallow-to-`null` path and being misread as a no-op success. No such new mutation exists
  yet for this harness to exercise.
  **Owner: phase 4** (the mandatory null-check-and-throw requirement for every mutation
  added there).

## What phase 1 did not cover

This harness measures a real subset of `GitProvider`, not the whole surface. Recorded
explicitly so this document is not mistaken for exhaustive coverage:

- **The job-selection bug that broke GitLab's `fetchJobTrace` also exists, unexercised, on
  the GitHub probe path.** `latestPipelineAndJob` takes `jobs[0]` with no status filter on
  both providers. On GitLab it landed on a skipped job and produced the empty-trace
  failure recorded above. On GitHub it happened to land on a job that had really run, so
  the GitHub CI results in this document depend on job ordering rather than on anything
  guaranteed. Treat `fetchJobTrace: returns non-empty log text` on GitHub as lucky rather
  than robust. The dedicated failed-job assertion, which selects the `controllable` job by
  name, is not affected and is the trustworthy one.
- **`requestReReview`** is never called anywhere in this harness, on either provider,
  despite being declared `supported` on both. Zero live evidence either way.
- **`watchEvents`** is never called anywhere in this harness, on either provider (unlike
  `fetchPullRequestsByBranches`, whose GitHub absence at least gets an explicit assertion).
  Zero live evidence either way.
- **MAT-24** (reviewers/assignees must replace rather than append on GitHub) is never
  exercised: no check in this harness ever calls `updatePullRequest` with `reviewers` or
  `assignees`. This is named in the design doc as a phase 2 item, but phase 1 produced no
  live evidence about it in either direction.
- **`retryJob` on GitLab** is never called anywhere in this harness, despite being declared
  `supported`. Only GitHub's `retryJob` was exercised (see above), because
  `withFailedGitHubJob` is GitHub-only by design (the brief is explicit that the GitLab
  fixture's `.gitlab-ci.yml` is not this harness's to change). GitLab's `retryJob` has zero
  live coverage.
- **GitLab's `fetchJobTrace`** has effectively zero live coverage of a job that actually
  ran, for the harness-gap reason described above (`jobs[0]` unfiltered by status landed on
  a `skipped` job). Until the harness's job selection is fixed, this remains true on every
  future run against this fixture, since `install` fails on every pipeline by design.
- **`fetchDownstreamPipeline` and `fetchJobDetail` assertions are weak.**
  `fetchDownstreamPipeline`'s check only asserts "resolves without throwing," never a real
  value; neither fixture has an actual downstream/multi-project pipeline relationship to
  observe, on either provider. `fetchJobDetail`'s check only asserts the discriminant is
  `'trace'` or `'bridge'`; the `'bridge'` branch was never actually produced by either
  fixture in this run, so it remains type-checked, not behavior-checked.
- **GitLab's own `rebasePullRequest`, `setAutoMerge`, `cancelAutoMerge`, `resolveDiscussion`,
  `unresolveDiscussion`, and `watchMR`** are all declared `supported` and all skipped in
  this run (see "Skipped / inconclusive" above). None of GitLab's own working behavior for
  these six was verified live by phase 1, which matters most for `resolveDiscussion` /
  `unresolveDiscussion` since MAT-27's phase 4 GitHub work is meant to match GitLab's
  existing behavior.
- **GitHub's `approvePullRequest` / `unapprovePullRequest` accept-and-revoke path** remains
  unverifiable with a single GitHub identity (already flagged as a risk in the design doc).
  This run only confirms the self-approval *rejection* (422) on GitHub, which proves
  request shape and auth reach GitHub, not that a real approval from a second identity
  would be accepted and recorded correctly.
- **`deleteBranch`** has no dedicated pass/fail line in the Reporter's tally anywhere in
  this harness. It is called repeatedly, live, as cleanup in every `finally` block across
  the write, merge, and CI-failure cycles, and this run's cleanup verification (branches
  listed after the run contain no `conformance/`-prefixed entries) is indirect evidence it
  worked every time. But it is never asserted on directly, so it contributes nothing to the
  31/26 pass counts above.
- **Rulesets** (GitHub's newer branch-protection mechanism, as opposed to classic branch
  protection) remain entirely untested; the design doc already flags this, and phase 1 does
  not change it. The fixture uses classic protection only.
- **This document reflects one run at one point in time.** GitHub Actions and GitLab CI/CD
  are live, shared external systems; a re-run is not guaranteed to reproduce every result
  identically (the retryJob timing gap above is the clearest example of a result that could
  plausibly go either way on a different run).

## Phase ownership, all findings in this document

| Finding | Live-verified? | Owner |
| --- | --- | --- |
| MAT-25: `commitMessage` dropped on GitHub merge | Yes (this run and Task 6) | Phase 2 |
| `shouldRemoveSourceBranch` no-op on GitHub | Yes (this run and Task 6) | Phase 2 |
| `retryJob` 403 against a genuinely-failed job (new) | Yes (this run) | Phase 2 (recommended; pairs with 2d) |
| GitLab `fetchJobTrace` empty trace | Yes, root-caused to harness job selection | Harness fix, not phase 2/3/4 |
| GitHub `fetchJobTrace` did not fail as the design doc predicted | Yes (this run) | None needed; corrects phase 3's stated justification |
| `fetchPullRequestsByBranches` / `watchEvents` absent on GitHub | Partial (absence of the former confirmed live; `watchEvents` code-read only) | Phase 2a (former), phase 4 (latter) |
| `restRequest` not portable | Circumstantial live confirmation, not a dedicated assertion | Phase 2b |
| `fetchBranchProtectionRules` fabricates on read failure | Code-read only | Phase 2c |
| GitLab `mergePullRequest` mergeability race | Yes (Task 6) | Phase 2d |
| MAT-24 reviewers/assignees append instead of replace | Not covered at all | Phase 2 |
| `GitHubProvider.graphql()` swallows errors | Partially live-exercised (no failure observed); the mutation-safety risk itself remains code-read | Phase 4 |
