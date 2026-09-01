# Deck

Give every local app a name, keep it running, share it when you want.

(The command is `deck`, not `local`: `local` is a shell reserved word in
zsh and bash, so the product kept its name and the CLI took a different
one.)

`deck` registers any web app you run on your machine as a supervised
service with a stable HTTPS address (`myapp.localhost`), an always-on
dashboard, a one-toggle dev-port override, and, when you're ready, a real
public URL on your own domain with access control.

Deck is part of [mattstack](https://github.com/m4ttstack), a set of
local-first developer tools; see [Part of mattstack](#part-of-mattstack)
below for the rest. Nothing here requires any of them.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [CLI reference](#cli-reference)
- [Sharing](#sharing)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Migrating existing apps](#migrating-existing-apps)
- [Uninstalling](#uninstalling)
- [Part of mattstack](#part-of-mattstack)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Named local HTTPS**: `myapp.localhost` with a real, browser-trusted
  certificate, no warnings.
- **Supervised or just tracked**: hand Deck a command and Deck runs it
  under launchd, restarting it on crash and at login; or point it at a
  port you already run yourself and it just tracks the name.
- **Live board**: health, logs, restart, everything editable, at
  `https://deck.localhost`.
- **Dev-port override**: point `myapp.localhost` at a dev server for a
  debugging session, flip it back with one command.
- **Share on your terms**: a casual public URL, a password gate, or your
  own domain with per-app Google sign-in. Nothing is public until you say
  so.
- **App launcher registry**: a managed app's display name, description,
  and icon are discoverable by other mattstack surfaces over a small
  CORS-enabled API.
- **Adopt what's already running**: `deck migrate` brings existing
  LaunchAgents onto the board without touching them.
- **Plain JSON, no account**: your registry, logs, and sign-in rules live
  on your own disk.

## Installation

```bash
curl -fsSL deck.mattstack.dev | sh
```

Deck v1 is macOS only; Linux support is designed for but not shipped yet.
The installer downloads the `deck` binary to `~/.mattstack/deck/bin`, adds
that directory to your `PATH` if it isn't already there, and finishes by
running `deck setup`.

`deck setup` needs two prerequisites in place, and tells you exactly
what's missing if you skip this:

```bash
# Node 24+ (portless's own requirement)
node --version

# portless 0.15.5+, installed, trusted, and running as a service
npm install -g portless
portless trust
portless service install
```

## Quickstart

Register something Deck should run for you:

```
$ deck add myapp --cmd "bun src/server.ts" --dir ~/code/myapp
registered myapp on port 4021
```

That's now live at `https://myapp.localhost`, auto-starting on login and
restarting if it crashes. Already running your own dev server on a port?
Track it instead, without Deck touching the process at all:

```
$ deck add otherapp --port 4200
registered otherapp on port 4200
```

Either way you end up with a name instead of a port to remember, and a
process Deck watches so it comes back after a reboot or a crash. Check on
everything from the CLI, or from the board at `https://deck.localhost`:

```
$ deck status
myapp                    4021   up    user
otherapp                 4200   up    user
```

Need `myapp.localhost` to serve your dev server instead, while you debug?

```
$ deck override myapp 5173
`myapp.localhost` now serves port 5173
$ deck override myapp off
override cleared
```

## CLI reference

`deck help` prints the full command list:

```
$ deck help
deck: named https domains, supervision, and sharing for local apps

usage:
  deck status | list                       show every app
  deck url <name> [--public]               print its local url (or public url with --public)
  deck add <name> --port N                 route an app you run yourself
  deck add <name> --cmd "…" --dir PATH     register a supervised app
  deck config init                         scaffold mattstack.deck.json in cwd
  deck register [--dir PATH]               create/sync an app from its mattstack.deck.json
  deck alt <app> <name|off>                activate a declared serve overlay, or return to base
  deck cmd <app> <name>                    run a declared action command (dev mode only)
  deck remove <name> [--force]             unregister (registrar-owned; --force is the escape hatch)
  deck remove --managed                    unregister every app deck manages (installer's uninstall step)
  deck restart <name>                      kickstart its service
  deck restart --managed                   kickstart every app deck manages (installer's version-change step)
  deck logs <name> [--lines N]             tail stderr
  deck override <name> <port|off>          dev-port override for <name>.localhost
  deck publish <name> on|off               public visibility
  deck password <name> [--clear]           password gate (prompts)
  deck access <name> off | emails a,b | domains c,d    google sign-in gate
  deck adopt <name> [--as NEW] [--managed-by ID] [--json]   claim a user app as a mattstack product
  deck domain                              show the bound domain, tunnel identity and edge health
  deck domain <domain> [--force]           bind your own domain (cloudflared wildcard tunnel + DNS)
  deck domain unbind [--force]             tear the edge down (tunnel, DNS record, launchd service)
  deck migrate                             adopt existing plists + routes
  deck migrate --convert                   relabel adopted legacy apps to com.mattstack.deck.<name>
  deck remote <name> on|off                serve <name> publicly from Railway (on) or the tunnel (off)
  deck push <name>                         redeploy a remote app from the local checkout
  deck serve | setup | uninstall | update  platform lifecycle
  deck version
```

## Sharing

- **Casual, zero setup**: `portless --funnel` gives the app a public URL
  with no auth. Treat it accordingly.
- **Password gate**: set a password on the app, from the board or `deck
  password <name>`. It's served by Deck's own gateway; no accounts
  needed.
- **Your own domain**: `deck domain yourdomain.dev` creates and owns a
  wildcard Cloudflare tunnel (`*.yourdomain.dev` to your local gateway),
  writes the DNS record, and supervises the connector. Needs `cloudflared`
  plus a one-time `cloudflared tunnel login`, and two secrets:
  `rt secrets set deck cfZoneId` / `cfDnsToken` (Zone.DNS:Edit). Then
  per-app, layer on a password, a Google sign-in allowlist of people or
  domains, or both.
- **Serve it while your laptop is off**: `deck remote <name> on` redeploys
  the app to Railway and points its public hostname there instead of the
  tunnel; `deck push <name>` redeploys it again after a local change;
  `deck remote <name> off` moves it back. `<name>.localhost` stays local
  either way, remote only ever swaps the public origin.

```
$ deck domain yourdomain.dev
bound yourdomain.dev via deck-edge-a1b2c3-x9y8 (1 connector) ... every published app is now https://<name>.yourdomain.dev
$ deck domain
domain: yourdomain.dev
tunnel: deck-edge-a1b2c3-x9y8 (1a2b3c4d-...)
edge: healthy (connector reporting)
```

Once bound, `deck domain` shows the domain, tunnel, and live edge health.
`deck domain unbind` tears it all down: it refuses while apps are served
from Railway, warns about apps that would go offline, and `--force`
overrides both.

Nothing is public by default. An app stays on `.localhost` until you
publish it, and publishing is a toggle on the board or a single API call,
not a redeploy.

## Configuration

An adopted or supervised app configures through a manifest at its repo
root, `mattstack.deck.json`:

```json
{
  "name": "myapp",
  "commands": {
    "start": "bun src/server.ts",
    "build": "bun run build"
  },
  "displayName": "My App",
  "icon": "./icon.svg"
}
```

```
$ deck config init
wrote mattstack.deck.json
$ deck register
registered myapp on port 4021
```

`deck config init` scaffolds one from your `package.json`'s `start`/`build`
scripts. `deck register` reads it and creates or syncs the app's record;
run it again after editing the manifest or swapping the icon, there's no
separate refresh command. See [`docs/manifest.md`](docs/manifest.md) for
the full schema, including dev-only commands, named config overlays
(`deck alt`), and environment.

### App launcher registry

`displayName`, `description`, and `icon`, whether in the manifest above or
in a standalone `mattstack.json` kept for apps that predate the unified
manifest, let other mattstack surfaces discover a managed app:

```json
{ "displayName": "My App", "description": "What it does", "icon": "./icon.svg" }
```

`displayName` and `icon` (a repo-relative SVG path, at most 64 KB) are
required; `description` is optional. Deck copies the icon into its own
store on adopt or register; a plain `deck add` app is never ingested this
way. `GET /api/apps` returns the slim list (name, displayName,
description, url, icon) for managed products only: it's unversioned,
GET-only, and CORS-enabled for mattstack-TLD origins, built for an app
launcher to fetch across origins without touching the versioned `/api/v1`
API. `GET /api/apps/:name/icon` serves the stored icon.

## How it works

Every app you register becomes a row in Deck's registry
(`~/.mattstack/deck/registry.json`): a name, a port, and how it's
supervised. Hand it `--cmd`/`--dir` and Deck writes a launchd agent, so
macOS starts your app at login and restarts it if it dies. Point it at a
`--port` you're already running yourself and Deck just tracks the name and
port, without touching your process at all.

Either way, Deck hands the name and port to portless, which owns the
actual HTTPS: it terminates TLS for `<name>.localhost`, carries a local
certificate authority so your browser trusts it, and reads its own
`routes.json` to know where each name goes. In front of portless sits
Deck's own gateway, which decides whether a request reaches your app at
all, published or not, password or not. Who may sign in is settled a step
earlier, at Cloudflare's edge. The board, the CLI, and the gateway all
speak to the same thing underneath: a small HTTP API at `/api/v1` on
localhost. Nothing the board can do is board-only; the same calls are
there for scripts.

The registry, logs, and sign-in rules live under `~/.mattstack/deck` as
plain JSON on your own disk. Settings route through mattstack's own
git-backed settings store instead, also just files, no server. Either
way: no database, no account, nothing to sign into.

## Migrating existing apps

Already running things by hand? `deck migrate` adopts your existing
LaunchAgents and routes in place, nothing rewritten:

```
$ deck migrate
adopted: myoldapp, anotherapp
skipped: (none)
```

It reads what's already there, matches routes to running services by
port, and records what it finds so those apps show up on the board. The
original plists keep running under launchd exactly as before; migrate
only makes them visible and operable, it never touches the files that
define them.

`deck migrate --convert` goes further, per adopted app: it writes a new
`com.mattstack.deck.<name>` plist alongside the legacy one, boots out the
legacy label, and health-checks the app under its new label. A failed
health check rolls that one app back (legacy plist restored, an issue
recorded on its board row) without stopping the rest of the batch. Routes,
ports, and settings never change, only the launchd label does.

## Uninstalling

```
$ deck uninstall
```

`deck uninstall` refuses to run if any app besides Deck itself is still
registered: it prints the offending names and tells you to remove them
first, or pass `--force`. Even with `--force`, it only ever tears down
Deck's own footprint (its launchd agent, its `deck`/`deck.mattstack`
aliases, and `api.json`), never another app's route, plist, or registry
record. Uninstalling the platform should never silently take an app it
happens to be supervising down with it. Your app code, your own launchd
agents, and anything else already on disk under `~/.mattstack/deck` are
left in place.

## Part of mattstack

Deck installs mattstack's own surfaces as managed apps via `rt install
<app>`, but Deck needs none of that. If you've never heard of mattstack,
nothing above required it and nothing above changes because of it.

If you have: `rt install <app>` registers that app with Deck the same way
`deck add` does, through the same registry and routing described above,
so mattstack's own tools end up on your board alongside everything else
you run. The rest of the estate:

- [rt](https://github.com/m4ttstack/rt): the CLI and daemon Deck's own
  settings and secrets run through.
- [gitq](https://github.com/m4ttstack/gitq): a deterministic stacked-branch
  engine for git.
- [board](https://github.com/m4ttstack/board): a team's open GitLab MRs,
  ready to review, on one page.
- [glance](https://github.com/m4ttstack/glance): one client for GitHub and
  GitLab, one set of types.
- [fast-browser](https://github.com/m4ttstack/fast-browser): drive the
  Chrome you already have from an agent.
- [herdr-chat](https://github.com/m4ttstack/herdr-chat): rt chat, where the
  agents live.
- [skills](https://github.com/m4ttstack/skills): the mattstack skill
  collection for Claude Code.
- [mattstack-marketplace](https://github.com/m4ttstack/mattstack-marketplace):
  the plugin marketplace that ships them.

Several of these run their agents on [herdr](https://github.com/herdrdev/herdr),
the runtime coding agents live on.

## Development

The board (`core/board/`) is a small React app built with
`@mattstack/tui-kit` and served by the API.

- Edited `core/board/`? Run `bun run build:board` before testing or
  building, it regenerates the committed `core/generated/board.js` and
  `board.css`. `core/generated-fresh.test.ts` fails the suite if that
  output is stale.
- `bun run test:dom` drives the built board with a real headless Chromium
  against fixture data (`test/dom/rig.ts`) for DOM/behavior coverage;
  `bun run capture:compare` (below) is the pixel layer on top.
- `bun run test` is scoped (`bun test core src`). The bare `bun test`,
  with no arguments, also sweeps `test/dom/` and `test/e2e.smoke.test.ts`,
  slower, and e2e touches real launchd, so reach for the scoped script day
  to day and save the bare command for a full sweep.

Pixel baselines: `test/capture.ts` boots the fixture server and
Playwright-screenshots a fixed set of board/modal/notice states, day and
night; `test/compare.ts` diffs them against `test/baselines/`
pixel-for-pixel, zero tolerance. `bun run capture:baseline` regenerates
the baselines after an intentional visual change; eyeball every PNG before
committing, it's the review step for the board's CSS/markup. `bun run
capture` + `bun run capture:compare` take a fresh set into
`test/.captures/` (gitignored) and diff against what's committed; a diff
means the board's rendered output moved, on purpose or not.

`@mattstack/tui-kit` is a `file:` sibling checkout, which has its own
refresh rules and a react-singleton constraint on the build; see
[`docs/board-dev-loop.md`](docs/board-dev-loop.md).

## Contributing

```bash
bun install
bun run test
```

`bun run test` runs the scoped suite (`core src`); see
[Development](#development) above for the board's build and pixel-testing
loop, and a bare `bun test` for a full sweep before opening a PR.

Bug reports and pull requests are welcome. Deck is macOS-only today with
no Linux target yet; a PR that gets there while keeping launchd as the
default supervisor is more useful than a full rewrite.

## License

[MIT](LICENSE)
