# @forge-glance/react

React component library for Forge Glance — pre-themed MR dashboards, CI badges, and base primitives powered by the [GDS](https://graphite.dev) design system.

## Install

```bash
npm install @forge-glance/react @forge-glance/sdk
# or
bun add @forge-glance/react @forge-glance/sdk
```

## Quick Start

```tsx
import '@forge-glance/react/styles.css';
import { MRCard, Button, Badge } from '@forge-glance/react';
```

The CSS import brings in all tokens, utilities, and component styles — no Tailwind required on your end.

---

## Dashboard Integration

The dashboard API provides real-time MR data and pre-bound mutation actions. There are three integration patterns depending on your architecture:

### 1. React Hook — `useDashboard`

The simplest approach for standard React apps. Handles the subscription lifecycle and state internally.

```tsx
import '@forge-glance/react/styles.css';
import { useDashboard, MRCard, MRRow } from '@forge-glance/react';

function MergeRequestDashboard({ provider, projectPath, mrIid, userId }) {
  const { mr, actions, status } = useDashboard({
    provider, projectPath, mrIid, userId
  });

  if (status === 'connecting' || !mr) return <p>Loading…</p>;

  // Full card view — status, pipeline, reviewers, merge/rebase actions
  return <MRCard mr={mr} actions={actions} />;

  // Or use the compact row view — same props, different layout
  // return <MRRow mr={mr} actions={actions} />;
}
```

`useDashboard` returns:

| Field | Type | Description |
|---|---|---|
| `mr` | `MRDashboardProps \| null` | Render-ready props. `null` until first update. |
| `actions` | `MRDashboardActions` | Pre-bound mutations (merge, rebase, approve, etc.) |
| `status` | `'connecting' \| 'watching'` | Subscription state |

### 2. SDK + State Manager (Zustand, Redux, etc.)

Use `createDashboard` from the SDK directly when you manage state outside React (e.g., Zustand stores).

```tsx
import { createDashboard } from '@forge-glance/sdk';
import { create } from 'zustand';
import type { MRDashboardProps, MRDashboardActions } from '@forge-glance/sdk';

// Create the store
const useMRStore = create<{
  mr: MRDashboardProps | null;
  actions: MRDashboardActions | null;
}>(() => ({
  mr: null,
  actions: null,
}));

// Wire up the dashboard — call once on mount
const { actions, subscribe, dispose } = createDashboard({
  provider, projectPath: 'group/project', mrIid: 42, userId
});

// actions is available immediately — stable reference
useMRStore.setState({ actions });

// subscribe feeds real-time MR updates into the store
subscribe((mr) => useMRStore.setState({ mr }));

// Later, when tearing down:
dispose();
```

Then in your React component:

```tsx
import '@forge-glance/react/styles.css';
import { MRCard } from '@forge-glance/react';

function Dashboard() {
  const mr = useMRStore((s) => s.mr);
  const actions = useMRStore((s) => s.actions);

  if (!mr) return <p>Loading…</p>;

  return <MRCard mr={mr} actions={actions} />;
}
```

### 3. Read-Only (no actions)

For displaying MR data without mutation buttons, simply omit the `actions` prop:

```tsx
import { useDashboard, MRCard } from '@forge-glance/react';

function ReadOnlyCard({ provider, projectPath, mrIid, userId }) {
  const { mr } = useDashboard({ provider, projectPath, mrIid, userId });

  if (!mr) return <p>Loading…</p>;

  // No actions prop → buttons are hidden / disabled
  return <MRCard mr={mr} />;
}
```

### 4. Multi-MR Dashboard (shared WebSocket)

Watch multiple MRs over a single connection:

```tsx
import { createDashboard } from '@forge-glance/sdk';
import { MRRow } from '@forge-glance/react';

const { actionsFor, subscribe, dispose } = createDashboard({
  provider, projectPath: 'group/project',
  mrIid: [42, 43, 44, 45],
  userId
});

subscribe((mrs) => {
  for (const [iid, mr] of mrs) {
    renderRow(mr, actionsFor(iid));
  }
});
```

### `createDashboard` Return Shape

```ts
const { actions, subscribe, dispose } = createDashboard(provider, path, iid, userId);
```

| Property | Type | Description |
|---|---|---|
| `actions` | `MRDashboardActions` | Pre-bound mutations — available immediately |
| `subscribe(cb)` | `(listener: (mr: MRDashboardProps) => void) => void` | Register a listener for real-time MR updates |
| `dispose()` | `() => void` | Stop the subscription and clean up |

### `MRDashboardActions`

Actions are pre-bound to the specific MR — no need to pass project path or IID:

| Action | Description |
|---|---|
| `merge(input?)` | Merge the MR (optional merge options) |
| `rebase()` | Rebase onto target branch |
| `approve()` | Approve the MR |
| `unapprove()` | Remove your approval |
| `setAutoMerge()` | Enable auto-merge when pipeline passes |
| `cancelAutoMerge()` | Cancel auto-merge |
| `retryPipeline(id)` | Retry a specific pipeline |
| `requestReReview(usernames?)` | Request re-review |
| `can` | Provider capability flags |

---

## Components

### Forge Components

Built for GitLab/GitHub merge request dashboards. Feed them [`MRDashboardProps`](../sdk) from `@forge-glance/sdk`.

| Component | Description |
|---|---|
| `MRCard` | Full MR card — status, pipeline, reviewers, merge/rebase actions, forge icon link |
| `MRRow` | Compact MR row for list views |
| `MRRowList` | Renders a list of `MRRow` items |
| `MRStatusBadge` | Status badge — mergeable, blocked, draft, merged, closed |
| `PipelineBadge` | CI pipeline badge — passing, failing, running, warnings |
| `ReviewerList` | Reviewer avatars with approval state badges |
| `ReviewerRow` | Single reviewer row (used by `ReviewerList`) |

Both `MRCard` and `MRRow` accept an optional `actions` prop. When provided, the SDK actions
take precedence over individual `onMerge`/`onRebase` callbacks (which still work for backward compatibility).

### Brand Icons

```tsx
import { GitLabIcon, GitHubIcon, IconButton } from '@forge-glance/react';

<IconButton variant="ghost" aria-label="Open in GitLab">
  <GitLabIcon className="size-4" />
</IconButton>
```

| Component | Description |
|---|---|
| `GitLabIcon` | GitLab tanuki logo (official brand colors) |
| `GitHubIcon` | GitHub octocat logo (uses `currentColor`) |
| `IconButton` | Square icon-only button wrapper — supports all Button variants and colors |

### Base Primitives

Themed variants of common UI elements. Built on [Radix UI](https://radix-ui.com) + [CVA](https://cva.style).

| Component | Variants | Colors |
|---|---|---|
| `Button` | `filled` `outline` `subtle` `ghost` `link` | `emphasis` `action` `positive` `negative` `caution` `merge` `neutral` |
| `IconButton` | `filled` `outline` `subtle` `ghost` | `emphasis` `action` `positive` `negative` `caution` `merge` `neutral` |
| `Badge` | `filled` `outline` `subtle` | `emphasis` `action` `positive` `negative` `caution` `merge` `neutral` |
| `Switch` | — | — |
| `Tooltip` | — | — |

## Theming

### Light / Dark Mode

Toggle by adding `.dark` to your `<html>` element:

```js
document.documentElement.classList.toggle('dark');
```

### Using Tokens in Your Own Tailwind Setup

If you want to use the GDS tokens as Tailwind utilities in your own code, import `tokens.css` instead of `styles.css`:

```css
@import 'tailwindcss';
@import '@forge-glance/react/tokens.css';

@theme inline {
  --color-positive: var(--positive);
  --color-negative: var(--negative);
  --color-caution: var(--caution);
  /* register whichever tokens you need */
}
```

### Overriding Tokens

All component colors are CSS custom properties — override any token to retheme:

```css
:root {
  --positive: oklch(0.72 0.22 145);
  --btn-merge: oklch(0.55 0.20 280);
}
```

## SDK Types

Common types are re-exported so you don't need to install `@forge-glance/sdk` separately for types:

```tsx
import type {
  MRDashboardProps,
  MRDashboardActions,
  Dashboard,
  MRStatus,
  Reviewer,
} from '@forge-glance/react';
```

## Development

```bash
bun install
bun run dev:app        # demo app (imports from source)
bun storybook          # component playground on :6006
bun run build          # production build → dist/
```

### Releasing

This package uses [@changesets/cli](https://github.com/changesets/changesets) for independent versioning:

```bash
bun changeset          # create a changeset after making changes
bun run version        # apply changesets → bump versions + changelogs
bun run release        # build + npm publish + git tags
```

## License

[MIT](LICENSE)
