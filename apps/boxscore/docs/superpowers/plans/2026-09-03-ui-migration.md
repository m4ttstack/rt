# Boxscore UI Migration (SP5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild boxscore's UI on app-kit and app-server so it looks and behaves like the rest of the suite, with wouter routing, react-query over typed Hono RPC, and a settings page on settings-kit over the rt keys.

**Architecture:** The repo moves to the suite layout (`src/server`, `src/app`, `src/shared`). `serveMattstackApp` replaces the hand-rolled server entry and supplies health, the daemon probe, static serving, and the JSON error floor. The client mounts through `mountMattstackApp` into `MattstackShell`, routed by wouter. `web/src/api.ts` is replaced by a typed `hc<AppType>` client consumed through react-query hooks. Every bespoke Radix/shadcn component is rebuilt on app-kit's Mantine barrels; the local `ui/` primitives and the theme provider are deleted. The settings page SP2 removed comes back on settings-kit.

**Tech Stack:** TypeScript, Bun, React 18, `@mattstack/app-kit` ^0.1.9, `@mattstack/app-server` ^0.1.2, `@mattstack/settings-kit` ^0.1.3, wouter, `@tanstack/react-query`, Hono RPC, vitest.

**Spec:** docs/superpowers/specs/2026-09-02-mattstack-integration-design.md, section 8. The visual target is the approved design in `docs/superpowers/design/boxscore-ui/` (five artboards: leaderboard, leaderboard mid-refresh with trend, cards, person detail with evidence, settings). Regenerate them with `node build.mjs` and open the `.dc.html` files to see the intended layout.

**Template:** `/Users/matt/Documents/GitHub/console/docs/superpowers/plans/2026-08-28-console-app-kit-migration.md` is the pattern this plan follows. `/Users/matt/Documents/GitHub/chat` is the closest live reference for a consumer on published npm ranges; read its `src/server/index.ts`, `src/server/routes.ts`, and `src/main.tsx` before Tasks 3 and 4.

## Global Constraints

- Branch `feat/ui-migration` off `feat/mattstack-integration-spec`, in a git worktree under `.worktrees/`. Validation after every task: `bun run test` and `bun run typecheck`, both green, plus `bun run build` from Task 2 onward.
- **The server's data layer is frozen.** `server/metrics/**`, `server/store/**`, `server/source/**`, `server/refresh/**`, `server/config/**`, `server/linear/**`, and `server/bots.ts` change only by having their import paths rewritten during the Task 1 move. No logic edits. SP4 shipped these hours ago with a full review; a behavior change here is out of scope and a finding.
- **Wire types are frozen.** `shared/types.ts` (becoming `src/shared/types.ts`) keeps every field. The response shapes the client consumes are the ones the server already produces.
- **Consume the kits from npm, not vendored tarballs.** Chat's pattern, not console's: plain semver ranges in `package.json`. Boxscore ships no compiled binary, so the tarball vendoring console needs buys nothing here.
- **Expect one peer warning and do not fix it.** app-kit and app-server declare a peer of `@mattstack/rt-client` `^0.11.0`; boxscore pins `^0.12.0`. The console plan records this as benign: runtime is fine. Confirm the install succeeds and move on.
- **The Mantine wall.** App code imports Mantine only through `@mattstack/app-kit/*` barrels, never `@mantine/*` directly. The eslint preset enforces it.
- **Hono RPC inference is fragile.** Routes must be CHAINED (`.route('/', x).route('/', y)`) with handlers INLINE. A handler lifted into a named function loses path-param typing, and an unchained `app.get(...)` never reaches `typeof routes`. Carry that as a comment where the chain is defined.
- Every task keeps the app runnable: `bun run dev` must serve the leaderboard at the end of each one.
- House rules: no em dashes; comments only state constraints the code cannot show; commit after every task with a short imperative message.

---

### Task 1: Move to the suite layout

**Files:**
- Move: `server/**` to `src/server/**`, `web/src/**` to `src/app/**`, `shared/**` to `src/shared/**`, `web/index.html` to `index.html`, `web/public/**` to `public/**`
- Modify: every import path affected, `vite.config.ts`, `tsconfig.json`, `web/tsconfig.json`, `vitest.config.ts`, `package.json` scripts, `test/**` imports
- Delete: `web/` (now empty)

**Interfaces:**
- Produces: the layout every later task assumes. `src/server/app.ts` still exports `app`; `src/app/main.tsx` is still the client entry; `src/shared/types.ts` still holds the wire types.

- [ ] **Step 1: Move the trees**

Use `git mv` so history follows. `server` to `src/server`, `web/src` to `src/app`, `shared` to `src/shared`, `web/index.html` to the repo root, `web/public` to `public`. `test/` stays where it is.

- [ ] **Step 2: Repoint every import**

The moves change relative depths: `server/x.ts` importing `../shared/types.js` becomes `src/server/x.ts` importing `../shared/types.js` (unchanged depth, since both moved together), while `test/x.test.ts` importing `../server/app.js` becomes `../src/server/app.js`. Work through the compiler rather than guessing: run `bun run typecheck` and fix what it reports until clean. The vite alias `@` (if present) and `index.html`'s script src need updating too.

- [ ] **Step 3: Update the config files**

`vite.config.ts` root and input paths, `tsconfig.json` include globs, `web/tsconfig.json` becomes `tsconfig.app.json` (or folds into the root config), `vitest.config.ts` test globs, and `package.json`'s `dev:web`/`build` scripts.

- [ ] **Step 4: Validate**

Run `bun run test` (240 green, unchanged), `bun run typecheck`, and `bun run dev` briefly to confirm the app still serves. Nothing about behavior changed; this is a move.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "move to the suite layout: src/server, src/app, src/shared"
```

---

### Task 2: Dependencies and config presets

**Files:**
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`
- Create: `eslint.config.js`
- Delete: `tailwind.config.*` and any Tailwind entry CSS if present

**Interfaces:**
- Produces: the toolchain later tasks build on. `mattstackVite({ apiPort: 11005 })` is the vite config; `@mattstack/app-kit/tsconfig.base.json` is the tsconfig base; `mattstackEslint()` is the lint preset.

- [ ] **Step 1: Dependencies**

Add `@mattstack/app-kit@^0.1.9`, `@mattstack/app-server@^0.1.2`, `@mattstack/settings-kit@^0.1.3`, `wouter`, `@tanstack/react-query`. Remove the Radix packages (`@radix-ui/react-dropdown-menu`, `-slot`, `-switch`, `-tabs`, `-tooltip`), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss`, and `@tailwindcss/vite`: app-kit supplies icons and styling, and the eslint preset bans direct `lucide-react` imports. Keep `hono`, `@mattstack/glance`, `@mattstack/rt-client`.

Run `bun install`. Expect exactly one peer warning about `@mattstack/rt-client` (see Global Constraints) and leave it.

- [ ] **Step 2: Config presets**

```ts
// vite.config.ts
import { mattstackVite } from "@mattstack/app-kit/vite";
export default mattstackVite({ apiPort: 11005 });
```

`tsconfig.json` extends `@mattstack/app-kit/tsconfig.base.json` with boxscore's own `include`. `eslint.config.js`:

```js
import tseslint from "typescript-eslint";
import { mattstackEslint } from "@mattstack/app-kit/eslint";
export default tseslint.config(...mattstackEslint());
```

`vitest.config.ts` keeps its `env` block (`BOXSCORE_DB`, `BOXSCORE_CACHE_DIR`) and adds `installJsdomPolyfills()` from `@mattstack/app-kit/test-utils` in a setup file if any component test needs a DOM.

- [ ] **Step 3: Scripts**

Rewrite `package.json` scripts to the suite shape: `dev`, `dev:server`, `build`, `serve`, `typecheck`, `lint`, `test`. Keep `report` and `validate` (the CLI entry points) pointing at `src/server/cli.ts`. `test` stays `bun --bun vitest run` (SP4's runner constraint: `bun:sqlite` is unreachable under Node).

- [ ] **Step 4: Validate**

`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`. Lint will report the Mantine-wall and icon violations that Tasks 4-7 fix; record the count in the task report rather than suppressing them, and confirm it drops to zero by Task 8.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "adopt the app-kit toolchain: vite, tsconfig, eslint presets"
```

---

### Task 3: The server on app-server

**Files:**
- Create: `src/server/routes.ts`
- Modify: `src/server/index.ts`, `src/server/app.ts`
- Test: `test/endpoints.test.ts` (repoint to the new route export; assertions unchanged)

**Interfaces:**
- Produces: `export const routes` (a chained Hono) and `export type AppType = typeof routes` from `src/server/routes.ts`. Task 5's client imports `AppType`.

- [ ] **Step 1: Restructure the routes for RPC inference**

`src/server/app.ts` today is a sequence of `app.get(...)` / `app.post(...)` statements, which `typeof` cannot see. Restructure into chained groups with inline handlers, following chat's `src/server/routes.ts`. Group them by concern (leaderboard/detail, refresh jobs, cache stats) and chain the groups:

```ts
// Routes are CHAINED and handlers INLINE, both load-bearing for Hono's RPC inference:
// a handler lifted into a named function loses path-param typing, and an unchained
// app.get(...) never reaches `typeof routes`.
export const routes = leaderboard.route("/", jobs).route("/", cache);
export type AppType = typeof routes;
```

Drop `/api/health` from boxscore's own routes: `serveMattstackApp` supplies it, along with `/api/daemon`, the 404 JSON floor, and the error handler. Keep every other path and response shape byte-identical.

- [ ] **Step 2: The entry point**

```ts
import { serveMattstackApp } from "@mattstack/app-server";
import pkg from "../../package.json" with { type: "json" };
import { routes } from "./routes";

await serveMattstackApp({
  name: "boxscore",
  version: pkg.version,
  routes,
  port: 11005,
});
```

No `relay` (boxscore has no daemon topic subscription) and no `embedded` (no compiled binary). `PORT` still overrides, which is how deck drives it.

- [ ] **Step 3: Mount the settings handler**

Task 7 needs `settingsHandler` reachable. Add it now, inside the route chain, so the server half is done in one task:

```ts
import { settingsHandler } from "@mattstack/settings-kit/server";
```

Mount it so `/api/settings/*` reaches it, with `allowComposite: true` (boxscore's keys include arrays and one object) and the default loopback `allowWrite` guard. Return its `Response` when non-null and fall through otherwise.

- [ ] **Step 4: Validate**

`bun run test`, `bun run typecheck`, then `bun run dev:server` and confirm by curl: `/api/health` returns `{ok:true,name:"boxscore",...}` from the frame, `/api/leaderboard` still answers, `/api/settings/defs?prefix=boxscore.` returns the registry rows, and an unknown path returns `{"error":"not found"}` as JSON.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "serve through app-server; routes chained for RPC inference"
```

---

### Task 4: The client shell and routing

**Files:**
- Modify: `src/app/main.tsx`, `src/app/App.tsx`
- Create: `src/app/routes.ts`
- Delete: `src/app/components/ThemeProvider.tsx`, `src/app/components/ThemeToggle.tsx`, `src/app/hooks/useHashRoute.ts`, `src/app/index.css` (app-kit's `styles.css` replaces it)

**Interfaces:**
- Produces: `useAppRoute(): AppRoute` from `src/app/routes.ts`, a discriminated union over the four routes. Tasks 6 and 7 render against it.

- [ ] **Step 1: The entry**

```ts
import { mountMattstackApp } from "@mattstack/app-kit/app";
import { App } from "./App";
mountMattstackApp(<App />);
```

`mountMattstackApp` supplies StrictMode, the Tokyo theme, `MantineProvider`, `ModalsProvider`, and `Notifications`, so the bespoke `ThemeProvider` and `ThemeToggle` are deleted: `MattstackShell` renders a `ColorSchemeControl` in its header already.

- [ ] **Step 2: Routes**

```ts
export type AppRoute =
  | { name: "leaderboard" }
  | { name: "user"; username: string }
  | { name: "stat"; username: string; stat: MetricKey }
  | { name: "settings" }
  | { name: "not-found" };
```

`useAppRoute()` calls `useRoute("/")`, `useRoute("/user/:name")`, `useRoute("/user/:name/:stat")`, and `useRoute("/settings")` in that order, decoding params with `decodeURIComponent` and validating `stat` against the `METRICS` descriptor list from `src/shared/metrics.ts` (an unknown stat is `not-found`, not a crash). Follow console's `src/app/routes.ts` shape.

The old app used hash routes (`#user/name`). Those links are dead after this task; update every internal navigation to wouter `Link` or `useLocation`'s setter.

- [ ] **Step 3: The shell**

`App.tsx` mounts:

```tsx
<MattstackShell name="boxscore" appName="boxscore" mark={...}>
  <MattstackShell.Rail>
    <RailLink icon={...} label="Leaderboard" href="/" />
    <RailLink icon={...} label="Settings" href="/settings" />
  </MattstackShell.Rail>
  {routed content}
</MattstackShell>
```

Icons come from `@mattstack/app-kit/icons`. `appName="boxscore"` lights up the deck app launcher. Route to a `NotFoundPage` (exported from `@mattstack/app-kit/app`) on `not-found`.

- [ ] **Step 4: Validate**

`bun run test`, `bun run typecheck`, `bun run build`, then `bun run dev` and confirm the shell renders with the rail, the launcher, and a working color-scheme control, and that `/`, `/user/x`, and `/settings` route without a reload. The page content can still be the old components at this point; the next tasks replace them.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "mount through app-kit: shell, rail, wouter routing"
```

---

### Task 5: Typed RPC and react-query

**Files:**
- Create: `src/app/api.ts`, `src/app/hooks/useLeaderboard.ts`, `src/app/hooks/useRefreshJob.ts`
- Modify: `src/app/App.tsx` (mount `QueryClientProvider`)
- Delete: the old `src/app/api.ts` fetch wrapper (replaced in place)
- Test: `test/api-client.test.ts` (rewrite against the new hooks or delete if its subject is gone; say which in the report)

**Interfaces:**
- Produces: `client` (`hc<AppType>('/')`), `useLeaderboard(selection)`, `useUserDetail(username)`, `useRefreshJob()` with the existing poll-start-cancel behavior, and `readOrThrow<T>(res, label)`.

- [ ] **Step 1: The client**

```ts
import { hc } from "hono/client";
import type { AppType } from "../server/routes";
export const client = hc<AppType>("/");
```

Response types derive from the server, never hand-written: `type Leaderboard = InferResponseType<typeof client.api.leaderboard.$get, 200>`.

- [ ] **Step 2: `readOrThrow`**

The server returns `{ error }` envelopes on failure. One helper unwraps them into thrown `Error`s so every hook has the same error semantics, matching console's `src/app/wiring/useWiring.ts`.

- [ ] **Step 3: The hooks**

`useLeaderboard` and `useUserDetail` are plain `useQuery` reads keyed on the selection (range, trend, custom bounds). **The job polling behavior is preserved exactly**: read the current `src/app/App.tsx` and `src/app/lib/progress.ts` first, then reimplement the same sequence with react-query, namely the cache-only probe, starting a refresh job when cold, polling `/api/refresh/:id` until done, surfacing `RefreshProgress` for the progress bar, and cancelling on demand. Stall detection in `lib/progress.ts` stays as-is and keeps its tests.

Mount `QueryClientProvider` in `App.tsx` inside the shell.

- [ ] **Step 4: Validate**

`bun run test`, `bun run typecheck`, `bun run build`, then `bun run dev`: the leaderboard loads, a refresh runs to completion with a live progress bar, and cancelling works. Confirm `InferResponseType` really is inferring by breaking a server response shape temporarily and watching the client fail to typecheck; undo it.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "typed hono rpc through react-query; job polling preserved"
```

---

### Task 6: Rebuild the views on app-kit

**Files:**
- Rewrite: `src/app/components/LeaderboardTable.tsx`, `MetricCards.tsx`, `DetailPage.tsx`, `EvidenceTable.tsx`, `Controls.tsx`, `RefreshProgress.tsx`, `DeltaBadge.tsx`, `MetricTip.tsx`, `Tooltip.tsx`
- Delete: `src/app/components/ui/**` (the eight shadcn primitives), `src/app/lib/utils.ts` (the `cn` helper)

**Interfaces:**
- Consumes: Task 5's hooks, Task 4's routes. Produces the finished leaderboard, cards, and detail views.

- [ ] **Step 1: Read the design**

Open `docs/superpowers/design/boxscore-ui/Main.dc.html` (leaderboard), `Cards.dc.html`, `Detail.dc.html`, and `Refreshing.dc.html`. They are the approved target: a dense table as the primary view with cards secondary, a 48px header, a 40px title row, and a 68px rail. Match the information hierarchy and density; exact pixel fidelity is not required where an app-kit primitive has its own spacing.

- [ ] **Step 2: The leaderboard table**

Rebuild on app-kit's `Table` from `@mattstack/app-kit/core`. If the roster grows past what renders comfortably, `VirtualTable` is available with the same column shape, but the roster is single-digit today so the plain `Table` is right; do not add virtualization speculatively.

Preserve every behavior the current table has: per-metric sorting, rank display, the leader highlight, the current-user row emphasis, delta badges when trend is on, and the metric tooltips sourced from `METRICS` descriptors.

- [ ] **Step 3: Cards, detail, evidence, controls**

`MetricCards` becomes Mantine `Card`s in a responsive grid. `DetailPage` keeps its rail-plus-evidence structure, with the stat rail driving the `/user/:name/:stat` route. `EvidenceTable` renders `MetricEvidence.columns`/`rows` with `href` links and the `muted` styling for non-counting rows. `Controls` (range preset, trend toggle, refresh) rebuilds on Mantine inputs. `RefreshProgress` keeps its stall-detection wiring from `lib/progress.ts`.

- [ ] **Step 4: Delete the local primitives**

Remove `components/ui/**` and `lib/utils.ts` once nothing imports them. `grep -rn "components/ui\|from \"@/lib/utils\"" src/` must come back empty.

- [ ] **Step 5: Validate**

`bun run test`, `bun run typecheck`, `bun run lint` (the Mantine-wall violations from Task 2 should be gone), `bun run build`, then `bun run dev` and walk all three views against the artboards.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "rebuild the leaderboard, cards, and detail views on app-kit"
```

---

### Task 7: The settings page

**Files:**
- Create: `src/app/settings/SettingsPage.tsx`, `src/app/settings/shapes.ts`
- Modify: `src/app/App.tsx` (route `/settings`)

**Interfaces:**
- Consumes: `useSettingsScope` and `useSettingKey` from `@mattstack/settings-kit/react`, against the handler Task 3 mounted.

- [ ] **Step 1: Shapes**

Boxscore's keys are mostly composite, so they need the shape layer the board uses. Read `/Users/matt/Documents/GitHub/board/src/client/board/config-shapes.ts` and `ConfigModal.tsx` first; mirror the pattern rather than inventing one.

```ts
export const COMPOSITE_SHAPES: Record<string, CompositeShape> = {
  "mattstack.roster": { kind: "roster" },
  "boxscore.projects": { kind: "stringList" },
  "boxscore.linearDoneStates": { kind: "stringList" },
  "boxscore.excludeFilePatterns": { kind: "stringList" },
  "boxscore.ignoredMrs": { kind: "stringList" },
  "boxscore.botPatterns": { kind: "stringList" },
  "boxscore.hiddenMembers": { kind: "stringList" },
  "boxscore.sizeBand": { kind: "leaves", fields: { tooSmall: "number", tooLarge: "number" } },
};
```

`boxscore.defaultRange` is a plain scalar and needs no shape (render it as a select over `7d`/`30d`/`90d`).

- [ ] **Step 2: The page**

`useSettingsScope("boxscore.")` for the app's own keys plus `useSettingKey("mattstack.roster")` for the shared roster, grouped by scope (team keys and user keys in separate sections, since that distinction determines who a change affects). Every composite control writes the WHOLE value back through `store.set`, never a partial patch: that is the board's rule and the wire contract's.

Respect `def.writable`: a non-writable or secret row renders read-only. Show `def.description` as help text, since the registry descriptions were written for exactly this surface.

`Settings.dc.html` in the design directory is the visual target.

- [ ] **Step 3: Validate**

`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`. Then, with the real daemon running, load `/settings` and confirm the boxscore keys and the roster render with their current values, that a scalar edit round-trips, and that a team-scope write reports where it landed. **Do not leave a test value in the team store**: if you write during verification, restore the prior value and say so in the report.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "settings page on settings-kit over the boxscore and roster keys"
```

---

### Task 8: Manifest, docs, and the full gate

**Files:**
- Modify: `mattstack.deck.json`, `README.md`, `index.html`

**Interfaces:**
- Produces: the releasable branch.

- [ ] **Step 1: The deck manifest**

`dev.start` becomes the new server entry (`bun src/server/index.ts`). Verify `build` and `deploy` still match the Task 2 scripts, and that `icon` still resolves after the `web/public` move.

- [ ] **Step 2: index.html**

Assert the loading-bar markup matches app-kit's canonical block using `expectLoadingBarInSync` from `@mattstack/app-kit/test-utils`, as console's Task 8 does. Add it as a test rather than eyeballing it.

- [ ] **Step 3: README**

Rewrite the architecture and development sections for the new layout and stack: `src/server` on app-server, `src/app` on app-kit, settings through rt with the page at `/settings`, and the same data-layer description SP4 left (sqlite store, glance transport, window-as-query, merged MRs immutable).

- [ ] **Step 4: The full gate**

`bun run test`, `bun run typecheck`, `bun run lint` (zero violations now), `bun run build`, and a final `bun run dev` walkthrough of all four routes. Then `deck restart boxscore` and confirm it comes up on 11005 under the deck frame.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "deck manifest, README, and index.html for the app-kit stack"
```

---

## Self-Review

- **Spec coverage.** Section 8's seven bullets map to tasks: layout (T1), wouter (T4), react-query over Hono RPC (T5), settings-kit page (T7), `serveMattstackApp` and the frame's health (T3), the deck manifest (T8). The design artboards drive T6 and T7.
- **Frozen surfaces.** The SP4 data layer and the wire types are touched only by T1's mechanical import rewrite. Any behavior change there is a finding.
- **Known risk.** T6 is the largest task by far, rewriting nine components. If its review surfaces more than a couple of Important findings, splitting it (table and controls, then detail and evidence) is the right call rather than a long fix loop.
- **Open implementer choice.** Whether `MetricTip`/`Tooltip` collapse into app-kit's `IconTooltip` or stay as thin local wrappers is left to T6; either is acceptable if the metric descriptions still surface on hover.
