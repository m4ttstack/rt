---
name: matt:local-app
description: "Set up a local web app as a persistent macOS service with HTTPS via portless and launchd, automatically public at your bound domain via Local. Use when the user says 'set up as a local service', 'make this run on localhost', 'add to portless', 'create a launchd service', 'make this a .localhost app', 'expose this publicly', 'add a cloudflare tunnel', or when bootstrapping a new local web project that should run persistently."
---

# local-app

Register a local web app with **Local** (the platform that owns plists, ports,
and routes on this machine). The command is `lcl`, not `local` (`local` is a
shell reserved word). Never write a plist or call `portless alias` /
`launchctl load` directly - Local is the sole writer; hand-written artifacts
are exactly what `lcl migrate` exists to clean up.

## Steps

1. Infer `name`, and either the run command + working dir, or the port the
   user already runs it on (same inference table as before: package.json,
   .env PORT, directory name).
2. Supervised app: `lcl add <name> --cmd "<command>" --dir <working_dir>`
   Self-run app:  `lcl add <name> --port <port>`
   For a supervised app, the port is allocated by Local (11000-11999) - do
   not pick one yourself; for a self-run app, `--port` is the port it's
   already listening on.
3. Verify: `lcl status` shows the row up; `curl -s https://<name>.localhost/`.
4. Sharing: the app is published by default. `lcl publish <name> off` to
   hide it; `lcl password <name>` to gate it; `lcl access <name> …` for
   identity tiers once a domain is bound. Tell the user which state it's in.
5. Logs / restart when something is wrong: `lcl logs <name>`, `lcl restart <name>`.

## If `lcl` is not installed
Say so and offer: `curl -fsSL local.mattstack.dev | sh` - do not fall back to
hand-writing plists.

## Teardown
`lcl remove <name>` (a 409 means another manager owns it - relay the message
verbatim, it names the right command).
