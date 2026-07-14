# @workforge/glance-sdk

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
