# @mattstack/glance-react

React components and hooks for [`@mattstack/glance`](../glance): pre-themed MR
dashboard cards, rows, reviewer and pipeline badges, and a small set of base
UI primitives, all built on Radix UI with a bundled design-token CSS system
(internal token prefix `gds`) that switches with a `.dark` class on `<html>`.

## Install

```bash
npm install @mattstack/glance-react @mattstack/glance
# or
bun add @mattstack/glance-react @mattstack/glance
```

## Quick Start

```tsx
import '@mattstack/glance-react/styles.css';
import { MRCard, Button, Badge } from '@mattstack/glance-react';
```

The CSS import brings in all tokens, utilities, and component styles... no Tailwind required on your end.

---

## Dashboard Integration

The dashboard API lives in [`@mattstack/glance`](../glance) and provides
real-time MR data plus pre-bound mutation actions (`merge`, `rebase`,
`approve`, and more). The full `createDashboard` / `DashboardGroup` /
`MRDashboardActions` reference is in
[`packages/glance/README.md`](../glance/README.md#dashboard-api); this
section covers the React-specific ways to consume it.

### 1. React Hook: `useDashboard`

The simplest approach for standard React apps. Wraps `createDashboard` and handles the subscription lifecycle internally.

```tsx
import '@mattstack/glance-react/styles.css';
import { useDashboard, MRCard, MRCardError } from '@mattstack/glance-react';

function MergeRequestDashboard({ provider, projectPath, mrIid, userId }) {
  const { mr, actions, isInitialLoading, error } = useDashboard({
    provider, projectPath, mrIid, userId
  });

  if (error) return <MRCardError error={error} />;
  if (isInitialLoading || !mr) return <MRCard loading />;

  return <MRCard mr={mr} actions={actions ?? undefined} />;
}
```

`useDashboard` returns:

| Field | Type | Description |
|---|---|---|
| `mr` | `MRDashboardProps \| null` | Render-ready props. `null` until first update. |
| `actions` | `MRDashboardActions \| null` | Pre-bound mutations (merge, rebase, approve, etc.). `null` until an MR is resolved (relevant for branch-based dashboards). |
| `isInitialLoading` | `boolean` | `true` until the first data payload arrives. |
| `connectionStatus` | `'connecting' \| 'connected' \| 'disconnected' \| 'reconnecting' \| 'idle'` | WebSocket / push connection state. |
| `error` | `Error \| null` | Last error from the realtime watcher, if any. |

### 2. SDK + State Manager (Zustand, Redux, etc.)

Use `createDashboard` from the SDK directly when you manage state outside React (e.g., Zustand stores).

```tsx
import { createDashboard } from '@mattstack/glance';
import { create } from 'zustand';
import type { MRDashboardProps, MRDashboardActions } from '@mattstack/glance';

// Create the store
const useMRStore = create<{
  mr: MRDashboardProps | null;
  actions: MRDashboardActions | null;
}>(() => ({
  mr: null,
  actions: null,
}));

// Wire up the dashboard, call once on mount
const dashboard = createDashboard({ provider, projectPath: 'group/project', mrIid: 42, userId });

// actions are available immediately (stable reference)
useMRStore.setState({ actions: dashboard.actions });

// subscribe feeds real-time MR updates into the store
dashboard.subscribe((mr) => useMRStore.setState({ mr }));

// Later, when tearing down:
dashboard.dispose();
```

Then in your React component:

```tsx
import '@mattstack/glance-react/styles.css';
import { MRCard } from '@mattstack/glance-react';

function Dashboard() {
  const mr = useMRStore((s) => s.mr);
  const actions = useMRStore((s) => s.actions);

  if (!mr) return <MRCard loading />;

  return <MRCard mr={mr} actions={actions ?? undefined} />;
}
```

### 3. Read-Only (no actions)

For displaying MR data without mutation buttons, simply omit the `actions` prop:

```tsx
import { useDashboard, MRCard } from '@mattstack/glance-react';

function ReadOnlyCard({ provider, projectPath, mrIid, userId }) {
  const { mr } = useDashboard({ provider, projectPath, mrIid, userId });

  if (!mr) return <MRCard loading />;

  // No actions prop → buttons are hidden / disabled
  return <MRCard mr={mr} />;
}
```

### 4. Multi-MR Dashboard (shared WebSocket)

Watch multiple MRs over a single connection:

```tsx
import { createDashboard } from '@mattstack/glance';
import { MRRow } from '@mattstack/glance-react';

const group = createDashboard({
  provider, projectPath: 'group/project',
  mrIid: [42, 43, 44, 45],
  userId
});

group.subscribe((mrs) => {
  for (const [iid, mr] of mrs) {
    renderRow(mr, group.actionsFor(iid));
  }
});
```

---

## Components

### Forge Components

Built for GitLab/GitHub merge request dashboards. Feed them [`MRDashboardProps`](../glance) from `@mattstack/glance`.

| Component | Description |
|---|---|
| `MRCard` | Full MR card: status, pipeline, reviewers, merge/rebase actions, forge icon link. Accepts `loading` for a skeleton state. |
| `MRCardError` | Error banner for a dashboard component. `standalone` replaces the card; `inline` is a slim banner. |
| `MRRow` | Compact MR row for list views. |
| `MRRowList` | Renders a list of `MRRow` items. |
| `MRNode` | Minimal MR representation for graph/tree views. |
| `MRSidebar` | Sidebar panel pairing an MR with related tickets. |
| `MRStatusBadge` | Status badge: mergeable, blocked, draft, merged, closed. |
| `PipelineBadge` | CI pipeline badge: passing, failing, running, warnings. |
| `ConnectionStatusBadge` | Small badge reflecting `connectionStatus` from `useDashboard`. |
| `ReviewerList` | Reviewer avatars with approval state badges. |
| `ReviewerRow` | Single reviewer row (used by `ReviewerList`). |

`MRCard` is also available as smaller composable pieces (`MRHeader`,
`MRStatusCard`, `MRActions`, `PipelineStatus`, `ReviewerStatus`,
`BlockerList`, `StatusIcon`, `ExpandChevron`, and skeleton variants of the
above) for consumers assembling their own layout; see
[`lib/main.ts`](lib/main.ts) for the full export list.

Both `MRCard` and `MRRow` accept an optional `actions` prop. When provided, the SDK actions
take precedence over individual `onMerge`/`onRebase` callbacks (which still work for backward compatibility).

### Brand Icons

```tsx
import { GitLabIcon, GitHubIcon, IconButton } from '@mattstack/glance-react';

<IconButton variant="ghost" aria-label="Open in GitLab">
  <GitLabIcon className="size-4" />
</IconButton>
```

| Component | Description |
|---|---|
| `GitLabIcon` | GitLab tanuki logo (official brand colors) |
| `GitHubIcon` | GitHub octocat logo (uses `currentColor`) |
| `IconButton` | Square icon-only button wrapper, supports all Button variants and colors |

### Base Primitives

Themed variants of common UI elements. Built on [Radix UI](https://radix-ui.com) + [CVA](https://cva.style).

| Component | Variants | Colors |
|---|---|---|
| `Button` | `filled` `outline` `subtle` `ghost` `link` | `emphasis` `action` `positive` `negative` `caution` `merge` `neutral` |
| `IconButton` | `filled` `outline` `subtle` `ghost` | `emphasis` `action` `positive` `negative` `caution` `merge` `neutral` |
| `Badge` | `filled` `outline` `subtle` | `emphasis` `action` `positive` `negative` `caution` `merge` `neutral` |
| `Switch` | n/a | n/a |
| `Skeleton` | n/a | n/a |
| `Row` / `Stack` | flex row/column layout helpers | n/a |

## Theming

### Light / Dark Mode

Toggle by adding `.dark` to your `<html>` element:

```js
document.documentElement.classList.toggle('dark');
```

### Using Tokens in Your Own Tailwind Setup

If you want to use the design tokens as Tailwind utilities in your own code, import `tokens.css` instead of `styles.css`:

```css
@import 'tailwindcss';
@import '@mattstack/glance-react/tokens.css';

@theme inline {
  --color-positive: var(--positive);
  --color-negative: var(--negative);
  --color-caution: var(--caution);
  /* register whichever tokens you need */
}
```

An app that already defines its own `@theme` (and doesn't want a second
`@import 'tailwindcss'`) can instead import `utilities.css`, which supplies
just the `@utility` shorthands the components use, given the same token
names are defined in that app's theme.

### Overriding Tokens

All component colors are CSS custom properties; override any token to retheme:

```css
:root {
  --positive: oklch(0.72 0.22 145);
  --btn-merge: oklch(0.55 0.20 280);
}
```

## SDK Types

Common types are re-exported so you don't need to install `@mattstack/glance` separately for types:

```tsx
import type {
  MRDashboardProps,
  MRDashboardActions,
  Dashboard,
  DashboardGroup,
  MRStatus,
  Reviewer,
} from '@mattstack/glance-react';
```

## Development

```bash
bun install
bun run dev:app        # demo app (imports from source)
bun storybook          # component playground on :6006
bun run build          # production build → dist/
```

### Releasing

Versions are bumped by hand in `package.json` and published with `npm publish`,
gated by the `prepublishOnly` script (`check-types` then `build`).

## License

[MIT](LICENSE)
