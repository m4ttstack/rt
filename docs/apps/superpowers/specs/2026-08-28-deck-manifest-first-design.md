# deck manifest-first: mattstack.deck.json — design

Date: 2026-08-28
Status: ratified (decisions approved by Matt in-session, via forms)
Builds on: `2026-08-27-mattstack-app-launcher-design.md` (the existing
`mattstack.json` launcher manifest and its ingest path, which this design
generalizes and supersedes as the manifest surface).

## Problem

Getting an app onto deck today means remembering `deck add` flags (`--cmd`,
`--dir`, `--port`), and the app itself declares nothing about how it is
built or deployed. Redeploying a managed app from source is a hand-run
loop per app (chat: `bun run build && deck restart chat`; deck itself:
build, install the binary, self-restart). The launcher manifest
(`mattstack.json`) exists but is metadata-only and scoped to managed
products.

The goal: an app declares itself in one file, `deck register` from its
directory does the rest, and the deck board gains per-app action buttons
(deploy, build, anything named) that exist only in dev mode.

## The manifest: `mattstack.deck.json`

Lives at the app repo root. Example (chat):

```json
{
  "name": "chat",
  "displayName": "Chat",
  "description": "rt chat viewer",
  "icon": "public/icon.svg",
  "port": 11002,
  "commands": {
    "start": "bun run serve",
    "build": "bun run build",
    "deploy": "bun run deploy"
  },
  "altConfigs": {
    "dev": { "port": 5173, "commands": { "start": "bun run dev" } }
  }
}
```

Rules:

- **Commands are shell strings**, executed via `sh -c` with the app's
  `workingDirectory` as cwd. (Friendlier than argv; the manifest is
  hand-written by app authors.)
- **`commands.start`** is what deck supervises as the service. Every OTHER
  entry in `commands` is an action command: it becomes a dev-mode board
  button, an API route, and a CLI verb (below). Names are free-form
  (`deploy`, `build`, `migrate`, ...), `start` is the only reserved key.
- **`altConfigs`** is a name-keyed map of overlays. An overlay may override
  ONLY `port` and `commands.start` (the serve shape, e.g. an HMR dev
  server). It may never override action commands, identity fields, or the
  icon: an app has one deploy story regardless of mode.
- **`port`** optional for `kind: external`-style setups deck already
  supports; when present with `commands.start`, register creates a
  supervised service.
- Identity/launcher fields (`displayName`, `description`, `icon`) keep the
  semantics and validation of the existing manifest (SVG icon, 64 KB cap,
  ingest to the deck icon store).
- **Universality**: ANY deck app may carry the manifest, not only
  mattstack-managed products. The launcher discovery API's managed-only
  filter is unchanged; the board is where every app shows.
- **Migration**: `mattstack.json` remains readable as a deprecated
  fallback (identity fields only) for a window; `mattstack.deck.json`
  wins when both exist.

## CLI flow

- **`deck config init`**: scaffolds `mattstack.deck.json` in cwd. Infers
  `name` from the directory, pre-fills `commands.start`/`build` from
  `package.json` scripts when present, prompts for (or defaults) the port.
  Never overwrites an existing manifest.
- **`deck register`**: reads the manifest in cwd (or `--dir`) and creates
  or updates the whole app record from it: name, port, supervised start
  command, identity ingest, action commands. Zero flags in the happy path.
  Re-running syncs the record to the manifest: the manifest is the source
  of truth for everything it declares, and register subsumes the existing
  `deck manifest refresh` verb.
- **`deck alt <app> <name|off>`**: activates a declared overlay (restarts
  the service on the overlay's serve shape) or returns to the base config.
  The board's existing dev-override toggle maps onto declared alts for
  manifested apps; the flag-based `deck override` survives for
  unmanifested ones.
- **`deck cmd <app> <name>`**: runs an action command (CLI twin of the
  button). Dev-mode gated like the route.
- **`deck add`** survives unchanged for quick, unmanifested apps.

## CLI cleanup: verbs removed, slimmed, narrowed

`register`, `alt`, and `cmd` retire or narrow part of the existing verb
surface. Audit of every current verb against the manifest model:

**Removed**

- **`deck manifest refresh <name>`**: deleted. Its whole job (re-read the
  app's manifest, re-ingest identity/icon via `ingestManifest`) is exactly
  what `deck register` does on every run, so nothing is left for a separate
  refresh to do. The `POST /api/v1/apps/:name/manifest/refresh` route is
  deleted with it; register's sync path is its replacement.

**Slimmed**

- **`deck adopt <name> [--as] [--managed-by]`**: survives as the claim verb
  (assign `managedBy`, optional rename, force-bless the `.mattstack` route)
  but stops carrying its own manifest ingest. It reads the manifest through
  register's shared sync path, so an rt-spawned product and a hand-run
  `deck register` ingest through identical code. (Considered and deferred:
  folding adopt entirely into `deck register --managed-by <id> --as <name>`
  and dropping the verb. Kept separate because "claim as a managed product"
  is a distinct intent from "sync my record to my manifest".)

**Narrowed in role, kept**

- **`deck add <name> --cmd --dir --port`**: the manifest-free path.
  `register` is now the primary registration route; `add` stays for quick
  apps that never write a manifest. Behavior unchanged.
- **`deck override <name> <port|off>`**: the flag-based twin of `deck alt`.
  For a manifested app the declared overlay (`deck alt <app> dev`) is native
  and the board dev-toggle maps onto it; `override` stays as the escape
  hatch for unmanifested apps.

**Untouched** (no manifest relationship): `status`/`list`, `url`, `remove`,
`restart`, `logs`, `publish`, `password`, `access`, `domain`, `migrate`
(+`--convert`), `version`/`--version`, `help`.

Net: one verb deleted (`manifest refresh`), one slimmed (`adopt`), two
narrowed but retained (`add`, `override`). No other verb is dead weight
under the manifest model.

## Action commands: routes, buttons, gate

- **Route**: `POST /api/v1/apps/:name/commands/:cmd` next to
  `apps/managed/restart`. Refuses unknown command names and apps without a
  manifest. Spawns the shell string in the app's `workingDirectory`,
  streams output into the app's existing deck log, returns
  `{ started: true, runId }` immediately; `GET
  /api/v1/apps/:name/commands/:cmd/:runId` reports running/exit status.
  One action command at a time per app (409 on overlap).
- **Board**: a button per action command on the app's row, with
  running/failed state surfaced the way restart already is. Deck's own row
  uses the identical path; the board tolerates the API connection dropping
  during a self-restarting deploy and re-polls until the API returns.
- **Dev-mode gate**: deck reads rt's dev-mode (the platform
  source-vs-bundle truth: deck ships inside the mattstack.app bundle with
  rt, and rt is always present; `rt settings dev-mode`, backed by
  `~/.mattstack/rt/dev-mode.json`). In production mode the command routes
  are NOT registered (404, indistinguishable from absent), status rows
  carry no command metadata, and the board renders no buttons. There is no
  override and no env escape hatch. Reading is cached briefly; a failed
  read counts as production (fail closed).
- **Safety**: commands come only from the manifest in the app's own
  checkout; the API never accepts a request-supplied command line. Output
  is capped in the log like service output.

## First adopters

- **chat**: manifest with `start`/`build`/`deploy` (deploy = build + `deck
  restart chat`).
- **deck itself**: same contract; its `deploy` script builds, installs
  `dist/deck` over `~/.mattstack/deck/bin/deck` (the launchd-registered path,
  matching `install.sh`), and runs `deck restart deck` (the self-restart
  connection drop is expected and handled by the board's re-poll).
- rt-managed adopt reads the same manifest so rt-spawned products flow
  through the identical ingest.

## Testing

deck's existing harness (scratch state dir via env paths, fake HOME,
`FakeServiceManager`/`FakeEdgeProxy`/`FakeTunnelDriver`):

- Manifest parse + validation, fallback precedence over `mattstack.json`,
  alt overlay resolution (only `port`/`commands.start` override; anything
  else in an overlay is rejected loudly at parse).
- `deck config init` scaffolding (inference from package.json, refuses to
  overwrite).
- `deck register` create and sync paths (record mirrors manifest; removed
  manifest fields clear their record fields).
- Register subsumes `manifest refresh`: a re-run re-ingests identity/icon
  (coverage moved off the deleted refresh route), and `deck adopt`
  delegates its manifest ingest to the same sync path (adopt still assigns
  `managedBy` and renames; the manifest read is no longer its own).
- Dev gate both ways with a fake dev-mode reader: routes absent in
  production, present in dev; fail-closed on read error.
- Command runs with a fake spawn: log streaming, run status, 409 overlap,
  unknown command refusal.
- Board rendering gated on command metadata presence.

## Deferred

- Non-shell (argv) command form; per-command env; command timeouts beyond
  the log cap.
- Widening the launcher discovery filter to manifested user apps
  (explicitly kept managed-only for now).
- `deck alt` auto-selection tied to rt dev-mode (an overlay that activates
  itself in dev) — attractive, but implicit mode-coupled serving is a
  separate decision.
