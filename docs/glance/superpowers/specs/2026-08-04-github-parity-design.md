# GitHub feature parity with GitLab

**Date:** 2026-08-04
**Status:** approved, pending implementation plan

## Problem

`GitLabProvider` is the mature implementation in `@mattstack/glance`. It is exercised
daily through gitq and mr-board. `GitHubProvider` implements the same `GitProvider`
interface, but most of its paths have never run against a live API, and five of nine
`ProviderCapabilities` flags are `false` on GitHub against nine `true` on GitLab.

Five Linear bugs already name specific GitHub defects (MAT-13, MAT-14, MAT-24, MAT-25,
MAT-27), and MAT-13 and MAT-14 shipped only because someone read the code. Nothing in
the test suite would have caught either. The absence of live coverage is the root
cause; the individual bugs are symptoms.

## Goal

Every `GitProvider` method either works on GitHub or is explicitly, verifiably declared
unsupported. A live conformance suite proves which, on both providers, from one shared
assertion set.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Capabilities GitHub cannot do natively | Honest flags | `canRebase` stays false and `watchMR` keeps throwing. GitHub's `update-branch` merges base into head, which is not a rebase, and there is no push channel to back `watchMR`. Callers already branch on `capabilities`, so a flag that lies is worse than one that admits the gap. |
| Test strategy | Live-only integration suite | Run by hand with credentials. No record/replay layer. |
| Suite structure | Shared conformance harness | One assertion set driven against both providers, with per-provider expectations where they legitimately differ. |
| GitLab target | Full mutating, three identities | `m4tthew-dev/glance-test-repo`, project id 79691134. |
| GitHub approvals | Assert the 422, document the gap | Only one GitHub identity exists, and GitHub rejects self-approval. |
| Credential storage | Gitignored file plus committed example | This repo is public. |
| Octokit adoption | Yes, after the harness is green | Sequencing matters: the suite is the safety net that makes the transport swap safe. |

## Environment facts established

These were verified live, not assumed.

- **GitLab.** Three tokens in `harness_credentials.json`, all valid, all full `api`
  scope, all with access to project 79691134:
  `goodwin.matthew.eric` (access level 50, owner), `luke.skycoder` (30),
  `han.solocoder` (30). Two developers who can approve each other's MRs is what makes
  approval semantics testable at all.
- **GitHub account is on the free plan.** `GET /repos/m4ttheweric/gitq-test-sandbox/branches/main/protection`
  returns 403 *"Upgrade to GitHub Pro or make this repository public to enable this
  feature."* Branch protection and auto-merge are therefore untestable on a private
  repo. A public fixture repo is a requirement, not a preference.
- **`gh` token scopes** are `gist, read:org, repo, workflow`. No `delete_repo`, so
  ephemeral per-run repositories are not an option without a new PAT.
- **`m4ttheweric/gitq-test-sandbox`** is private and has zero Actions workflows, so
  every CI path (`retryPipeline`, `retryJob`, `fetchJobTrace`, `fetchJobDetail`) has
  nothing to read there today.

## Fixture repositories

**GitHub: a new public repo `m4ttheweric/glance-conformance`.** Public because the free
plan requires it for protection and auto-merge. Seeded with a small file tree and a
`.github/workflows/ci.yml` carrying two fast jobs, one that always passes and one that
can be made to fail on demand, so the pipeline and job and trace paths have real data.
Repository settings: `allow_auto_merge: true`. Branch protection on `main` with a
required status check, because auto-merge is meaningless without something to wait on.

`gitq-test-sandbox` is deliberately left alone. gitq's own live suite targets it, and
changing its visibility or settings would perturb a suite this project does not own.

**GitLab: reuse `m4tthew-dev/glance-test-repo`.** It already carries a `.gitlab-ci.yml`
and all three identities are already members.

## Harness architecture

A new `packages/glance/tests/live/` directory:

- `credentials.ts` loads `harness_credentials.json` and resolves the GitHub token from
  `gh auth token`. Missing credentials skip with a legible message rather than crash.
- `expectations.ts` holds the per-provider expectation table.
- `conformance.ts` holds the assertion set, written once, driven against a fixture
  descriptor: provider instance, project path, second identity or `null`.
- `runner.ts` is the entrypoint that drives both fixtures and reports.

### The expectation table

This is the load-bearing idea. Every `GitProvider` method is declared as exactly one of:

- **`supported`** ... must succeed.
- **`unsupported`** ... must throw, and its capability flag must be `false`. Asserting
  both directions is what stops a flag and its implementation drifting apart.
- **`approximate`** ... succeeds, with semantics documented as differing from the other
  provider.
- **`absent`** ... the optional method is not implemented, so the property is `undefined`
  rather than a throwing stub. Distinct from `unsupported` because callers feature-detect
  with `provider.x?.()` and silently take a fallback path instead of surfacing an error.

A method present on `GitProvider` but absent from the table fails the run. That is the
mechanism that prevents recurrence: adding a method to the interface later *forces* a
conformance decision instead of silently landing GitHub-shaped or GitLab-shaped.

### Lifecycle

Branches carry a per-run unique prefix so an aborted run never collides with the next.
Cleanup runs in `finally`, deleting branches and closing PRs. The suite never deletes
repositories, which also means it never needs `delete_repo`.

## Implementation phases

### Phase 1: harness against current code

Build the fixture repo, the harness, and the expectation table. Run it. The output is a
map of what actually works on GitHub today, replacing the current guesswork. Expect
failures; recording them accurately is the deliverable of this phase.

### Phase 2: bug fixes

- **MAT-25.** `GitHubProvider.ts:962-964` assigns both `commitMessage` and
  `squashCommitMessage` to `commit_title`, so the second silently clobbers the first.

  **Corrected 2026-08-04, while planning phase 2.** An earlier version of this bullet
  prescribed mapping the two onto GitHub's `commit_title` and `commit_message`. That was
  wrong. Those two GitHub fields are the title and the body of a single commit, not a
  merge variant and a squash variant. `types.ts:471-474` defines `commitMessage` as the
  merge commit message and `squashCommitMessage` as the squash commit message "(when
  merge method is squash)", so they are alternates selected by strategy, not two halves
  of one message. Sending both would put a squash message in the body of a merge commit.

  The fix: resolve the effective merge method first (`mergeMethod`, else `squash` implying
  `squash`, else GitHub's repository default), select `squashCommitMessage` when squashing
  and `commitMessage` otherwise, and split the selected string into `commit_title` (first
  line) and `commit_message` (remainder, when there is one).
- **MAT-24.** Reviewers and assignees must replace rather than append, which requires an
  explicit diff (DELETE removals, POST additions) because GitHub has no replace
  semantics on either collection.
- **`shouldRemoveSourceBranch` is a silent no-op on GitHub.** `GitHubProvider.ts:966`
  sends `delete_branch` to the merge endpoint, and no such parameter exists. GitHub's
  merge API accepts only `commit_title`, `commit_message`, `sha`, and `merge_method`.
  Deleting the branch needs a separate `DELETE /git/refs/heads/{branch}` call after a
  successful merge. Ticketed as MAT-127. Same silent-no-op class as MAT-15.

  **Corrected 2026-08-04, while planning phase 2.** An earlier version of this bullet also
  offered the repository-level `delete_branch_on_merge` setting as an alternative. It is
  not one: a repository setting cannot honor a per-call `shouldRemoveSourceBranch: false`,
  and enabling it would invalidate the live assertion that catches this defect, which
  `tests/live/conformance.ts:869-875` documents as depending on that setting being off.

### Phase 2d: GitLab merge races mergeability, and its failure is ambiguous

Found in phase 1, only after the fixture's merge gates were disabled.

For roughly a second after an MR is created, GitLab reports `detailedMergeStatus` as
`checking` or `preparing`. Calling `mergePullRequest` inside that window returns
**HTTP 405**, the identical status GitLab returns when a merge is permanently blocked by
project policy. So a caller cannot tell "try again in a moment" from "this can never
merge", and the natural usage pattern (create an MR, then merge it) lands squarely in
the racy window.

The harness works around it with a `waitForMergeReadiness` poll before merging, but that
is the caller compensating for the SDK. `GitLabProvider.mergePullRequest` should either
wait for mergeability itself or surface a distinguishable error, so a caller can retry
the transient case without retrying the permanent one.

This is a parity issue as well as a usability one: `GitHubProvider` has no equivalent
pre-merge state to race, so the same caller code behaves differently on the two providers.

### Phase 2c: `fetchBranchProtectionRules` invents a rule when a read fails

Found during phase 1, by reading the implementation after a live run passed.

The method itself works. A live run against the fixture returned `allowForcePush: true,
allowDeletion: true, requireStatusChecks: true`, matching the GitHub API exactly. It does
fetch `/branches/{branch}/protection` per branch rather than relying on the shallow
listing.

The defect is in its failure path. `GitHubProvider.ts:697-706`: when the per-branch
protection request is not ok, it pushes a rule with `allowForcePush: false`,
`allowDeletion: false`, `requiredApprovals: 0`, `requireStatusChecks: false` and
continues. A caller cannot distinguish "this branch forbids force-push and deletion"
from "we could not read this branch's protection at all". The invented values are wrong
in both directions, not uniformly dangerous one way: `allowForcePush: false` and
`allowDeletion: false` describe a *more* protected branch than may exist, while
`requiredApprovals: 0` and `requireStatusChecks: false` describe a *less* protected one.
A caller gating a destructive action on the first pair would wrongly believe it is safe;
one relying on the second pair to require review or checks would wrongly believe none is
needed. The success path's `raw` field (the full API response) is the discriminator: the
fabricated rule omits it, so a caller could check for its presence, though nothing does
today.

It should surface the failure rather than fabricate a rule. This is the same class as
MAT-14, where a hardcoded `unresolvedThreadCount: 0` suppressed a warning gitq depended on.

**Rulesets remain invisible.** The method reads classic branch protection only, so a repo
governed by rulesets reports no rules. Untested, since the fixture uses classic protection.

### Phase 2b: `restRequest` is not portable, but documents that it is

Found while planning phase 1. `GitProvider.restRequest`'s docstring states that
"implementations translate the path to the provider's API URL format".
`GitHubProvider` does: it joins the path onto `https://api.github.com`.
`GitLabProvider` does not: `restRequest` is `${this.baseURL}${path}` verbatim, so a
GitLab caller must pass `/api/v4/user` while a GitHub caller must pass `/user`.

The consequence is that provider-agnostic code cannot call `restRequest` portably,
which is the one thing the method exists to provide. The existing
`tests/integration.live.ts` already works around it, passing `/user` on one provider
and `/api/v4/user` on the other, which is why the divergence has gone unnoticed.

Either the implementation should match the docstring (GitLab prefixes `/api/v4`
itself) or the docstring should be corrected and the interface should expose the API
root so callers can build paths deliberately. The first is the smaller change and
matches what callers already assume from the name. Changing it is a breaking change
for any existing caller passing `/api/v4/...`, so it needs a deliberate decision
rather than a quiet fix.

### Phase 2a: absent optional methods

Found while planning phase 1. `GitHubProvider` does not implement two optional
`GitProvider` methods at all: the properties are `undefined` rather than stubs that
throw. Because both are optional on the interface, `tsc` never objected, and
`providerConformance.ts` only guards parameter arity on methods that exist.

- **`fetchPullRequestsByBranches`.** Callers feature-detect and fall back to sequential
  `fetchPullRequestByBranch` calls, so a board resolving twenty branches makes twenty
  round-trips where GitLab makes one. A performance gap rather than a correctness one,
  but a real one for gitq's board.
- **`watchEvents`.** Deferred to phase 5 along with the rest of the
  `canWatchEvents` work. See that bullet in the phase 4 section for the
  measured reasons.

The expectation table gets a fourth state, `absent`, to distinguish "undefined property"
from "throws when called". They fail differently at the call site, so folding them
together would hide exactly this.

### Phase 3: Octokit transport swap

Replace the hand-rolled `api()` wrapper and `graphql()` helper with `@octokit/core` plus
the `paginate-rest`, `retry`, `throttling`, and `graphql` plugins. The suite from phase 1
proves nothing regressed.

What this fixes structurally rather than case by case:

- **`fetchJobTrace`.** ~~The Actions logs endpoint returns 302 to signed blob storage.
  Forwarding the `Authorization` header to that redirect target typically fails with 400.~~
  **Corrected by phase 1's live run: this prediction was wrong.** `fetchJobTrace` passed
  twice against the GitHub fixture, including once against a genuinely failed job, and
  returned the real log content. The redirect was followed and the request succeeded; the
  client-level mechanism was not investigated, and nothing in the run's output evidences
  one explanation over another. This is no longer a reason to adopt Octokit, and phase 3
  should not budget work for it. The remaining reasons below stand on their own.
- **Rate limiting.** A mutating suite is exactly where throttling and retry matter. There
  is none today.
- **Pagination.** `octokit.paginate` replaces the hand-rolled `fetchAllPages`.
- **Types.** `@octokit/openapi-types` is generated from GitHub's OpenAPI spec, so
  response shapes stop being hand-written beliefs (`GHPullRequest`, `GHComment`).
- **Instrumentation.** Octokit's `hook.before/after/error` are first class, unlike
  gitbeaker's requester, which is not injectable and forced the resource-method wrapping
  described in `instrumentation.ts:32-34`.

The error model changes: Octokit throws `RequestError` on non-2xx, so the 29 call sites
that manually check `if (!res.ok)` change. This deletes boilerplate rather than adding it.

### Phase 4: new capabilities

The first three flip a flag from `false` to `true`. `canWatchEvents` does not:
it is deferred to phase 5.

- **`canResolveDiscussions` (MAT-27).** GraphQL `resolveReviewThread` and
  `unresolveReviewThread`. The largest single item: it needs thread node IDs,
  which the current REST-only `fetchMRDiscussions` never obtains. It groups
  review comments by `in_reply_to_id ?? id` (`GitHubProvider.ts:691`), not by
  `pull_request_review_id` as an earlier draft of this document claimed. That
  reply-root is the same comment GraphQL reports as a review thread's first
  comment, so the REST grouping and the GraphQL thread list are joinable on
  `comments(first: 1) { nodes { databaseId } }`.

  **Decision, made in the phase 4 survey:** `Discussion.id` keeps its current
  `gh-review-thread-<rootCommentId>` form and the mutations resolve it to a
  node ID at call time. MAT-27's acceptance criteria contemplated changing
  `Discussion.id` to the node ID instead; that is a change of a value
  consumers may have persisted, on a package still at 0.13.2 with unbumped
  consumer-visible changes already in main. The cost of the chosen route is
  one extra GraphQL read per mutation.
- **`canUnapprove`.** The review dismissal endpoint
  (`PUT /repos/{owner}/{repo}/pulls/{n}/reviews/{review_id}/dismissals`),
  after locating the current user's review ID. Three divergences from
  GitLab's `unapprove` that the implementation has to answer:
  - GitHub requires a `message` on every dismissal and posts it to the PR
    timeline. `unapprovePullRequest(projectPath, mrIid)` has nowhere to get
    one from, so the provider sends a fixed, plainly-attributed string.
  - Dismissal leaves a `DISMISSED` review in the list rather than removing
    the approval record. `toPullRequest` (`GitHubProvider.ts:2024-2040`)
    keeps only the newest review per user, so the approval does drop out.
    That is read-verified, not live-verified.
  - GitHub keeps every review ever submitted, so the newest review per user
    is the only one worth dismissing. Dismissing the first `APPROVED` one
    found would revive a stale approval.
- **`canAutoMerge`.** GraphQL `enablePullRequestAutoMerge` and
  `disablePullRequestAutoMerge`, both needing the PR node ID (REST returns it
  as `node_id`). The fixture is already provisioned for this: a read-only
  check during the phase 4 survey confirmed `allow_auto_merge: true` on
  `m4ttheweric/glance-conformance` and a required `always-passes` status
  check on `main`. The open risk is a race rather than a missing setting:
  GitHub rejects enabling auto-merge on a pull request that is already
  mergeable, so the harness has to land the call before the required check
  reports. Phase 4 resolves that with a live spike rather than a guess.
- **`canWatchEvents`.** Deferred to phase 5. The one-line claim this document
  used to make -- poll `/repos/{owner}/{repo}/events` and translate into the
  same `InvalidationBatch` contract -- understated it. Measured against the
  live fixture feed during the phase 4 survey:
  - `X-Poll-Interval: 60` and `Cache-Control: private, max-age=300`. GitHub
    asks for a 60s cadence over a feed cached for five minutes, against a
    watcher whose default is 15s. GitHub freshness is minutes, not seconds.
  - Event ids do not order with `created_at`. Observed ids descended
    (`16777788402`, `16777332085`, `16777142192`) while timestamps ran
    `07:17:11`, `07:17:23`, `07:17:17`. `EventsPoller` derives `since` as
    `max(created_at)` over fresh events and has a timestamp-fallback filter
    that assumes the two agree (`EventsPoller.ts:174-192`).
  - No `since`/`after` request parameter exists; the `Link` header carries
    only `page`. The day-exclusive cursor strategy `FetchEvents` is typed
    around has no GitHub analog, so filtering is entirely client-side over a
    feed capped at 300 events.
  - Ids are strings. `EventCursor.lastEventId` is `number | null` and is
    publicly exported (`index.ts:54`) for consumers to persist.
  - `EventsPoller` is typed on `GitLabEvent` and `classifyEvent` is pure
    GitLab `action_name` semantics. Workflow and check-run events are absent
    from the feed, so `pipelines` invalidation can only be inferred from
    pushes.

**Mandatory for every mutation added here.** `GitHubProvider.graphql<T>()` (line 1213)
swallows transport, HTTP, and GraphQL errors alike and returns `null`, warning only.
That is defensible for reads, and its docstring argues exactly that. It is dangerous for
mutations: an `enablePullRequestAutoMerge` returning `null` is indistinguishable from
"auto-merge is off". That is the same bug class as MAT-15 on the GitLab side, where a
silent no-op meant gitq had never actually published a draft MR. Every mutation must
null-check and throw, as `setDraft` already does.

## Stays unsupported

`rebasePullRequest` and `watchMR`. The suite asserts they throw and that
`capabilities.canRebase` is `false`, so the gap is verified rather than assumed.

## Risks

- **GitHub search index lag.** Involvement-mode fetch is search-backed and eventually
  consistent. Measured previously on `gitq-test-sandbox`: two fresh PRs absent at t+3.7s,
  present at t+9.7s, while the REST listing had them at t+0.9s. The suite must poll until
  visible and must never sleep a guessed interval. This lag is what produced MAT-80.
- **Rate limits.** A mutating suite burns quota. Phase 3's throttling plugin mitigates
  this, but phase 1 runs before it exists.
- **Actions wall-clock.** Auto-merge assertions wait on a real workflow, so the fixture
  workflow must finish fast.
- **GitHub approval coverage gap.** With one identity, approve and dismiss success paths
  stay unverified. The suite asserts the 422 self-approval rejection, which proves
  request shape, auth, and URL, but not GitHub's accept path. Closing this needs a second
  GitHub identity.

## Out of scope

`glance-react` is untouched. So is the GitLab provider, except where the shared harness
reveals a genuine divergence.
