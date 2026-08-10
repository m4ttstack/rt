# Local

Give every local app a name, keep it running, share it when you want.

The command is `lcl` (named so because `local` is a shell reserved word in
zsh and bash; the product is still Local).

`lcl` registers any web app you run on your machine as a supervised service
with a stable https address (`myapp.localhost`), an always-on dashboard, a
one-toggle dev-port override, and - when you're ready - a real public URL on
your own domain with access control.

## Install

    curl -fsSL local.mattstack.dev | sh

(macOS. Prerequisites: Node 24+, because the https proxy - portless - needs
it; and portless itself installed, trusted, and running as a service -
`npm install -g portless && portless trust && portless service install`.
The installer finishes by running `lcl setup`, which needs both in place
and will tell you exactly what's missing if you skip this.)

## Five minutes in

- `lcl add myapp --cmd "bun src/server.ts" --dir ~/code/myapp` → https://myapp.localhost, auto-starts on login
- `lcl add otherapp --port 4200` → routes something you run yourself
- the board: https://local.localhost - health, logs, restart, everything editable
- `lcl override myapp 5173` → myapp.localhost serves your dev server while you debug; flip it back with `off`

Either way you end up with a name instead of a port to remember, and a
process Local watches so it comes back after a reboot or a crash.

## Sharing

- zero-setup, casual: `portless --funnel` (public URL, no auth - treat accordingly)
- password gate: set a password on the board - served by Local's own gateway, no accounts needed
- your own domain: `lcl domain yourdomain.dev` (Cloudflare tunnel, wildcard DNS), then per-app access tiers: public · password · only me · work domain · custom list

Nothing is public by default. An app stays on `.localhost` until you publish
it, and publishing is a toggle on the board or a single API call, not a
redeploy.

## How it works

Every app you register becomes a row in Local's registry
(`~/.mattstack/local/registry.json`): a name, a port, and how it's
supervised. Hand it `--cmd`/`--dir` and Local writes a launchd agent, so
macOS starts your app at login and restarts it if it dies. Point it at a
`--port` you're already running yourself and Local just tracks the name and
port, without touching your process at all.

Either way, Local hands the name and port to portless, which owns the actual
HTTPS: it terminates TLS for `<name>.localhost`, carries a local certificate
authority so your browser trusts it, and reads its own `routes.json` to know
where each name goes. In front of portless sits Local's gateway, which
decides whether a request reaches your app at all - published or not,
password or not, which access tier applies. The board, the CLI, and the
gateway all speak to the same thing underneath: a small HTTP API at
`/api/v1` on localhost. Nothing the board can do is board-only; the same
calls are there for scripts.

State - the registry, logs, settings, access tiers - lives under
`~/.mattstack/local` as plain JSON on your own disk. No database, no
account, nothing to sign into.

## Already running things by hand?

`lcl migrate` adopts your existing LaunchAgents and routes in place -
nothing rewritten. It reads what's already there, matches routes to running
services by port, and records what it finds so those apps show up on the
board. The original plists keep running under launchd exactly as before;
migrate only makes them visible and operable, it never touches the files
that define them.

`lcl migrate --convert` goes further, per adopted app: it writes a new
`com.mattstack.local.<name>` plist alongside the legacy one, boots out the
legacy label, and health-checks the app under its new label. A failed
health-check rolls that one app back (legacy plist restored, an issue
recorded on its board row) without stopping the rest of the batch. Routes,
ports, and settings never change - only the launchd label does.

## mattstack

Local is part of mattstack and installs its surfaces (board, gitq, ...) as
managed apps via `rt install <app>` - but Local needs none of that. If
you've never heard of mattstack, nothing above required it and nothing above
changes because of it. If you have: `rt install <app>` registers that app
with Local the same way `lcl add` does, through the same registry and
routing described above, so mattstack's own tools end up on your board
alongside everything else you run.

## Uninstall

`lcl uninstall` refuses to run if any app besides Local itself is still
registered: it prints the offending names and tells you to remove them
first, or pass `--force`. Even with `--force`, it only ever tears down
Local's own footprint - its launchd agent, its `local`/`local.mattstack`
aliases, and `api.json` - never another app's route, plist, or registry
record. That's deliberate: uninstalling the platform should never silently
kill an app it happens to be supervising. Your app code, your own launchd
agents, and anything else already on disk under `~/.mattstack/local` are
left in place.
