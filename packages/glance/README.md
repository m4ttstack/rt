# @mattstack/glance

Provider-agnostic SDK for GitHub and GitLab: types, REST/GraphQL clients, real-time subscriptions, and dashboard helpers. Works in any Node/Bun runtime.

## Install

```bash
npm install @mattstack/glance
# or
bun add @mattstack/glance
```

## Quick Start

```ts
import { GitLabProvider } from '@mattstack/glance';

const provider = new GitLabProvider('https://gitlab.com', process.env.GITLAB_TOKEN!);
const user = await provider.validateToken();
const prs = await provider.fetchPullRequests();
```

## Providers

Two built-in providers implement the `GitProvider` interface:

| Provider | Class | Capabilities |
|---|---|---|
| GitLab | `GitLabProvider` | Full: merge, rebase, approve, auto-merge, retry pipeline, re-review, resolve discussions |
| GitHub | `GitHubProvider` | Core: merge, approve, rebase |

```ts
import { createProvider } from '@mattstack/glance';

// Auto-create the right provider by slug
const provider = createProvider('gitlab', 'https://gitlab.com', token);

// With optional logger
const provider = createProvider('gitlab', 'https://gitlab.com', token, {
  logger: console
});
```

### Provider Methods

| Method | Description |
|---|---|
| `validateToken()` | Verify credentials, returns `UserRef` |
| `fetchPullRequests(options?)` | Fetch MRs — supports `state` filter and batch `iids` fetching |
| `fetchSingleMR(path, iid, userId)` | Fetch one MR by project path and IID |
| `fetchPullRequestByBranch(path, branch, state?)` | Find an MR by source branch |
| `fetchPullRequestsByBranches(path, branches)` | Batch-fetch MRs by source branches *(optional, not all providers)* |
| `createPullRequest(input)` | Create a new MR |
| `updatePullRequest(path, iid, input)` | Update an existing MR (title, description, draft status, etc.) |
| `mergePullRequest(path, iid, input?)` | Merge an MR |
| `rebasePullRequest(path, iid)` | Rebase an MR onto its target branch |
| `approvePullRequest(path, iid)` | Approve an MR |
| `unapprovePullRequest(path, iid)` | Remove your approval |
| `setAutoMerge(path, iid)` | Enable auto-merge when pipeline passes |
| `cancelAutoMerge(path, iid)` | Cancel auto-merge |
| `retryPipeline(path, pipelineId)` | Retry a pipeline |
| `requestReReview(path, iid, usernames?)` | Request re-review |
| `resolveDiscussion(path, iid, discussionId)` | Resolve a discussion thread |
| `unresolveDiscussion(path, iid, discussionId)` | Unresolve a discussion thread |
| `watchMR(path, iid, userId, onUpdate, options?)` | Real-time MR subscription (returns `dispose()`) |
| `fetchMRDiscussions(repoId, iid)` | Fetch MR discussions and notes |
| `fetchBranchProtectionRules(path)` | Fetch branch protection rules |
| `deleteBranch(path, branch)` | Delete a branch |
| `restRequest(method, path, body?)` | Raw authenticated REST API pass-through |

Provider capabilities are exposed via `provider.capabilities` — check flags like `canMerge`, `canRebase`, `canAutoMerge`, `canResolveDiscussions`, etc. before calling provider-specific methods.

---

## Dashboard API

### `createDashboard`

High-level factory that bundles real-time MR watching with pre-bound mutation actions.

#### Single MR by IID

```ts
import { createDashboard } from '@mattstack/glance';

const dashboard = createDashboard({
  provider,
  projectPath: 'group/project',
  mrIid: 42,
  userId
});

// Actions are available immediately
await dashboard.actions.merge();
await dashboard.actions.approve();
await dashboard.actions.toggleDraft(false); // mark ready

// Subscribe delivers real-time MRDashboardProps on each update
dashboard.subscribe((mr) => {
  console.log(mr.status, mr.pipeline?.status);
  renderUI(mr, dashboard.actions);
});

// Monitor connection health
dashboard.onStatusChange((status) => {
  console.log(status.connection); // 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
});

// When done, stop the subscription
dashboard.dispose();
```

| Property | Type | Description |
|---|---|---|
| `actions` | `MRDashboardActions` | Pre-bound mutation methods — available immediately |
| `isInitialLoading` | `boolean` | `true` until the first data payload arrives |
| `subscribe(cb)` | `(cb: (mr: MRDashboardProps) => void) => void` | Register a listener for real-time updates |
| `onStatusChange(cb)` | `(cb: (status: WatcherStatus) => void) => void` | Monitor connection health |
| `dispose()` | `() => void` | Stop the subscription and clean up |

#### Single MR by branch name

```ts
const dashboard = createDashboard({
  provider,
  projectPath: 'group/project',
  branch: 'feat/my-feature',
  userId
});

// Resolves the MR IID from the branch automatically.
// Re-resolves on each poll, so it picks up new MRs on the same branch.
dashboard.subscribe((mr) => renderUI(mr, dashboard.actions));
```

#### Multi-MR: `DashboardGroup`

Pass an array of IIDs to watch multiple MRs over a single WebSocket:

```ts
const group = createDashboard({
  provider,
  projectPath: 'group/project',
  mrIid: [42, 43, 44, 45],
  userId
});

group.subscribe((mrs) => {
  for (const [iid, mr] of mrs) {
    renderRow(mr, group.actionsFor(iid));
  }
});

// Dynamically update the tracked IIDs without destroying the group
group.updateIids([42, 43, 44, 45, 46]);
group.updateIids(prev => prev.filter(id => id !== 43));
```

| Property | Type | Description |
|---|---|---|
| `actionsFor(iid)` | `(iid: number) => MRDashboardActions` | Get actions for a specific MR |
| `isInitialLoading` | `boolean` | `true` until the first data payload arrives |
| `subscribe(cb)` | `(cb: (mrs: Map<number, MRDashboardProps>) => void) => void` | Real-time updates for all MRs |
| `updateIids(iids)` | `(iids: number[] \| (prev: number[]) => number[]) => void` | Dynamically add/remove tracked MRs |
| `onStatusChange(cb)` | `(cb: (status: WatcherStatus) => void) => void` | Monitor connection health |
| `dispose()` | `() => void` | Stop all subscriptions and clean up |

### `getMRDashboardProps`

Lower-level helper that transforms a raw `PullRequest` into render-ready `MRDashboardProps`. Useful when you already have the MR data from `fetchPullRequests()` or `fetchSingleMR()`:

```ts
import { getMRDashboardProps } from '@mattstack/glance';

const prs = await provider.fetchPullRequests();
const dashboards = prs.map(getMRDashboardProps);
// dashboards[0].status → 'mergeable' | 'blocked' | 'draft' | ...
// dashboards[0].mergeButton.visible, .disabled, .label
// dashboards[0].provider → 'gitlab' | 'github'
```

### `MRDashboardProps`

Pre-computed, UI-ready props — no conditional logic needed in the component layer:

| Field | Description |
|---|---|
| `provider` | `'gitlab'` or `'github'` — use to pick brand icon |
| `iid`, `title`, `webUrl`, `state` | Identity |
| `isDraft` | Whether the MR is in draft mode |
| `author`, `assignees`, `createdAt` | Authorship |
| `sourceBranch`, `targetBranch` | Branch info |
| `status` | `'mergeable' \| 'blocked' \| 'draft' \| 'merged' \| 'closed'` |
| `statusDetail` | Specific blocker reason (e.g., `'CI_MUST_PASS'`, `'NEED_REBASE'`) |
| `isReady` | `true` when `detailedMergeStatus === 'mergeable'` |
| `pipeline` | Pipeline status breakdown: passing, failing, running counts, `hasWarnings`, individual `jobs` |
| `reviews` | Reviewer state: required, given, remaining, approvedBy, per-reviewer breakdown |
| `mergeButton` | `{ visible, disabled, loading, label }` |
| `rebaseButton` | `{ visible, loading, label, behindBy }` |
| `autoMergeButton` | `{ visible, isActive, strategy, setBy, label, cancelLabel }` |
| `blockers` | Flags: `isDraft`, `hasConflicts`, `needsRebase`, `pipelineFailing`, `pipelineRunning`, `awaitingApprovals`, `hasUnresolvedDiscussions`, `hasMergeError`, `any` |
| `isMerging`, `isRebasing`, `isLoading` | In-progress spinner states |
| `connection` | `'connecting' \| 'connected' \| 'disconnected' \| 'reconnecting' \| 'idle'` |

### `MRDashboardActions`

Pre-bound mutation methods — call without passing project path or IID:

| Action | Description |
|---|---|
| `merge(input?)` | Merge the MR |
| `rebase()` | Rebase onto target branch |
| `approve()` | Approve the MR |
| `unapprove()` | Remove approval |
| `setAutoMerge()` | Enable auto-merge |
| `cancelAutoMerge()` | Cancel auto-merge |
| `retryPipeline(id)` | Retry a pipeline |
| `requestReReview(usernames?)` | Request re-review |
| `toggleDraft(draft)` | Toggle draft / ready-for-review status |
| `can` | Provider capability flags |

---

## Real-Time Architecture

### Shared WebSocket Connection

All `watchMR` calls on a single `GitLabProvider` instance share **one WebSocket connection** via ActionCable. Each MR subscribes 3 channels (merge status, approval state, reviewers) on the shared connection. The connection is ref-counted:

- **First `watchMR` call** → opens the WebSocket
- **Subsequent calls** → subscribe additional channels on the existing connection
- **`dispose()` a watcher** → unsubscribes that MR's channels
- **Last watcher disposed** → disconnects the WebSocket

This means watching 30 MRs uses 1 WebSocket with 90 channel subscriptions, not 30 separate connections.

### `createRealtimeWatcher`

Generic self-healing subscription + polling module used internally by `watchMR` and `createDashboard`. Also exported for custom use:

- Adaptive poll rate (fast when push is down, slow when healthy)
- Full-jitter exponential backoff on fetch failures
- Push-event debouncing (burst events → one refetch)
- Immediate refetch on reconnect
- Connection status reporting via `WatcherStatus`

```ts
import { createRealtimeWatcher } from '@mattstack/glance';
import type { WatcherStatus, WatcherSubscribeCallbacks, RealtimeWatcherOptions } from '@mattstack/glance';
```

---

## Discussion & Note Mutations

The SDK exports specialized classes for working with MR discussions:

### `MRDetailFetcher`

Fetches full MR discussion threads. Used to populate reviewer summaries and comment panels.

### `NoteMutator`

Creates and manages notes (comments) on MRs. Returns `CreatedNote` with the note's metadata.

```ts
import { MRDetailFetcher, NoteMutator } from '@mattstack/glance';
import type { CreatedNote } from '@mattstack/glance';
```

### `getReviewerSummaries`

Utility that merges reviewer state with discussion threads into a unified list:

```ts
import { getReviewerSummaries } from '@mattstack/glance';
import type { ReviewerSummary } from '@mattstack/glance';

const detail = await provider.fetchMRDiscussions(repoId, iid);
const summaries = getReviewerSummaries(mr, detail.discussions);
// summaries[0].reviewer, .commentCount, .discussions
```

---

## Types

All domain types are exported:

```ts
import type {
  // Core domain
  PullRequest,
  PullRequestsSnapshot,
  MergeabilityCheck,
  UserRef,
  Reviewer,
  MergeRequestReviewState,
  ReviewDisplayState,
  Pipeline,
  PipelineJob,
  DiffStats,

  // Discussion
  Discussion,
  Note,
  NoteAuthor,
  NotePosition,
  MRDetail,
  ReviewerSummary,

  // Dashboard
  MRStatus,
  MRState,
  MRDashboardProps,
  MRDashboardActions,
  Dashboard,
  DashboardGroup,
  CreateDashboardOptions,

  // Provider
  GitProvider,
  FetchPullRequestsOptions,
  ProviderCapabilities,
  ProviderSlug,
  BranchProtectionRule,

  // Mutations
  CreatePullRequestInput,
  UpdatePullRequestInput,
  MergePullRequestInput,
  MergeMethod,
  CreatedNote,

  // Real-time
  RealtimeWatcherOptions,
  WatcherSubscribeCallbacks,
  WatcherStatus,
  ActionCableCallbacks,

  // Server
  FeedEvent,
  FeedSnapshot,
  ServerNotification,

  // Logger
  ForgeLogger,
} from '@mattstack/glance';
```

### Utility Exports

| Export | Description |
|---|---|
| `createProvider(slug, url, token, options?)` | Factory — creates the right provider by slug |
| `SUPPORTED_PROVIDERS` | `['gitlab', 'github'] as const` |
| `parseRepoId(id)` | Extract numeric ID from `"gitlab:42"` → `42` |
| `repoIdProvider(id)` | Extract provider from `"gitlab:42"` → `"gitlab"` |
| `getReviewDisplayState(raw)` | Map raw review state → UI display state |
| `getReviewerSummaries(mr, discussions)` | Merge reviewer state with discussion threads |
| `noopLogger` | Silent logger implementation |
| `parseGitLabRepoId(path)` | Parse GitLab project path to numeric ID |
| `MR_DASHBOARD_FRAGMENT` | GraphQL fragment for MR dashboard queries |

## License

[MIT](LICENSE)
