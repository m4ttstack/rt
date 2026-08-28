# mattstack-console

A local web app for the mattstack pipeline: what's running, what needs you, and what a run
actually did. One `Bun.serve` process (Hono) serves a built Vite SPA and an `/api` + `/ws` surface
backed by `@mattstack/rt-client`, called in-process — no shelling out to `rt`, and nothing proxied
through to another service.

Built on `@mattstack/app-kit`: Mantine 9, React 19, Vite, and Bun, with the shell, theme, and
Mantine facades layered on top (see `AGENTS.md` for console's own contract, and
`~/Documents/GitHub/app-kit/AGENTS.md` for the kit's).

## What it talks to

`src/server/*` reads pipeline run state, decisions, and settings through `@mattstack/rt-client`,
which resolves against the same `~/.rt/` and `~/.mattstack/` state the `rt` CLI and daemon use.
There's no separate console database and no write path the CLI doesn't also have — the console is
a view onto the same substrate.

## Dev

Two processes: Vite serves the SPA with hot reload, and the Bun/Hono server answers `/api` and
`/ws`. Vite's dev proxy (`vite.config.ts`) forwards both to `http://127.0.0.1:11011`, so the server
must be listening there (its default `PORT`).

```bash
bun install
bun run dev:server   # Bun + Hono API, hot-reloaded, port 11011
bun run dev           # Vite, in a second terminal
```

Open the Vite URL it prints; API and WebSocket calls transparently reach the Bun server.

## Production

```bash
bun run build   # tsc -p tsconfig.json, then vite build -> dist/
bun run serve   # bun run src/server/index.ts
```

One process, one port. It serves `dist/` (assets, fonts, `index.html`) and answers `/api` and `/ws`
itself — no Vite involved. Port defaults to `11011`; override with `PORT`.

```bash
bun run build:binary   # vite build, embed dist/ into a manifest, bun --compile -> dist-bin/console
```

A single self-contained executable with no `dist/` or `node_modules` alongside it: `vite build`
produces `dist/`, `mattstack-embed-assets` (from `@mattstack/app-server`) embeds it into a
generated manifest, and `bun build --compile` bundles the server plus that manifest into
`dist-bin/console`.

## Scripts

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

## Learn more

- `AGENTS.md` — console's own contract: routes, the runs domain, the wiring map, the embedded
  binary pipeline, and where the vendored packages live.
- `~/Documents/GitHub/app-kit/AGENTS.md` — the kit's contract: import walls, the shell, theme,
  facades (modals, notifications, forms), the icon registry, and the server package.
