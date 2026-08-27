# app-kit `<AppLauncher />` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared `<AppLauncher />` from `@mattstack/app-kit` that any mattstack app mounts to get a Google-style app-grid switcher, fed by deck's `GET /api/apps`, with the platform mark as its trigger.

**Architecture:** A pure origin→deck-base resolver and a never-throwing fetch hook feed a Mantine `Popover` whose body is a grid of tiles linking to each app's deck-resolved URL. The trigger is `MattstackMark`, an inline-SVG reproduction of the mattstack `.app` icon. `MattstackShell` mounts the launcher header-right when the app passes its registry `appName`. The deck backend (`GET /api/apps`, `GET /api/apps/:name/icon`, CORS) already shipped (deck #3, merged `aeafcd0`); this plan is the app-kit half only.

**Tech Stack:** React 19, Mantine 9.5 (`Popover`, `ActionIcon`, `SimpleGrid`, `Anchor`), TypeScript, Vitest 4 + jsdom, `@testing-library/react`. No new dependencies.

**Spec:** `~/Documents/GitHub/deck/docs/superpowers/specs/2026-08-27-mattstack-app-launcher-design.md` (Section D and onward is the app-kit half; A-C are the shipped deck half).

## Global Constraints

- **Package + subpath:** all new source lives under `packages/ui/src/app/` and is exported from the `./app` subpath (`@mattstack/app-kit/app`). No new package export.
- **Never break the host header:** a null deck base, a failed fetch, or a malformed payload must resolve to a hidden launcher or an empty grid, never a throw. The launcher is decoration on someone else's header.
- **deck base derivation (exact):** `*.mattstack` → `https://deck.mattstack`; `*.localhost` → `https://deck.localhost`; a `deckBase` prop/override wins for dev and custom domains; any other origin with no override → `null` (launcher hidden). Discovery is a local/internal surface (spec non-goals); public tunnel origins hide the launcher by design.
- **Mark palette (verbatim from the `.app` iconset source, `repo-tools/rt-tray/make-icon.swift`):** canvas `#161224`, mark `#FF6B9D`, corner radius `0.225 × side`, the mark is a monospace `m` beside the lucide-"layers" stacked-diamonds glyph.
- **Tiles are plain anchors** to each app's full deck URL (cross-domain navigation, same tab). No wouter, no client routing.
- **Tests** use `renderWithProviders` from `@mattstack/app-kit/test-utils`; `fetch` is stubbed with `vi.stubGlobal`/`vi.fn`.
- **Clean-code comments:** a comment states a constraint the code cannot show (a color parity anchor, a never-throw invariant). No narration, no task/spec citations in source.
- **Out of scope (consumer-side, separate later plans):** per-app `mattstack.json` files, the tarball/`app-icons.d.ts`/`.js`-vite consumption requirements, and the chat/console migrations. This plan changes only app-kit internals.

---

### Task 1: Discovery types + `deriveDeckBase` resolver

**Files:**
- Create: `packages/ui/src/app/deck-discovery.ts`
- Test: `packages/ui/src/app/deck-discovery.test.ts`

**Interfaces:**
- Produces: `DiscoveryApp { name: string; displayName: string; description?: string; url: string; icon: string | null }`, `DiscoveryResponse { apps: DiscoveryApp[] }`, and `deriveDeckBase(origin: string, override?: string): string | null`.
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { deriveDeckBase } from './deck-discovery';

describe('deriveDeckBase', () => {
  test('maps a *.mattstack origin to deck.mattstack', () => {
    expect(deriveDeckBase('https://chat.mattstack')).toBe(
      'https://deck.mattstack'
    );
  });

  test('maps a *.localhost origin to deck.localhost', () => {
    expect(deriveDeckBase('https://chat.localhost')).toBe(
      'https://deck.localhost'
    );
  });

  test('an override wins and its trailing slash is trimmed', () => {
    expect(deriveDeckBase('https://chat.mattstack', 'http://localhost:11007/')).toBe(
      'http://localhost:11007'
    );
  });

  test('an unrecognized origin with no override is null', () => {
    expect(deriveDeckBase('https://chat.m4tthew.dev')).toBeNull();
  });

  test('a non-URL origin is null, not a throw', () => {
    expect(deriveDeckBase('not a url')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/deck-discovery.test.ts`
Expected: FAIL ("deriveDeckBase is not a function" / module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
export interface DiscoveryApp {
  name: string;
  displayName: string;
  description?: string;
  url: string;
  icon: string | null;
}

export interface DiscoveryResponse {
  apps: DiscoveryApp[];
}

/**
 * The deck discovery origin for a mattstack surface. `override` (the
 * launcher's `deckBase` prop) wins for dev and custom domains. A host that is
 * neither `*.mattstack` nor `*.localhost` yields null, so the launcher hides
 * rather than firing a doomed cross-origin fetch.
 */
export function deriveDeckBase(
  origin: string,
  override?: string
): string | null {
  if (override) return override.replace(/\/+$/, '');
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (host === 'mattstack' || host.endsWith('.mattstack'))
    return 'https://deck.mattstack';
  if (host === 'localhost' || host.endsWith('.localhost'))
    return 'https://deck.localhost';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/deck-discovery.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app/deck-discovery.ts packages/ui/src/app/deck-discovery.test.ts
git commit -m "app: add deck discovery types and deriveDeckBase resolver"
```

---

### Task 2: `useDiscoveryApps` fetch hook

**Files:**
- Create: `packages/ui/src/app/useDiscoveryApps.ts`
- Test: `packages/ui/src/app/useDiscoveryApps.test.tsx`

**Interfaces:**
- Consumes: `DiscoveryApp`, `DiscoveryResponse` from Task 1.
- Produces: `useDiscoveryApps(deckBase: string | null): { apps: DiscoveryApp[]; loaded: boolean; refresh: () => Promise<void> }`. `refresh` is called by the launcher when its popover opens; it caches the last good list for 30s and swallows every failure into an empty (or last-good) list.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useDiscoveryApps } from './useDiscoveryApps';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown) {
  const fn = vi.fn(async () => ({ json: async () => body }) as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

test('a null deck base loads an empty list without fetching', async () => {
  const fn = stubFetch({ apps: [] });
  const { result } = renderHook(() => useDiscoveryApps(null));
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  expect(fn).not.toHaveBeenCalled();
});

test('refresh fetches <base>/api/apps and exposes the rows', async () => {
  const apps = [
    { name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null },
  ];
  const fn = stubFetch({ apps });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledWith('https://deck.mattstack/api/apps');
  await waitFor(() => expect(result.current.apps).toEqual(apps));
});

test('a rejected fetch loads empty and never throws', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down');
    })
  );
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/useDiscoveryApps.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
import { useCallback, useRef, useState } from 'react';

import type { DiscoveryApp, DiscoveryResponse } from './deck-discovery';

interface DiscoveryState {
  apps: DiscoveryApp[];
  loaded: boolean;
}

const CACHE_MS = 30_000;

/**
 * Fetches `${deckBase}/api/apps` on demand (the launcher calls `refresh` when
 * its popover opens) and caches the last good list for CACHE_MS so rapid
 * reopens do not refetch. A null base, a rejected fetch, or a non-array
 * payload all resolve to an empty (or last-good) list and never throw: an
 * unreachable deck must not break the host app's header.
 */
export function useDiscoveryApps(deckBase: string | null) {
  const [state, setState] = useState<DiscoveryState>({
    apps: [],
    loaded: false,
  });
  const fetchedAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!deckBase) {
      setState({ apps: [], loaded: true });
      return;
    }
    if (fetchedAt.current && Date.now() - fetchedAt.current < CACHE_MS) return;
    try {
      const res = await fetch(`${deckBase}/api/apps`);
      const data = (await res.json()) as DiscoveryResponse;
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      fetchedAt.current = Date.now();
      setState({ apps, loaded: true });
    } catch {
      setState(prev => ({ apps: prev.apps, loaded: true }));
    }
  }, [deckBase]);

  return { ...state, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/useDiscoveryApps.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app/useDiscoveryApps.ts packages/ui/src/app/useDiscoveryApps.test.tsx
git commit -m "app: add useDiscoveryApps fetch hook (never-throws, 30s cache)"
```

---

### Task 3: `MattstackMark` platform mark (inline SVG)

**Files:**
- Create: `packages/ui/src/app/MattstackMark.tsx`
- Test: `packages/ui/src/app/MattstackMark.test.tsx`

**Interfaces:**
- Produces: `MattstackMark({ size?: number; title?: string }): JSX.Element` (default `size = 28`, default `title = 'mattstack'`). An `<svg role="img">` with an `<title>`, reproducing the `.app` icon.
- Consumes: nothing.

**Geometry note (from `make-icon.swift`, verbatim):** on a 64-box, radius `14.4`; the mark group is a monospace `m` at font-size `25.6` then a `3.84` gap then the layers glyph in a `19.2` box, the group horizontally centered and vertically centered. The layers glyph uses the source's own 24-box coordinates (SVG y-down, so no flip): diamond `(12,2.5)(21.8,7)(12,11.5)(2.2,7)`, mid chevron `(2.2,12.3)(12,16.8)(21.8,12.3)`, bottom chevron `(2.2,17.3)(12,21.8)(21.8,17.3)`, stroke `2/24`, round caps/joins.

**Fidelity flag (surface at plan review, not blocking):** the `m` is monospace text (`'SF Mono', ui-monospace, Menlo, monospace`); a viewer without SF Mono falls back to another monospace face, so the `m` is faithful-not-pixel-identical to the Swift-rendered icon. The plum square + pink `m`-beside-layers composition is what carries the platform identity. Alternative if exactness is required: trace the SF Mono `m` outline to a `<path>` (heavier; deferred).

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MattstackMark } from './MattstackMark';

test('renders an accessible svg with the plum canvas and pink mark', () => {
  const { getByRole, container } = render(<MattstackMark />);
  const svg = getByRole('img', { name: 'mattstack' });
  expect(svg.tagName.toLowerCase()).toBe('svg');
  expect(container.querySelector('rect')).toHaveAttribute('fill', '#161224');
  expect(container.querySelector('text')).toHaveTextContent('m');
  expect(container.querySelector('text')).toHaveAttribute('fill', '#FF6B9D');
});

test('honors the size prop on the svg element', () => {
  const { getByRole } = render(<MattstackMark size={40} />);
  const svg = getByRole('img', { name: 'mattstack' });
  expect(svg).toHaveAttribute('width', '40');
  expect(svg).toHaveAttribute('height', '40');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/MattstackMark.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
const BG = '#161224';
const FG = '#FF6B9D';

export interface MattstackMarkProps {
  /** Rendered svg side in px. @default 28 */
  size?: number;
  /** Accessible name / tooltip title. @default 'mattstack' */
  title?: string;
}

/**
 * The shared mattstack platform mark, reproduced from the `.app` iconset
 * (`repo-tools/rt-tray/make-icon.swift`): a plum rounded square carrying a
 * monospace `m` beside the lucide-"layers" glyph, both in rose pink. Palette
 * and geometry are parity anchors to the installer/tray icon -- keep them in
 * sync with that source.
 */
export function MattstackMark({ size = 28, title = 'mattstack' }: MattstackMarkProps) {
  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <rect width="64" height="64" rx="14.4" fill={BG} />
      <text
        x="13"
        y="40.5"
        fontFamily="'SF Mono', ui-monospace, Menlo, monospace"
        fontSize="25.6"
        fontWeight={500}
        fill={FG}
      >
        m
      </text>
      <g
        transform="translate(31.6 22.4) scale(0.8)"
        fill="none"
        stroke={FG}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2.5 L21.8 7 L12 11.5 L2.2 7 Z" />
        <path d="M2.2 12.3 L12 16.8 L21.8 12.3" />
        <path d="M2.2 17.3 L12 21.8 L21.8 17.3" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/MattstackMark.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app/MattstackMark.tsx packages/ui/src/app/MattstackMark.test.tsx
git commit -m "app: add MattstackMark, an inline-SVG of the .app platform icon"
```

---

### Task 4: `<AppLauncher />` component

**Files:**
- Create: `packages/ui/src/app/AppLauncher.tsx`
- Test: `packages/ui/src/app/AppLauncher.test.tsx`

**Interfaces:**
- Consumes: `deriveDeckBase` (Task 1), `useDiscoveryApps` (Task 2), `MattstackMark` (Task 3).
- Produces: `AppLauncher(props: AppLauncherProps): JSX.Element | null` where
  ```ts
  interface AppLauncherProps {
    /** This app's deck registry name, to mark/sort "you are here". */
    currentApp?: string;
    /** Override the derived deck base URL (dev, custom domain). */
    deckBase?: string;
  }
  ```
  Returns `null` when no deck base resolves. Otherwise a `Popover` whose trigger is a `MattstackMark` `ActionIcon` and whose body is a grid of app tiles. Opening the popover calls `refresh`. Tiles are anchors to `app.url`; `currentApp` is marked and sorted first; an empty list renders a muted "No apps" note (never a crash).

- [ ] **Step 1: Write the failing test**

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { AppLauncher } from './AppLauncher';

const APPS = [
  { name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: 'https://deck.mattstack/api/apps/chat/icon' },
  { name: 'board', displayName: 'Board', url: 'https://board.mattstack', icon: null },
];

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://chat.mattstack' } as Location);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ apps: APPS }) }) as Response)
  );
});
afterEach(() => vi.unstubAllGlobals());

test('opens a grid of app tiles linking to each url', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher currentApp="chat" />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  const chat = await screen.findByRole('link', { name: /Chat/ });
  expect(chat).toHaveAttribute('href', 'https://chat.mattstack');
  expect(screen.getByRole('link', { name: /Board/ })).toHaveAttribute(
    'href',
    'https://board.mattstack'
  );
});

test('marks the current app', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher currentApp="chat" />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  const chat = await screen.findByRole('link', { name: /Chat/ });
  expect(chat).toHaveAttribute('data-current', 'true');
});

test('renders null when the origin is not a mattstack surface and no override', () => {
  vi.stubGlobal('location', { origin: 'https://example.com' } as Location);
  const { container } = renderWithProviders(<AppLauncher />);
  expect(container).toBeEmptyDOMElement();
});

test('an empty list shows a muted note, not a crash', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ apps: [] }) }) as Response)
  );
  const user = userEvent.setup();
  renderWithProviders(<AppLauncher />);
  await user.click(screen.getByRole('button', { name: /apps/i }));
  await waitFor(() =>
    expect(screen.getByText(/no apps/i)).toBeInTheDocument()
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/AppLauncher.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useMemo } from 'react';
import {
  ActionIcon,
  Anchor,
  Image,
  Popover,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { deriveDeckBase } from './deck-discovery';
import type { DiscoveryApp } from './deck-discovery';
import { MattstackMark } from './MattstackMark';
import { useDiscoveryApps } from './useDiscoveryApps';

export interface AppLauncherProps {
  /** This app's deck registry name, to mark/sort "you are here". */
  currentApp?: string;
  /** Override the derived deck base URL (dev, custom domain). */
  deckBase?: string;
}

function sortApps(apps: DiscoveryApp[], currentApp?: string) {
  return [...apps].sort((a, b) => {
    if (currentApp) {
      if (a.name === currentApp) return -1;
      if (b.name === currentApp) return 1;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

function Tile({ app, current }: { app: DiscoveryApp; current: boolean }) {
  return (
    <Anchor
      href={app.url}
      underline="never"
      data-current={current}
      aria-label={app.displayName}
    >
      <Stack align="center" gap={4} p="xs">
        {app.icon ? (
          <Image src={app.icon} w={40} h={40} alt="" />
        ) : (
          <MattstackMark size={40} title="" />
        )}
        <Text size="xs" ta="center" lh={1.1}>
          {app.displayName}
        </Text>
      </Stack>
    </Anchor>
  );
}

/**
 * The shared cross-app switcher. Renders nothing when no deck base resolves
 * (an unrecognized origin with no `deckBase` override), so a non-mattstack
 * surface simply has no launcher rather than a dead button.
 */
export function AppLauncher({ currentApp, deckBase }: AppLauncherProps) {
  // Read bare `location` (not `window.location`) so a test can control the
  // origin with `vi.stubGlobal('location', ...)`; jsdom's default origin is
  // `localhost`, which would otherwise always resolve a base.
  const origin = typeof location === 'undefined' ? '' : location.origin;
  const base = deriveDeckBase(origin, deckBase);
  const { apps, loaded, refresh } = useDiscoveryApps(base);
  const [opened, handlers] = useDisclosure(false);
  const ordered = useMemo(
    () => sortApps(apps, currentApp),
    [apps, currentApp]
  );

  if (!base) return null;

  return (
    <Popover
      opened={opened}
      onChange={handlers.toggle}
      onOpen={refresh}
      position="bottom-end"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          size="lg"
          aria-label="Apps"
          onClick={handlers.toggle}
        >
          <MattstackMark size={24} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        {loaded && ordered.length === 0 ? (
          <Text size="sm" c="dimmed" p="xs">
            No apps
          </Text>
        ) : (
          <SimpleGrid cols={3} spacing="xs" w={240}>
            {ordered.map(app => (
              <Tile
                key={app.name}
                app={app}
                current={app.name === currentApp}
              />
            ))}
          </SimpleGrid>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/AppLauncher.test.tsx`
Expected: PASS (4/4). If the `ActionIcon` accessible name resolves to "Apps" but the MattstackMark `<title>` also contributes, keep the button's `aria-label="Apps"` authoritative (already set); adjust the query to `{ name: 'Apps' }` if the regex is ambiguous.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app/AppLauncher.tsx packages/ui/src/app/AppLauncher.test.tsx
git commit -m "app: add AppLauncher popover grid switcher"
```

---

### Task 5: Wire the launcher into `MattstackShell` + export the surface

**Files:**
- Modify: `packages/ui/src/app/MattstackShell.tsx`
- Modify: `packages/ui/src/app/index.ts`
- Test: `packages/ui/src/app/MattstackShell.test.tsx` (extend)

**Interfaces:**
- Consumes: `AppLauncher` (Task 4).
- Produces: `MattstackShellProps` gains `appName?: string` and `deckBase?: string`. When `appName` is set, the shell renders `<AppLauncher currentApp={appName} deckBase={deckBase} />` in the header's right slot. `index.ts` additionally exports `AppLauncher`, `AppLauncherProps`, `MattstackMark`, `MattstackMarkProps`, and the discovery types.

- [ ] **Step 1: Write the failing test** (append to `MattstackShell.test.tsx`)

```tsx
test('mounts the app launcher when appName is passed', () => {
  const { hook } = memoryLocation({ path: '/' });
  renderWithProviders(
    <Router hook={hook}>
      <MattstackShell name="Chat" appName="chat" deckBase="https://deck.mattstack">
        <main>page</main>
      </MattstackShell>
    </Router>
  );
  expect(
    within(screen.getByRole('banner')).getByRole('button', { name: 'Apps' })
  ).toBeInTheDocument();
});

test('omits the launcher when appName is absent', () => {
  const { hook } = memoryLocation({ path: '/' });
  renderWithProviders(
    <Router hook={hook}>
      <MattstackShell name="Chat">
        <main>page</main>
      </MattstackShell>
    </Router>
  );
  expect(
    within(screen.getByRole('banner')).queryByRole('button', { name: 'Apps' })
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/MattstackShell.test.tsx`
Expected: FAIL (no "Apps" button; `appName`/`deckBase` not accepted).

- [ ] **Step 3: Write minimal implementation**

In `MattstackShell.tsx`, extend the props and header. Add to `MattstackShellProps`:

```ts
  /** This app's deck registry name. When set, the header shows the shared
   *  app launcher marking this app as current. */
  appName?: string;
  /** Override the launcher's derived deck base URL (dev, custom domain). */
  deckBase?: string;
```

Import the launcher and `Group` is already imported; replace the header node:

```tsx
import { AppLauncher } from './AppLauncher';

// ...in Shell(), destructure appName and deckBase, then:
        header={
          <Group justify="space-between" w="100%" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              {mark}
              <Text fw={700} fz={22} lh={1} style={{ whiteSpace: 'nowrap' }}>
                {name}
              </Text>
            </Group>
            {appName && (
              <AppLauncher currentApp={appName} deckBase={deckBase} />
            )}
          </Group>
        }
```

In `index.ts`, add:

```ts
export { AppLauncher } from './AppLauncher';
export type { AppLauncherProps } from './AppLauncher';
export { MattstackMark } from './MattstackMark';
export type { MattstackMarkProps } from './MattstackMark';
export type { DiscoveryApp, DiscoveryResponse } from './deck-discovery';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui/src/app/MattstackShell.test.tsx`
Expected: PASS (existing tests + the 2 new ones). The existing "renders the wordmark, the mark, and the page" test still passes because the brand group is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app/MattstackShell.tsx packages/ui/src/app/index.ts packages/ui/src/app/MattstackShell.test.tsx
git commit -m "app: mount AppLauncher header-right when the shell gets an appName"
```

---

### Task 6: Full-suite + typecheck gate

**Files:**
- No new source. Verification only.

- [ ] **Step 1: Run the app-kit ui test suite**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bunx vitest run packages/ui`
Expected: all green, including the four new files and the extended shell test.

- [ ] **Step 2: Typecheck + lint the package (scoped, no probe)**

Run: `cd ~/Documents/GitHub/app-kit-launcher-wt && bun run --filter '@mattstack/app-kit' typecheck && bunx eslint packages/ui/src/app`
Expected: clean. Do NOT run the root `typecheck`/`lint` scripts here: they chain `probe:typecheck`/`probe:lint`, which require `probe:install` (tarball packing) first and are unrelated to this change. The package-scoped `typecheck` is `tsc -p tsconfig.json` in `packages/ui`.

- [ ] **Step 3: Commit any lint/type fixups**

```bash
git add -A
git commit -m "app: launcher suite green, typecheck + lint clean"
```

---

## Self-Review

**Spec coverage:** Section D trigger (Task 3 mark + Task 4 trigger), popover grid (Task 4), data/deckBase derivation (Task 1) + fetch-on-open + caches briefly + never-throws (Task 2/4), props `currentApp`/`deckBase` (Task 4), shell wiring via `appName` + right slot (Task 5), navigation as plain anchors (Task 4 `Tile`). Section G testing: `deriveDeckBase` origin cases (Task 1), fetch mock + empty/failed (Task 2/4), grid + current-app mark + null render (Task 4). Board-as-a-tile is a deck-data concern (board ships a `mattstack.json`), out of app-kit scope. Manual cross-link verification is Task 6-adjacent + the deploy step, tracked at hand-off.

**Placeholder scan:** none. Every step carries real code or a concrete command.

**Type consistency:** `DiscoveryApp` shape identical across Tasks 1/2/4; `deriveDeckBase(origin, override?)` signature stable; `useDiscoveryApps(base)` returns `{ apps, loaded, refresh }` consumed exactly in Task 4; `AppLauncherProps` `{ currentApp?, deckBase? }` matches the spec and the shell forward in Task 5.

**Open implementer choice (non-blocking, flagged for review):** the `m` fidelity (monospace text vs. traced path) in Task 3; and whether the "No apps" note or a hidden trigger is the better empty-state (plan chose the muted note so the button is never dead-on-click). Both are cosmetic and reversible.
