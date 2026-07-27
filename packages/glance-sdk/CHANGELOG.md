# @workforge/glance-sdk

## 0.11.0

### Minor Changes

- 03ffad5: **Breaking (type):** `PullRequest.unresolvedThreadCount` is now `number | null`. `null` means the provider could not determine the count and must not be rendered as "all resolved"; GitLab always reports a number. Consumers that assign the field to a non-nullable `number` need a `?? 0` or nullable handling of their own.
- 03ffad5: `GitHubProvider.fetchPullRequests` accepts and honors `FetchPullRequestsOptions` (MAT-13). It previously declared no parameter at all, so every option a caller passed was discarded and all three involvement searches were hardcoded to `is:open` — a `{ state: ['opened','merged'] }` request could never see a merged PR. `state` maps onto search qualifiers (`merged` is `is:closed` plus a `merged_at` check, since GitHub has no merged state of its own); `iids`, `authorUsernames`, `projectPath`, `updatedAfter`, and `listWeight` are all honored, and `iids`/`authorUsernames` throw without `projectPath` instead of being ignored. The `projectPath`-alone mode lists the repository, where GitHub omits diff stats and mergeability: PRs from that mode carry `diffStats: null` and `conflicts: false`. Searches now paginate (10 pages, with a logged warning at the cap) rather than silently stopping at 100 results.
- 03ffad5: GitHub PRs report real unresolved review threads (MAT-14). `unresolvedThreadCount` was hardcoded to `0`, which reads as "nothing outstanding" and silenced consumers' pre-rebase warnings. It now comes from GraphQL `reviewThreads { isResolved }`, batched one query per 50 PRs rather than an extra per-PR request, and is `null` when the query fails or a PR carries more threads than a single page. `detailedMergeStatus` is `null` on GitHub, as its doc comment always said it should be — it no longer leaks GitHub's `mergeable_state` vocabulary into a field documented as raw GitLab.
- aac2f81: `draft` on create and update now actually produces a draft (MAT-15). GitLab has no `draft` parameter on either endpoint, so the flag both providers forwarded was silently dropped: MRs published with `draft: true` landed ready for review. GitLab now applies the documented `Draft:` title prefix at the wire boundary and strips it again on read, so `PullRequest.title` never carries a marker the caller did not write. `updatePullRequest` resolves title and draft together — retitling a draft MR no longer publishes it — reading the MR only when given one without the other. On GitHub, where REST accepts `draft` on create but ignores it on update, the transition runs `convertPullRequestToDraft` / `markPullRequestReadyForReview` and throws if it does not land. Both `as never` casts on the gitbeaker options objects are gone.
- 03ffad5: `src/providerConformance.ts` fails `tsc` if a provider ever again implements a `GitProvider` method with fewer parameters than the interface declares. TypeScript accepts that narrowing structurally, which is exactly how MAT-13 went unnoticed.
- f5a40e0: The `projectPath`-alone mode of `GitLabProvider.fetchPullRequests` gains `updatedAfter` (ISO-8601, with `sort: UPDATED_DESC` on the project queries) and `listWeight`, which selects a fragment without the `headPipeline` stage/job trees: ~10x cheaper per page and immune to GitLab's CI-tree resolver timeouts on large projects.
- e869a6b: `fetchPullRequests.project` throws on a non-advancing GraphQL cursor instead of looping forever.

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
