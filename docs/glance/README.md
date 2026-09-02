# glance

One client for GitHub and GitLab, behind a single set of types.

Merge requests and pull requests are the same idea wearing different API
shapes. glance hides that difference: write against one `GitProvider`
interface and it works on either forge, over REST, GraphQL, and real-time
subscriptions, so a dashboard can update the moment a pipeline finishes
instead of polling for it.

Part of [mattstack](https://m4tthew.dev/mattstack). Siblings in the estate
include [rt](https://github.com/m4ttstack/rt) (a developer CLI),
[gitq](https://github.com/m4ttstack/gitq) (a stacked-branch engine),
[board](https://github.com/m4ttstack/board) (a team MR dashboard),
[deck](https://github.com/m4ttstack/deck), [fast-browser](https://github.com/m4ttstack/fast-browser),
[herdr-chat](https://github.com/m4ttstack/herdr-chat), [skills](https://github.com/m4ttstack/skills),
and [mattstack-marketplace](https://github.com/m4ttstack/mattstack-marketplace),
built alongside [herdr](https://github.com/herdrdev/herdr) itself.

## Who uses it

[rt](https://github.com/m4ttstack/rt), [gitq](https://github.com/m4ttstack/gitq),
and [board](https://github.com/m4ttstack/board) all read and write merge
requests through this layer, which is why the same review state shows up in a
CLI, a board, and an editor extension without three integrations drifting
apart.

## Packages

| Package | Description |
| --- | --- |
| [`@mattstack/glance`](packages/glance) | Provider-agnostic client: types, REST/GraphQL, ActionCable subscriptions, dashboard helpers. Runs on Node (>=21) or Bun. |
| [`@mattstack/glance-react`](packages/glance-react) | React components and hooks for rendering merge request state: cards, rows, reviewer status, pipeline badges. |

Both are published on npm and installable directly; this repo is where they
are built from, not a wrapper around something published elsewhere.

## Features

- **One interface, two forges.** `GitLabProvider` and `GitHubProvider` both
  implement `GitProvider`, so `fetchPullRequests`, `mergePullRequest`,
  `approvePullRequest`, and the rest read and write identically regardless of
  which forge is behind them. `createProvider(slug, baseURL, token)` picks the
  right one by slug.
- **REST and GraphQL, on both forges.** GitLab runs on
  [`@gitbeaker/rest`](https://github.com/jdalrymple/gitbeaker); GitHub runs on
  Octokit (REST v3 and GraphQL), including GitHub Enterprise Server by passing
  its instance URL.
- **Real-time GitLab subscriptions.** `ActionCableClient` is an
  auto-reconnecting WebSocket client for GitLab's ActionCable endpoint.
  Every `watchMR` call on one `GitLabProvider` shares a single WebSocket
  connection, ref-counted per channel: watching 30 MRs opens one socket with
  90 channel subscriptions, not 30 sockets.
- **Self-healing by default.** `createRealtimeWatcher` pairs a push
  subscription with an adaptive polling safety net: fast polling while push is
  down, full-jitter exponential backoff on repeated failures, burst-event
  debouncing, and an immediate refetch on reconnect. It backs `watchMR` and
  the dashboard helpers, and is exported for wiring up other transports.
- **Dashboard helpers.** `createDashboard` bundles a live subscription with
  pre-bound mutation actions (merge, approve, rebase, auto-merge, and more);
  `getMRDashboardProps` turns a raw `PullRequest` into render-ready props
  (status, blocker flags, button labels and disabled states) with no
  conditional logic needed in the component layer.
- **Metric-grade reads.** `fetchMergeRequestIndex` pages scalar MR rows
  (with `mergedAt` and labels) across a group or project set, and
  `PullRequest` itself now carries `mergedAt`;
  `fetchMergeRequestMetrics` reads one MR's diff stats and every note, and
  `fetchProjectPipelines` / `fetchUserEvents` / `fetchGroupProjects` /
  `fetchProject` cover the rest of what an engineering-metrics consumer
  needs. GitLab today; each is optional on `GitProvider` behind a
  capability flag.
- **Capability flags, not forge sniffing.** `provider.capabilities` reports
  which mutations a given forge actually supports (`canRebase`,
  `canAutoMerge`, `canResolveDiscussions`, and more), so a caller can show or
  hide UI affordances without a hardcoded check for which forge it is.
- **Cursor-based cache invalidation feeds.** `EventsPoller`/`EventsWatcher`
  watch GitLab's project events feed, and `GitHubEventsPoller` watches
  GitHub's, both translating activity into invalidation hints with the same
  jitter, backoff, and degraded/live status reporting as the realtime watcher.
- **Request instrumentation.** An optional `onRequest` hook reports one
  callback per logical SDK operation, with timing and status, across all four
  HTTP transports the SDK uses internally (GraphQL, the gitbeaker REST client,
  `restRequest`, and the standalone fetchers).
- **Write failures you can act on.** `ReadBackFailedError` distinguishes a
  write the forge rejected from a write that landed but could not be read
  back afterward, so a caller knows not to retry (and duplicate) the second
  case.
- **Ships for Node and Bun, and it is tested that way.** The unit suite runs
  on Bun; a separate smoke test imports the built `dist` output under plain
  Node and exercises it end to end, so a change that only Bun tolerates
  cannot ship unnoticed.
- **A themed React layer.** `@mattstack/glance-react` supplies `MRCard`,
  `MRRow`, `MRStatusBadge`, `PipelineBadge`, `ReviewerList`, brand icons for
  both forges, skeleton loading states, and a `useDashboard` hook wrapping the
  SDK's dashboard API. Built on Radix UI, with a bundled design-token CSS
  system that switches with a `.dark` class on `<html>`.

## Installation

```bash
bun add @mattstack/glance
bun add @mattstack/glance-react   # optional React layer

# or with npm
npm install @mattstack/glance
npm install @mattstack/glance-react
```

## Usage

```ts
import { createProvider } from '@mattstack/glance';

const provider = createProvider('gitlab', 'https://gitlab.com', token);
const user = await provider.validateToken();
const prs = await provider.fetchPullRequests();
```

The same code against GitHub only changes the slug and host:

```ts
const provider = createProvider('github', 'https://github.com', token);
```

### Real-time dashboard

```ts
import { createDashboard } from '@mattstack/glance';

const dashboard = createDashboard({ provider, projectPath: 'group/project', mrIid: 42, userId });

dashboard.subscribe((mr) => {
  console.log(mr.status, mr.pipeline?.status);
  renderUI(mr, dashboard.actions);
});

await dashboard.actions.merge();
dashboard.dispose(); // stop watching and clean up
```

### React

```tsx
import '@mattstack/glance-react/styles.css';
import { useDashboard, MRCard } from '@mattstack/glance-react';

function MergeRequestDashboard({ provider, projectPath, mrIid, userId }) {
  const { mr, actions, status } = useDashboard({ provider, projectPath, mrIid, userId });
  if (status === 'connecting' || !mr) return <p>Loading...</p>;
  return <MRCard mr={mr} actions={actions} />;
}
```

The full API reference, the multi-MR (`DashboardGroup`) pattern, and every
exported type live in [`packages/glance/README.md`](packages/glance/README.md)
and [`packages/glance-react/README.md`](packages/glance-react/README.md).

## Configuration

- **Logger.** Pass any object matching the `ForgeLogger` interface
  (`debug`/`info`/`warn`/`error`) as `{ logger }` to a provider constructor or
  `createProvider`. Defaults to a silent `noopLogger`.
- **Request instrumentation.** Pass `{ onRequest }` to observe every logical
  SDK operation with timing and status.
- **GitHub Enterprise Server.** Pass the GHES instance URL as `baseURL`; the
  client appends `/api/v3` and `/api/graphql` itself. `github.com` resolves to
  `api.github.com` automatically.
- **Capabilities before mutations.** Check `provider.capabilities` before
  calling a provider-specific action like `rebasePullRequest` or
  `setAutoMerge`; GitLab and GitHub do not support the same mutation surface.
- **Realtime tuning.** `watchMR`, `createDashboard`, and `createRealtimeWatcher`
  all accept `RealtimeWatcherOptions` (poll interval, backoff, debounce);
  `watchEvents` accepts `WatchEventsOptions` for the cursor-based invalidation
  feed.

## Development

```bash
$ bun install
$ bun run check-types   # tsc --noEmit across every package
```

Per-package build and test:

```bash
$ cd packages/glance
$ bun run build
$ bun test               # unit + smoke tests; the live conformance suite is skipped by default

$ cd packages/glance-react
$ bun run test           # vitest
$ bun run dev:app        # demo app that imports from source
$ bun storybook          # component playground on :6006
```

The live conformance suite exercises real GitLab and GitHub projects instead
of mocks. It is opt-in: copy `harness_credentials.example.json` to
`harness_credentials.json` (gitignored; see the file's own comments for what
each token needs) at `~/Documents/GitHub/Glance/harness_credentials.json`,
then run with `GLANCE_LIVE=1 bun test`. GitHub's second identity comes from
`gh auth token` via the `GLANCE_HARNESS_GITHUB_APPROVER` environment variable
rather than the credentials file, so nothing GitHub-shaped needs to sit on
disk.

## Contributing

Issues and pull requests are welcome. Run `bun run check-types` and the
per-package test commands above before opening one; there is no separate
`CONTRIBUTING.md` yet, so this README is the guide.

## License

[MIT](LICENSE)
