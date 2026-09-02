# @mattstack/glance

## 0.23.0

### Minor Changes

- `PullRequest` carries `mergedAt` (when the MR merged, null while open or
  closed unmerged). Both providers populate it; the field is optional on the
  type so a `PullRequest` built by an older SDK still type-checks. Labels
  are deliberately not on `PullRequest`: a connection in the dashboard
  fragment pushes the role-based `fetchPullRequests` query past gitlab.com's
  complexity cap of 250. They ride the metric-grade reads below.
- Metric-grade reads on `GitProvider`, each optional and paired with a
  `ProviderCapabilities` flag; `GitLabProvider` implements all six,
  `GitHubProvider` declares them `false`:
  - `fetchMergeRequestIndex({ groupPath | projectPaths, updatedAfter, states?, onPage? })`:
    scalar MR rows (`MergeRequestIndexRow`) across a group with its
    subgroups or a project set, 100 per page to exhaustion. The list a
    metrics consumer keeps history from.
  - `fetchMergeRequestMetrics(projectPath, iid)`: one MR's
    `MergeRequestMetrics` (description, summary and per-file diff stats,
    labels, approver usernames, every note with author, time, system flag,
    and whether it sits on a diff line), notes paginated to exhaustion.
  - `fetchGroupProjects(groupPath)`, `fetchProject(projectPath)`,
    `fetchProjectPipelines(projectPath, { username?, updatedAfter, updatedBefore })`,
    and `fetchUserEvents(userId, { action, after, before })`, returning
    `string[]`, `ProjectRef | null`, `PipelineSummary[]`, and `UserEvent[]`.
  - New exports: those five types plus `MetricsNote`, and the option types
    `FetchMergeRequestIndexOptions`, `FetchProjectPipelinesOptions`,
    `FetchUserEventsOptions`.

## 0.22.1

### Patch Changes

- `fetchCodeownerSections` throws when a CODEOWNERS file exists but GitLab
  returns no text for it, instead of reading it as a file with no sections.
  A consumer that keeps its previous list on failure now does so here too.

## 0.22.0

### Minor Changes

- New `GitLabProvider.fetchCodeownerSections({ projectPath })`: the section
  headers of the project's default-branch CODEOWNERS (first documented
  location wins), or `null` when the project has no such file. New export
  `parseCodeownerSections(text)`, the pure parser behind it. Per-MR approval
  rules keep a section name as it was when the MR last synced, so after a
  section rename they cannot say which names still exist; this method
  reports the names that exist now.

## 0.19.0

### Minor Changes

- New export `ReadBackFailedError`, thrown when a write landed but the MR could
  not be read back (MAT-169). `createPullRequest`, `updatePullRequest`, and
  `mergePullRequest` each write and then read the MR back to return it; the two
  are separate calls, so a read that fails says nothing about whether the write
  did. These previously threw a bare `Error` there, leaving a caller unable to
  tell "the forge rejected your write" from "your write landed and we cannot
  describe the result" -- and the two want opposite handling, since the second
  is a succeeded write that a retry would apply twice. The error carries
  `writeApplied` (true on those three paths, false where the read had no write
  in front of it, such as a `watchMR` poll), plus `operation`, `projectPath`,
  `iid`, and the underlying failure as `cause`. It extends `Error`, so a caller
  that does not branch on it keeps the behaviour it already had.

  A failed *draft transition* is deliberately not this error: there the
  read-back succeeded and the MR genuinely is not in the requested state, which
  is a real failure to report rather than an unread result. It still throws a
  plain `Error`.

  Considered and rejected: falling back to a REST read to synthesize the MR
  instead of throwing. REST cannot answer `mergeabilityChecks`, which `toMR`
  reads `CONFLICT`/`FAILED` out of to compute `conflicts`, so a degraded read
  would report an empty check list as "nothing failing" -- the same shape as
  the bug 0.18.0 fixed.

## 0.18.1

### Patch Changes

- `GitLabProvider.updatePullRequest` no longer reports a write that landed as a
  failure when the read-back after it fails or lags (MAT-169). The edit is a
  separate call from the verification that follows it, and two gaps in that
  verification threw over an MR GitLab had already updated. First, the
  read-back retry only retried a null result, so a rejection from
  `fetchSingleMR` escaped on attempt 0 -- the retry did nothing for the case it
  exists to cover. It now retries a rejection too, and carries the last one as
  the thrown error's `cause` when every attempt fails. Second, the `draft`
  check compared the first read with no allowance for GitLab serving an MR that
  had not caught up with the title just written; the requested state is now
  part of what makes a read acceptable, so lag costs the same backoff a failed
  read gets and only a transition that never arrives throws. A draft marker
  this SDK does not write (a pre-14.0 `WIP:`) still throws, as before. The same
  retry backs `createPullRequest`, `mergePullRequest`, and `watchMR`, which get
  the rejection handling as well.

## 0.18.0

### Minor Changes

- `blockers.needsRebase` now means what its name says: GitLab requires a rebase
  before this MR can merge (MAT-164). It reads `shouldBeRebased` alone, which
  rides the GraphQL payload every fetch path shares. It previously also went
  true when the target branch had merely moved ahead, read from
  `divergedCommitsCount` -- a field only `fetchSingleMR`,
  `fetchPullRequestByBranch`, and the role-based mode of `fetchPullRequests`
  populate. Every other path, including the `iids` mode `DashboardGroup` polls
  with and `fetchPullRequestsByBranches`, left it null, and `?? 0` folded that
  "we did not ask" into "not behind". The same MR therefore alternated true and
  false depending on which method the consumer happened to call, and a consumer
  notifying on the `false -> true` edge re-fired on every alternation.
  `blockers.any` no longer inherits behind-ness either.
- Behind-ness is now `MRDashboardProps.behindTarget: number | null`, where
  `null` means the fetch path did not request the count and is deliberately
  distinguishable from `0`. **Breaking:** `rebaseButton.behindBy` is removed --
  it reported `0` for a count nobody fetched, and with the button now hidden
  wherever GitLab hides its own, a count hanging off it would be read from a
  control that never renders. Callers rendering "behind by N" should read
  `behindTarget` and handle `null` as unknown.
- **Breaking:** `rebaseButton.visible` now tracks `shouldBeRebased` only, so on
  a `merge_method: merge` project the button no longer appears for a branch
  that is merely behind -- matching GitLab's own UI, which offers no rebase
  there. Read `behindTarget` and render your own affordance if you want one.

## 0.17.0

### Minor Changes

- `GitProvider` gains a required `fetchUser(username): Promise<UserRef | null>`,
  implemented on both providers (MAT-159). GitLab resolves through the
  exact-match `users?username=` filter and normalizes the avatar URL the same
  way `validateToken` does; GitHub resolves through `GET /users/{username}`. A
  miss is an answer, not an error: null means the provider looked and found
  nobody, while transport and auth failures still throw. **Breaking for
  implementers:** any external `implements GitProvider` class or
  interface-shaped mock must add `fetchUser` to compile against this release.
  Plain callers are unaffected.
- `stripDraftPrefix` and `draftTitle` are exported from the package root
  (MAT-157), so a consumer rendering its own draft affordance or composing an
  `updatePullRequest` title no longer has to copy the draft-marker regex and
  track glance's marker set by hand. Both are listed in the README's utility
  exports table.
- `updatePullRequest`'s docstring no longer implies a pure draft toggle can
  close the lost-update window by passing `title` alongside `draft` (MAT-158).
  The window is inherent for a toggle; `title` is for callers already editing
  the title. Documentation only, no behavior change.

## 0.16.0

### Minor Changes

- `GitHubProvider.fetchPullRequestsByBranches` is implemented, closing the last
  functional parity gap between the two providers. It resolves branches in one
  aliased GraphQL round-trip per 50 branches, then one detail fetch per branch
  that actually matched, so a board resolving twenty branches makes two requests
  where it used to make twenty. State semantics are pinned to the single-branch
  sibling rather than to GraphQL's defaults: no `state` means opened only,
  `closed` folds merged in (GitHub models merged as a kind of closed, GitLab
  does not), and when a branch has several matching PRs the newest by
  `CREATED_AT DESC` wins. Callers that feature-detect and fall back to
  sequential `fetchPullRequestByBranch` calls need no change; the U2 conformance
  flow asserts, live, that the batch result and that fallback agree field for
  field.
- GitHub REST response shapes now derive from `@octokit/openapi-types` instead of
  being hand-transcribed. Types only: `dist` is byte-identical before and after,
  and no runtime behaviour moves. What changes is what happens next time GitHub
  renames or drops a field ... it becomes a compile error in `GitHubProvider.ts`
  rather than an `undefined` at a call site. The handful of places this file
  narrows beyond what the published schema promises are declared explicitly with
  the reason inline. The GraphQL response shapes stay hand-rolled;
  `@octokit/openapi-types` documents only the REST surface.
- The two events-path consumer flows that had never run green live on GitHub,
  U20 (a JSON round-tripped cursor resumes without replay, and a foreign-typed
  `lastEventId` never silently fails to dedup) and U21 (a branch invalidation
  whose lookup returns null writes `mr: null` and flushes exactly once), now
  both pass live on GitHub. U20's proof needed the settle windows reworked
  first: they were sized against the configured interval, but GitHub's feed
  answers on its own server-directed 60s cadence, so the old 12s window could
  cover at most one warm tick and the no-replay claim rested on that single
  tick. The windows are now sized to span two warm ticks by construction on both
  providers, which is what makes the silence mean dedup instead of luck.

## 0.15.0

### Minor Changes

- `GitHubProvider.watchEvents` polls the repository events feed
  (`GET /repos/{owner}/{repo}/events`) and translates activity into the same
  `InvalidationBatch` contract GitLab's watcher emits. `capabilities.canWatchEvents`
  is now `true` on GitHub. Cadence is server-directed: GitHub asks for 60s via
  `X-Poll-Interval` on every `200`. Once a `200` has taught the watcher that
  cadence, it never polls faster than it, only slower if a caller configured a
  larger `intervalMs`; before the first `200` (or during a run of pure `304`s,
  which carry no `X-Poll-Interval`), the caller's configured `intervalMs`
  governs instead. No `pipelines` invalidation is ever emitted on GitHub: the
  feed has no CI event type, so a consumer that needs pipeline freshness keeps
  its slow full poll. This is an accelerator, not a replacement for that poll,
  and a live acceptance run made the gap concrete: the feed dropped git-ref
  events (`PushEvent`/`CreateEvent`/`DeleteEvent`) entirely for about 18 minutes
  while comment and PR events kept arriving in ~11s. The full poll is
  load-bearing on GitHub in a way it is not on GitLab.
- `EventCursor.lastEventId` widens from `number | null` to `number | string | null`,
  and gains an optional `seenIds` (GitHub only: a bounded set of recently-seen event
  ids). GitHub event ids do not order with `created_at` (they come from two
  disjoint numeric ranges), so a high-water mark alone silently drops most PR and
  comment events; `seenIds` is what dedup actually uses on GitHub. A cursor a
  caller already persisted with a plain numeric `lastEventId` behaves correctly
  on either provider, but not for the same reason: GitLab resumes from it as the
  high-water mark it always was, while GitHub (which requires `seenIds` to
  recognize a cursor as its own) treats it as foreign and cold-starts rather than
  misreading it. Fixed alongside the widening: `EventsPoller` (GitLab) used to
  compare `e.id <= this.cursor.lastEventId` directly, which coerced a string id
  through `<=` and kept deduping by accident; the type-safe narrowing the widening
  required initially just ignored a non-numeric id instead of falling back, which
  silently disabled GitLab's own dedup for any cursor carrying a foreign-typed
  `lastEventId` ... every event in the poll window came back as a fresh invalidation,
  a watcher that looked healthy while replaying history. Caught live, not in review.
  `lastEventId` is now normalized once, in the constructor, to `number | null`: a
  foreign-typed value is treated as absent and falls back to the timestamp anchor,
  or to a cold start if there is no timestamp either. Three regression tests guard
  it in `tests/events-poller.test.ts`.
- New exports: `GitHubEventsPoller`, `classifyGitHubEvent`, `normalizeBranchRef`,
  and types `GitHubEvent`, `FetchGitHubEventsPage`, `GitHubTickResult`,
  `GitHubEventsPollerOptions`.

## 0.14.0

Note: 0.13.0, 0.13.1, and 0.13.2 were released without changelog entries; their
contents are not recorded here.

### Breaking Changes

Read these three before upgrading. Everything else in this release is additive
or a correction a caller does not have to act on.

- **Breaking:** `reviewers` and `assignees` now genuinely reach both providers,
  and on GitHub `updatePullRequest` now *removes* people (MAT-24). Two halves,
  both worth reading.

  On GitLab, `createPullRequest` and `updatePullRequest` forwarded the
  documented username strings straight into GitLab's `assignee_ids` /
  `reviewer_ids`, which take numeric user ids, behind a cast that made the
  mismatch compile. Both fields are now resolved to real ids first. A username
  GitLab has no user for **throws**, naming the operation and the username
  (`createPullRequest: no GitLab user found for username "..."`), rather than
  being dropped: a dropped name hands back a merge request that looks like the
  reviewer or assignee was added when nobody was.

  On GitHub, `updatePullRequest` now honours the "replaces the current set"
  contract `UpdatePullRequestInput` documents and GitLab's id arrays have
  always had. GitHub's own endpoints are additive, so the previous `POST`
  could only ever add; the call now diffs the requested list against the PR's
  current one and issues the matching `DELETE` for every login the input left
  out. **That is the consequence to know about: a caller passing a partial
  `reviewers` or `assignees` list now removes everyone missing from it**,
  where before the omitted names stayed on the PR untouched. `reviewers: []`
  cancels every open review request. A caller that has been passing "the
  people to add" has to start passing "the people who should end up on the
  PR", which for an addition means the current set plus the new name; the PR
  object it already has carries that set. Team reviewers (`requested_teams`)
  are never read or written, so any team already requested is left exactly as
  it was, and `createPullRequest` is unchanged, since a new PR has nothing to
  remove from.
- **Breaking:** `GitProvider.restRequest`'s `path` is now provider-relative on
  both providers. `GitLabProvider.restRequest` previously concatenated
  `baseURL + path` verbatim, so a GitLab caller had to pass `/api/v4/user`
  where a GitHub caller passes `/user` -- the opposite of the "translate the
  path to the provider's API URL format" contract the interface documents.
  `GitLabProvider` now prefixes `/api/v4` itself. A path that already starts
  with `/api/v4` throws rather than being silently accepted: a caller
  upgrading past this fix needs to drop that prefix from its own call sites,
  and a thrown error naming the exact path is how it finds out. The
  `onRequest` hook follows the path the caller now passes: a `restRequest`
  `RequestInfo.path` reads `/projects/1/notes` where it used to read
  `/api/v4/projects/1/notes`, so a consumer grouping or matching on that field
  sees different strings for the same request. The other transports are
  unchanged: `MRDetailFetcher`, `NoteMutator`, and GraphQL still report the
  wire path, and the gitbeaker transport still reports a resource name such as
  `MergeRequests` rather than a path at all.
- **Breaking (shared interface):** `requestReReview(projectPath, mrIid)` with
  no `reviewerUsernames` now throws, on both providers, when there are no
  existing reviewers to re-request. GitLab already made this change this
  branch; GitHub previously resolved silently in the same situation, which
  was the one-interface-two-behaviors defect the GitLab fix was filed to
  close, not a second bug to leave open. A caller relying on the old
  GitHub-side silent no-op now gets an `Error` instead.

### Minor Changes

- `GitLabProvider.mergePullRequest` now names why GitLab refused a merge
  (MAT-132). On the plain merge path, GitLab answers a refusal with a bare
  HTTP 405 whose body is the constant string "405 Method Not Allowed", so the
  error could not separate "mergeability is still being computed, retry in a
  moment" from "a check failed, change something first". (Its other refusals
  on the same endpoint do say why, and are untouched: 409 for a `sha` that
  does not match the head, 422 "Branch cannot be merged".) On a 405 only, the
  provider reads the merge request back once and appends the
  `detailedMergeStatus` GitLab reports, plus a retry hint when that value is a
  transitional one. The status is worded as an observation taken after the
  refusal, not as its cause, because it can change in between. The existing
  `mergePullRequest failed: 405 ...` prefix is unchanged; a follow-up read
  that fails, reports nothing, or takes longer than 5 seconds leaves the
  original error exactly as it was, so a read failure can never stand in for a
  merge failure. New exports: `TRANSITIONAL_MERGE_STATUSES` and
  `isTransitionalMergeStatus`, the list and predicate the SDK classifies with,
  so a caller deciding whether to retry does not need its own copy.
- `getMRDashboardProps` now treats `detailedMergeStatus: "preparing"` as
  transitional, alongside `checking`, `unchecked`, and `approvals_syncing`.
  GitLab emits `preparing` ahead of `unchecked` on a just-created merge
  request, so the omission flashed `BLOCKED` during part of the very window
  the transitional rule exists to cover. An MR in `preparing` with no other
  blocker now reports `status: "mergeable"`, `isCheckingMergeability: true`,
  `isReady: true`, and `mergeButton.disabled: false`. That last one is the
  consequence to know about: the Merge button is now enabled during the
  `preparing` window, which is exactly the window in which a merge returns the
  ambiguous 405 described above. That tradeoff is not new, it is what the
  other three transitional values have always done, and the improved 405
  message is what a consumer now gets if a user presses it too early.
- **Changed values, not shapes:** `Discussion.resolved` and
  `Discussion.resolvable` on GitLab were hardcoded `null` and now carry
  GitLab's real thread-resolution state. `Note.resolved` on GitHub moves from
  always `null` to `boolean | null` for diff notes specifically (other note
  types are unaffected). `BranchProtectionRule.requiredApprovals` and
  `requireStatusChecks` on GitLab were always `0` / `false` and are now
  measured from the project's approval configuration and pipeline-success
  setting. A consumer rendering any of these fields will see different,
  correct output on data that has not itself changed.
- `capabilities.canResolveDiscussions`, `canUnapprove`, and `canAutoMerge` are
  now `true` on GitHub, backed by real implementations of
  `resolveDiscussion`, `unresolveDiscussion`, `unapprovePullRequest`,
  `setAutoMerge`, and `cancelAutoMerge`.
- Explicitly unchanged: `Discussion.id` on GitHub keeps its
  `gh-review-thread-<rootCommentId>` form. This is deliberate, not an
  oversight, so that any id a consumer has already persisted stays valid.
- On GitHub, a PR whose reviews fetch fails partway through (rate limiting,
  most commonly) is now dropped from `fetchPullRequests`'s result and
  reported through `onWarning`, instead of rejecting the whole call. A PR
  whose check-runs or thread-count fetch fails stays in the result with
  just that field degraded to its existing "unknown" value
  (`pipeline: null` / `unresolvedThreadCount: null`), also now reported
  through `onWarning`. `FetchPullRequestsWarning['source']` gained
  `'reviews' | 'checks' | 'threads'` (previously `'search' | 'list' |
  'detail'`) to name these. `fetchSingleMR`'s `createPullRequest`/
  `updatePullRequest`/`mergePullRequest` refetch failures now throw a
  message describing the actual cause instead of the generic "... but
  failed to fetch it back".
- New export: `FetchPullRequestsWarning` (previously only reachable as
  `FetchPullRequestsOptions['onWarning']`'s parameter type, not nameable on
  its own).
- New optional `DashboardGroup.onWarning(listener)`: fires per-row when one
  MR in a batched dashboard fetch did not refresh cleanly while the rest of
  the batch succeeded -- both when that MR is missing from `subscribe`'s Map
  entirely (a `reviews`/`detail` failure) and when it is present with one
  field silently at its "unknown" value (a `checks`/`threads` failure), so a
  consumer can flag either case instead of it looking like an ordinary
  update or an ordinary empty/no-checks reading. `MRDashboard`'s batched
  fetch no longer swallows a `fetchPullRequests` rejection to `null` for the
  whole group; a genuine total failure now reaches `onStatusChange`'s
  existing `lastError`/`consecutiveErrors` instead.
- New export: `warningTarget(projectPath, iid)`, the exact format (
  `owner/repo#number`) every single-PR `FetchPullRequestsWarning.target`
  uses. A consumer matching on `target` should build it with this rather
  than its own string interpolation, the same way `GitHubProvider` and
  `DashboardGroup.onWarning`'s own matching logic now both do internally.

## 0.12.0

### Minor Changes

- 0b4a4e4: `reviews.isApproved` now means genuinely approved: an MR the provider reports approved with zero required approvals and zero approvers (GitLab stack MRs targeting a parent branch) no longer reads as approved. Mergeability is unchanged and still flows through `blockers.awaitingApprovals` / `status` / `isReady`, which intentionally disagree with `isApproved` in the vacuous case. New optional `isStacked` on `PullRequest` and `MRDashboardProps`: true when the target branch differs from the repo's default branch (GitLab: `targetProject.repository.rootRef` in the MR fragments; GitHub: `base.repo.default_branch`). Absent or unknown default branch reads as not stacked.

## 0.11.0

### Minor Changes

- The build no longer inlines `@gitbeaker/rest` into `dist`. It is a declared dependency, so every consumer already installs it; bundling it shipped a second copy and, since 0.10.0, pulled a CJS interop shim (`import { createRequire } from "node:module"`) into `dist/index.js`. That import is unresolvable in a browser bundler, which broke any downstream build that inlines this package (`@workforge/glance-react` among them). `dist/index.js` goes from 570 KB to 104 KB and the tarball from 366 KB to 143 KB. Node and Bun consumers are unaffected beyond the size drop.
- 03ffad5: **Breaking (type):** `PullRequest.unresolvedThreadCount` is now `number | null`. `null` means the provider could not determine the count and must not be rendered as "all resolved"; GitLab always reports a number. Consumers that assign the field to a non-nullable `number` need a `?? 0` or nullable handling of their own.
- 03ffad5: `GitHubProvider.fetchPullRequests` accepts and honors `FetchPullRequestsOptions` (MAT-13). It previously declared no parameter at all, so every option a caller passed was discarded and all three involvement searches were hardcoded to `is:open` ... a `{ state: ['opened','merged'] }` request could never see a merged PR. `state` maps onto search qualifiers (`merged` is `is:closed` plus a `merged_at` check, since GitHub has no merged state of its own); `iids`, `authorUsernames`, `projectPath`, `updatedAfter`, and `listWeight` are all honored, and `iids`/`authorUsernames` throw without `projectPath` instead of being ignored. The `projectPath`-alone mode lists the repository, where GitHub omits diff stats and mergeability: PRs from that mode carry `diffStats: null` and `conflicts: false`. Searches paginate (5 pages, 500 results) rather than silently stopping at 100.
- 063d788: The request cost of a GitHub fetch is bounded, and stated. For U matching PRs and Q state qualifiers (Q is 1, or 2 for a request mixing `opened` with `merged`/`closed`), the involvement mode costs **3·Q searches of 1 to 5 pages each, then 3U REST GETs (detail + reviews + check runs, 2U with `listWeight`) plus ceil(U/50) GraphQL calls**; `{ authorUsernames }` is the same with one search per author and qualifier instead of three. Three things had driven that cost. A mixed-state request dropped the `is:` qualifier entirely, so the search matched every PR the user had ever authored, all time; it now runs one bounded search per qualifier and merges (which also stops open PRs being crowded out of a single capped result set by closed ones). Searches detail-fetched each match before the caller deduped across them, so a PR the token user had authored, been assigned, and been asked to review cost three identical GETs; the merge now happens on search results, before any detail fetch. And the per-PR fetches ran through an unbounded `Promise.all`, which spends GitHub's secondary rate limit in one burst; they now run 8 at a time. Measured against the adversarial review's 500-unique-PR mixed-state case, that is ~1,540 requests where the previous code issued ~2,525 (1,500 of them duplicate detail GETs). Search GETs themselves can double in the mixed case (15 to at most 30), which is the price of the two bounded queries replacing one unbounded one.
- 063d788: `FetchPullRequestsOptions.onWarning` reports what a fetch could not return. Page-cap and failure warnings previously went only to `this.log`, which defaults to `noopLogger`, so a truncated or rate-limited result was indistinguishable from a complete one: `PullRequest[]` has nowhere to say "and there were more". The callback receives a `FetchPullRequestsWarning` (`kind`, `source`, `message`, optional `status`/`target`) for GitHub's search and listing page caps and for detail fetches GitHub rejected, which is the shape rate limiting takes on that path. A 404 stays silent: a PR that is not there is not a PR that went missing. A callback that throws is ignored. GitLab paginates its project mode to exhaustion and raises transport failures as exceptions, so it never calls this.
- 19d550a: One `fetchPullRequests` contract across both providers. `{ iids }` or `{ authorUsernames }` without `projectPath` threw on GitHub and quietly returned the role-based involvement set on GitLab ... the same call answered a different question depending on the forge behind it. GitLab now throws the same error, and rejects an `updatedAfter` that is not parseable as an instant instead of forwarding it to the API where the filter is dropped. Both checks are shared code, so the messages cannot drift apart again. The `GitProvider.fetchPullRequests` JSDoc states the contract and which options each provider honors (`updatedAfter` and `listWeight` are project-mode-only on GitLab). Callers that always pass `projectPath` with an ISO `updatedAfter` (repo-tools' daemon, for one) are unaffected.
- 03ffad5: GitHub PRs report real unresolved review threads (MAT-14). `unresolvedThreadCount` was hardcoded to `0`, which reads as "nothing outstanding" and silenced consumers' pre-rebase warnings. It now comes from GraphQL `reviewThreads { isResolved }`, batched one query per 50 PRs rather than an extra per-PR request, and is `null` when the query fails or a PR carries more threads than a single page. `detailedMergeStatus` is `null` on GitHub, as its doc comment always said it should be: it no longer leaks GitHub's `mergeable_state` vocabulary into a field documented as raw GitLab.
- aac2f81: `draft` on create and update now actually produces a draft (MAT-15). GitLab has no `draft` parameter on either endpoint, so the flag both providers forwarded was silently dropped: MRs published with `draft: true` landed ready for review. GitLab now applies the documented `Draft:` title prefix at the wire boundary and strips it again on read, so `PullRequest.title` never carries a marker the caller did not write. `updatePullRequest` resolves title and draft together (retitling a draft MR no longer publishes it), reading the MR only when given one without the other. On GitHub, where REST accepts `draft` on create but ignores it on update, the transition runs `convertPullRequestToDraft` / `markPullRequestReadyForReview` and throws if it does not land. Both `as never` casts on the gitbeaker options objects are gone.
- daf2fd0: GitLab checks that a draft transition landed, and stops guessing on create. `updatePullRequest` wrote a title and trusted it, but GitLab derives draft state from the title and recognizes prefixes the SDK does not write: a pre-14.0 `WIP:` on self-hosted survives the strip, so `{ draft: false }` returned a "published" MR that is still a draft. The MR read back after the edit must now agree with the request, mirroring the GitHub path. And `createPullRequest` read a missing `draft` as `draft: false`, so `{ title: 'Draft: notes' }` with no `draft` field created a non-draft MR titled "notes" ... GitLab itself would have made that a draft, and the caller never asked for its title to be rewritten. An absent `draft` now leaves the title exactly as given.
- 03ffad5: `src/providerConformance.ts` fails `tsc` if a provider ever again implements a `GitProvider` method with fewer parameters than the interface declares. TypeScript accepts that narrowing structurally, which is exactly how MAT-13 went unnoticed. `index.ts` names a type from that module (2559969) so the guard cannot be deleted, or dropped from tsconfig's `include`, with every check still green.
- f5a40e0: The `projectPath`-alone mode of `GitLabProvider.fetchPullRequests` gains `updatedAfter` (ISO-8601, with `sort: UPDATED_DESC` on the project queries) and `listWeight`, which selects a fragment without the `headPipeline` stage/job trees: ~10x cheaper per page and immune to GitLab's CI-tree resolver timeouts on large projects.
- e869a6b: `fetchPullRequests.project` throws on a non-advancing GraphQL cursor instead of looping forever.

## 0.10.2

### Minor Changes

- a3a26d8: `fetchPullRequests({ projectPath })` alone: every MR in the project, member-blind, cursor-paginated, with full dashboard fields. Lets a caller build a project board without the token user being involved in any of the MRs and without a per-MR discovery pass. Pages are fetched sequentially, since GitLab's GraphQL resolvers time out under concurrent dashboard-field queries.
- afa4f3d: `onRequest` instrumentation hook: one `RequestInfo` callback (`op`, `transport`, `method`, `path`, `durationMs`, `status`) per logical SDK operation, so a consumer can count and time what the SDK actually issues. `op` is the SDK-level label ("fetchPullRequests.project", "gb.MergeRequests.merge"), since raw method/path cannot tell two GraphQL operations apart. Covers all four transports: GraphQL `runQuery` (afa4f3d), the gitbeaker REST client and `restRequest` (004db35), and the `MRDetailFetcher` / `NoteMutator` fetchers (3c6b57f). New exports: types `RequestInfo` and `OnRequestHook`.

## 0.10.1

### Patch Changes

- 4e93add: `classifyEvent` gates `branch` invalidation keys on `push_data.ref_type === 'branch'` (tag pushes no longer emit a bogus branch key; `pipelines:*` still fires for tag pipelines). Timestamp comparisons in `EventsPoller` are numeric via `Date.parse`, so offset-format timestamps from self-hosted GitLab work. `EventsWatcher` guards against reentrant `dispose()` from inside success-path callbacks, and caps a server-supplied Retry-After at the 5-minute backoff ceiling. Documented the per-tick truncation bound and the empty-feed time-anchor cold-start semantics.
- 555c75f: `GitHubProvider.fetchPullRequestByBranch` now finds fork PRs (client-side head-ref fallback, paginated up to 500 PRs with a logged page-limit warning) and accepts the `state` parameter the `GitProvider` interface declares (interface parity; previously 2-arg only).

## 0.10.0

### Minor Changes

- 72a6b9a: Event invalidation types (`InvalidationKind`, `InvalidationKey`, `InvalidationBatch`, `EventCursor`) and `classifyEvent` function for categorizing GitLab project events.
- 9417018: `GitLabProvider.watchEvents(projectPath, options, onInvalidations)`: SDK-owned freshness loop over the GitLab project events feed. Translates activity into `InvalidationBatch` cache hints (`mr`, `notes`, `pipelines`, `branch`), persists position via an `onCursor` callback, reports health transitions via `onStatus`, and handles GitLab's day-exclusive `after` parameter internally. Backoff: exponential to 5 min, honors Retry-After. Cold start establishes a cursor without replaying history. Consumer-callback errors are logged via the provider logger and never misclassified as feed failures. Metadata-only MR edits (title/description/labels/assignees) and pipeline status transitions emit no event on the GitLab events feed; consumers should keep a slow full-refresh safety net.
- 9417018: `capabilities.canWatchEvents` on `ProviderCapabilities` (GitLab true, GitHub false).
- 9417018: New exports: `EventsPoller`, `startEventsWatcher`, `classifyEvent`, and types `InvalidationKind`, `InvalidationKey`, `InvalidationBatch`, `EventCursor`, `WatchEventsOptions`, `WatchEventsStatus`.
- c89792a: All 25 hand-rolled REST call sites in `GitLabProvider` now go through `@gitbeaker/rest` (first runtime dependency). Public signatures, GraphQL paths, ActionCable, and `restRequest` are unchanged. Thrown errors keep the `<label> failed: <status>` prefix; suffix formatting is now uniform.

## 0.9.0

### Minor Changes

- 26d05c1: Feat: `fetchPullRequests` accepts `{ authorUsernames, projectPath }` to fetch every MR in a project authored by any of the given users, with full dashboard fields, in one GraphQL query per author (deduped by MR id). Lets a caller build a team board without the token user being involved in each MR and without a separate REST discovery pass.

## 0.8.1

### Patch Changes

- Fix: Lowercase `detailedMergeStatus` at the GitLab provider boundary. GitLab GraphQL returns this field as an uppercase enum (e.g. `MERGEABLE`), but downstream code (including `MRDashboard` and the `conflicts` derivation) compares against lowercase values. Previously every such comparison silently failed, causing ready-to-merge MRs to render as `BLOCKED`.

## 0.7.0

### Minor Changes

- Feat: Add child/downstream pipeline support. Trigger jobs now include `downstreamPipeline` with full stage and job data, fetched eagerly in the initial GraphQL query.

## 0.6.2

### Patch Changes

- Perf: Skip redundant GraphQL refetch on initial WebSocket connect. The init fetch has just completed so no events could have been missed.

## 0.6.1

### Patch Changes

- Fix: Normalize GitLab job statuses to lowercase. GitLab GraphQL returns uppercase enum values (SUCCESS, FAILED) but all downstream code expects lowercase.

## 0.6.0

### Minor Changes

- Add pipeline job detail capabilities: `retryJob()`, `fetchJobTrace()`, and `duration` field on `PipelineJob`.

## 0.5.3

### Patch Changes

- Add `state` parameter to `fetchPullRequestsByBranches` to support fetching merged/closed MRs (defaults to `'opened'` for backward compatibility).

## 0.5.2

### Patch Changes

- 9fce16c: Optimize fetchPullRequestsByBranches: replace N REST calls + 1 GraphQL batch with a single GraphQL query using the `sourceBranches` array filter. Reduces ~60 HTTP calls to 1 for bulk branch lookups.

## 0.5.1

### Patch Changes

- Update README: rebrand from @forge-glance/sdk to @workforge/glance-sdk, comprehensive documentation of all exported APIs including Dashboard branch overloads, DashboardGroup.updateIids, discussion/note mutations, connection status, and complete type export list.

## 0.5.0

### Minor Changes

- ### @forge-glance/sdk
  - `fetchPullRequests(options?)` — accepts `state: MRState | MRState[]` to filter by state (fixes merged MRs being invisible) and `iids + projectPath` for batch fetching specific MRs in a single GraphQL query
  - `fetchPullRequestsByBranches(projectPath, branches[])` — batch-resolve MRs by source branch name
  - `createDashboard({ branch })` — new overload that resolves IID from a branch name automatically, re-resolves on each poll
  - `MRDashboardActions.toggleDraft(draft)` — toggle MR draft/ready status
  - Removed `fetchMultipleMRs` (consolidated into `fetchPullRequests({ iids })`)

  ### @forge-glance/react
  - `useDashboard` now accepts `{ branch }` as alternative to `{ mrIid }`
  - Re-exports `MRState` and `FetchPullRequestsOptions` from SDK

## 0.4.0

### Minor Changes

- f01a16d: ### `createDashboard` — object params + multi-MR support

  **Breaking:** `createDashboard` now takes an options object instead of positional arguments.

  ```ts
  // Before
  createDashboard(provider, 'group/project', 42, userId);

  // After — single MR
  createDashboard({
    provider,
    projectPath: 'group/project',
    mrIid: 42,
    userId,
  });

  // After — multiple MRs (shared WebSocket)
  createDashboard({
    provider,
    projectPath: 'group/project',
    mrIid: [42, 43],
    userId,
  });
  ```

  **New features:**
  - `mrIid` accepts `number | number[]` — array returns `DashboardGroup` with `actionsFor(iid)` and combined `subscribe`
  - All `watchMR` calls share a single ActionCable WebSocket connection (ref-counted)
  - `useDashboard` hook uses `UseDashboardOptions` object

  **New types:** `DashboardGroup`, `CreateDashboardOptions`, `UseDashboardOptions`

## 0.3.0

### Minor Changes

- bcc7c57: Add `createDashboard` SDK factory and `useDashboard` React hook for unified MR dashboard setup. Add `IconButton` component, `GitHubIcon`/`GitLabIcon` brand icons, and `provider` field on `MRDashboardProps`. MRCard now shows a forge icon button with tooltip linking to the MR on GitLab/GitHub.

## 0.2.10

### Patch Changes

- 65e2762: initial release
