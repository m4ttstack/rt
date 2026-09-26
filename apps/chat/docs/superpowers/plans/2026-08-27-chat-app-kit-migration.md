# Chat → `@mattstack/app-kit` Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chat's vendored `src/ui` kit with the `@mattstack/app-kit` + `@mattstack/app-server` packages, keep chat's product code, and wire `MattstackShell` with `appName="chat"` so the shared `<AppLauncher>` renders in chat's header (fed by the now-live deck `/api/apps`).

**Architecture:** Chat becomes a thin app-kit consumer, exactly like the `app-kit/probe` reference app: `main.tsx` → `mountMattstackApp`, `server/index.ts` → `serveMattstackApp`, config files → the app-kit presets, all `@ui/*` imports → `@mattstack/app-kit/*` subpaths. Chat's product modules (Transcript, Composer, Roster, RoomRail, PageBar, AgentName, ArchivedBar, NewPill, day-label, presence-bits, buddies-context, statusDetail) move from `src/ui/` to `src/app/`. The vendored kit, the boot module, and the server boilerplate are deleted (the packages replace them).

**Tech Stack:** React 19, Mantine 9.5, `@mattstack/app-kit` + `@mattstack/app-server` + `@mattstack/mantine-tokyo` (consumed as packed tarballs), Hono 4, wouter 3, Vitest 4 (jsdom), Bun.

**Spec:** `~/Documents/GitHub/app-kit/docs/superpowers/specs/2026-08-26-app-kit-design.md` (section D Migration → chat; section 10 Consumer requirements). This plan reconciles that design with chat's _current_ code (which added `ArchivedBar`/`NewPill`/`day-label` and moved its shell to `src/app/chrome/` since the spec was written) and applies the three consumer requirements the spec predates.

## Global Constraints

- **Reference implementation is `app-kit/probe`.** Every consumer file (`main.tsx`, `server/index.ts`, `server/routes.ts`, `vite.config.ts`, `tsconfig.json`, `vitest.setup.ts`, `eslint.config.js`, `src/app/app-icons.d.ts`, `src/loading-bar-sync.test.ts`) mirrors probe's version, scaled to chat's real product code. When in doubt, match probe.
- **Consumer requirement 1 — packed tarballs, not bare `file:` dirs.** Vendor the three packages with `bun pm pack` into `chat/vendor/` and depend on them as `file:./vendor/mattstack-<pkg>-<ver>.tgz` (bun 1.3 symlinks bare `file:` dirs and duplicates peers; a packed tarball extracts as a real copy). Exactly as probe's `package.json` does.
- **Consumer requirement 2 — `app-icons.d.ts`, never `icons.d.ts`.** The `AppIcons` augmentation file must NOT share a basename with a sibling `.ts` (TypeScript drops the colliding `.d.ts`). Name it `src/app/app-icons.d.ts`.
- **Consumer requirement 3 — the `.js` vite preset.** `vite.config.ts` imports `mattstackVite` from `@mattstack/app-kit/vite` (hand-authored `.js`); NO `--configLoader` flag on any Vite/Vitest invocation.
- **Mantine wall stays.** App code imports Mantine primitives only through `@mattstack/app-kit/*` barrels, never raw `@mantine/*` (enforced by the app-kit eslint preset). The one exception is the icon-registration file (`src/app/icons.ts`), which imports the raw lucide glyph with an `eslint-disable-line no-restricted-imports`, exactly as probe does.
- **rt side is unchanged.** Same host, same `/r/<room>#m-<id>` contract, same deck service, same `chat/*` relay topic, port 11002.
- **Clean-code comments.** A comment states a constraint the code cannot show. No narration, no migration-process citations in source.
- **Verification is per-task where a suite exists** (`bunx vitest run <path>`), and a full gate at the end. Do not run the app in a browser; the launcher-renders check is a manual note for the human at PR time.

---

### Task 1: Vendor the packages + rewrite `package.json` deps

**Files:**

- Create: `vendor/` (three `.tgz` files, git-ignored or committed per repo norm)
- Modify: `package.json`
- Modify: `.gitignore` (if vendoring committed vs ignored — match probe's choice)

**Interfaces:**

- Produces: a resolvable dependency graph with `@mattstack/app-kit`, `@mattstack/app-server`, `@mattstack/mantine-tokyo` as tarballs, `@mantine/spotlight` added, the internalized deps dropped.

- [ ] **Step 1: Pack the three app-kit packages into `vendor/`**

```bash
cd ~/Documents/GitHub/chat-app-kit-wt
mkdir -p vendor
(cd ~/Documents/GitHub/app-kit/packages/mantine-tokyo && bun pm pack --destination ~/Documents/GitHub/chat-app-kit-wt/vendor --quiet)
(cd ~/Documents/GitHub/app-kit/packages/ui && bun pm pack --destination ~/Documents/GitHub/chat-app-kit-wt/vendor --quiet)
(cd ~/Documents/GitHub/app-kit/packages/server && bun pm pack --destination ~/Documents/GitHub/chat-app-kit-wt/vendor --quiet)
ls vendor/   # note the exact filenames + versions for the file: specifiers
```

- [ ] **Step 2: Rewrite `package.json` dependencies**

Add (tarball specifiers use the exact packed filenames from Step 1):

```jsonc
"@mattstack/app-kit": "file:./vendor/mattstack-app-kit-<ver>.tgz",
"@mattstack/app-server": "file:./vendor/mattstack-app-server-<ver>.tgz",
"@mattstack/mantine-tokyo": "file:./vendor/mattstack-mantine-tokyo-<ver>.tgz",
"@mantine/spotlight": "^9.5.2",
```

Keep all existing `@mantine/*` peers, `@mattstack/rt-client`, `@tanstack/react-query`, `hono`, `react`, `react-dom`, `react-interval-hook` (App.tsx's buddies poll uses `useInterval`), `react-scroll-to-bottom`, `wouter`, `zod`.
DROP the deps that became package internals and that no product code imports after the rewrite: `clsx`, `dayjs`, `mantine-form-zod-resolver`, `@tanstack/react-virtual`. Leave `lucide-react` for now — Task 7 decides it based on real icon usage.
Add a `serve` script: `"serve": "bun run src/server/index.ts"`. Change `build` to `"tsc -p tsconfig.json && vite build"` and `typecheck` to `"tsc -p tsconfig.json"` (single tsconfig, per Task 2). Drop the `treeshake` and `debrand` scripts if their scripts are deleted (Task 2/3).

- [ ] **Step 3: Install and verify no peer duplication**

```bash
cd ~/Documents/GitHub/chat-app-kit-wt && bun install
# Confirm a single react/vite/wouter copy (tarballs must not duplicate peers):
bun pm ls 2>/dev/null | grep -E "react@|vite@|wouter@" | sort -u
```

Expected: install succeeds; one copy each of react/vite/wouter. If a peer is duplicated, STOP and report — the tarball packing is the fix, not a resolution override.

Known warning (not a failure): the `@mattstack/app-server` tarball declares peer `@mattstack/rt-client@^0.6` while chat pins `^0.7` (non-overlapping ranges), so `bun install` prints an unmet-peer warning. Runtime is fine — chat already uses the same `daemonHealth`/`createRelay` APIs. Confirm it is a warning only (install still succeeds); do not "fix" it by downgrading chat's rt-client.

- [ ] **Step 4: Commit**

```bash
git add package.json vendor .gitignore
git commit -m "chat: vendor app-kit packages as tarballs, rewrite deps"
```

---

### Task 2: Swap config files for the app-kit presets

**Files:**

- Modify: `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js`
- Replace: `tsconfig.json` (collapse the `app`/`node`/`tools` split into one)
- Delete: `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.tools.json`, `eslint-local/`, `scripts/treeshake-check.sh`, `scripts/treeshake-probe/`, `scripts/debrand-check.sh`

**Interfaces:**

- Consumes: the `@mattstack/app-kit/{vite,eslint,tsconfig.base.json,test-utils}` subpaths (installed in Task 1).
- Produces: config with no `@ui/*` alias anywhere.

- [ ] **Step 1: `vite.config.ts`** — replace with the preset (mirrors probe):

```ts
import { mattstackVite } from '@mattstack/app-kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(mattstackVite({ apiPort: 11002 }));
```

If chat's custom rolldown chunk `groups` prove necessary after the build gate (Task 10), reintroduce them via a merge on top of `mattstackVite(...)`; default is to drop them (YAGNI) and confirm the build still splits vendors acceptably.

- [ ] **Step 2: `tsconfig.json`** — single config extending the base (mirrors probe):

```jsonc
{
  "extends": "@mattstack/app-kit/tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
  },
  "include": ["src", "vite.config.ts", "vitest.setup.ts"],
}
```

Delete `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.tools.json`. There is no `@ui/*` `paths` entry anywhere anymore.

- [ ] **Step 3: `vitest.setup.ts`** — use the package's polyfills (mirrors probe):

```ts
import '@testing-library/jest-dom/vitest';

import { installJsdomPolyfills } from '@mattstack/app-kit/test-utils';

installJsdomPolyfills();
if (typeof window !== 'undefined') window.scrollTo = () => {};
```

- [ ] **Step 4: `eslint.config.js`** — use the preset (mirrors probe); delete `eslint-local/`:

```js
import { mattstackEslint } from '@mattstack/app-kit/eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(...mattstackEslint());
```

- [ ] **Step 5: Delete the treeshake + debrand scripts** (`scripts/treeshake-check.sh`, `scripts/treeshake-probe/`, `scripts/debrand-check.sh`) and remove their `package.json` script entries (`treeshake`, `debrand`) if not already dropped in Task 1.

- [ ] **Step 6: Commit** (config only — the suite will not pass until Tasks 3-8 land; that is expected):

```bash
git add -A && git commit -m "chat: swap config for app-kit vite/eslint/tsconfig presets"
```

---

### Task 3: Delete the vendored kit, the boot module, and redundant app files

**Files:**

- Delete: `src/ui/{core,design-system,forms,hooks,icons,lazy,modals,notifications,storybook,styles,utils}/`, `src/ui/mantine.d.ts`
- Delete: `src/boot/` (its `SimpleAlerts` + loading-bar CSS + tests are the app-kit `boot` subpath + `test-utils`)
- Delete: `src/app/NotFoundPage.tsx`, `src/app/styles/tokyo-theme.css`
- Delete: `src/ui/DaemonBanner.tsx`, `src/ui/DaemonBanner.test.tsx` (the package's `DaemonBanner` replaces them)

**Interfaces:**

- Produces: a `src/ui/` containing ONLY chat's product files (moved out in Task 4). After Task 4, `src/ui/` is empty and removed.

- [ ] **Step 1: Delete the kit folders + boot + redundant files**

```bash
cd ~/Documents/GitHub/chat-app-kit-wt
git rm -r src/ui/core src/ui/design-system src/ui/forms src/ui/hooks src/ui/icons \
  src/ui/lazy src/ui/modals src/ui/notifications src/ui/storybook src/ui/styles src/ui/utils \
  src/ui/mantine.d.ts src/boot src/app/NotFoundPage.tsx src/app/styles/tokyo-theme.css \
  src/ui/DaemonBanner.tsx src/ui/DaemonBanner.test.tsx
```

- [ ] **Step 2: Commit** (the tree will not build yet — product files still reference the deleted kit until the later tasks):

```bash
git commit -m "chat: delete vendored kit, boot module, redundant app files"
```

---

### Task 4: Move chat's product files from `src/ui/` to `src/app/`

**Files (git mv each with its companions):**

- `Transcript.tsx` (+ `Transcript.test.tsx`, `transcript-body.module.css`, `transcript-scroll.module.css`)
- `Composer.tsx` (+ `Composer.test.tsx`), `Roster.tsx` (+ `Roster.test.tsx`), `RoomRail.tsx` (+ `RoomRail.test.tsx`), `PageBar.tsx` (+ `PageBar.test.tsx`)
- `AgentName.tsx` (+ `agent-name.module.css`), `ArchivedBar.tsx` (+ `ArchivedBar.test.tsx`), `NewPill.tsx`
- `day-label.ts` (+ `day-label.test.ts`), `statusDetail.ts` (+ `statusDetail.test.ts`), `presence-bits.tsx`, `buddies-context.tsx`
- `test-utils.tsx` → `src/app/test-utils.tsx` (chat's product test helper; renames nothing, but its `renderWithProviders` import switches to the package in Task 5)

**Interfaces:**

- Produces: all product modules under `src/app/` with their existing relative cross-imports (`./AgentName`, `./day-label`, `./statusDetail`, `./presence-bits`, `./buddies-context`) intact.

- [ ] **Step 1: Move the files** (relative cross-imports survive a same-directory move; only `@ui/*` and `@ui/statusDetail`-style specifiers get rewritten in Task 5):

```bash
cd ~/Documents/GitHub/chat-app-kit-wt
for f in Transcript Transcript.test transcript-body.module transcript-scroll.module \
  Composer Composer.test Roster Roster.test RoomRail RoomRail.test PageBar PageBar.test \
  AgentName agent-name.module ArchivedBar ArchivedBar.test NewPill day-label day-label.test \
  statusDetail statusDetail.test presence-bits buddies-context test-utils; do
  # move whichever extension exists
  for ext in tsx ts css; do [ -f "src/ui/$f.$ext" ] && git mv "src/ui/$f.$ext" "src/app/$f.$ext"; done
done
# src/ui should now be empty:
rmdir src/ui 2>/dev/null; ls src/ui 2>/dev/null || echo "src/ui removed"
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "chat: move product modules from src/ui to src/app"
```

---

### Task 5: Rewrite `@ui/*` imports to `@mattstack/app-kit/*`

**Files:** every `src/**/*.{ts,tsx}` that imported `@ui/*` (73 files pre-move) plus `vitest.setup.ts` (already handled in Task 2).

**Interfaces:**

- Consumes: the moved product files (Task 4), the deleted kit (Task 3).
- Produces: zero `@ui/` specifiers remaining in the tree.

- [ ] **Step 1: Rewrite the kit-barrel specifiers** (mechanical, one-to-one):

```bash
cd ~/Documents/GitHub/chat-app-kit-wt
# barrels: @ui/<x> -> @mattstack/app-kit/<x>
grep -rl "@ui/" src | xargs sed -i '' -E "s#@ui/(core|hooks|design-system|notifications|modals|forms|lazy|icons)#@mattstack/app-kit/\1#g"
```

- [ ] **Step 2: Rewrite the storybook test-util specifiers**

- `@ui/storybook/test-utils` (21 sites) → `@mattstack/app-kit/test-utils` (its `renderWithProviders` lives there).
- `@ui/storybook/jsdom-polyfills` → `@mattstack/app-kit/test-utils` (already done in `vitest.setup.ts`, Task 2).

```bash
grep -rl "@ui/storybook/test-utils" src | xargs sed -i '' -E "s#@ui/storybook/test-utils#@mattstack/app-kit/test-utils#g"
```

(There is no surviving `@ui/hooks/useSchemeColors` deep import in app code — `layout.ts` imports the `@ui/hooks` barrel and is deleted in Task 6; the deep occurrences were in kit files deleted in Task 3. If Step 4's grep surfaces any deep `@mattstack/app-kit/hooks/<name>`, flatten it to the `@mattstack/app-kit/hooks` barrel.)

- [ ] **Step 3: Fix the product-module + intra-product specifiers**

Product-module specifiers that resolved to `src/ui/<File>` now resolve to siblings under `src/app/`. A sed handles the common ones (adjust the relative prefix per importer depth; most importers are in `src/app/` so `./` is correct):

```bash
grep -rl -E "@ui/(Transcript|Composer|Roster|RoomRail|PageBar|ArchivedBar|AgentName|NewPill|day-label|statusDetail|presence-bits|buddies-context|test-utils)" src \
  | xargs sed -i '' -E "s#@ui/(Transcript|Composer|Roster|RoomRail|PageBar|ArchivedBar|AgentName|NewPill|day-label|statusDetail|presence-bits|buddies-context|test-utils)#./\1#g"
```

Then: `@ui/DaemonBanner` importers switch to `import { DaemonBanner } from '@mattstack/app-kit/app'` (Task 6 owns the render-site reconciliation). Chat's `src/app/test-utils.tsx` switches its own `renderWithProviders` import to `@mattstack/app-kit/test-utils`. Fix any `./` path that is wrong for an importer not in `src/app/` (Step 4's typecheck catches these).

- [ ] **Step 4: Verify no `@ui/` remains** (except `src/main.tsx`, which Task 6 rewrites wholesale)

```bash
grep -rn "@ui/" src | grep -v "src/main.tsx$" | grep -v "src/main.tsx:" \
  && echo "STILL HAS @ui outside main.tsx — fix before commit" || echo "clean: only src/main.tsx (Task 6) remains"
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chat: rewrite @ui imports to @mattstack/app-kit subpaths"
```

---

### Task 6: Shell, entry, and daemon health

**Files:**

- Delete: `src/app/chrome/{AppChrome.tsx,layout.ts}` (replaced by `MattstackShell`); KEEP `src/app/chrome/AppMark.tsx`
- Modify: `src/app/App.tsx` (mount `MattstackShell`; replace inline `useDaemonHealth` + product `DaemonBanner` with the package's)
- Rewrite: `src/main.tsx`
- Test: `src/app/App.test.tsx` (adjust to the new shell)

**Interfaces:**

- Consumes: `MattstackShell`, `mountMattstackApp`, `useDaemonHealth`, `DaemonBanner` from `@mattstack/app-kit/app` (`mountMattstackApp` brackets the pre-mount `registerSimpleAlerts`/`markMounted` internally, so `main.tsx` never imports the `boot` subpath directly).
- Produces: chat rendering inside `MattstackShell` with `appName="chat"`, so `<AppLauncher>` mounts header-right.

- [ ] **Step 1: `main.tsx`** — collapse to the probe shape exactly. `mountMattstackApp` (`packages/ui/src/app/mount.tsx`) already brackets the render with `registerSimpleAlerts()`/`markMounted()` internally, so `main.tsx` does NOT call them:

```tsx
import { mountMattstackApp } from '@mattstack/app-kit/app';

import './app/icons'; // only if Task 7 keeps an icon registration; otherwise omit

import { App } from './app/App';

mountMattstackApp(<App />);
```

Drop the `@ui/styles/index.css` and `./app/styles/tokyo-theme.css` imports (the package's `styles.css` is loaded by `mountMattstackApp`; probe imports no stylesheet in `main.tsx`).

- [ ] **Step 2: Replace the shell in `App.tsx`** — swap `<AppChrome>…</AppChrome>` (the wrapper around the routed body) for:

```tsx
<MattstackShell name="chat" appName="chat" mark={<AppMark size={30} />}>
  <MattstackShell.Rail>
    <RailLink icon="users" label="Rooms" href="/" />
  </MattstackShell.Rail>
  {/* the existing routed body */}
</MattstackShell>
```

`name="chat"` is lowercase — `MattstackShell` renders `{name}` as the wordmark and `App.test.tsx` asserts `getByText('chat')` (case-sensitive), matching the current `AppChrome`. Use `AppChrome`'s actual Rooms entry icon (`users`). The scheme toggle is now the shell's built-in `ColorSchemeControl` (a System/Light/Dark `HybridMenu`), so drop chat's hand-wired sun/moon toggle. `MattstackShell`/`RailLink` import from `@mattstack/app-kit/app` and `@mattstack/app-kit/router`. Delete `AppChrome.tsx` and `layout.ts`; keep `AppMark.tsx`.

- [ ] **Step 2b: Re-point `NotFoundPage`** — Task 3 deleted `src/app/NotFoundPage.tsx`, but `App.tsx` still imports `{ NotFoundPage } from './NotFoundPage'` (a relative path Task 5's `@ui` sed never touched). Change it to `import { NotFoundPage } from '@mattstack/app-kit/app'` (as probe's `App.tsx` does). Grep `src` for any other import of the deleted `./NotFoundPage`/`./styles/tokyo-theme.css` and re-point or drop them.

- [ ] **Step 3: Daemon health** — delete the inline `useDaemonHealth` in `App.tsx` and import it from `@mattstack/app-kit/app` (seed argument preserved). At the two `DaemonBanner` render sites, pass the hook's state to the package `DaemonBanner` (`DaemonBannerProps { reachable, downSince?, probeCount, lastAnsweredAt? }` — read the package's prop names and map the call sites).

- [ ] **Step 4: Rework `App.test.tsx` for the new shell, then run it**

The scheme-toggle test (`'the rail hosts the color-scheme toggle'`, App.test.tsx ~lines 59-71) clicks buttons named `'Switch to dark mode'`/`'Switch to light mode'` — those were `AppChrome`'s hand-wired sun/moon `RailEntry`, which this task deletes. The shell's `ColorSchemeControl` is a `System/Light/Dark` `HybridMenu` with no such buttons, so **that test must be rewritten or removed** (the scheme control is now the package's tested surface, not chat's). These survive unchanged (MattstackShell reuses the same `RailShell`/`Rail`, and the package `NotFoundPage` uses the same heading): the wordmark `getByText('chat')`, the expand `'Expand/Collapse navigation'`, the mobile `'Toggle navigation'`/`rail-overlay`, and the `'Page not found'` h1. The launcher trigger (`aria-label="Apps"`) now appears in the banner — add an assertion for it if useful.

```bash
bunx vitest run src/app/App.test.tsx
```

Expected: PASS after the scheme-toggle test is reworked and the render tree updated.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chat: mount MattstackShell (appName=chat), use package daemon health"
```

---

### Task 7: Icon registration (verify, then minimal)

**Files:**

- Maybe create: `src/app/icons.ts`, `src/app/app-icons.d.ts`
- Maybe modify: `package.json` (drop `lucide-react`)

**Interfaces:**

- Produces: every `<Icon name="…">` chat renders resolves — either from app-kit's built-in registry or a chat registration.

- [ ] **Step 1: Enumerate chat's icon names and check them against the package registry**

```bash
cd ~/Documents/GitHub/chat-app-kit-wt
grep -rohE "name=[\"'][a-zA-Z]+[\"']" src/app | sed -E "s/name=[\"']([a-zA-Z]+)[\"']/\1/" | sort -u > /tmp/chat-icon-names.txt
# Compare against app-kit's ICON_NAMES (the package's built-in set):
node -e "import('@mattstack/app-kit/icons').then(m=>console.log([...m.ICON_NAMES].sort().join('\n')))" > /tmp/kit-icon-names.txt 2>/dev/null
comm -23 /tmp/chat-icon-names.txt /tmp/kit-icon-names.txt   # names chat uses that the kit lacks
```

- [ ] **Step 2a: If the diff is empty** — chat needs no custom icons. Do NOT create `icons.ts`/`app-icons.d.ts`, remove the `import './app/icons'` line from `main.tsx`, and drop `lucide-react` from `package.json`. Commit.

- [ ] **Step 2b: If the diff lists names (e.g. `hash`)** — register exactly those (mirrors probe's `icons.ts` + `app-icons.d.ts`):

```ts
// src/app/icons.ts
import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';
import { Hash } from 'lucide-react'; // eslint-disable-line no-restricted-imports

registerIcons({ hash: lucideWrapperFn(Hash) });
```

```ts
// src/app/app-icons.d.ts
declare module '@mattstack/app-kit/icons' {
  interface AppIcons {
    hash: true;
  }
}
export {};
```

Keep `lucide-react` in `package.json`. Keep the `import './app/icons'` line in `main.tsx`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chat: reconcile icon registration against the package set"
```

---

### Task 8: Server — routes only, `serveMattstackApp` for the rest

**Files:**

- Create: `src/server/routes.ts` (chat's Hono chain + `AppType`)
- Rewrite: `src/server/index.ts`
- Delete: `src/server/{app.ts,ws.ts,health.ts,static-disk.ts}` and their tests (the package provides all of it)
- Keep/move: `src/server/chat.ts` + `src/server/fixtures.ts` become the body of `routes.ts` (or `routes.ts` re-exports them)
- Test: port `chat.test.ts` + `fixtures.test.ts` to target `routes`

**Interfaces:**

- Consumes: `serveMattstackApp` from `@mattstack/app-server` (provides `/api/daemon`, SPA static, ws, `{ error }` envelope, binds `127.0.0.1`).
- Produces: chat served on `127.0.0.1:11002` with its `/api/chat/*` routes and the `chat/` relay.

- [ ] **Step 1: `routes.ts`** — the existing chat Hono chain, exported with its type:

```ts
import { Hono } from 'hono';
// ...chat's existing /api/chat/* route definitions (from chat.ts), fixtures behind CHAT_FIXTURES=1
export const routes = /* the chat Hono chain */;
export type AppType = typeof routes;
```

Move `chat.ts`'s route definitions here (or keep `chat.ts`/`fixtures.ts` and have `routes.ts` compose them). Drop the `/api/health` route if unused (the client polls `/api/daemon`, which the package provides); keep `/api/chat/*` verbatim.

- [ ] **Step 2: `index.ts`** — mirror probe:

```ts
import { serveMattstackApp } from '@mattstack/app-server';

import { routes } from './routes';

await serveMattstackApp({
  name: 'chat',
  version: '0.0.0',
  routes,
  port: 11002,
  relay: [{ match: t => t.startsWith('chat/'), topic: 'chat' }],
});
```

Delete `app.ts`, `ws.ts`, `health.ts`, `static-disk.ts` and their tests — `serveMattstackApp` supplies the listener, static SPA serving, `/api/daemon`, ws plumbing, and the `{ error }` envelope. The client only checks `res.ok` (HTTP status), never the envelope body (verified), so the envelope change is safe.

- [ ] **Step 3: Port the server tests** — `chat.test.ts` and `fixtures.test.ts` now import from `./routes`. Delete `app.test.ts`, `ws.test.ts`, `health.test.ts`, `static-disk.test.ts` (their targets are gone; the package owns those tests).

- [ ] **Step 4: Run the server tests**

```bash
bunx vitest run src/server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chat: serve via @mattstack/app-server, keep only chat routes"
```

---

### Task 9: `index.html` loading-bar sync

**Files:**

- Modify: `index.html` (loading-bar block matches the package's)
- Create: `src/loading-bar-sync.test.ts` (mirrors probe)
- Delete: chat's old `src/boot/loading-bar-sync.test.ts` (already removed with `src/boot/` in Task 3)

**Interfaces:**

- Consumes: `expectLoadingBarInSync` from `@mattstack/app-kit/test-utils`.

- [ ] **Step 1: Add the sync test** (mirrors probe):

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

- [ ] **Step 2: Reconcile `index.html`** — run the test; if it fails, replace chat's inline loading-bar `<style>` block with the package's canonical block (the error names the expected content). Keep the rest of `index.html` (root div, entry script).

```bash
bunx vitest run src/loading-bar-sync.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chat: sync index.html loading-bar with the package block"
```

---

### Task 10: Docs re-point + full verification gate

**Files:**

- Modify: `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`
- No source changes (verification).

- [ ] **Step 1: Re-point the docs** — `AGENTS.md` shrinks to what is app-specific plus a pointer at app-kit's own `AGENTS.md` (the kit contract lives there now). `ARCHITECTURE.md`/`CLAUDE.md` drop references to the vendored `src/ui` kit and the deleted boot/server modules.

- [ ] **Step 2: Full gate**

```bash
cd ~/Documents/GitHub/chat-app-kit-wt
bunx vitest run          # whole suite green
bun run typecheck        # tsc -p tsconfig.json, clean
bun run lint             # eslint src, clean (mantine wall via the preset)
bun run build            # tsc + vite build succeeds
```

Expected: all green. If the vite build's vendor splitting regressed (Task 2 dropped the custom chunk groups), decide whether to reintroduce a `groups` merge on top of `mattstackVite(...)` or accept the preset default.

- [ ] **Step 3: Commit any doc/gate fixups**

```bash
git add -A && git commit -m "chat: re-point docs, full suite + build green"
```

---

## Self-Review

**Spec coverage:** section D chat bullets — delete kit (Task 3), move product files (Task 4), `@ui`→package rewrite (Task 5), deep-specifier flatten (Task 5), shell via `MattstackShell` + `AppMark` as mark + `mountMattstackApp` + package `useDaemonHealth` (Task 6), server → `routes.ts` + `serveMattstackApp` at port 11002 with `{ error }` envelope (Task 8), config → presets (Task 2), package.json dep changes (Task 1), docs re-point (Task 10), rt side unchanged (Global Constraints). Section 10 consumer requirements — tarballs (Task 1), `app-icons.d.ts` (Task 7), `.js` vite preset (Task 2). The launcher payoff (`appName="chat"` → `<AppLauncher>` renders) is Task 6.

**Reconciliations vs the spec (chat drifted since 2026-08-26):** `ArchivedBar`/`NewPill`/`day-label` added to the product-move list (Task 4); the shell lives in `src/app/chrome/` not `src/app/AppChrome.tsx` (Task 6); `DaemonBanner` is deleted in favor of the package's (Tasks 3/6); the `hash` icon is verify-then-register rather than assumed (Task 7); `src/boot/SimpleAlerts` maps to the package `boot` subpath, not deleted-into-nothing (Task 6 keeps the calls).

**Placeholder scan:** the two conditional tasks (Task 7 icon diff, Task 2 chunk-groups) are decision points with both branches specified, not placeholders. Every other step has concrete files/commands.

**Type/interface consistency:** `serveMattstackApp` options and `mountMattstackApp`/`MattstackShell`/`DaemonBannerProps`/`useDaemonHealth`/`registerIcons` signatures are all taken from the installed package (probe + app-kit source), not invented.

**Open implementer choices (non-blocking):** whether chat keeps custom vite chunk groups (Task 2/10); whether any icon registration survives (Task 7); the exact rail entry set the shell carries (Task 6, matched to `AppChrome`'s current entries).
