# mattstack-console

_Part of the [mattstack](https://github.com/m4ttstack) estate, alongside [`rt`](https://github.com/m4ttstack/rt),
[`deck`](../deck) (in this same repo), and [herdr](https://github.com/herdrdev/herdr)._

Console is the management console for mattstack: a local web app that shows what's running, what
needs you, and what a run actually did. It reads run state, wiring, and settings straight through
[`@mattstack/rt-client`](https://www.npmjs.com/package/@mattstack/rt-client), the same client the
`rt` CLI and daemon use, so there's no separate database and no write path the CLI doesn't already
have.

## Features

- **Run board**: a live view of every pipeline run, with aging, liveness, and stage-progress
  indicators.
- **Run detail**: timeline, failure excerpts, command provenance, and effective inputs for a
  single run.
- **Search**: find a run across the whole board.
- **Wiring map**: visualizes the skill/pipeline graph, its surfaces, seams, health, and version
  history.
- **Settings explorer**: inspect and edit settings across their layered scopes (default, user,
  team, machine), staging a change before it's written.
- **Command palette** (`mod+K`): jump straight to a run, a config key, or a nav action.
- **Live updates**: the board and run pages update over WebSocket as runs change, no polling.
- **Single-binary distribution**: ships as one self-contained executable with its built assets
  embedded, no `dist/` or `node_modules` alongside it.

## Installation

Console needs [Bun](https://bun.sh) and reads its data through `@mattstack/rt-client`, so it's
most useful once `rt` itself is set up locally; without that, the board and settings pages just
start out empty.

```bash
git clone https://github.com/m4ttstack/apps.git
cd apps                       # the workspace root, not this app's own dir
bun install                   # workspace install: packages/*, apps/*
cd apps/console
```

## Usage

### Local development

Two processes: Vite serves the SPA with hot reload, and the Bun/Hono server answers `/api` and
`/ws`. Vite's dev proxy (`vite.config.ts`) forwards both to `http://127.0.0.1:11011`, so the server
must be listening there (its default `PORT`).

```bash
$ bun run dev:server   # Bun + Hono API, hot-reloaded, port 11011
$ bun run dev           # Vite, in a second terminal
```

Open the Vite URL it prints; API and WebSocket calls transparently reach the Bun server.

### Production

```bash
$ bun run build   # tsc -p tsconfig.json, then vite build -> dist/
$ bun run serve   # bun run src/server/index.ts
```

One process, one port. It serves `dist/` (assets, fonts, `index.html`) and answers `/api` and `/ws`
itself, with no Vite involved.

### Single binary

```bash
$ bun run build:binary   # vite build, embed dist/ into a manifest, bun --compile -> dist-bin/console
```

`vite build` produces `dist/`, `mattstack-embed-assets` (from `@mattstack/app-server`) embeds it
into a generated manifest, and `bun build --compile` bundles the server plus that manifest into
`dist-bin/console`: a single self-contained executable that serves itself with no `dist/` or
`node_modules` next to it.

## Configuration

| Variable | Default | What it does                                                                                     |
| -------- | ------- | ------------------------------------------------------------------------------------------------ |
| `PORT`   | `11011` | Port the Bun server listens on, in both dev (`dev:server`) and production (`serve`, the binary). |

Console has no config file of its own. Everything else it reads or writes is a setting in the
shared mattstack settings store (default, user, team, and machine scopes), the same one `rt`
reads. Browse and edit those values from the in-app settings pages rather than hand-editing files.

## Development

| Script                 | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `bun run dev`          | Start the Vite dev server.                                               |
| `bun run dev:server`   | Start the Bun/Hono API server with hot reload.                           |
| `bun run build`        | Typecheck (`tsc -p tsconfig.json`) then production build (`vite build`). |
| `bun run build:binary` | Build a self-contained binary embedding its own assets -> `dist-bin/`.   |
| `bun run serve`        | Run the production server (`src/server/index.ts`) against `dist/`.       |
| `bun run test`         | Run the test suite (Vitest). Add `-- --run` for a single non-watch run.  |
| `bun run lint`         | ESLint over `src`.                                                       |
| `bun run typecheck`    | `tsc -p tsconfig.json`, no emit.                                         |
| `bun run format`       | Format the repo with Prettier (`--write`).                               |
| `bun run format:check` | Check formatting without writing (what CI runs).                         |
| `bun run preview`      | Preview the production Vite build locally (SPA only, no `/api`).         |

Console is built on `@mattstack/app-kit` (Mantine 9, React 19, Vite, and Bun, with the shell,
theme, and Mantine facades layered on top) and `@mattstack/app-server`. Both, along with
`@mattstack/mantine-tokyo`, are vendored as `file:` tarball dependencies (see `package.json`); Bun
copies a `file:` dependency into `node_modules` rather than symlinking it, so bumping one means
dropping in a new tarball and re-running `bun install`.

See `AGENTS.md` for console's own contract (routes, the runs domain, the wiring map, and the
embedded-binary pipeline) and `~/Documents/GitHub/app-kit/AGENTS.md` for the kit's.

## Contributing

This repo is currently private. If you have access, open a PR against `main`; CI runs the same
checks below on every push:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test -- --run
bun run build
bun run build:binary
```

## License

MIT, see [LICENSE](LICENSE).
