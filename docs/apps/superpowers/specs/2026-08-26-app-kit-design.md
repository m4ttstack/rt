# app-kit: one UI package and one server package for mattstack apps

Date: 2026-08-26. Status: approved design, awaiting implementation plan.

## Problem

Every mattstack web app (chat, console today) is scaffolded from `mantine-kit`
and carries its own copy of the kit: `src/ui/**` (about 11k lines of
ts/tsx/css, 126 of 135 shared-path files byte-identical between chat and
console), the Vite/ESLint/tsconfig files, the boot family, and a Hono/Bun
server whose plumbing (health route,
JSON error floors, static serving, `/ws` relay, `Bun.serve`, signals) is 90%
the same in both. Every cross-cutting change lands twice: the wouter swap
(chat #5, console #15), the Tokyo contrast fix, the theme extraction.

## Goal

Two source-shipped packages, one repo, so an app is only its product code:

- `@mattstack/app-kit`: the kit plus a whitelabeled mattstack layer (shell,
  boot, router helpers, config presets), Tokyo theme pre-wired.
- `@mattstack/app-server`: the Hono/Bun server frame with rt-client relay,
  static/embedded serving, and the JSON contract both apps rely on.

Chat migrates in this pass. Console migrates in a second plan from its
post-wouter `main` (#15 merged 2026-08-26 as `2481b18`).

## Non-goals

- Merging chat and console into one app (assessed, rejected in favour of
  this).
- Changing `mantine-kit` itself. It stays the public generic template; fixes
  flow between it and app-kit by hand, with no sync tooling.
- A `create-mattstack-app` scaffolder. Possible follow-up once two apps
  consume the packages.
- Publishing to npm inside this work. Publishing is Matt's step; consumers
  use `file:` until then.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Where the packages live | New repo `m4ttstack/app-kit`, bun workspace, source-shipped npm packages (the `@mattstack/mantine-tokyo` shape). |
| Relation to `mantine-kit`'s `src/ui` | app-kit absorbs it and becomes the source of truth for mattstack apps; apps delete `src/ui`. |
| Import surface | Subpath exports (`@mattstack/app-kit/core` etc.), no `@ui/*` alias. |
| Router | wouter is a dependency of the package; `RailLink`, `Link`, `useHash` ship in `@mattstack/app-kit/router`. Route tables stay in apps. |
| Server | One `serveMattstackApp()` entry with `createApp`, `startRelays`, `mountStatic` as separately exported seams. Embedded (compiled binary) mode is in v1. |
| Error envelope | `{ error: string }` (console's RPC-typed shape). Chat adjusts. |
| Scope of this pass | Packages, a probe app, chat migration. Console later. |
| Worktrees | Every change to an existing repo happens in a clean worktree off `main`. |

## A. Repo and package layout

```
app-kit/                          m4ttstack/app-kit (bun workspace)
  packages/ui/                    @mattstack/app-kit
    src/core, hooks, forms, modals, notifications, icons, lazy, spotlight,
        design-system, styles, utils, storybook   (the kit, moved verbatim, stories included)
    src/boot/                     SimpleAlerts, simple-loading-bar.css (the boot family)
    src/app/                      mountMattstackApp, MattstackShell, DaemonBanner, useDaemonHealth, NotFoundPage
    src/router/                   RailLink, Link, useHash (wouter)
    presets/eslint.js             flat config with the import wall and the local rules
    presets/eslint-local/         no-inline-styles.js, require-data-testid.js (from the apps' eslint-local/)
    presets/vite.ts               mattstackVite()
    tsconfig.base.json
    scripts/treeshake-check.sh + scripts/treeshake-probe/   moved with the kit
  packages/server/                @mattstack/app-server
    src/app.ts, relays.ts, static.ts, serving-mode.ts, embedded/*, serve.ts
    bin/mattstack-embed-assets.ts
  packages/tokyo/                 @mattstack/mantine-tokyo (moved from console/packages: seven files incl. src/fonts/jetbrains-mono.woff2, a binary; version line continues from 0.1.2)
  probe/                          private app that consumes the packages the way chat will; CI target
  .storybook/                     main.ts + preview.tsx, moved from console
  docs/superpowers/specs/         this spec
```

Packaging rules, all three packages:

- Source-shipped: `exports` point at `src/*.ts(x)` and `.css`; no `dist`, no
  build step, nothing to go stale for `file:` consumers.
- Dependency classification for `@mattstack/app-kit`:
  - Peers (the app installs them; a second copy would break types or
    context): `react`, `react-dom`, `@mantine/core`, `@mantine/dates`,
    `@mantine/hooks`, `@mantine/form`, `@mantine/modals`,
    `@mantine/notifications`, `@mantine/spotlight`, `@mantine/code-highlight`
    (all on the 9.5 line), `wouter` (3.x), `zod` (4.x).
  - Dependencies (internal to the kit, apps never import them):
    `@mattstack/mantine-tokyo` (workspace version), `clsx`, `dayjs`,
    `lucide-react`, `mantine-form-zod-resolver`, `react-interval-hook`,
    `@tanstack/react-virtual`, `codemirror`, `@codemirror/state`,
    `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-javascript`,
    `@codemirror/lang-json`.
  - `@mattstack/app-server` peers: `hono` (4.x), `@mattstack/rt-client`
    (0.6 line). No dependencies.
  Ranges match what chat and console pin today. The probe verifies that a
  `file:` install resolves `react` and `@mantine/core` exactly once.
- One version per package, bumped by hand. `sideEffects: ["*.css"]` on the
  UI package so tree-shaking keeps working.
- Repository field points at `m4ttstack/app-kit` with the package
  `directory`.

Consumption during this pass: `"@mattstack/app-kit": "file:../app-kit/packages/ui"`
and the same for the server package. `bun link` is the alternative for
day-to-day iteration. After Matt publishes, apps switch to version ranges.

## B. `@mattstack/app-kit`

### Subpath exports

| Subpath | Contents |
|---|---|
| `./core` | `export * from '@mantine/core'` and `@mantine/dates`, then the kit's shadows (`Table`, `TextInput`, `CopyButton`) and components (`PageShell`, `RailShell`, `Rail`, `RailEntry`, `SiteShell`, `HybridMenu`, `SelectableList`, `VirtualTable`, ...) |
| `./hooks` | `useColorScheme`, `useStorage`, `useUIState`, `useIsMobile`, `useSchemeColors`, `useHasOverflowX`, `useHoverableTextStyle` |
| `./forms` | `FormContainer`, `useModalForm`, `useModalFormSubmit`, validation, types |
| `./modals` | `modals` facade (`confirm`, `prompt`), `ModalsProvider` |
| `./notifications` | `notifications` facade, `TimedRingProgress` |
| `./icons` | `Icon`, `IconName`, `AnimatedChevron`, `registerIcons`. The registry is the kit's; chat's `Hash` is NOT folded in (it becomes chat's example app registration) |
| `./lazy` | `LazyLoader`, `CodeHighlight`, `CodeMirror` (console's loader moves in) |
| `./spotlight` | spotlight re-exports (from console) |
| `./design-system` | `theme` (pre-branded), `baseTheme`, `ThemeIsland`, `ScopedThemeProvider`, `ThemeInitializer`, `ThemeOverrideWrapper`, `getColorSchemeFromDocument` |
| `./boot` | `registerSimpleAlerts`, `markMounted`, `LOADING_BAR_CSS` (the synced block as a string); `./boot/simple-loading-bar.css` is the stylesheet |
| `./app` | `mountMattstackApp`, `MattstackShell`, `DaemonBanner`, `useDaemonHealth`, `NotFoundPage` |
| `./router` | `RailLink`, `Link`, `useHash` |
| `./utils` | `createDynamicTable`, `noop` |
| `./test-utils` | `renderWithProviders`, `spyableAction`, jsdom polyfills (today's `@ui/storybook/*`; chat's product tests import `renderWithProviders`), `expectLoadingBarInSync(indexHtml: string)` |
| `./styles.css` | kit styles entry (Mantine styles, scheme vars, overrides) |
| `./eslint` | flat config array |
| `./vite` | `mattstackVite()` |

Internal relative imports inside the kit folders stay as they are; only the
barrels' public paths change. Deep specifiers apps use today are flattened
to the barrels during migration: `@ui/storybook/test-utils` and
`@ui/storybook/jsdom-polyfills` -> `./test-utils`, `@ui/styles/index.css`
-> `./styles.css`, `@ui/hooks/useSchemeColors` -> `./hooks`,
`@ui/utils/noop` -> `./utils`. The kit's `mantine.d.ts` (the `tokyo.*`
colour name augmentation of `@mantine/core`) ships in the package so
consumers get it by importing any subpath.

### Boot family

`src/boot/` moves into the package: `SimpleAlerts.ts` (with its test) and
`simple-loading-bar.css`. The two-file sync contract from mantine-kit's
AGENTS.md section 7 is kept with a clear owner on each side: the package
owns the stylesheet and exports its synced block as `LOADING_BAR_CSS`; the
app owns `index.html` (it must inline the block so the bar paints before
the bundle loads) and keeps a one-line `loading-bar-sync.test.ts` that
calls `expectLoadingBarInSync(readFileSync('index.html'))`. The check
therefore runs in every app against the package version it actually
installed. `mountMattstackApp` calls `registerSimpleAlerts()` before render
and `markMounted()` after, exactly as the apps' `main.tsx` do today.

### Pre-branded design-system

`app-theme.ts` and `app-colors.ts` are the Tokyo re-exports permanently.
`theme` is `mergeThemeOverrides(baseTheme, tokyoTheme)`. `baseTheme` stays
exported so `<ThemeIsland theme={baseTheme} baseSurfaces>` still gives the
unbranded kit look inside a subtree. Apps never carry theme files.

This closes the kit's per-app brand-colour extension point on purpose:
`MantineThemeColorsOverride` can be declared once per program, and the
package declares it with the Tokyo names. A mattstack app that needs a new
named colour adds it to `@mattstack/mantine-tokyo` (a kit change), not to
itself. Theme values other than colour names are overridable through
`mountMattstackApp(node, { theme })`.

### `app` module

```ts
mountMattstackApp(
  node: ReactNode,
  opts?: { theme?: MantineThemeOverride; notificationMaxHeight?: number }
): void
```

Renders `StrictMode > MantineProvider(theme merged with opts.theme,
defaultColorScheme "auto") > ModalsProvider > node + Notifications`, brackets
the render with `registerSimpleAlerts()` / `markMounted()`, and imports
`./styles.css` and the Tokyo CSS as a side effect of the module. Target
element is `#root`.

```tsx
<MattstackShell name="chat" mark={<AppMark size={30} />} headerHeight?={64}>
  <MattstackShell.Rail label?="App sections">
    <RailLink icon="users" label="Rooms" href="/" active />
  </MattstackShell.Rail>
  <MattstackShell.RailBottom>{/* optional, above the scheme control */}</MattstackShell.RailBottom>
  {children}
</MattstackShell>
```

`MattstackShell` owns the `RailShell` wiring, `useRailState`, the
translucent header (`useSiteHeaderProps` from chat), the 30px mark + 22/700
wordmark recipe, and the colour-scheme control pinned to the rail bottom
(console's three-way `HybridMenu`: System / Light / Dark). `Rail` and
`RailBottom` are compound statics attached with a `/* @__PURE__ */
Object.assign`, per the kit's tree-shake rules.

`DaemonBanner` is chat's presentational component, moved as is.
`useDaemonHealth(seed?: boolean)` is the hook that lives inside chat's
`App.tsx` today, extracted: it polls `/api/daemon` (the route
`@mattstack/app-server` mounts) and returns `{ reachable, downSince,
probeCount, lastAnsweredAt, probeNow }`. `seed` is the initial `reachable`
value, kept so chat's `App.test.tsx` can still drive the daemon's starting
state through `initialState.daemonReachable`. `NotFoundPage` takes `home`
(default `/`).

### `router` module

`RailLink` renders `RailEntry` through wouter's `Link` (`href`, `active`,
closes the rail on click via shell context). `Link` is wouter's, re-exported
so apps have one door. `useHash()` is
`useLocationProperty(() => window.location.hash)`.

### Extension points

- Icons: `registerIcons({ hash: lucideWrapperFn(Hash) })` at boot, plus
  `declare module '@mattstack/app-kit/icons' { interface AppIcons { hash: true } }`
  in the app's `.d.ts`. `IconName` is `keyof KitIcons | keyof AppIcons`, so it
  stays a closed union that includes app additions. `Icon` reads a
  module-level registry; registration before first render is the contract,
  and registering a key the kit already has throws. Chat's `Hash` is the
  first real registration (it is not in the package registry).
- Theme: `mountMattstackApp(node, { theme })` merges on top of Tokyo.
- Lazy loaders: heavy dependencies get a loader in the package, never in an
  app, so vendor splitting has one owner.

### Presets

- `presets/eslint.js`: the kit's flat config with the wall re-pointed
  (`@mantine/core` -> `@mattstack/app-kit/core`, `@mantine/hooks` ->
  `.../hooks`, form, modals, notifications, spotlight, code-highlight ->
  `.../lazy`, dates -> `.../core`), the `lucide-react` / `react-icons` /
  `codemirror` bans, the `**/server/**` browser guard (type imports only;
  new to chat, whose client has no value import from `src/server`, so it
  passes clean), the `local/no-inline-styles` and `local/require-data-testid`
  rules (the apps' `eslint-local/` moves into the preset), react-hooks, and
  prettier last. Exported as an array the app spreads; storybook rules are
  not included (stories live in app-kit).
- `presets/vite.ts`: `mattstackVite({ apiPort, proxy = true, extraGroups = [] })`
  returns a `UserConfig` with the react plugin, the vendor `codeSplitting`
  groups (react, mantine incl. spotlight, codemirror, codemirror-lang), the
  `/api` + `/ws` dev proxy to `apiPort`, `preview.allowedHosts` from
  `PREVIEW_ALLOWED_HOSTS`, the vitest block (jsdom, globals, setup file), and
  whatever `optimizeDeps` / plugin `include` settings the probe proves are
  needed for a source-shipped TSX package under `node_modules`.
- `tsconfig.base.json`: the kit's `tsconfig.app.json` compiler options
  (bundler resolution, strict, `jsx: react-jsx`, `types: ["vite/client",
  "vitest/globals", "bun", "@testing-library/jest-dom"]`, chat's convention;
  console's `src/jest-dom.d.ts` goes when it migrates) for `extends`.

### Tests, stories, guards

The kit's 27 tests and 34 stories move with their components; the stories
and `.storybook/` come from console (chat has none). The treeshake check
script and probe move and import through the package subpaths. New tests:
`MattstackShell` (rail entries, scheme control, header), `registerIcons`
(union extension, duplicate key rejection), `mountMattstackApp` (theme
override merged, alerts bracket order), `useDaemonHealth` (seed honoured,
probe cadence), `RailLink` (navigates, closes rail),
`expectLoadingBarInSync` (passes on the probe's `index.html`, fails on a
drifted block).

## C. `@mattstack/app-server`

```ts
import { serveMattstackApp } from '@mattstack/app-server';
import { routes } from './routes';

serveMattstackApp({
  name: 'chat',
  version: pkg.version,
  routes,
  port: 11002,                              // env PORT overrides; binds 127.0.0.1
  relay: [{ match: t => t.startsWith('chat/'), topic: 'chat' }],
  embedded: () => import('./embedded/manifest'),   // optional; absent = ./dist
});
```

Subpath exports, so the vitest-safe seams never load `hono/bun`:

| Subpath | Exports | Importable under vitest |
|---|---|---|
| `./app` | `createApp({ name, version, routes })`: mounts `/api/health` (`{ ok: true, name, version }`), `/api/daemon` (rt-client `daemonHealth`, always 200), then `routes`; JSON 404 `{ error: 'not found' }`; `onError` answers `{ error: err.message }` with the `HTTPException` status or 500 | yes |
| `./relays` | `startRelays(relays, publish)`: one rt-client `createRelay` per entry; returns a single stop function | yes |
| `./static` | `mountStatic(app, serveStatic, { embedded? })`: `serveStatic` is injected (chat's seam, so the path rules are testable with a fake); disk: `/assets/*`, `/fonts/*`, `favicon.svg` and the raster icon set from `./dist`; embedded: manifest-driven serving; SPA fallback for every other path except `/api/*` (JSON 404) and `/ws` (next). Also `decideServingMode({ manifestLoaded, isCompiledBinary })`, console's rule verbatim (manifest -> embedded; compiled binary without manifest -> fatal with the build:binary message; else disk), `loadEmbeddedManifest`, `isCompiledBinary` | yes |
| `.` | `serveMattstackApp(opts)`: `createApp` + `mountStatic` with `hono/bun`'s `serveStatic` + `/ws` upgrade subscribing each socket to every relay topic + `Bun.serve({ hostname: '127.0.0.1' })` + `server.publish` fan-out + SIGINT/SIGTERM -> stop relays, stop server | no (`hono/bun`) |

`bin/mattstack-embed-assets.ts` is console's `generate-embedded-assets.ts`
generalised: walks `dist/`, writes `src/server/embedded/manifest.ts` with
`with { type: 'file' }` imports and the path map. An app's `build:binary`
is `vite build && mattstack-embed-assets && bun build --compile --outfile
dist-bin/<name> src/server/index.ts`.

`AppType` stays `typeof routes` in the app, so the RPC client's typing is
untouched by the frame.

Tests: `createApp` floors (unknown route, thrown `HTTPException`, thrown
Error), `/api/health` payload, `/api/daemon` relays the down envelope,
`startRelays` fans two entries into one stop, `decideServingMode` table,
`mountStatic` path rules with a fake `serveStatic` (chat's
`static-disk.test.ts`, extended for embedded mode), embedded
`manifest-loader` / `mount` / `serve` / `compiled-binary` tests from console.

## D. Migration

Order: app-kit repo, probe, chat. Console is a separate plan after #15.

### app-kit bring-up

1. Workspace skeleton, CI (typecheck, lint, test, storybook build, treeshake,
   probe build).
2. `packages/tokyo` copied from `console/packages/mantine-tokyo` (seven
   files including the `woff2` font, copied as bytes; history not
   preserved).
3. `packages/ui`: kit folders copied from console's `src/ui` (the copy that
   carries the 34 stories, the CodeMirror loader and the spotlight folder),
   with chat's `RailShell.railProps` addition folded in and chat's `Hash`
   icon left out; `.storybook/` from console; chat's `src/boot/` as the
   boot module; the apps' `eslint-local/` rules and `scripts/treeshake-*`
   moved into the package; barrels re-pathed; then `app`, `router`, presets
   written fresh.
4. `packages/server` written fresh from the two servers, tests ported.
5. `probe/`: a minimal app (shell, one route, one registered icon, a
   `tokyo.*` colour, one API route, relay) that must typecheck, lint against
   the eslint preset, build, and serve. This is where the Vite
   source-serving risk is proven before chat is touched.

### chat (worktree `chat-app-kit-wt` off `main`)

- Delete `src/ui/{core,design-system,forms,hooks,icons,lazy,modals,notifications,storybook,styles,utils,mantine.d.ts}`
  and `src/ui/DaemonBanner*` (the package's replaces it).
- Move chat's product files out of `src/ui/` into `src/app/`: `Transcript`,
  `Composer`, `Roster`, `RoomRail`, `PageBar`, `AgentName`, `presence-bits`,
  `buddies-context`, `statusDetail`, `test-utils.tsx` (its Transcript fetch
  mocks; `renderWithProviders` now comes from `@mattstack/app-kit/test-utils`),
  their CSS modules and tests.
- `'@ui/` -> `'@mattstack/app-kit/` across `src/`, plus the deep-specifier
  flattening listed in section B.
- Also deleted, made redundant by the package: `src/boot/` (its
  `loading-bar-sync.test.ts` is replaced by the one-liner calling
  `expectLoadingBarInSync`), `src/app/NotFoundPage.tsx`,
  `src/app/styles/tokyo-theme.css` (and its import in `main.tsx`),
  `scripts/treeshake-check.sh`, `scripts/treeshake-probe/`, the `treeshake`
  script in `package.json`, `eslint-local/`. `index.html` stays (it inlines
  the loading-bar block).
- `AppChrome`, `AppMark`'s header wiring, `layout.ts` replaced by
  `MattstackShell` (`AppMark` itself stays as the `mark`); `main.tsx` becomes
  `mountMattstackApp(<App />)`; `useDaemonHealth` leaves `App.tsx` for the
  package (seed preserved); `Hash` registered via `registerIcons` with the
  `AppIcons` augmentation in `src/app/icons.d.ts`.
- `src/server/{app,index,static-disk,ws,health}.ts` replaced by `routes.ts`
  (the existing `chat` Hono chain) and an `index.ts` calling
  `serveMattstackApp` with `port: 11002` (deck's port for chat; today's
  code defaults to 3000 and binds all interfaces, the package binds
  127.0.0.1). Error envelope switched to `{ error }`; the client's `ok`
  checks adjusted. A `serve` script (`bun run src/server/index.ts`) added
  to `package.json` to match console.
- Config files become preset one-liners. `package.json`: add the two
  `file:` packages; add the peers chat lacks today (`@mantine/spotlight`);
  keep every other peer installed; drop the direct deps that became package
  internals (`clsx`, `dayjs`, `lucide-react`, `mantine-form-zod-resolver`,
  `react-interval-hook`, `@tanstack/react-virtual`) unless product code
  imports them.
- Docs: `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md` re-pointed; `AGENTS.md`
  shrinks to what is app-specific plus a pointer at app-kit's own
  `AGENTS.md` (the kit contract moves there).
- rt side: unchanged. Same host, same `/r/<room>#m-<id>` contract, same deck
  service and start command.

### console (later)

Same moves, plus: embedded mode through the package, `packages/mantine-tokyo`
removed, `build:binary` on the bin, `ConsoleChrome` and `ConsolePalette`
onto the shell. Starts from post-#15 `main`.

## E. Testing and verification

- app-kit CI green: vitest, storybook build, treeshake, probe typecheck +
  lint + build.
- chat: of the 33 test files under `src/ui`, 27 are removed (26 kit tests
  plus `DaemonBanner.test.tsx`, whose component now lives in the package)
  and 6 move to `src/app`; `src/boot`'s two tests are removed and the
  loading-bar one-liner added. `bun run typecheck`, `bun run lint`,
  `bun run build`, and `bun run serve` against the real daemon (rooms load,
  a post renders, `/ws` delivers).
- No browser verification without Matt's go-ahead; the deck preview port is
  available as for chat #5.

## F. Risks

| Risk | Handling |
|---|---|
| Vite does not transform TSX + CSS modules under `node_modules` for a source-shipped package | Probe app is the first plan task; the vite preset carries `optimizeDeps.exclude` and the react plugin `include` for the package. If it cannot be made clean, fall back to a `tsc` emit to `dist` on `prepack` (rt-client's shape) and amend this spec. |
| `@mantine/core` augmentation and `IconName` augmentation across the package boundary | Probe asserts both compile. |
| Peer version skew | Peers pinned to the ranges chat and console use; the probe installs exactly those. |
| Console drifting while this lands | Console is untouched in this pass; its plan starts from `main` at `2481b18` or later. |
| `file:` deps until publish | Stated in the chat PR; publishing is Matt's step. |
| Duplicate React from a `file:` link resolving its own `node_modules` | Peers are not installed inside the packages; the probe checks `react` resolves once. |

## Open items for Matt

- npm publish of the three packages when the chat migration is merged.
- Whether chat ships in the distributed console binary is a console-plan
  question, not this one.
