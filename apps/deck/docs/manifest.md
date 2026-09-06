# The `mattstack.deck.json` manifest

Detail behind the "Configuration" section of the README: the full schema
`deck config init`, `deck register`, and `deck alt` read.

A manifest lives at an app's repo root and looks like this at minimum:

```json
{
  "name": "myapp",
  "commands": {
    "start": "bun src/server.ts"
  }
}
```

## Fields

- **`name`** (required): the app's registered name. Must match
  `^[a-z0-9][a-z0-9.-]*$`.
- **`commands`** (required, may be empty): shell strings. `commands.start`,
  when present, is the command Deck supervises as a launchd service; every
  other key becomes an action button on the app's board row, routed at
  `POST /api/v1/apps/:name/commands/:key` (dev mode only, see below). Command
  keys must match `^[a-z0-9-]+$`.
- **`port`**: the port `commands.start` listens on.
- **`displayName`**, **`description`**, **`icon`**: launcher metadata. See
  "App launcher registry" below.
- **`env`**: environment for the supervised `start` command. Deck layers
  `PORT` on top automatically; an overlay (`altConfigs`, below) may not
  override `env`.
- **`dev`**: an optional set of dev-only shell strings, same shape as
  `commands`. `dev.start`, if present, is the source-serve command a
  developer runs locally instead of the supervised `start`; every other key
  is a dev-only action command.
- **`altConfigs`**: named overlays, each of which may set only `port` and/or
  `commands.start`. `deck alt <app> <name>` activates one; `deck alt <app>
  off` returns to the base config. Nothing else in the manifest may be
  overridden by an overlay.
- **`includeInBundle`**: marks the app as in scope for the dev/prod serve
  switch used by mattstack's own bundling. Only relevant to apps built as
  part of the mattstack estate.

## How Deck uses it

- `deck config init` scaffolds a manifest in the current directory, reading
  `name`/`start`/`build` off `package.json` when it can.
- `deck register [--dir PATH]` reads the manifest and creates or syncs the
  app's record from it: serve shape, launcher metadata, and action commands
  all resync from the file on every run. There is no separate "refresh"
  command; re-running `deck register` is how you pick up manifest or icon
  edits after the app is already registered.
- `deck adopt <name>` claims an existing `deck add`-registered app as a
  managed product and ingests its manifest the same way.
- Action commands (the non-`start` keys) are dev-mode gated for managed
  (adopted) apps: the route 404s and the board button is absent outside dev
  mode. A `deck add`-registered app's own commands are not gated this way.

## App launcher registry

`displayName`, `description`, and `icon` can live directly in
`mattstack.deck.json`. A standalone `mattstack.json` (just those three
fields, `icon` and `displayName` required) is also read as a fallback for
identity, for apps that predate the unified manifest:

```json
{ "displayName": "Chat", "description": "Group chat", "icon": "./icon.svg" }
```

`icon` is a repo-relative path to an SVG, at most 64 KB. Deck copies it into
its own icon store on adopt or register; a plain `deck add` app (unmanaged,
no manifest) is never ingested this way.

`GET /api/apps` returns the slim discovery list, name/displayName/
description/url/icon, for managed products only. It is unversioned, GET-only,
and CORS-enabled for mattstack-TLD origins, built for an app launcher to
fetch across origins without touching the versioned `/api/v1` API.
`GET /api/apps/:name/icon` serves the stored SVG.
