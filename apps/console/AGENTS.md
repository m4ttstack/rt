# AGENTS.md

Contract for anyone (human or agent) working in this repo.

## Kit contract lives upstream

This app consumes `@mattstack/app-kit` and `@mattstack/app-server` as packages (vendored as the
tarballs in `vendor/`, installed as `file:` dependencies — see `package.json`). The kit's own
contract — the Mantine import walls, theme layering, facades (modals, notifications, forms), the
icon registry, `MattstackShell`, and the server package's `serveMattstackApp` surface — is
documented in `~/Documents/GitHub/app-kit/AGENTS.md`. Read that before touching anything that
imports from `@mattstack/app-kit/*` or `@mattstack/app-server`.

This file covers only what's specific to console: its routes, its runs domain, the wiring map, and
how it wires up the shell and server packages.

## What this app is

A local web app for the mattstack pipeline: what's running, what needs you, and what a run
actually did. One `Bun.serve` process (Hono, via `@mattstack/app-server`) serves a built Vite SPA
and an `/api` + `/ws` surface backed by `@mattstack/rt-client`, called in-process — no shelling out
to `rt`, and nothing proxied through to another service. The dev server defaults to port `11011` (`PORT`, and the `vite.config.ts` proxy); the production
`deck` service runs on `11001` (`mattstack.deck.json`).

## Routes and chrome (`src/app/App.tsx`, `src/app/routes.ts`)

Routing is `wouter`, via `useAppRoute()` (`src/app/routes.ts`), which maps the current location to
a structured `AppRoute` union: `board`, `run`, `search`, `wiring`, `config`, `not-found`. The
`/runs/:repo/:runId` route carries a percent-encoded, possibly `remote:`/`path:`-prefixed repo
identity in the `repo` segment; `canonicalRepo()` decodes and re-serializes it back to the exact
wire form `@mattstack/rt-client`'s `serializeIdentity` produces, because a repo identity containing
a slash would otherwise 404 every lookup. A malformed percent-escape reads as `not-found`, never a
thrown error.

`App.tsx` mounts `MattstackShell` (from `@mattstack/app-kit/app`) with `name="console"
appName="console"`, a `MattstackShell.Rail` of `RailLink`s (Runs, Search) plus the app-specific
`WiringRailEntry`, and routes each `AppRoute` to its page component inside a per-path
`RouteErrorBoundary` (keyed on `path` so a caught error on one route doesn't linger after
navigating away — Mantine has no error boundary of its own, and the run-detail suspense query
throws on failure).

`ConsolePalette` (`src/app/palette/ConsolePalette.tsx`) is a single global `Spotlight` instance
(from `@mattstack/app-kit/spotlight`), mounted once in `App`, indexing runs, config keys, and the
two static nav actions under `mod+K`.

## Runs domain (`src/app/runs/`, `src/server/runs.ts`)

The run board, run detail, search, and their supporting pieces (aging bands, liveness, stage
progress, timeline, failure excerpts, command provenance, effective-inputs) all live under
`src/app/runs/`, backed by `src/server/runs.ts` and `src/server/effectiveInputs.ts` on the server
side. `src/server/routes.ts` chains these Hono sub-routers plus `enrich`, `settings`, and `skills`
into one `routes` export; handlers stay inline and routes stay chained because Hono's RPC type
inference (`AppType = typeof routes`, consumed by `src/app/api.ts`) breaks if a handler is lifted
into a named function or a route is registered unchained.

**The `run-updated` → `runs` relay**: `src/server/index.ts` configures `serveMattstackApp` with
`relay: [{ match: t => t === 'run-updated', topic: 'runs' }]`. `@mattstack/rt-client` emits
`run-updated` events; the relay re-broadcasts them over the app-kit WebSocket surface under the
`runs` topic, which is what `src/app/runs/useRuns.ts` subscribes to for live updates. If a new
server-side event needs to reach the client live, it goes through this relay list, not a bespoke
WebSocket wire-up.

## Wiring map (`src/app/wiring/`)

The wiring map (skills, surfaces, seams, version timeline, on-demand view) is console's largest
app-specific feature — it visualizes the mattstack skill/pipeline graph read from
`@mattstack/rt-client`. It has no kit dependency beyond the shared UI facades; `WiringRailEntry`
is the one component that reaches into the shell's rail context (`useShellRail` from
`@mattstack/app-kit/app`) to badge the rail entry with attention state.

## Embedded server / `build:binary`

```bash
bun run build         # tsc -p tsconfig.json && vite build -> dist/
bun run build:binary   # vite build && mattstack-embed-assets && bun build --compile
```

`mattstack-embed-assets` (the bin shipped by `@mattstack/app-server`) reads the built `dist/` and
generates `src/server/embedded/manifest.ts` (gitignored, build-time only — never hand-edited, and
never committed). `src/server/index.ts` imports it dynamically as `import('./embedded/manifest' as
string)` — the `as string` cast keeps `tsc` from trying to resolve the gitignored path at
typecheck time, while `bun build --compile` still sees the literal specifier and embeds the module
into the compiled binary. `serveMattstackApp`'s embedded-mode detection (`decideServingMode` /
`loadEmbeddedManifest`, both in the app-server package) is what lets the resulting `dist-bin/console`
binary serve its own assets with no `dist/` on disk next to it — see the CI job in
`.github/workflows/ci.yml` for the end-to-end proof (build the binary, hide `dist/`, curl it).

## Vendored packages

`@mattstack/app-kit`, `@mattstack/app-server`, and `@mattstack/mantine-tokyo` are consumed as
`file:` tarball dependencies pinned in `vendor/` (see `package.json`). Bun **copies** a `file:`
dependency into `node_modules` rather than symlinking it, so bumping one means dropping in a new
tarball and re-running `bun install` — editing the vendored source in place has no effect until
then.

## Formatting, linting, testing

Same toolchain as any app built on the kit: `bun run format` / `format:check` (Prettier, import
order via `@ianvs/prettier-plugin-sort-imports`), `bun run lint` (ESLint over `src`, including the
kit's Mantine import wall), `bun run typecheck` (`tsc -p tsconfig.json`), `bun run test` (Vitest).
See `~/Documents/GitHub/app-kit/AGENTS.md` for what each of those enforces and why.
