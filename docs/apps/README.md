# local

Give every local app a name, keep it running, share it when you want.

`local` registers any web app you run on your machine as a supervised service
with a stable https address (`myapp.localhost`), an always-on dashboard, a
one-toggle dev-port override, and - when you're ready - a real public URL on
your own domain with access control.

## Install

    curl -fsSL local.mattstack.dev | sh

(macOS. Prerequisites: Node 24+, because the https proxy - portless - needs
it; and portless itself installed, trusted, and running as a service -
`npm install -g portless && portless trust && portless service install`.
The installer finishes by running `local setup`, which needs both in place
and will tell you exactly what's missing if you skip this.)

## Five minutes in

- `local add myapp --cmd "bun src/server.ts" --dir ~/code/myapp` → https://myapp.localhost, auto-starts on login
- `local add otherapp --port 4200` → routes something you run yourself
- the board: https://local.localhost - health, logs, restart, everything editable
- `local override myapp 5173` → myapp.localhost serves your dev server while you debug; flip it back with `off`

Either way you end up with a name instead of a port to remember, and a
process local watches so it comes back after a reboot or a crash.

## Sharing

- zero-setup, casual: `portless --funnel` (public URL, no auth - treat accordingly)
- password gate: set a password on the board - served by local's own gateway, no accounts needed
- your own domain: `local domain yourdomain.dev` (Cloudflare tunnel, wildcard DNS), then per-app access tiers: public · password · only me · work domain · custom list

Nothing is public by default. An app stays on `.localhost` until you publish
it, and publishing is a toggle on the board or a single API call, not a
redeploy.

## How it works

Every app you register becomes a row in local's registry
(`~/.mattstack/local/registry.json`): a name, a port, and how it's
supervised. Hand it `--cmd`/`--dir` and local writes a launchd agent, so
macOS starts your app at login and restarts it if it dies. Point it at a
`--port` you're already running yourself and local just tracks the name and
port, without touching your process at all.

Either way, local hands the name and port to portless, which owns the actual
HTTPS: it terminates TLS for `<name>.localhost`, carries a local certificate
authority so your browser trusts it, and reads its own `routes.json` to know
where each name goes. In front of portless sits local's gateway, which
decides whether a request reaches your app at all - published or not,
password or not, which access tier applies. The board, the CLI, and the
gateway all speak to the same thing underneath: a small HTTP API at
`/api/v1` on localhost. Nothing the board can do is board-only; the same
calls are there for scripts.

State - the registry, logs, settings, access tiers - lives under
`~/.mattstack/local` as plain JSON on your own disk. No database, no
account, nothing to sign into.

## Already running things by hand?

`local migrate` adopts your existing LaunchAgents and routes in place -
nothing rewritten. It reads what's already there, matches routes to running
services by port, and records what it finds so those apps show up on the
board. The original plists keep running under launchd exactly as before;
migrate only makes them visible and operable, it never touches the files
that define them.

## mattstack

local is part of mattstack and installs its surfaces (board, gitq, ...) as
managed apps via `rt install <app>` - but local needs none of that. If
you've never heard of mattstack, nothing above required it and nothing above
changes because of it. If you have: `rt install <app>` registers that app
with local the same way `local add` does, through the same registry and
routing described above, so mattstack's own tools end up on your board
alongside everything else you run.

## Uninstall

`local uninstall` refuses to run if any app besides local itself is still
registered: it prints the offending names and tells you to remove them
first, or pass `--force`. Even with `--force`, it only ever tears down
local's own footprint - its launchd agent, its `local`/`local.mattstack`
aliases, and `api.json` - never another app's route, plist, or registry
record. That's deliberate: uninstalling the platform should never silently
kill an app it happens to be supervising. Your app code, your own launchd
agents, and anything else already on disk under `~/.mattstack/local` are
left in place.
