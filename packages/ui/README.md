# @mattstack/app-kit

The Mantine-based component kit for mattstack apps, plus the mattstack
layer on top of it: app shell, boot, router helpers, icon registry, config
presets. Tokyo theme (`@mattstack/mantine-tokyo`) pre-wired -- a consuming
app never carries its own theme file. Source-shipped: `exports` point at
`src/*.ts(x)` and `.css` directly, no build step.

See the repo root `README.md` and `AGENTS.md` for the full contract; this
file is the one-screen version for this package.

## Subpaths

| Subpath                | Contents                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./core`               | `export * from '@mantine/core'` and `@mantine/dates`, then the kit's shadows (`Table`, `TextInput`, `CopyButton`) and components (`PageShell`, `RailShell`, `Rail`, `RailEntry`, `SiteShell`, `HybridMenu`, `SelectableList`, `VirtualTable`, ...) |
| `./hooks`              | `useColorScheme`, `useStorage`, `useUIState`, `useIsMobile`, `useSchemeColors`, `useHasOverflowX`, `useHoverableTextStyle`                                                                                                                         |
| `./forms`              | `FormContainer`, `useModalForm`, `useModalFormSubmit`, validation, types                                                                                                                                                                           |
| `./modals`             | `modals` facade (`confirm`, `prompt`), `ModalsProvider`                                                                                                                                                                                            |
| `./notifications`      | `notifications` facade, `TimedRingProgress`                                                                                                                                                                                                        |
| `./icons`              | `Icon`, `IconName`, `AnimatedChevron`, `registerIcons`                                                                                                                                                                                             |
| `./lazy`               | `LazyLoader`, `CodeHighlight`, `CodeMirror`                                                                                                                                                                                                        |
| `./spotlight`          | spotlight re-exports                                                                                                                                                                                                                               |
| `./design-system`      | `theme` (pre-branded), `baseTheme`, `ThemeIsland`, `ThemeInitializer`, `ThemeOverrideWrapper`, `getColorSchemeFromDocument`, `variantColorResolver`                                                                                                |
| `./boot`               | `registerSimpleAlerts`, `markMounted`; `./boot/simple-loading-bar.css` is the stylesheet                                                                                                                                                           |
| `./app`                | `mountMattstackApp`, `MattstackShell`, `DaemonBanner`, `useDaemonHealth`, `NotFoundPage`                                                                                                                                                           |
| `./router`             | `RailLink`, `Link`, `useHash`                                                                                                                                                                                                                      |
| `./utils`              | `createDynamicTable`, `noop`                                                                                                                                                                                                                       |
| `./test-utils`         | `renderWithProviders`, `spyableAction`, jsdom polyfills, `expectLoadingBarInSync(indexHtml: string)`                                                                                                                                               |
| `./styles.css`         | kit styles entry (Mantine styles, scheme vars, overrides, Tokyo CSS)                                                                                                                                                                               |
| `./eslint`             | `mattstackEslint()`, the flat config array with the import wall                                                                                                                                                                                    |
| `./vite`               | `mattstackVite()`                                                                                                                                                                                                                                  |
| `./tsconfig.base.json` | the compiler options a consumer `tsconfig.json` extends                                                                                                                                                                                            |

## Snippets

```tsx
// src/main.tsx
import { mountMattstackApp } from '@mattstack/app-kit/app';
import { App } from './App';

mountMattstackApp(<App />);
```

```tsx
// src/App.tsx
import { MattstackShell, NotFoundPage } from '@mattstack/app-kit/app';
import { Icon } from '@mattstack/app-kit/icons';
import { RailLink } from '@mattstack/app-kit/router';

export function App() {
  return (
    <MattstackShell name="chat">
      <MattstackShell.Rail>
        <RailLink icon="users" label="Rooms" href="/" active />
      </MattstackShell.Rail>
      {/* routed page content, or <NotFoundPage /> */}
    </MattstackShell>
  );
}
```

```ts
// vite.config.ts -- the preset ships as hand-authored .js, so no
// special vite/vitest flags are needed
import { defineConfig } from 'vite';

import { mattstackVite } from '@mattstack/app-kit/vite';

export default defineConfig(mattstackVite({ apiPort: 11002 }));
```

```js
// eslint.config.js
import { mattstackEslint } from '@mattstack/app-kit/eslint';

export default mattstackEslint({ app: ['src/**/*.{ts,tsx}'] });
```

An app that registers its own icon adds a `declare module
'@mattstack/app-kit/icons' { interface AppIcons { hash: true } }` block in
a `.d.ts` file that does NOT share a basename with a sibling `.ts` file in
the same directory (TypeScript drops `foo.d.ts` when `foo.ts` sits next to
it). See the root `AGENTS.md`'s "Consumer requirements" section for this
and the other real failure modes a migrating app hits.
