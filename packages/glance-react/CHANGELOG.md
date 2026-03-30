# @forge-glance/react

## 0.3.1

### Patch Changes

- Updated dependencies
  - @workforge/glance-sdk@0.5.1

## 0.3.0

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

### Patch Changes

- Updated dependencies
  - @forge-glance/sdk@0.5.0

## 0.2.0

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

### Patch Changes

- Updated dependencies [f01a16d]
  - @forge-glance/sdk@0.4.0

## 0.1.0

### Minor Changes

- bcc7c57: Add `createDashboard` SDK factory and `useDashboard` React hook for unified MR dashboard setup. Add `IconButton` component, `GitHubIcon`/`GitLabIcon` brand icons, and `provider` field on `MRDashboardProps`. MRCard now shows a forge icon button with tooltip linking to the MR on GitLab/GitHub.

### Patch Changes

- Updated dependencies [bcc7c57]
  - @forge-glance/sdk@0.3.0

## 0.0.2

### Patch Changes

- 65e2762: initial release
- Updated dependencies [65e2762]
  - @forge-glance/sdk@0.2.10
