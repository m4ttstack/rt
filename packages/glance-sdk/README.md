# @forge-glance/sdk

Provider-agnostic SDK for GitHub & GitLab — types, REST/GraphQL clients, real-time subscriptions, and dashboard helpers. Works in any Node/Bun runtime.

## Install

```bash
npm install @forge-glance/sdk
# or
bun add @forge-glance/sdk
```

## Quick Start

```ts
import { GitLabProvider } from '@forge-glance/sdk';

const provider = new GitLabProvider('https://gitlab.com', process.env.GITLAB_TOKEN!);
const user = await provider.validateToken();
const prs = await provider.fetchPullRequests();
```

## Providers

Two built-in providers implement the `GitProvider` interface:

| Provider | Class | Capabilities |
|---|---|---|
| GitLab | `GitLabProvider` | Full: merge, rebase, approve, auto-merge, retry pipeline, re-review |
| GitHub | `GitHubProvider` | Core: merge, approve, rebase |

```ts
import { createProvider } from '@forge-glance/sdk';

// Auto-create the right provider by slug
const provider = createProvider('gitlab', 'https://gitlab.com', token);
```

### Provider Methods

| Method | Description |
|---|---|
| `validateToken()` | Verify credentials, returns `UserRef` |
| `fetchPullRequests()` | Fetch all MRs you authored, review, or are assigned to |
| `fetchSingleMR(path, iid, userId)` | Fetch one MR by project path and IID |
| `fetchPullRequestByBranch(path, branch)` | Find an open MR by source branch |
| `createPullRequest(input)` | Create a new MR |
| `updatePullRequest(path, iid, input)` | Update an existing MR |
| `mergePullRequest(path, iid, input?)` | Merge an MR |
| `rebasePullRequest(path, iid)` | Rebase an MR onto its target branch |
| `approvePullRequest(path, iid)` | Approve an MR |
| `unapprovePullRequest(path, iid)` | Remove your approval |
| `setAutoMerge(path, iid)` | Enable auto-merge when pipeline passes |
| `cancelAutoMerge(path, iid)` | Cancel auto-merge |
| `retryPipeline(path, pipelineId)` | Retry a pipeline |
| `requestReReview(path, iid, usernames?)` | Request re-review |
| `watchMR(path, iid, userId, onUpdate)` | Real-time MR subscription (returns `dispose()`) |
| `fetchMRDiscussions(repoId, iid)` | Fetch MR discussions and notes |
| `fetchBranchProtectionRules(path)` | Fetch branch protection rules |
| `deleteBranch(path, branch)` | Delete a branch |

---

## Dashboard API

### `createDashboard`

High-level factory that bundles real-time MR watching with pre-bound mutation actions. Returns a `Dashboard` object:

```ts
import { createDashboard } from '@forge-glance/sdk';

const { actions, subscribe, dispose } = createDashboard({
  provider,
  projectPath: 'group/project',
  mrIid: 42,
  userId
});

// actions are available immediately — no need to wait for the first update
await actions.merge();
await actions.approve();

// subscribe delivers real-time MRDashboardProps on each update
subscribe((mr) => {
  console.log(mr.status, mr.pipeline?.status);
  renderUI(mr, actions);
});

// When done, stop the subscription
dispose();
```

| Property | Type | Description |
|---|---|---|
| `actions` | `MRDashboardActions` | Pre-bound mutation methods — available immediately |
| `subscribe(cb)` | `(cb: (mr: MRDashboardProps) => void) => void` | Register a listener for real-time updates |
| `dispose()` | `() => void` | Stop the subscription and clean up |

#### Multi-MR: `DashboardGroup`

Pass an array of IIDs to watch multiple MRs over a single WebSocket:

```ts
const { actionsFor, subscribe, dispose } = createDashboard({
  provider,
  projectPath: 'group/project',
  mrIid: [42, 43, 44, 45],
  userId
});

subscribe((mrs) => {
  for (const [iid, mr] of mrs) {
    renderRow(mr, actionsFor(iid));
  }
});
```

| Property | Type | Description |
|---|---|---|
| `actionsFor(iid)` | `(iid: number) => MRDashboardActions` | Get actions for a specific MR |
| `subscribe(cb)` | `(cb: (mrs: Map<number, MRDashboardProps>) => void) => void` | Real-time updates for all MRs |
| `dispose()` | `() => void` | Stop all subscriptions |

### `getMRDashboardProps`

Lower-level helper that transforms a raw `PullRequest` into render-ready `MRDashboardProps`. Useful when you already have the MR data from `fetchPullRequests()` or `fetchSingleMR()`:

```ts
import { getMRDashboardProps } from '@forge-glance/sdk';

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
| `status` | `'mergeable' \| 'blocked' \| 'draft' \| 'merged' \| 'closed'` |
| `statusDetail` | Specific blocker reason (e.g., `'CI_MUST_PASS'`, `'NEED_REBASE'`) |
| `pipeline` | Pipeline status breakdown: passing, failing, running counts |
| `reviews` | Reviewer state: required, given, remaining, approvedBy |
| `mergeButton` | `{ visible, disabled, loading, label }` |
| `rebaseButton` | `{ visible, loading, label, behindBy }` |
| `autoMergeButton` | `{ visible, isActive, strategy, label, cancelLabel }` |
| `blockers` | Boolean flags: `isDraft`, `hasConflicts`, `needsRebase`, `pipelineFailing`, etc. |
| `diff` | `{ additions, deletions, filesChanged }` |

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

Generic self-healing subscription + polling module used internally by `watchMR`. Also exported for custom use:

- Adaptive poll rate (fast when push is down, slow when healthy)
- Full-jitter exponential backoff on fetch failures
- Push-event debouncing (burst events → one refetch)
- Immediate refetch on reconnect

---

## Types

All domain types are exported:

```ts
import type {
  PullRequest,
  MRDashboardProps,
  MRDashboardActions,
  Dashboard,
  MRStatus,
  Reviewer,
  Pipeline,
  PipelineJob,
  DiffStats,
  GitProvider,
  ProviderCapabilities,
} from '@forge-glance/sdk';
```

## License

[MIT](LICENSE)
