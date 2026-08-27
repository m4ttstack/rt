# Deck

Give every local app a name, keep it running, share it when you want.

The command is `deck` (named so because `local` is a shell reserved word in
zsh and bash; the product is still Deck).

`deck` registers any web app you run on your machine as a supervised service
with a stable https address (`myapp.localhost`), an always-on dashboard, a
one-toggle dev-port override, and - when you're ready - a real public URL on
your own domain with access control.

## Install

    curl -fsSL deck.mattstack.dev | sh

(macOS. Prerequisites: Node 24+, because the https proxy - portless - needs
it; and portless itself installed, trusted, and running as a service -
`npm install -g portless && portless trust && portless service install`.
The installer finishes by running `deck setup`, which needs both in place
and will tell you exactly what's missing if you skip this.)

## Five minutes in

- `deck add myapp --cmd "bun src/server.ts" --dir ~/code/myapp` → https://myapp.localhost, auto-starts on login
- `deck add otherapp --port 4200` → routes something you run yourself
- the board: https://deck.localhost - health, logs, restart, everything editable
- `deck override myapp 5173` → myapp.localhost serves your dev server while you debug; flip it back with `off`

Either way you end up with a name instead of a port to remember, and a
process Deck watches so it comes back after a reboot or a crash.

## Sharing

- zero-setup, casual: `portless --funnel` (public URL, no auth - treat accordingly)
- password gate: set a password on the board - served by Deck's own gateway, no accounts needed
- your own domain: `deck domain yourdomain.dev` (Cloudflare tunnel, wildcard DNS), then per-app gates: a password, a Google sign-in list of people or domains, or both

Nothing is public by default. An app stays on `.localhost` until you publish
it, and publishing is a toggle on the board or a single API call, not a
redeploy.

## How it works

Every app you register becomes a row in Deck's registry
(`~/.mattstack/deck/registry.json`): a name, a port, and how it's
supervised. Hand it `--cmd`/`--dir` and Deck writes a launchd agent, so
macOS starts your app at login and restarts it if it dies. Point it at a
`--port` you're already running yourself and Deck just tracks the name and
port, without touching your process at all.

Either way, Deck hands the name and port to portless, which owns the actual
HTTPS: it terminates TLS for `<name>.localhost`, carries a local certificate
authority so your browser trusts it, and reads its own `routes.json` to know
where each name goes. In front of portless sits Deck's gateway, which
decides whether a request reaches your app at all - published or not,
password or not. Who may sign in is settled a step earlier, at Cloudflare's
edge. The board, the CLI, and the gateway all speak to the same thing
underneath: a small HTTP API at `/api/v1` on localhost. Nothing the board
can do is board-only; the same calls are there for scripts.

State - the registry, logs, settings, sign-in rules - lives under
`~/.mattstack/deck` as plain JSON on your own disk. No database, no
account, nothing to sign into.

## App launcher registry

An adopted app can carry a `mattstack.json` at its repo root:

    { "displayName": "Chat", "description": "Group chat", "icon": "./icon.svg" }

`displayName` and `icon` (a repo-relative path to an SVG, at most 64 KB) are
required; `description` is optional. Deck reads it and copies the icon into
its own store on adopt, so only managed (adopted) products are ever ingested
- a plain `deck add` app never is.

`GET /api/apps` returns that slim list - name, displayName, description,
url, icon - for managed products only. It's unversioned, GET-only, and
CORS-enabled for mattstack-TLD origins, built for an app launcher to fetch
across origins without touching the versioned `/api/v1` API. `GET
/api/apps/:name/icon` serves the stored SVG.

Edited the manifest or swapped the icon after adopting? `deck manifest
refresh <name>` re-reads `mattstack.json` and re-ingests the icon without
re-adopting the app.

## Already running things by hand?

`deck migrate` adopts your existing LaunchAgents and routes in place -
nothing rewritten. It reads what's already there, matches routes to running
services by port, and records what it finds so those apps show up on the
board. The original plists keep running under launchd exactly as before;
migrate only makes them visible and operable, it never touches the files
that define them.

`deck migrate --convert` goes further, per adopted app: it writes a new
`com.mattstack.deck.<name>` plist alongside the legacy one, boots out the
legacy label, and health-checks the app under its new label. A failed
health-check rolls that one app back (legacy plist restored, an issue
recorded on its board row) without stopping the rest of the batch. Routes,
ports, and settings never change - only the launchd label does.

## mattstack

Deck is part of mattstack and installs its surfaces (board, gitq, ...) as
managed apps via `rt install <app>` - but Deck needs none of that. If
you've never heard of mattstack, nothing above required it and nothing above
changes because of it. If you have: `rt install <app>` registers that app
with Deck the same way `deck add` does, through the same registry and
routing described above, so mattstack's own tools end up on your board
alongside everything else you run.

## Board dev loop

The board (`core/board/`) is a small React app built with
`@mattstack/tui-kit` and served by the API.

- Edited `core/board/`? Run `bun run build:board` before testing or
  building - it regenerates the committed `core/generated/board.js` and
  `board.css`. `core/generated-fresh.test.ts` fails the suite if that
  output is stale.
- `bun run test:dom` drives the built board with a real headless
  Chromium against fixture data (`test/dom/rig.ts`) for DOM/behavior
  coverage; `bun run capture:compare` (below) is the pixel layer on top.
- `bun run test` is scoped (`bun test core src`). The bare `bun test`,
  with no arguments, also sweeps `test/dom/` and `test/e2e.smoke.test.ts`
  - slower, and e2e touches real launchd - so reach for the scoped
  script day to day and save the bare command for a full sweep.

Pixel baselines: `test/capture.ts` boots the fixture server and
Playwright-screenshots a fixed set of board/modal/notice states, day and
night; `test/compare.ts` diffs them against `test/baselines/`
pixel-for-pixel, zero tolerance. `bun run capture:baseline` regenerates
the baselines after an intentional visual change - eyeball every PNG
before committing, it's the review step for the board's CSS/markup.
`bun run capture` + `bun run capture:compare` take a fresh set into
`test/.captures/` (gitignored) and diff against what's committed; a diff
means the board's rendered output moved, on purpose or not.

`@mattstack/tui-kit` is a `file:` sibling checkout, which has its own
refresh rules and a react-singleton constraint on the build - see
[`docs/board-dev-loop.md`](docs/board-dev-loop.md).

## Uninstall

`deck uninstall` refuses to run if any app besides Deck itself is still
registered: it prints the offending names and tells you to remove them
first, or pass `--force`. Even with `--force`, it only ever tears down
Deck's own footprint - its launchd agent, its `deck`/`deck.mattstack`
aliases, and `api.json` - never another app's route, plist, or registry
record. That's deliberate: uninstalling the platform should never silently
kill an app it happens to be supervising. Your app code, your own launchd
agents, and anything else already on disk under `~/.mattstack/deck` are
left in place.
