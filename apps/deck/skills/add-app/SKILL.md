---
name: deck:add-app
description: "Use when putting a local web app under Deck on macOS - triggers include 'add my app to deck', 'register this with deck', 'run this as a deck app', 'make this a .localhost / .mattstack app', 'set up as a local service', 'serve this on my domain', or 'expose this app publicly'. Deck-specific (the `deck` CLI); not for raw launchd / portless / nginx setups."
---

# Add your app to Deck

Deck is the local-app supervisor that OWNS this machine's launchd plists, ports,
and `<name>.localhost` / `<name>.mattstack` routes. `deck` is the sole writer of
those artifacts - never hand-write a plist, `portless alias`, or `launchctl
load` yourself (deck's `migrate` exists to clean up exactly that).

Assumes `deck` is installed (see the bottom). Every command below changes state;
run it against the user's actual app, not a guess.

## Register the app (manifest-first)

The current path is declarative: the app carries a `mattstack.deck.json`, and
`deck register` syncs it. Prefer this over `deck add` - it is reproducible,
travels with the app in git, and is what puts action buttons on the board.

1. In the app directory: `deck config init` scaffolds `mattstack.deck.json`.
2. Edit it. The minimum is `name` + `commands.start` (the supervised service):

```json
{
  "name": "notes",
  "displayName": "Notes",
  "icon": "📝",
  "commands": { "start": "bun run start" },
  "env": { "NODE_ENV": "production" }
}
```

- `commands.start` is the supervised service. Every OTHER `commands.<key>`
  (`build`, `deploy`, ...) becomes a dev-mode action button on the board, run
  via `deck cmd <app> <key>`; keys must match `[a-z0-9-]`.
- Do NOT hand-set `port` for a supervised app - deck allocates one
  (11000-11999) and injects it as `$PORT` into the service. Set `port` only for
  a self-run app deck should merely route to (one with no `commands.start`).
- `env` is the service environment; deck layers `PORT` on top of it.
3. From the app directory, `deck register` creates/syncs the app (or
   `deck register --dir <path>` from anywhere).

Quick alternative (no manifest): `deck add <name> --cmd "<start>" --dir <path>`
for a supervised app, or `deck add <name> --port <N>` to route an app the user
already runs. Manifest-first is preferred for anything kept.

## Verify

`deck status` shows the row `up`; `deck url <name>` prints its local URL;
`curl -s https://<name>.localhost/` confirms it serves.

## Share it

Apps are PUBLISHED by default. Publish controls visibility at the bound public
domain (next section); the `<name>.localhost` / `<name>.mattstack` routes are
always local to THIS machine, so a teammate on another machine reaches an app
only once a domain is bound. Adjust visibility as needed:

- `deck publish <name> off` hides it from the public edge; `on` re-exposes it.
- `deck password <name>` gates it behind a password (`--clear` removes it).
- `deck access <name> emails a,b` / `domains c,d` gates via Google sign-in;
  `off` removes the gate. Needs a bound domain (next section).

## Serve it publicly

`deck domain` governs ONE wildcard Cloudflare tunnel for the WHOLE machine:
`deck domain <domain>` routes `*.<domain>` at the gateway, so every PUBLISHED
app is then reachable at `https://<name>.<domain>`. It is machine-wide, not
per-app - binding or rebinding moves every app's public hostname at once, so
confirm the domain with the user before running it.

- Bare `deck domain` shows the bound domain, tunnel identity, and edge health.
- `deck domain unbind [--force]` tears the edge down.
- Prereqs: `cloudflared` installed, a one-time `cloudflared tunnel login`
  (writes `~/.cloudflared/cert.pem`), the domain's DNS zone on Cloudflare, and
  the secrets `rt secrets set deck cfZoneId` + `rt secrets set deck cfDnsToken`
  (a Zone.DNS:Edit token). The user runs the secret-setting; you do not.

## When something is wrong

`deck logs <name> [--lines N]` tails stderr; `deck restart <name>` kickstarts it.

## Teardown

`deck remove <name> [--force]`. A 409 means another registrar owns the app -
relay the message verbatim, it names the right command. Never `deck remove
deck`: deck's own row shares the supervisor's launchd label, so removing it
stops the platform.

## If `deck` is not installed

Say so and offer `curl -fsSL deck.mattstack.dev | sh`. It also needs portless:
`npm install -g portless && portless trust && portless service install`. Never
fall back to hand-writing plists.
