# app-kit

app-kit ships three source-shipped packages that let a mattstack web app be
only its product code: a Mantine-based UI kit, a Hono/Bun server frame, and
the shared brand tokens they both theme from. No `dist`, no build step:
`exports` in each package.json point straight at `src/*.ts(x)` and `.css`,
so a workspace consumer gets the same files a build step would produce,
without running one.

app-kit is part of the mattstack estate, the same toolkit behind
[rt](https://github.com/m4ttstack/rt), [deck](https://github.com/m4ttstack/deck),
and [herdr-chat](https://github.com/m4ttstack/herdr-chat). Internally, it's
the shared UI and server layer mattstack's own apps build on, including chat
and console.

## What's inside

| Package            | Name                       | What it is                                                                                                                                       |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/ui`      | `@mattstack/app-kit`       | The Mantine-based component kit plus the mattstack layer: app shell, boot, router helpers, icon registry, config presets. Tokyo theme pre-wired. |
| `packages/server`  | `@mattstack/app-server`    | The Hono/Bun server frame: health route, JSON error floors, static/embedded asset serving, the rt-client relay, `Bun.serve`.                     |
| `packages/tokyo`   | `@mattstack/mantine-tokyo` | The Tokyo Day/Night brand tokens (colour ramps, theme values, colour names, CSS, font) `@mattstack/app-kit` themes itself with.                  |
| `packages/tui-kit` | `@mattstack/tui-kit`       | The terminal-UI kit for herdr-style panes: components, hooks, and theme, built rather than source-shipped like the other three.                  |

`packages/tui-kit` lives in this repo alongside the Mantine-based packages
so all four version in lockstep; it does not depend on
`packages/ui` or `packages/server`, or vice versa. `packages/tokens` is
also part of this workspace but is private and unpublished: it generates
the canonical colour and font values both `mantine-tokyo` and `tui-kit`
ship, and exists to keep those two themes in sync, not to be consumed
directly.

`@mattstack/app-kit` has nineteen subpath exports: the Mantine-based
components and shadows (`./core`), hooks, forms, modals, notifications, the
icon registry, lazy-loaded editors, the app shell (`./app`), router
helpers, theming (`./design-system`), boot sequencing, test utilities, and
build presets (`./eslint`, `./vite`, `./tsconfig.base.json`). The full
subpath-by-subpath table lives in `packages/ui/README.md`.

`@mattstack/app-server` exports four modules split along one rule:
everything except the top-level `.` export is vitest-safe (never loads
`hono/bun`); the top-level export (`serveMattstackApp`) is the one that
does. The full table lives in `packages/server/README.md`.

`probe/` is an internal, unpublished consumer app in this repo that
installs the three packages the way an external app will, so CI proves
the packages actually work outside their own workspace before a real app
depends on them.

See `AGENTS.md` for the contract anyone editing `packages/ui/src` or
`packages/server/src`, or consuming either package, needs.

## Installation

None of the four packages publish to npm. The apps that use them are
folding into this repo as workspace members (see
`docs/superpowers/specs/2026-09-06-apps-fold-in-design.md`); once an app
lands under `apps/<name>`, it depends on `packages/ui`, `packages/server`,
`packages/tokyo`, and `packages/tui-kit` with `workspace:*`. `packages/ui`,
`packages/server`, and `packages/tokyo` are consumed straight from source,
no install step required; `@mattstack/tui-kit` builds to `dist/`, so
workspace consumers run `bun run tui-kit:build` before any board or deck
work. General consumption of these packages from outside this workspace
is unsupported, except for the packed-tarball path below, which is the
sanctioned bundle-transition mechanism for apps that have not folded in
yet.

### Bundle-transition tarballs

Until an app has folded in, it can pick up a workspace change by
depending on a packed tarball rather than a bare `file:` directory (Bun
1.3 resolves a bare `file:../packages/ui` dependency as a symlink into
the source tree, which resolves peers like `react` twice and breaks
typecheck and tests in the consumer); see the fold-in spec for how each
app's transition uses this mechanism.

## Quickstart

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

See `packages/ui/README.md` and `packages/server/README.md` for more
snippets, including the vite and eslint presets.

## Development

```bash
$ git clone https://github.com/m4ttstack/app-kit.git
$ cd app-kit
$ bun install                 # workspace install: packages/ui, packages/server, packages/tokyo
$ bun run test                # vitest across packages/ui + packages/server
$ bun run storybook           # dev server at :6006 (packages/ui's stories)
$ bun run probe:install       # packs the three packages as tarballs, installs the probe app against them
$ bun run probe:build         # typechecks and builds the probe app against the packed packages
```

`bun run typecheck`, `bun run lint`, `bun run format:check`,
`bun run build-storybook`, and `bun run treeshake` are the other gates CI
runs; `bun run probe:test` and `bun run probe:serve-check` exercise the
probe's own tests and its running server.

## Contributing

- Read `AGENTS.md` before touching `packages/ui/src` or `packages/server/src`:
  it covers the import-wall rules, icon and theme extension points, the
  boot family contract, and the real failure modes a migrating consumer
  hits.
- `bun run typecheck`, `bun run lint`, `bun run format:check`,
  `bun run test -- --run`, `bun run build-storybook`, `bun run treeshake`,
  `bun run probe:test`, and `bun run probe:build` are exactly what CI runs
  (`.github/workflows/ci.yml`); run them locally before opening a pull
  request.
- `bun run format` (prettier --write) fixes most lint and format failures
  automatically.

## License

MIT, see [LICENSE](./LICENSE).
