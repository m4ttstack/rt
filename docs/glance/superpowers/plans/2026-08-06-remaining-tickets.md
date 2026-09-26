# Remaining Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the tickets phase 4 left open, in value order, fixing real defects rather than documenting them.

**Architecture:** Provider fixes first, because they are consumer-visible silent failures. Then the contract decisions. Then harness coverage. `watchEvents` and the openapi-types adoption are the large tail and come last, because both are broad and neither fixes a defect anyone is hitting.

**Tech Stack:** TypeScript, Bun test runner, `@octokit/core` 7, gitbeaker, GitHub GraphQL v4.

## Global Constraints

- **The live harness mutates real repositories, including merging into their default branches.** Do not run `tests/live/runner.ts` from a task. The controller runs it.
- `harness_credentials.json` is at the **repository root**, gitignored, and holds three real GitLab tokens. The repository is public. Never stage it, never print it, never read it. Stage files by explicit path. Never `git add -A`.
- The GitHub second identity is named by `GLANCE_HARNESS_GITHUB_APPROVER` and its token comes from `gh auth token --user`. No GitHub credential belongs on disk.
- No em dashes or en dashes anywhere authored. Use `--`, an ellipsis, or rephrase.
- Comments explain WHY, never WHAT.
- `bun test`, `bun run check-types`, and `bun run check:node` must all be clean before every commit, run from `packages/glance`.
- One task, one commit.

## The failure shape this codebase keeps producing

Every task here should be read against it. Across four phases this project has now found eleven instances of one defect: something reporting success, or reporting accounted-for, while proving nothing. Hardcoded constants presented as measurements, silent no-ops returning success, tests passing against no-op implementations, a skip whose stated cause was never checked, a GraphQL query no stub could reject.

**When a fix has two candidate shapes and one of them hides information, that is the wrong one, even when it is smaller.** Several tasks below say this again in context.

---

### Task 1: MAT-24, reviewers and assignees actually reach both providers

Two independent defects on the same pair of input fields, both silent.

**GitLab is sent usernames where it wants numeric ids.** `CreatePullRequestInput.reviewers` and `.assignees` are documented as usernames. `GitLabProvider` forwards them into `assigneeIds` / `reviewerIds` through `asUserIds` (`GitLabProvider.ts:393`), which is `usernames as unknown as number[]`. That is a cast that erases the mismatch rather than fixing it, and it exists only so the current behaviour is honest about being a type escape.

**GitHub's documented "replaces the current set" is false.** `POST .../requested_reviewers` and `POST .../issues/:n/assignees` are additive. Removals need `DELETE` on the same endpoints.

Nothing reaches either path today, so this is latent rather than live. It matters the moment anyone adds reviewer support, because both failure modes return a `PullRequest` that looks like the call worked.

**Files:** `packages/glance/src/GitLabProvider.ts`, `packages/glance/src/GitHubProvider.ts`, `packages/glance/src/types.ts` (doc comments), tests for both providers.

- [ ] **Step 1: Resolve usernames to ids on GitLab, and delete the cast**

The pattern already exists in this file: `requestReReview` resolves with `this.gb.Users.all({ username })` (around `GitLabProvider.ts:1581`). Reuse it rather than inventing a second approach, and factor it into one helper both call sites use.

A username that resolves to no user must throw, naming the username. Dropping it silently is the same defect one level down.

`asUserIds` and its cast must be gone when you are done. If anything still needs it, say so rather than leaving it.

- [ ] **Step 2: Make GitHub's update replace rather than append**

Read the current reviewer and assignee sets, compute the difference against what the caller asked for, and issue `DELETE` for the removals alongside the `POST` for the additions. The documented contract is "replaces the current set", and GitLab already honours it, so GitHub is the one that moves.

**If you conclude replacement cannot be done correctly** for some case, do not quietly implement append-with-a-comment. Say so, and change the doc comment on `UpdatePullRequestInput` instead, so one of the two is true. Both providers must end up honouring the same documented contract.

- [ ] **Step 3: Tests on both providers**

A reviewer added, and a reviewer removed. The removal case is the one that catches an append-only implementation, so make sure it would fail against one. An assignee case too, since they are separate endpoints on GitHub.

- [ ] **Step 4: Verify and commit**

```bash
cd packages/glance && bun test && bun run check-types && bun run check:node
git commit -m "fix: reviewers and assignees reach both providers as documented (MAT-24)"
```

---

### Task 2: MAT-143, stop re-swallowing the pagination failure phase 3 made loud

Phase 3 replaced a hand-rolled `fetchAllPages` that did `if (!res.ok) break` and returned a short list. Those pages feed the reviews fetch, and approval counts are computed from reviews, so a failed second page could under-report approvals on a pull request. It rejects now.

That exposed two places one level up that turn the loud failure back into a quiet one.

`fetchSingleMR` catches everything to `null`, so a rate-limited page makes a live pull request look nonexistent. That is still better than a wrong approval count, since no caller can mistake `null` for "zero approvals", but it is half fixed.

`MRDashboard.batchFetch` (around `MRDashboard.ts:549-561`) catches `fetchPullRequests` into `null`, so one pull request's failing reviews fetch now fails an entire dashboard refresh rather than one row.

**Files:** `packages/glance/src/GitHubProvider.ts`, `packages/glance/src/MRDashboard.ts`, tests.

- [ ] **Step 1: Read the `onWarning` channel that already exists**

`fetchPR` and `searchPRs` already accept `onWarning` for exactly this partial-degradation case. `enrich` and `fetchReviews` do not. The ticket's own judgment is that extending it to them looks like the shape of the fix. Confirm that by reading, and say whether you agree.

- [ ] **Step 2: Make partial degradation reportable rather than silent**

A dashboard refresh should lose one row and say so, not lose everything and not silently show stale approval counts. Whatever mechanism you choose, the caller must be able to tell a complete answer from a degraded one. That is the whole ticket.

- [ ] **Step 3: Fix the live-run consequence the ticket names**

A rejection reaching `fetchSingleMR` currently surfaces as `Created/Merged PR but failed to fetch it back`, which matches no harness pattern and reads as an unrelated hard failure. Make the message say what actually happened.

- [ ] **Step 4: Tests, verify, commit**

```bash
git commit -m "fix: report partial fetch degradation instead of swallowing it (MAT-143)"
```

---

### Task 3: MAT-130, make `restRequest` portable

`GitProvider.ts` says implementations "translate the path to the provider's API URL format". GitHub does. GitLab does not: `restRequest` is `${this.baseURL}${path}` verbatim, so a GitLab caller passes `/api/v4/user` where a GitHub caller passes `/user`. Provider-agnostic code therefore cannot call it portably, which is the one thing it exists for.

**The decision, already recommended across two phases:** make `GitLabProvider.restRequest` prefix `/api/v4` itself, matching the docstring. Evidence: exactly one production call site exists across the user's repositories, `repo-tools/lib/daemon/freshness.ts` in `fetchProjectId`, and it already carries a comment documenting the divergence it works around. gitq and mr-board reference `restRequest` only in test stubs.

**This is a breaking change for anyone passing `/api/v4/...`**, so it needs a changelog entry, and the harness's own `apiPath(fixture, path)` compensation helper should disappear with it.

- [ ] **Step 1: Prefix in the provider, and handle the double-prefix case deliberately**

Decide what happens when a caller passes a path that already starts with `/api/v4`. Silently accepting both is how the ambiguity survives; rejecting is loud but may break the one known consumer at exactly the moment it upgrades. Pick one, implement it, and say why.

- [ ] **Step 2: Delete the harness's compensation**

`apiPath(fixture, path)` in `tests/live/` exists only to work around this. If it can go, remove it and let the harness call the same path shape on both providers. That is also the strongest proof the fix worked.

- [ ] **Step 3: Changelog, verify, commit**

This is consumer-visible. Add the entry in the same commit.

```bash
git commit -m "fix: GitLab restRequest prefixes /api/v4 as its contract says (MAT-130)"
```

---

### Task 4: MAT-147, record the branch-protection decision

`fetchBranchProtectionRules` throws as soon as one per-branch protection read fails, and the throw sits inside the loop, so one unreadable branch discards every rule already read. The read requires admin access, so any non-admin token turns a previously-resolving call into a throw.

**The decision: keep the throw.** The alternative, returning what was readable, gives the caller a list they cannot distinguish from a complete one, and callers gate destructive actions on this. That is silent absence, which is the failure shape this project keeps producing.

**So this task changes behaviour minimally and records the reasoning where it will be found.** Nobody has to reopen two specs to learn why it works this way.

- [ ] **Step 1: Say it in the docstring**

The current behaviour shipped by default rather than by decision. Write the decision into `fetchBranchProtectionRules`'s docstring: that a partial list is worse than no list because callers gate destructive actions on it, that admin access is required so non-admin tokens will throw, and that if this starts hurting, the honest fix is to make unreadability expressible in the return type rather than choosing between two ways of concealing it.

- [ ] **Step 2: Make the error name what was lost**

The throw currently does not say which branch failed or that earlier rules were discarded. A caller debugging this deserves both.

- [ ] **Step 3: Verify and commit**

```bash
git commit -m "docs: record why branch protection throws on an unreadable branch (MAT-147)"
```

---

### Task 5: MAT-145 remainder, and splitting MAT-129

Phase 4 closed most of MAT-145: `deleteBranch` and `requestReReview` are asserted on both providers, GitLab `retryJob` is asserted, and the job-selection bug is fixed. What remains:

- `fetchDownstreamPipeline` and `fetchJobDetail`'s `bridge` branch have never been produced by either fixture, so that branch is type-checked rather than behaviour-checked. Closing it means building a parent/child pipeline relationship into the GitLab fixture.
- GitLab's own `rebasePullRequest`, `setAutoMerge`, and `cancelAutoMerge` are declared supported and still skipped.
- `watchMR` on GitLab needs a live ActionCable connection, which is a different kind of harness.

- [ ] **Step 1: Assert GitLab's three skipped mutations**

`rebasePullRequest`, `setAutoMerge`, `cancelAutoMerge`. Each needs a re-read proving an effect, not an absence of throw. `setAutoMerge` on GitLab is "merge when pipeline succeeds", so it needs a merge request with a running pipeline; the fixture has CI, so this should be reachable.

If any of the three cannot be established on this fixture, report `Inconclusive` naming the reason rather than passing or failing. Follow the convention already in the file.

- [ ] **Step 2: Decide about the bridge branch and `watchMR`, do not guess**

Both need fixture or harness changes larger than this task. Investigate what each would actually take, write it down, and leave them. Say plainly in your report what is required so the next person is not re-deriving it.

- [ ] **Step 3: Verify and commit**

```bash
git commit -m "test: assert GitLab's remaining declared-supported mutations (MAT-145)"
```

---

### Task 6: MAT-132, make GitLab's merge 405 unambiguous

GitLab returns HTTP 405 both for "this merge request is not ready yet" and for "this can never merge". The harness compensates with `waitForMergeReadiness`, and phase 4 measured the transitional window at well past twenty seconds, but the underlying ambiguity is in the provider.

- [ ] **Step 1: Establish whether the provider can distinguish them**

`detailedMergeStatus` carries the information the 405 lacks. Investigate whether `mergePullRequest` can read it on failure and turn an ambiguous 405 into an error that names the actual cause. Report what you find before implementing.

- [ ] **Step 2: Implement if it is genuinely distinguishable**

If it is, the error message should name the merge status GitLab reported. If it is not, say so and record why, rather than adding a guess that reads as a diagnosis.

- [ ] **Step 3: Verify and commit**

```bash
git commit -m "fix: name the cause when a GitLab merge is refused (MAT-132)"
```

---

## The large tail, not in this plan

Two remaining tickets are big enough to want their own plans, and neither fixes a defect anyone is currently hitting:

- **`watchEvents` on GitHub** (the second half of MAT-129). Phase 4 measured why this is harder than it looks: `X-Poll-Interval: 60` over a five-minute cache, no `since` parameter, string ids, and an id ordering that disagrees with `created_at` where `EventsPoller` assumes the opposite. It needs `EventsPoller` and `EventsWatcher` generalized off `GitLabEvent`, a publicly exported type change, and ETag support, to ship something meaningfully weaker than its GitLab counterpart. Declaring it permanently unsupported with the measured reasons is a defensible alternative.
- **MAT-144, adopting `@octokit/openapi-types`.** Deliberately deferred out of phase 3 so a type-shape regression could not be confused with a transport regression. Broad and mechanical.

**`fetchPullRequestsByBranches` on GitHub** (the first half of MAT-129) is smaller and worth doing: callers feature-detect and fall back to N sequential calls where GitLab makes one. Split the ticket before planning it.
