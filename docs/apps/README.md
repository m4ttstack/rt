# app-kit

Three source-shipped packages that let a mattstack web app be only its
product code. No `dist`, no build step: `exports` in each package.json
point straight at `src/*.ts(x)` and `.css`, so a consumer gets the same
files whether it installs a tarball or a future npm release.

| Package           | Name                       | What it is                                                                                                                                       |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/ui`     | `@mattstack/app-kit`       | The Mantine-based component kit plus the mattstack layer: app shell, boot, router helpers, icon registry, config presets. Tokyo theme pre-wired. |
| `packages/server` | `@mattstack/app-server`    | The Hono/Bun server frame: health route, JSON error floors, static/embedded asset serving, the rt-client relay, `Bun.serve`.                     |
| `packages/tokyo`  | `@mattstack/mantine-tokyo` | The Tokyo Day/Night brand tokens (colour ramps, theme values, colour names, CSS, font) `@mattstack/app-kit` themes itself with.                  |

`probe/` is a private consumer app in this repo that installs the three
packages the way an external app will, so CI proves the packages actually
work outside their own workspace before a real app depends on them.

See `packages/ui/README.md` and `packages/server/README.md` for
per-package detail, `AGENTS.md` for the contract anyone editing
`packages/ui/src` or consuming these packages needs, and
`docs/superpowers/specs/2026-08-26-app-kit-design.md` for the full design.

## `@mattstack/app-kit` subpaths

| Subpath           | Contents                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./core`          | `export * from '@mantine/core'` and `@mantine/dates`, then the kit's shadows (`Table`, `TextInput`, `CopyButton`) and components (`PageShell`, `RailShell`, `Rail`, `RailEntry`, `SiteShell`, `HybridMenu`, `SelectableList`, `VirtualTable`, ...) |
| `./hooks`         | `useColorScheme`, `useStorage`, `useUIState`, `useIsMobile`, `useSchemeColors`, `useHasOverflowX`, `useHoverableTextStyle`                                                                                                                         |
| `./forms`         | `FormContainer`, `useModalForm`, `useModalFormSubmit`, validation, types                                                                                                                                                                           |
| `./modals`        | `modals` facade (`confirm`, `prompt`), `ModalsProvider`                                                                                                                                                                                            |
| `./notifications` | `notifications` facade, `TimedRingProgress`                                                                                                                                                                                                        |
| `./icons`         | `Icon`, `IconName`, `AnimatedChevron`, `registerIcons`. The registry is the kit's; an app's own icons are the app's registration, not a kit fork.                                                                                                  |
| `./lazy`          | `LazyLoader`, `CodeHighlight`, `CodeMirror`                                                                                                                                                                                                        |
| `./spotlight`     | spotlight re-exports                                                                                                                                                                                                                               |
| `./design-system` | `theme` (pre-branded), `baseTheme`, `ThemeIsland`, `ThemeInitializer`, `ThemeOverrideWrapper`, `getColorSchemeFromDocument`, `variantColorResolver`                                                                                                |
| `./boot`          | `registerSimpleAlerts`, `markMounted`; `./boot/simple-loading-bar.css` is the stylesheet                                                                                                                                                           |
| `./app`           | `mountMattstackApp`, `MattstackShell`, `DaemonBanner`, `useDaemonHealth`, `NotFoundPage`                                                                                                                                                           |
| `./router`        | `RailLink`, `Link`, `useHash`                                                                                                                                                                                                                      |
| `./utils`         | `createDynamicTable`, `noop`                                                                                                                                                                                                                       |
| `./test-utils`    | `renderWithProviders`, `spyableAction`, jsdom polyfills, `expectLoadingBarInSync(indexHtml: string)`                                                                                                                                               |
| `./styles.css`    | kit styles entry (Mantine styles, scheme vars, overrides)                                                                                                                                                                                          |
| `./eslint`        | flat config array (`mattstackEslint()`)                                                                                                                                                                                                            |
| `./vite`          | `mattstackVite()`                                                                                                                                                                                                                                  |

`@mattstack/app-server` exports `.` (`serveMattstackApp`, the one module
that touches `hono/bun`), plus the vitest-safe seams `./app`, `./relays`,
`./static`. See `packages/server/README.md` for the full table.

## Consumer snippets

```tsx
// src/main.tsx
import { mountMattstackApp } from '@mattstack/app-kit/app';
import { App } from './App';

mountMattstackApp(<App />);
```

```tsx
// src/App.tsx
import { MattstackShell } from '@mattstack/app-kit/app';
import { RailLink } from '@mattstack/app-kit/router';

export function App() {
  return (
    <MattstackShell name="chat">
      <MattstackShell.Rail>
        <RailLink icon="users" label="Rooms" href="/" active />
      </MattstackShell.Rail>
      {/* routed page content */}
    </MattstackShell>
  );
}
```

```ts
// src/server/index.ts
import { serveMattstackApp } from '@mattstack/app-server';
import pkg from '../../package.json';
import { routes } from './routes';

await serveMattstackApp({
  name: 'chat',
  version: pkg.version,
  routes,
  port: 11002,
  relay: [{ match: t => t.startsWith('chat/'), topic: 'chat' }],
});
```

## Local development

```bash
bun install                 # workspace install: packages/ui, packages/server, packages/tokyo
bun run test                # vitest across packages/ui + packages/server
bun run storybook           # dev server at :6006 (packages/ui's stories)
bun run probe:install       # packs the three packages as tarballs, installs the probe app against them
bun run probe:build         # typechecks and builds the probe app against the packed packages
```

`bun run typecheck`, `bun run lint`, `bun run format:check`,
`bun run build-storybook`, and `bun run treeshake` are the other gates CI
runs; `bun run probe:test` and `bun run probe:serve-check` exercise the
probe's own tests and its running server. See `AGENTS.md`'s "Consumer
requirements" section before wiring a new app to these packages: it
documents four real failure modes a naive `file:` consumer hits.

## Consumption

**Today (pre-publish)**: depend on a packed tarball, not a bare `file:`
directory. Bun 1.3 installs a bare `file:../packages/ui` dependency as a
symlink into the source tree, which resolves peers like `react` twice and
breaks typecheck and tests in the consumer. `probe/package.json` is the
reference: it depends on `file:./vendor/mattstack-app-kit-0.1.0.tgz` etc,
and `bun run probe:install` (root `package.json`) is the script that packs
each package with `bun pm pack` into `probe/vendor/` before installing.
A migrating app should do the same: pack each package into its own
`vendor/` directory and depend on the `.tgz`.

**After publish**: Matt publishes each package to npm by hand (one version
per package, bumped by hand, no automated release step in this repo).
Once published, a consumer switches to a version range
(`"@mattstack/app-kit": "^0.1.0"`) the same as any other npm dependency.
