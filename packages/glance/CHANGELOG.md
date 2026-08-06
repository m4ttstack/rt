# @workforge/glance-sdk

## 0.14.0

Note: 0.13.0, 0.13.1, and 0.13.2 were released without changelog entries; their
contents are not recorded here.

### Minor Changes

- **Breaking:** `GitProvider.restRequest`'s `path` is now provider-relative on
  both providers. `GitLabProvider.restRequest` previously concatenated
  `baseURL + path` verbatim, so a GitLab caller had to pass `/api/v4/user`
  where a GitHub caller passes `/user` -- the opposite of the "translate the
  path to the provider's API URL format" contract the interface documents.
  `GitLabProvider` now prefixes `/api/v4` itself. A path that already starts
  with `/api/v4` throws rather than being silently accepted: a caller
  upgrading past this fix needs to drop that prefix from its own call sites,
  and a thrown error naming the exact path is how it finds out.
- **Breaking (shared interface):** `requestReReview(projectPath, mrIid)` with
  no `reviewerUsernames` now throws, on both providers, when there are no
  existing reviewers to re-request. GitLab already made this change this
  branch; GitHub previously resolved silently in the same situation, which
  was the one-interface-two-behaviors defect the GitLab fix was filed to
  close, not a second bug to leave open. A caller relying on the old
  GitHub-side silent no-op now gets an `Error` instead.
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
