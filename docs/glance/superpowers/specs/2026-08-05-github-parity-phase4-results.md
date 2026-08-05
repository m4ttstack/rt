# GitHub Parity Phase 4: live verification results

Twenty-one tasks, plus a fix wave after the whole-branch review. Six live runs against `m4ttheweric/glance-conformance` and `m4tthew-dev/glance-test-repo`. Run five was the first in this project's history where the conformance runner exits zero; run six repeats it at the exact commit that merges.

```
github: 33 passed, 0 failed, 9 skipped
gitlab: 32 passed, 0 failed, 8 skipped
HARNESS_EXIT=0
```

Run six exists because run five was taken before the final fix wave, which changed provider source. A results document describing code that is not the code being merged would be the same category of claim this phase spent twenty-one tasks removing.

That exit code is the headline and also the least interesting thing in this document. What the six runs found on the way there matters more.

## The one that should have shipped broken

`fetchReviewThreadIndex`'s GraphQL query asked for `isResolvable` on `PullRequestReviewThread`. **That field does not exist.** Introspection returns `comments diffSide id isCollapsed isOutdated isResolved line originalLine originalStartLine path pullRequest repository resolvedBy startDiffSide startLine subjectType viewerCanReply viewerCanResolve viewerCanUnresolve`, and nothing named `isResolvable`. It was invented in this phase's own plan text and transcribed faithfully into the implementation.

Two layers of verification passed over it.

**Ten unit tests.** Every one stubs `octokit.graphql` and returns a literal shaped like the query's expected response. A stub cannot reject a field the real schema lacks, so the tests agreed with each other and none of them agreed with GitHub.

**The live read-side check.** This is the worse half. Task 3 deliberately made a GraphQL failure degrade rather than fail: the catch warns and falls back to `resolved: null`, on the reasoning that notes come from REST and were returned long before resolution state existed, so throwing would be a regression. A reviewer specifically praised that design. Against live GitHub it meant `fetchMRDiscussions` silently returned exactly its pre-MAT-27 answer, and its harness check passed, because that check only asserted an object came back.

So MAT-27's read side had never worked, and the graceful degradation is what hid it. Only `resolveDiscussion`, a mutation that cannot degrade, surfaced it, and only on the first live run after sixteen tasks were complete.

The fix drops the field. GitHub has no per-thread resolvability flag because every review thread is resolvable; `viewerCanResolve` exists but is a permission rather than a property, and using it would have replaced an invented field with a wrong meaning. Task 17 also added a harness assertion that cannot pass through the degradation path, verified by tracing rather than assertion: a broken query empties the whole thread index, every review-thread discussion then reads `resolved: null`, and the new check demands `resolved === false`.

## MAT-128, root-caused after three phases

Phase 1 proposed that `retryJob`'s intermittent 403 came from calling it in the gap between the *job* reporting completed and the *workflow run* reporting completed, and said plainly it was "the evidence available, not a proven root cause". Phase 2 reproduced the failure without explaining it. Phase 3 made it pass by accident when a throttling plugin incidentally added seconds of delay, and correctly declined to claim that closed anything.

The instrumentation Task 8 added recorded, across three runs:

| Run | Job status | Run status at the call | Result |
| --- | --- | --- | --- |
| 1 | completed | `completed`, +1.9s | pass |
| 2 | completed | `completed`, +1.4s | pass |
| 3 | completed | **`in_progress`** | 403 `The workflow run containing this job is already running` |

The job had completed in all three. The run had not, in the one that failed, and GitHub's error text says exactly that. That is the hypothesis confirmed by measurement.

Task 20 acts on it: the harness now polls for run completion before calling `retryJob`. Runs 4 and 5 both show `run status "completed"` in the timing line and both pass, which is how a future reader confirms the fix still holds.

Worth recording how this became measurable. Task 8's brief forbade adding any delay before the call, because that would have destroyed the measurement. Task 16's review flagged that the diagnostic itself issued two sequential reads before the call, and that finding was upgraded from Minor to Important on the grounds that a diagnostic perturbing its own variable is a correctness problem. Task 20 is the first change permitted to wait before that call, and only because the measurement was finished.

## The GitLab merge stall

`waitForMergeReadiness` timed out at 20 seconds on three consecutive runs, on three different merge requests. The poll discarded every observation and reported only the timeout, which is the same evidentiary hole MAT-128 sat in.

Task 19 instrumented it rather than guessing, and explicitly forbade raising the timeout, because a longer bound on an unexplained stall converts a visible failure into a slow one and destroys the evidence. Run 3 produced:

```
preparing x1 -> unchecked x1 -> checking x12
```

`detailedMergeStatus` reaches `checking` and stays there. Phase 1 measured that transitional window at roughly one second; it is now far longer on this fixture. That is the condition under which raising the bound stops being a guess, so Task 20 raised it to 90 seconds with the observation in the comment. Runs 4 and 5 both merge cleanly.

The observation trail is retained. A future stall past 90 seconds will produce the same evidence rather than a bare timeout.

## What the harness proves now, and what it does not

Full method coverage on both providers. That retires the reason this runner has exited non-zero since phase 1, where four methods were declared supported and never asserted on.

**Newly verified live, most of it for the first time ever:**

- GitHub `resolveDiscussion` and `unresolveDiscussion`, after Task 17
- **GitLab `resolveDiscussion` and `unresolveDiscussion`**, which had never once been verified despite being declared supported. MAT-27's acceptance criteria said the GitHub work should match GitLab's existing behavior; that behavior turned out to be reporting `null` for everything, because `MRDetailFetcher` hardcoded discussion-level `resolvable` and `resolved`. Task 13 fixed it, and only then could either provider's resolution be measured.
- GitLab `requestReReview`, which previously ignored its `reviewerUsernames` argument entirely and returned successfully having done nothing when a merge request had no reviewers
- `deleteBranch` on both providers, previously called constantly as cleanup and never asserted
- GitLab `retryJob`, previously never asserted
- GitLab branch protection reporting measured `requiredApprovals` and `requireStatusChecks` rather than the constants `0` and `false`

**Still not proven, stated plainly:**

- **GitHub `setAutoMerge`'s round trip.** Run 1 armed auto-merge and confirmed it by re-read, so it works. Runs 2 through 5 could not: GitHub refuses `enablePullRequestAutoMerge` on a `clean` pull request (nothing to wait for) and on an `unstable` one (checks failing), leaving a narrow armable window. The expectation entry is now `approximate` rather than `supported`, because leaving it as `supported` would claim verification the harness does not perform.
- **GitHub `unapprovePullRequest`'s success path.** Dismissal needs an approval, and GitHub rejects self-approval. `fixture.approver` is hardcoded `null` for GitHub while GitLab reads approver tokens from credentials, so this is a credentials and wiring change rather than a harness redesign.
- **GitHub `requestReReview`.** Same single-identity limit: GitHub rejects a review request from the pull request's author.
- **`watchMR` and `watchEvents` on GitLab.** Both would open real subscriptions the harness has nothing to close.
- **GitHub `fetchPullRequests` projectPath scoping**, when the fixture has no open pull requests at read time.

## Independent checks, from outside the harness

A green assertion is the harness making a claim about itself.

**Fixture state after five runs**, read through `gh api` rather than through the SDK under test: branches `["main"]` only, zero open pull requests, none left with auto-merge armed. Every `conformance/`-prefixed branch was cleaned up, and no pull request was abandoned.

**The corrected GraphQL query**, run directly against live GitHub outside the provider, returned a valid response rather than a field error. That is what proves Task 17's fix rather than the unit tests, which would have passed either way.

**The Node build**, exercised by a committed smoke test that imports `dist` through `import()` and drives the real provider methods against stubbed transports. Its failure injection reproduced the historical bug live: removing `NULL_BODY_STATUSES` produces `Response constructor: Invalid response status code 204` and exits non-zero. That is the phase 3 defect, now caught by tooling instead of by a later phase.

## The fixture carries an artifact from a mistake in this phase

The auto-merge spike merged into `main`, adding `automerge-spike.md` and a merge commit. The cause was the plan's own script: it armed auto-merge and then slept 90 seconds waiting for the required check to report, which is precisely the condition that fires auto-merge. No merge endpoint was called. The implementer noticed, stopped before writing any code, and escalated.

Left in place by decision. The repository root already held seven `conformance-merge-*.md` files from prior runs, because every merge cycle permanently adds one file and two commits by design, so this is one more artifact of a kind already accumulating. It is recorded here rather than reverted.

Five runs later the root holds sixteen files and the first page of commits shows thirty. Any claim of the form "commit count stayed stable across runs" remains meaningless for this fixture, as phase 1 already noted.

## What the whole-branch review caught that per-task review could not

Twenty-one tasks were each reviewed against their own brief. Three defects survived that, because no brief covered them.

**The shared interface still said "GitLab-only."** `GitProvider.ts` documented `unapprovePullRequest`, `setAutoMerge`, `cancelAutoMerge`, `resolveDiscussion`, and `unresolveDiscussion` as GitLab-only, after this branch implemented all of them on GitHub and flipped three flags to true. No task's brief touched that file. It ships to consumers and is the first thing they read, so the capability flags would have been inert for exactly the capabilities this phase added.

**`unapprovePullRequest` threw on a pull request GitHub reports as approved.** Only `APPROVE` and `REQUEST_CHANGES` change a reviewer's state; `COMMENT` does not. Approving and then leaving review comments made the method report no approval to dismiss. `gh-unapprove.test.ts` built almost exactly that fixture but ordered the `COMMENTED` review between two approvals, so the bug could not fire: a test agreeing with a broken implementation through fixture ordering alone.

**A fix inverted an asymmetry rather than removing it.** Task 14 made GitLab's `requestReReview` throw when there is nothing to re-request, and left GitHub silently returning at the same input. The identical call through one shared interface then threw on one provider and resolved on the other, which is the precise defect that fix was filed for.

Also found: `prepublishOnly` never ran the Node smoke test, and this repository has no CI workflows, so the guard built in Task 12 ran only when someone typed it. Reverting `NULL_BODY_STATUSES` would still have published green. It is now wired into the publish path.

## What this phase says about verification

Eight instances of one defect were found across twenty-one tasks: something reporting success, or reporting accounted-for, while proving nothing.

1. A unit test that passed against a no-op implementation
2. A skip whose stated cause was never checked, so a wholly broken method would have skipped forever
3. An assertion that could not fire, because the poll before it threw first
4. A Node check that read a static object literal, blind to the bug class it existed to catch
5. A harness check satisfied entirely by its own setup step
6. A GraphQL query no stub could reject
7. A re-read assertion satisfied by a pull request that never entered the state under test
8. A gate that would have silently stopped running a check when its expectation was corrected

Seven were caught by adversarial review before shipping. The sixth needed a real API to say no. The eighth was caught by an implementer who flagged their own unrequested change for review rather than quietly making it.

The pattern across phases holds and sharpened: defects concentrate in plans rather than implementations. Of the four fix rounds where fault was attributable, three were defects in this phase's own plan text, including the invented GraphQL field. A green test suite was not evidence of anything until something outside it disagreed.
