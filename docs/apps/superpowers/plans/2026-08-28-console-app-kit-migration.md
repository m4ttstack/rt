# Console → `@mattstack/app-kit` Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace console's vendored `src/ui` kit with the `@mattstack/app-kit` + `@mattstack/app-server` packages, delete console's locally-hosted `packages/mantine-tokyo` in favour of the packaged tokyo, drive the embedded/`build:binary` path through the package, and mount `MattstackShell` with `appName="console"` so the shared `<AppLauncher>` renders in console's header (fed by the live deck `/api/apps`).

**Architecture:** Console becomes a thin app-kit consumer like `app-kit/probe` and the just-migrated chat: `main.tsx` → `mountMattstackApp`, `server/index.ts` → `serveMattstackApp` (with its `embedded` option and the `mattstack-embed-assets` bin driving `build:binary`), config files → the app-kit presets, all `@ui/*` imports → `@mattstack/app-kit/*` subpaths. Console's product code already lives under `src/app/` (chrome, palette, routes, runs, wiring, config) and its server handlers under `src/server/`, so there is **no product-file move** (unlike chat) — `src/ui/` is deleted wholesale. `ConsoleChrome`'s hand-wired `RailShell` is replaced by `MattstackShell`; `ConsolePalette` (⌘K spotlight) is preserved with an import repoint; the custom `WiringRailEntry` (attention-count badge) is rebuilt on `RailLink` + the shell's `useShellRail` context. Storybook is dropped (the kit's stories moved to app-kit; console has no product stories).

**Tech Stack:** React 19, Mantine 9.5, `@mattstack/app-kit` 0.1.4 + `@mattstack/app-server` 0.1.0 + `@mattstack/mantine-tokyo` 0.2.0 (consumed as packed tarballs), Hono 4, wouter 3, Vitest 4 (jsdom), Bun.

**Spec:** `~/Documents/GitHub/app-kit/docs/superpowers/specs/2026-08-26-app-kit-design.md` (section C `@mattstack/app-server` incl. embedded; section D Migration → "console (later)"). This plan reconciles that design with console's _current_ post-#16 `main` (`a5134b9`, which added `mattstack.json` since the spec was written) and applies the three consumer requirements the spec predates.

## Global Constraints

- **Base commit is `a5134b9`** (console origin/main, "Merge PR #16 add mattstack.json"). Work happens in the worktree `~/Documents/GitHub/console-app-kit-wt` on branch `feat/app-kit-migration`. The `mattstack.json` launcher manifest already exists at the repo root — do NOT add or modify it.
- **Reference implementation is `app-kit/probe` + the chat migration** (`~/Documents/GitHub/chat` on `main`). Every consumer file (`main.tsx`, `server/index.ts`, `server/routes.ts`, `vite.config.ts`, `tsconfig.json`, `vitest.setup.ts`, `eslint.config.js`) mirrors probe/chat, scaled to console's real product code. When in doubt, match chat.
- **Consumer requirement 1 — packed tarballs, not bare `file:` dirs.** Vendor the three packages with `bun pm pack` into `console/vendor/` and depend on them as `file:./vendor/mattstack-<pkg>-<ver>.tgz`. Console's existing `@mattstack/rt-client` stays a bare `file:../repo-tools/packages/rt-client` (out-of-tree sibling; unchanged by this migration).
- **Consumer requirement 2 — `app-icons.d.ts` N/A for console.** Console registers NO custom icons (verified: all 21 icon names it uses are kit built-ins). Do NOT create `src/app/icons.ts` or `src/app/app-icons.d.ts`, and do NOT add an `import './app/icons'` to `main.tsx`.
- **Consumer requirement 3 — the `.js` vite preset.** `vite.config.ts` imports `mattstackVite` from `@mattstack/app-kit/vite`; NO `--configLoader` flag on any Vite/Vitest invocation.
- **Mantine wall stays.** App code imports Mantine primitives only through `@mattstack/app-kit/*` barrels, never raw `@mantine/*` (enforced by the app-kit eslint preset). Console has no direct raw-lucide import (its icons go through the `@mattstack/app-kit/icons` registry/namespace), so no `eslint-disable` is needed.
- **rt side is unchanged.** Same daemon, same `run-updated` event topic, same `runs` Bun pub/sub topic, port 11011. The relay payload (`JSON.stringify(data)`) is byte-identical between console's old `startRelay` and the package's `createRelay`.
- **Binary stays console-only.** Do NOT bundle chat into the console binary; migrate 1:1. The binary artifact remains `dist-bin/console`.
- **Keep `purity.yml` + `scripts/repo-purity.sh` untouched** (console's public-tree hygiene, unrelated to the kit). Drop only `debrand` + `treeshake`.
- **Clean-code comments.** A comment states a constraint the code cannot show. No narration, no migration-process citations in source.
- **Verification is per-task where a suite exists** (`bunx vitest run <path>`), and a full gate at the end. Do NOT run the app in a browser; the launcher-renders check is a manual note for the human at PR time.

---

### Task 1: app-kit — export `useShellRail`, bump ui to 0.1.4

This task edits the **app-kit repo** (`~/Documents/GitHub/app-kit`), NOT the console worktree. It exposes the shell's rail context as a public extension point so console's custom `WiringRailEntry` (an `Indicator` badge that is its own link) can close the rail on mobile — the same `close` `RailLink` already consumes internally.

**Files:**

- Modify: `~/Documents/GitHub/app-kit/packages/ui/src/app/index.ts`
- Modify: `~/Documents/GitHub/app-kit/packages/ui/package.json` (version `0.1.3` → `0.1.4`)
- Test: `~/Documents/GitHub/app-kit/packages/ui/src/app/MattstackShell.test.tsx`

**Interfaces:**

- Produces: `useShellRail(): { expanded: boolean; close: () => void }` and type `ShellRailState`, exported from `@mattstack/app-kit/app`.

- [ ] **Step 1: Add the export**

In `packages/ui/src/app/index.ts`, append:

```ts
export { useShellRail } from './shell-context';
export type { ShellRailState } from './shell-context';
```

(`useShellRail` and `ShellRailState` already exist in `packages/ui/src/app/shell-context.ts`; this only makes them public. `RailLink` already imports the hook from that module.)

- [ ] **Step 2: Add a failing test asserting the export**

In `MattstackShell.test.tsx`, add:

```tsx
import { useShellRail } from '@mattstack/app-kit/app';

test('useShellRail is exported and defaults to a closed rail', () => {
  const seen: { expanded: boolean } = { expanded: true };
  function Probe() {
    seen.expanded = useShellRail().expanded;
    return null;
  }
  render(<Probe />);
  expect(seen.expanded).toBe(false); // default context: collapsed
});
```

Run: `cd ~/Documents/GitHub/app-kit && bunx vitest run packages/ui/src/app/MattstackShell.test.tsx`
Expected before Step 1's export lands: FAIL (`useShellRail` is not exported). After: PASS.

- [ ] **Step 3: Bump the package version**

In `packages/ui/package.json`, change `"version": "0.1.3"` to `"version": "0.1.4"`.

- [ ] **Step 4: Verify app-kit is still green**

```bash
cd ~/Documents/GitHub/app-kit
bunx vitest run packages/ui/src/app
bun run --filter '@mattstack/app-kit' typecheck 2>/dev/null || (cd packages/ui && bunx tsc -p tsconfig.json --noEmit)
```

Expected: PASS / clean. If the repo has a top-level `typecheck`/`lint` script, run those instead; the export must resolve.

- [ ] **Step 5: Commit (to app-kit `main`)**

```bash
cd ~/Documents/GitHub/app-kit
git add packages/ui/src/app/index.ts packages/ui/src/app/MattstackShell.test.tsx packages/ui/package.json
git commit -m "app-kit: export useShellRail for custom rail entries, bump ui 0.1.4"
```

Do NOT push; Matt handles app-kit pushes. Record the commit SHA in the ledger — Task 2 packs this version.

---

### Task 2: Remove hosted `packages/mantine-tokyo`, vendor the tarballs, rewrite deps

All remaining tasks run in the console worktree `~/Documents/GitHub/console-app-kit-wt`.

**Files:**

- Delete: `packages/mantine-tokyo/` (the whole directory), `src/app/styles/tokyo-ramps.test.ts`, `src/app/styles/tokyo-theme.test.ts`
- Create: `vendor/` (three `.tgz` files, committed — match chat's committed-tarball choice)
- Modify: `package.json`

**Interfaces:**

- Produces: a resolvable dependency graph with `@mattstack/app-kit` 0.1.4, `@mattstack/app-server` 0.1.0, `@mattstack/mantine-tokyo` 0.2.0 as tarballs; the kit-internal deps dropped.

- [ ] **Step 1: Pack the three app-kit packages into `vendor/`** (app-kit ui must be at 0.1.4 from Task 1)

```bash
cd ~/Documents/GitHub/console-app-kit-wt
mkdir -p vendor
(cd ~/Documents/GitHub/app-kit/packages/tokyo  && bun pm pack --destination ~/Documents/GitHub/console-app-kit-wt/vendor --quiet)
(cd ~/Documents/GitHub/app-kit/packages/ui     && bun pm pack --destination ~/Documents/GitHub/console-app-kit-wt/vendor --quiet)
(cd ~/Documents/GitHub/app-kit/packages/server && bun pm pack --destination ~/Documents/GitHub/console-app-kit-wt/vendor --quiet)
ls vendor/   # expect: mattstack-mantine-tokyo-0.2.0.tgz, mattstack-app-kit-0.1.4.tgz, mattstack-app-server-0.1.0.tgz
```

If a filename's version differs from the expected above, STOP and reconcile (Task 1 must have bumped ui to 0.1.4; tokyo is 0.2.0, server is 0.1.0).

- [ ] **Step 2: Delete the hosted tokyo package and its now-orphaned tests**

The tokyo package moved into app-kit (`@mattstack/mantine-tokyo` 0.2.0); console consumes the tarball. The two ramp tests read `../../../packages/mantine-tokyo/src/tokyo-theme.css` by relative path and break once the directory is gone — the tokyo package owns its own tests in app-kit now.

```bash
cd ~/Documents/GitHub/console-app-kit-wt
git rm -r packages/mantine-tokyo
git rm src/app/styles/tokyo-ramps.test.ts src/app/styles/tokyo-theme.test.ts
```

- [ ] **Step 3: Rewrite `package.json` dependencies**

In `dependencies`:

- Change `"@mattstack/mantine-tokyo"` from `"file:./packages/mantine-tokyo"` to `"file:./vendor/mattstack-mantine-tokyo-0.2.0.tgz"`.
- Add:
  ```jsonc
  "@mattstack/app-kit": "file:./vendor/mattstack-app-kit-0.1.4.tgz",
  "@mattstack/app-server": "file:./vendor/mattstack-app-server-0.1.0.tgz",
  ```
- Keep: all eight `@mantine/*` peers (`code-highlight`, `core`, `dates`, `form`, `hooks`, `modals`, `notifications`, `spotlight`), `@mattstack/rt-client` (`file:../repo-tools/packages/rt-client`), `@tanstack/react-query`, `hono`, `react`, `react-dom`, `react-interval-hook`, `wouter`, `zod`.
- DROP (kit internals; verified zero direct imports in `src/app`): `@codemirror/commands`, `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/state`, `@codemirror/view`, `codemirror`, `@tanstack/react-virtual`, `clsx`, `dayjs`, `lucide-react`, `mantine-form-zod-resolver`.

In `devDependencies`, DROP the storybook toolchain (Task 4 removes storybook): `@chromatic-com/storybook`, `@storybook/addon-a11y`, `@storybook/addon-docs`, `@storybook/react-vite`, `eslint-plugin-storybook`, `storybook`. Keep everything else.

- [ ] **Step 4: Install and verify no peer duplication**

```bash
cd ~/Documents/GitHub/console-app-kit-wt
bun install
bun pm ls 2>/dev/null | grep -E "react@|vite@|wouter@" | sort -u
```

Expected: install succeeds; one copy each of react/vite/wouter. If a peer is duplicated, STOP and report — the tarball packing is the fix, not a resolution override.

Known warning (not a failure): `@mattstack/app-server` declares peer `@mattstack/rt-client@^0.6`; console's `file:` rt-client may report a different version, printing an unmet-peer warning. Runtime is fine (console already uses the same `subscribe`/`createRelay` surface). Confirm install still succeeds; do not "fix" it.

- [ ] **Step 5: Commit**

```bash
git add package.json vendor packages src/app/styles
git commit -m "console: vendor app-kit tarballs, drop hosted packages/mantine-tokyo"
```

---

### Task 3: Swap config files for the app-kit presets, rewrite scripts

**Files:**

- Modify: `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `package.json` (scripts)
- Replace: `tsconfig.json` (collapse the `app`/`node`/`tools` split into one)
- Delete: `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.tools.json`, `eslint-local/`, `scripts/treeshake-check.sh`, `scripts/treeshake-probe/`, `scripts/debrand-check.sh`, `src/jest-dom.d.ts`

**Interfaces:**

- Consumes: `@mattstack/app-kit/{vite,eslint,tsconfig.base.json,test-utils}` (installed in Task 2).
- Produces: config with no `@ui` alias and no storybook/embedded/treeshake/debrand scripts.

- [ ] **Step 1: `vite.config.ts`** — replace with the preset (console's API port is 11011; the preset supplies the react/mantine/codemirror codeSplitting groups, the `/api`+`/ws` proxy, `PREVIEW_ALLOWED_HOSTS`, and the vitest jsdom block):

```ts
import { mattstackVite } from '@mattstack/app-kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(mattstackVite({ apiPort: 11011 }));
```

- [ ] **Step 2: `tsconfig.json`** — single config extending the base (mirrors chat):

```jsonc
{
  "extends": "@mattstack/app-kit/tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
  },
  "include": ["src", "vite.config.ts", "vitest.setup.ts"],
}
```

Delete `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.tools.json`. No `@ui/*` `paths` entry anywhere. The base's `types` already includes `@testing-library/jest-dom`, so delete `src/jest-dom.d.ts`.

- [ ] **Step 3: `vitest.setup.ts`** — use the package's polyfills (mirrors chat):

```ts
import '@testing-library/jest-dom/vitest';

import { installJsdomPolyfills } from '@mattstack/app-kit/test-utils';

installJsdomPolyfills();
if (typeof window !== 'undefined') window.scrollTo = () => {};
```

(If console's current `vitest.setup.ts` has extra lines beyond jsdom polyfills, read it first and preserve any app-specific setup on top of this base.)

- [ ] **Step 4: `eslint.config.js`** — use the preset; delete `eslint-local/`:

```js
import { mattstackEslint } from '@mattstack/app-kit/eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(...mattstackEslint());
```

The preset carries the same import wall (Mantine barrels, lucide/react-icons/codemirror bans, the `src/server` browser guard) plus the `local/no-inline-styles` and `local/require-data-testid` rules that `eslint-local/` held. Delete `eslint-local/` and drop the `eslint-plugin-storybook` import/usage. If console's app-scoped wall added a `@mattstack/rt-client` value-import ban (identity-only), confirm the preset already covers it; if console needs that extra scope, layer it on top of `mattstackEslint()` rather than replacing the preset.

- [ ] **Step 5: Rewrite `package.json` scripts**

Target scripts block:

```jsonc
"scripts": {
  "dev": "vite",
  "build": "tsc -p tsconfig.json && vite build",
  "preview": "vite preview",
  "serve": "bun run src/server/index.ts",
  "dev:server": "bun run --hot src/server/index.ts",
  "build:binary": "vite build && mattstack-embed-assets && bun build --compile --outfile dist-bin/console src/server/index.ts",
  "typecheck": "tsc -p tsconfig.json",
  "lint": "eslint src",
  "test": "vitest",
  "format": "prettier --write . --cache",
  "format:check": "prettier --check . --cache"
}
```

Removed: `generate:embedded` (the `mattstack-embed-assets` bin replaces it), `storybook`, `build-storybook`, `debrand`, `treeshake`. `build:binary` now calls the package bin instead of `bun run generate:embedded`.

- [ ] **Step 6: Delete the treeshake + debrand scripts**

```bash
cd ~/Documents/GitHub/console-app-kit-wt
git rm -r scripts/treeshake-check.sh scripts/treeshake-probe scripts/debrand-check.sh 2>/dev/null || true
```

(Leave `scripts/generate-embedded-assets.ts` for Task 7, which deletes it alongside the server rewrite. Leave `scripts/repo-purity.sh` and `scripts/make-icon.swift` untouched.)

- [ ] **Step 7: Commit** (config only — the suite will not pass until Tasks 4-8 land; that is expected):

```bash
git add -A && git commit -m "console: swap config for app-kit presets, rewrite scripts"
```

---

### Task 4: Delete the vendored kit, the boot module, and Storybook

**Files:**

- Delete: `src/ui/` (entire directory — pure kit, no product code), `src/boot/`, `.storybook/`, `src/app/styles/tokyo-theme.css`

**Interfaces:**

- Produces: a tree whose only remaining `@ui/*` references are import specifiers (rewritten in Task 5) and `src/main.tsx` (rewritten in Task 6).

- [ ] **Step 1: Delete the kit, boot, storybook, and the orphaned tokyo stylesheet**

```bash
cd ~/Documents/GitHub/console-app-kit-wt
git rm -r src/ui src/boot .storybook src/app/styles/tokyo-theme.css
# src/app/styles/ should now be empty (its two tests + the css are gone):
rmdir src/app/styles 2>/dev/null || true
```

`src/app/styles/tokyo-theme.css` only `@import`ed the tokyo package CSS and was pulled in via the deleted `src/ui/styles/index.css`; `mountMattstackApp` loads the package's `styles.css` (which includes Tokyo) from Task 6, so nothing app-side needs it.

- [ ] **Step 2: Commit** (the tree will not build yet — product files still reference the deleted kit until Task 5):

```bash
git commit -m "console: delete vendored kit, boot module, storybook"
```

---

### Task 5: Rewrite `@ui/*` imports to `@mattstack/app-kit/*`

**Files:** every `src/**/*.{ts,tsx}` that imported `@ui/*` (barrels used: `core`×69, `icons`×47, `hooks`×47, `storybook`×43, `modals`×12, `design-system`×9, `notifications`×7, `spotlight`×4, `styles`×2, `utils`×1, `lazy`×1, `forms`×1), excluding `src/main.tsx` (Task 6 rewrites it wholesale).

**Interfaces:**

- Produces: zero `@ui/` specifiers remaining outside `src/main.tsx`.

- [ ] **Step 1: Rewrite the barrel specifiers** (mechanical, one-to-one):

```bash
cd ~/Documents/GitHub/console-app-kit-wt
grep -rl "@ui/" src | grep -v "src/main.tsx" | xargs sed -i '' -E \
  "s#@ui/(core|icons|hooks|modals|notifications|spotlight|lazy|forms|utils|design-system)#@mattstack/app-kit/\1#g"
```

- [ ] **Step 2: Rewrite the storybook test-util specifiers**

`@ui/storybook/test-utils` (and any `@ui/storybook/jsdom-polyfills`) → `@mattstack/app-kit/test-utils` (where `renderWithProviders` and the jsdom polyfills live):

```bash
grep -rl "@ui/storybook" src | xargs sed -i '' -E "s#@ui/storybook/[a-zA-Z-]+#@mattstack/app-kit/test-utils#g"
```

- [ ] **Step 3: Verify no `@ui/` remains outside `src/main.tsx`**

```bash
grep -rn "@ui/" src | grep -v "^src/main.tsx:" \
  && echo "STILL HAS @ui outside main.tsx — fix before commit" || echo "clean: only src/main.tsx (Task 6) remains"
```

If any deep specifier survived (e.g. `@mattstack/app-kit/hooks/<name>` produced by a pre-existing deep import), flatten it to the barrel (`@mattstack/app-kit/hooks`). The `@ui/styles/index.css` import lives only in `src/main.tsx` and is dropped in Task 6.

- [ ] **Step 4: Typecheck to surface any specifier that resolved to a moved/renamed export**

```bash
bun run typecheck 2>&1 | head -40
```

Expected: it will still error on `src/main.tsx`, `src/app/App.tsx`, the server, and the `WiringRailEntry`/chrome files that Tasks 6-7 rewrite. Note any OTHER unexpected error (a kit export console used that the package renamed) and fix the specifier. Do not fix the Task 6/7 files here.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "console: rewrite @ui imports to @mattstack/app-kit subpaths"
```

---

### Task 6: Shell, entry, and the custom Wiring rail entry

**Files:**

- Rewrite: `src/main.tsx`, `src/app/App.tsx`, `src/app/wiring/WiringRailEntry.tsx`, `src/app/wiring/WiringRailEntry.test.tsx`
- Delete: `src/app/chrome/ConsoleChrome.tsx`, `src/app/chrome/ConsoleChrome.test.tsx` (replaced by `MattstackShell`); remove `src/app/chrome/` if it is then empty
- Test: `src/app/App.test.tsx` (adjust to the new shell)

**Interfaces:**

- Consumes: `mountMattstackApp`, `MattstackShell`, `useShellRail` from `@mattstack/app-kit/app`; `RailLink`, `Link` from `@mattstack/app-kit/router`; `Indicator` from `@mattstack/app-kit/core`.
- Produces: console rendering inside `MattstackShell` with `appName="console"`, so `<AppLauncher>` mounts header-right.

- [ ] **Step 1: `main.tsx`** — collapse to the probe/chat shape. `mountMattstackApp` brackets the render with `registerSimpleAlerts()`/`markMounted()` internally and applies the base+Tokyo theme + `#root` target, so `main.tsx` drops the providers, the `@ui/design-system` theme, the boot import, and the `@ui/styles/index.css` import. Console's one customization is the notification height:

```tsx
import { mountMattstackApp } from '@mattstack/app-kit/app';

import { App } from './app/App';

mountMattstackApp(<App />, { notificationMaxHeight: 400 });
```

(No `import './app/icons'` — console registers no custom icons. `MountOptions.notificationMaxHeight` is confirmed present in `packages/ui/src/app/mount.tsx`, and its default is already `400` — passing `{ notificationMaxHeight: 400 }` is explicit-but-redundant, so `mountMattstackApp(<App />)` alone is equally correct; keep the explicit form to mirror console's current intent.)

- [ ] **Step 2: `App.tsx`** — replace `ConsoleChrome` with `MattstackShell`. Keep `QueryClientProvider`, `ConsolePalette`, `RouteErrorBoundary`, `RouteContent`, and the `chromeSection(route)` active-section logic (move the `ConsoleSection` type + `chromeSection` inline into `App.tsx`, since `ConsoleChrome.tsx` is deleted). The shell owns the header (mark + wordmark + launcher) and the color-scheme control:

```tsx
import { Component, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLocation } from 'wouter';

import { GenericError, PageShell } from '@mattstack/app-kit/core';
import { MattstackShell } from '@mattstack/app-kit/app';
import { RailLink } from '@mattstack/app-kit/router';
import { ExplainKeyPage } from './config/ExplainKeyPage';
import { NotFoundPage } from './NotFoundPage';
import { ConsolePalette } from './palette/ConsolePalette';
import { useAppRoute, type AppRoute } from './routes';
import { RunBoard } from './runs/RunBoard';
import { RunDetail } from './runs/RunDetail';
import { RunSearch } from './runs/RunSearch';
import { WiringMap } from './wiring/WiringMap';
import { WiringRailEntry } from './wiring/WiringRailEntry';

const queryClient = new QueryClient();

type ConsoleSection = 'runs' | 'search' | 'wiring';

function chromeSection(route: AppRoute): ConsoleSection | null {
  if (route.name === 'search') return 'search';
  if (route.name === 'wiring') return 'wiring';
  if (route.name === 'not-found') return null;
  if (route.name === 'config') return null;
  return 'runs';
}

// (RouteErrorBoundary and RouteContent are UNCHANGED from the current file —
// keep them verbatim.)

export function App() {
  const [path] = useLocation();
  const route = useAppRoute();
  const section = chromeSection(route);

  return (
    <QueryClientProvider client={queryClient}>
      <ConsolePalette />
      <MattstackShell
        name="console"
        appName="console"
        mark={
          <img
            src="/favicon.svg"
            alt=""
            width={30}
            height={30}
            style={{ display: 'block', flex: 'none' }}
          />
        }
      >
        <MattstackShell.Rail>
          <RailLink icon="layers" label="Runs" href="/" active={section === 'runs'} />
          <RailLink icon="search" label="Search" href="/search" active={section === 'search'} />
          <WiringRailEntry active={section === 'wiring'} />
        </MattstackShell.Rail>
        <RouteErrorBoundary key={path}>
          <RouteContent route={route} />
        </RouteErrorBoundary>
      </MattstackShell>
    </QueryClientProvider>
  );
}
```

`name="console"` is lowercase (the shell renders it as the 22/700 wordmark; the favicon `mark` reproduces console's current 30px header art). The shell's built-in `ColorSchemeControl` (System/Light/Dark) replaces `ConsoleChrome`'s hand-wired sun/moon `HybridMenu`. `RailLink` reads `expanded`/`close` from the shell context, so the Runs/Search entries need only `icon`/`label`/`href`/`active`. `NotFoundPage` stays console's own (`src/app/NotFoundPage.tsx`, already `@ui`→package-repointed in Task 5, still wrapped in `PageShell` by `RouteContent`).

- [ ] **Step 3: `WiringRailEntry.tsx`** — rebuild on `RailLink` + `useShellRail`. The primary entry becomes a `RailLink` (closes the rail itself); the attention badge stays an `Indicator`-hosted `Link` and now reads `close` from the shell context (Task 1's export) instead of an `onClick` prop. The component takes only `active`:

```tsx
import { Indicator } from '@mattstack/app-kit/core';
import { useShellRail } from '@mattstack/app-kit/app';
import { Link, RailLink } from '@mattstack/app-kit/router';
import { WIRING_ATTENTION_HREF, WIRING_HREF } from './attentionFilter';
import { useAttentionCount } from './useWiring';

export interface WiringRailEntryProps {
  active: boolean;
}

/**
 * The Wiring rail entry plus the count of rows needing attention. `RailLink`
 * carries the entry to /wiring and closes the rail on click; the count rides
 * an `Indicator` whose label is its own link to the attention-filtered view,
 * closing the rail through the shell context so a mobile tap doesn't leave
 * the overlay open behind the filtered page.
 */
export function WiringRailEntry({ active }: WiringRailEntryProps) {
  const count = useAttentionCount();
  const { close } = useShellRail();

  const entry = (
    <RailLink icon="zap" label="Wiring" href={WIRING_HREF} active={active} />
  );

  if (count === 0) return entry;

  return (
    <Indicator
      color="warn"
      size={16}
      offset={6}
      position="top-end"
      label={
        <Link
          href={WIRING_ATTENTION_HREF}
          onClick={close}
          aria-label={`${count} need attention — show only those`}
          data-testid="drift-badge"
          style={{
            color: 'inherit',
            font: 'inherit',
            textDecoration: 'none',
            padding: '0 2px',
          }}
        >
          {count}
        </Link>
      }
    >
      {entry}
    </Indicator>
  );
}
```

- [ ] **Step 4: Delete `ConsoleChrome`**

```bash
cd ~/Documents/GitHub/console-app-kit-wt
git rm src/app/chrome/ConsoleChrome.tsx src/app/chrome/ConsoleChrome.test.tsx
rmdir src/app/chrome 2>/dev/null || true
```

`CONSOLE_HEADER_HEIGHT` (64) is dropped — it equalled `MATTSTACK_HEADER_HEIGHT`, the shell's default. If any file other than the deleted chrome imported `CONSOLE_HEADER_HEIGHT` or `ConsoleSection` from `./chrome/ConsoleChrome`, the Task 5 typecheck or Step 6 below surfaces it; re-point to the shell default / the inline `chromeSection` respectively.

- [ ] **Step 5: Rework the tests**

- `WiringRailEntry.test.tsx`: it renders the entry outside a shell, so wrap the render in a `MattstackShell` (or a `ShellRailContext` provider is no longer public — use `MattstackShell` from `@mattstack/app-kit/app` with a `MattstackShell.Rail` around the entry) OR render it directly and assert the default context (collapsed, no-op close). Update its props (`{ active }` only; the old `expanded`/`onClick` are gone). Keep the count-badge assertions (zero → no `drift-badge`; nonzero → `drift-badge` link to `WIRING_ATTENTION_HREF`).
- `App.test.tsx`: read it first. Remove/rework any assertion tied to `ConsoleChrome`'s deleted sun/moon scheme toggle. Assertions that survive: the routed content renders, the wordmark `getByText('console')`, and (new, optional) the launcher trigger `getByLabelText('Apps')`. Adjust the render tree if the test mounted `ConsoleChrome` directly.

- [ ] **Step 6: Run the shell tests**

```bash
bunx vitest run src/app/App.test.tsx src/app/wiring/WiringRailEntry.test.tsx
```

Expected: PASS after the reworks.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "console: mount MattstackShell (appName=console), rebuild Wiring rail entry"
```

---

### Task 7: Server — routes + `serveMattstackApp` + embedded via the package

**Files:**

- Create: `src/server/routes.ts`
- Rewrite: `src/server/index.ts`
- Modify: `src/app/api.ts` (repoint the `AppType` type import off the deleted `../server/app`)
- Delete: `src/server/app.ts`, `src/server/ws.ts`, `src/server/static-disk.ts`, `src/server/embedded/{compiled-binary,manifest-loader,mount,serve,serving-mode,types}.ts` and every `*.test.ts` beside them; `scripts/generate-embedded-assets.ts`
- Delete tests: `src/server/app.test.ts`, `src/server/ws.test.ts`, `src/server/static-disk.test.ts`, `src/server/embedded/*.test.ts`
- Keep: `src/server/{runs,enrich,settings,skills,effectiveInputs,artifact,gitLog,seen,rt-bin,git-bin}.ts` and their tests
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `serveMattstackApp` from `@mattstack/app-server` (provides `/api/health`, `/api/daemon`, SPA static in disk OR embedded mode, `/ws` relay, `{ error }` 404/onError envelope, binds `127.0.0.1`, `decideServingMode` fatal-on-compiled-binary-without-manifest).
- Produces: console served on `127.0.0.1:11011` with its `/api/*` routes, the `run-updated`→`runs` relay, and package-driven embedded serving.

- [ ] **Step 1: `routes.ts`** — the app-specific Hono chain only (drop `/api/health`, `notFound`, `onError` — the package's `createApp` supplies all three; console's client never calls `/api/health`, verified):

```ts
import { Hono } from 'hono';

import { mountEffectiveInputs } from './effectiveInputs';
import { enrich } from './enrich';
import { runs } from './runs';
import { settings } from './settings';
import { mountSkills } from './skills';

/**
 * Routes are CHAINED and handlers INLINE, both load-bearing for Hono's RPC
 * inference: a handler lifted into a named function loses path-param typing,
 * and an unchained `app.get(...)` never reaches `typeof routes`.
 */
export const routes = new Hono()
  .route('/', runs)
  .route('/', enrich)
  .route('/', settings)
  .route('/', mountSkills(new Hono()))
  .route('/', mountEffectiveInputs(new Hono()));

export type AppType = typeof routes;
```

- [ ] **Step 1b: Repoint the client's `AppType` import** — `src/app/api.ts` does `import type { AppType } from '../server/app'`, and this task deletes `../server/app`. Change that line to:

```ts
import type { AppType } from '../server/routes';
```

`AppType` is still `typeof routes`, so the `hc<AppType>('/')` RPC client typing is unchanged. `src/app/api.ts` is the ONLY surviving importer of `../server/app` (the other two are `index.ts`, rewritten this task, and `app.test.ts`, deleted this task), so this single repoint fully closes the deletion — without it, `bun run typecheck`/`bun run build` fail at the Task 9 gate on a missing module.

- [ ] **Step 2: `index.ts`** — replace the hand-wired server with `serveMattstackApp`:

```ts
import { serveMattstackApp } from '@mattstack/app-server';

import pkg from '../../package.json' with { type: 'json' };
import { routes } from './routes';

await serveMattstackApp({
  name: 'console',
  version: pkg.version,
  routes,
  port: 11011,
  relay: [{ match: t => t === 'run-updated', topic: 'runs' }],
  // `as string` keeps TS from resolving the gitignored, build-time-only
  // manifest; `bun build --compile` still sees the literal and embeds it.
  embedded: () => import('./embedded/manifest' as string),
});
```

The relay is byte-for-byte console's old `startRelay` (`createRelay` filters `type==='event'` and `frame.topic==='run-updated'`, then `publish('runs', JSON.stringify(data))`). `serveMattstackApp` internally runs `loadEmbeddedManifest` → `decideServingMode` (fatal if a compiled binary has no manifest) → `mountStatic` in disk or embedded mode → `/ws` upgrade subscribing each socket to `runs` → `Bun.serve({ hostname: '127.0.0.1' })` → SIGINT/SIGTERM cleanup.

- [ ] **Step 3: Delete the superseded server modules + the codegen script**

```bash
cd ~/Documents/GitHub/console-app-kit-wt
git rm src/server/app.ts src/server/app.test.ts \
       src/server/ws.ts src/server/ws.test.ts \
       src/server/static-disk.ts src/server/static-disk.test.ts \
       scripts/generate-embedded-assets.ts
git rm src/server/embedded/compiled-binary.ts src/server/embedded/compiled-binary.test.ts \
       src/server/embedded/manifest-loader.ts src/server/embedded/manifest-loader.test.ts \
       src/server/embedded/mount.ts src/server/embedded/mount.test.ts \
       src/server/embedded/serve.ts src/server/embedded/serve.test.ts \
       src/server/embedded/serving-mode.ts src/server/embedded/serving-mode.test.ts \
       src/server/embedded/types.ts 2>/dev/null || true
# Any leftover *.test.ts under embedded/ that named a now-deleted target:
git rm src/server/embedded/*.test.ts 2>/dev/null || true
ls src/server/embedded 2>/dev/null || echo "embedded/ now holds only the build-time manifest (gitignored)"
```

The `mattstack-embed-assets` bin writes the generated manifest to `src/server/embedded/manifest.ts` at `build:binary` time — the directory stays, but its only future content is that gitignored file. If a test file remains that imported a deleted module, delete it (its target lives in `@mattstack/app-server` now, tested there).

- [ ] **Step 4: `.gitignore`** — the generated manifest path changed from `src/server/embedded/generated/` to `src/server/embedded/manifest.ts`:

Replace the console line ignoring `src/server/embedded/generated/` with:

```
src/server/embedded/manifest.ts
```

If a comment above that ignore line references the deleted `generate:embedded` script or the old `generated/` path, update or remove it so it doesn't dangle. Keep the existing `dist/`, `dist-bin/`, `node_modules/` ignores. If `src/server/embedded/generated/` still exists on disk from an old build, `git rm -r --cached` it and delete the directory.

- [ ] **Step 5: Run the surviving server tests**

```bash
bunx vitest run src/server
```

Expected: PASS. The remaining tests target the app-specific route handlers (`runs`, `settings`, `skills`, `effectiveInputs`, `enrich`) and helpers, which are unchanged. If a route test imported `app` from `./app`, re-point it to `./routes` (import `routes`, wrap in the package's `createApp` if it needs the `/api/health`/404 floor, or test the sub-router directly).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "console: serve via @mattstack/app-server, embedded through the package bin"
```

---

### Task 8: `index.html` loading-bar sync

**Files:**

- Modify: `index.html` (loading-bar block matches the package's)
- Create: `src/loading-bar-sync.test.ts`

**Interfaces:**

- Consumes: `expectLoadingBarInSync` from `@mattstack/app-kit/test-utils`.

- [ ] **Step 1: Add the sync test** (mirrors chat/probe):

```ts
import { readFileSync } from 'node:fs';
import { expectLoadingBarInSync } from '@mattstack/app-kit/test-utils';
import { expect, test } from 'vitest';

test('index.html inlines the package loading-bar block', () => {
  expect(() =>
    expectLoadingBarInSync(readFileSync('index.html', 'utf-8'))
  ).not.toThrow();
});
```

- [ ] **Step 2: Reconcile `index.html`** — run the test; if it fails, replace console's inline loading-bar `<style>`/markup block with the package's canonical block (the error names the expected content). Keep the rest of `index.html` (`#root`, the `src/main.tsx` entry script, title, favicon links).

```bash
bunx vitest run src/loading-bar-sync.test.ts
```

Expected: PASS after the block matches.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "console: sync index.html loading-bar with the package block"
```

---

### Task 9: CI, docs, and the full verification gate

**Files:**

- Modify: `.github/workflows/ci.yml`, `README.md`, `AGENTS.md`
- No source changes beyond fixups the gate surfaces.

**Interfaces:**

- Produces: a green local gate and a CI workflow that reflects the migrated toolchain.

- [ ] **Step 1: Update `.github/workflows/ci.yml`** — drop the `build-storybook`, `debrand`, and `treeshake` steps. Keep, in order: checkout console, checkout `m4ttstack/rt` into `repo-tools`, setup-bun, `bun install --ignore-scripts` (repo-tools), build rt-client, `bun install --frozen-lockfile --ignore-scripts` (console), `typecheck`, `lint`, `format:check`, `test -- --run`, `build`, `build:binary`, and the "binary serves its own assets" integration step (copy `dist-bin/console` to `$RUNNER_TEMP`, hide `dist/`, run on `PORT=11099`, assert `/api/health`, `/`, `/search`, a discovered `/assets/*.js`, the woff2 font). Leave `.github/workflows/purity.yml` untouched.

The integration step is the embedded-binary regression test — it now exercises the package's `mattstack-embed-assets` + `serveMattstackApp` embedded path end to end.

- [ ] **Step 2: Re-point the docs** — `AGENTS.md` shrinks to what is app-specific (console's routes/runs/wiring, the `run-updated`→`runs` relay, `build:binary`/embedded via the package, the vendored tarballs, the deck service on 11011) plus a pointer at `~/Documents/GitHub/app-kit/AGENTS.md` for the kit contract (import walls, theme, facades, the shell, the server package). Drop references to the vendored `src/ui`/`@ui/*` kit, `packages/mantine-tokyo`, `src/boot`, Storybook, and the deleted server modules (`app.ts`/`ws.ts`/`static-disk.ts`/hand-rolled `embedded/*`). `README.md`: update the toolchain/scripts section (no storybook/debrand/treeshake; `build:binary` via the package bin). `CLAUDE.md` is just "See AGENTS.md" — leave it.

- [ ] **Step 3: Full gate**

```bash
cd ~/Documents/GitHub/console-app-kit-wt
bunx vitest run          # whole suite green
bun run typecheck        # tsc -p tsconfig.json, clean
bun run lint             # eslint src, clean (mantine wall via the preset)
bun run build            # tsc + vite build succeeds
bun run build:binary     # vite build + mattstack-embed-assets + bun --compile → dist-bin/console
```

Expected: all green, and `dist-bin/console` is produced. Optionally smoke-test the binary the way CI does (copy it out, hide `dist/`, run on a spare `PORT`, curl `/api/health` and `/`) — this is the one true test of the embedded path.

- [ ] **Step 4: Commit any doc/gate fixups**

```bash
git add -A && git commit -m "console: update CI (drop storybook/debrand/treeshake), re-point docs, full gate green"
```

---

## Self-Review

**Spec coverage (section D "console (later)"):** "Same moves" as chat — delete kit (Task 4), config presets (Task 3), `@ui`→package rewrite (Task 5), shell via `MattstackShell` + `mountMattstackApp` (Task 6), server via `serveMattstackApp` (Task 7), package.json deps (Task 2), docs (Task 9). Plus the four console specifics: embedded mode through the package + `build:binary` on the bin (Tasks 3 script + 7 server), `packages/mantine-tokyo` removed (Task 2), `ConsoleChrome`→`MattstackShell` (Task 6), `ConsolePalette` onto the shell (Task 5 spotlight repoint, unchanged component). Section C server surface — `serveMattstackApp` options, `{ error }` envelope, `/api/daemon`, embedded `decideServingMode`/`loadEmbeddedManifest`, the `mattstack-embed-assets` bin (Task 7). Consumer requirements — tarballs (Task 2), `app-icons.d.ts` N/A (Global Constraints; console registers no custom icons), `.js` vite preset (Task 3). The launcher payoff (`appName="console"` → `<AppLauncher>`) is Task 6.

**Console-specific reconciliations vs the chat plan:** no product-file move (console's product code is already in `src/app/`, `src/ui/` is pure kit → deleted wholesale in Task 4); `packages/mantine-tokyo` is console-hosted and removed (Task 2), not just re-vendored; the embedded machinery is console's own, deleted in favour of the package (Task 7); the custom `WiringRailEntry` needs the shell's rail context, which Task 1 exports from app-kit (ui 0.1.4); Storybook is dropped entirely (all 34 stories were kit stories under `src/ui/`); `purity.yml` is preserved, only `debrand`+`treeshake` dropped; no `useDaemonHealth`/`DaemonBanner` (console has none); no custom icon registration (all 21 names are kit built-ins).

**Placeholder scan:** the conditional steps (Task 3 Step 3 extra vitest setup, Task 5 Step 4 unexpected-export handling, Task 6 Step 5 test reworks, Task 7 Step 5 route-test re-point) are decision points with both branches specified against real files, not placeholders. Every code step carries the actual code.

**Type/interface consistency:** `serveMattstackApp`/`ServeOptions`, `mountMattstackApp`/`MountOptions`, `MattstackShell`/`MattstackShell.Rail`, `RailLink`/`RailLinkProps`, `useShellRail`/`ShellRailState`, `RelaySpec { match, topic }`, and the `mattstack-embed-assets` output path (`src/server/embedded/manifest.ts` exporting `manifest: EmbeddedManifest`) are all taken from the installed/packed app-kit source, not invented. `AppType = typeof routes` is preserved, so console's RPC client typing is unchanged apart from one import line — `src/app/api.ts` repoints its `AppType` type import from the deleted `../server/app` to `../server/routes` (Task 7 Step 1b).

**Open implementer choices (non-blocking):** whether any surviving server route test wraps `routes` in `createApp` or tests the sub-router directly (Task 7 Step 5); the precise `App.test.tsx` reworks (Task 6 Step 5).
