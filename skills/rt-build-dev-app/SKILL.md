---
name: rt:build-dev-app
description: Use when a merged repo-tools change under rt-tray/ (the tray app, a helper shim, build.sh, bundle layout, signing, a deps.lock pin) has to reach the running /Applications/mattstack-dev.app, or when Matt asks to rebuild, reinstall, or ship something to the dev app. Also use to decide whether a change needs a dev app rebuild at all.
---

# Rebuilding the dev app

One script rebuilds `/Applications/mattstack-dev.app` from a pushed ref and
makes it live. When Matt asks for a dev app rebuild, that request is the
go-ahead: run the script yourself rather than handing him a bundle to swap in.

## Does this change need a rebuild?

| What changed | How it goes live |
|---|---|
| `rt-tray/**` in repo-tools (tray, shims, `build.sh`, `deps.lock`) | this skill; a daemon shim (`Sources-daemon-shim`) change also needs the #rt announce and `rt daemon restart` afterwards |
| board, console, chat, boxscore (`~/Documents/GitHub/mattstack-apps`), gitq (`~/Documents/GitHub/gitq`) | no rebuild: in that checkout confirm `git branch --show-current` is `main` (never switch it), pull, then the app row's deploy button or `deck cmd <app> deploy` |
| deck source (`mattstack-apps/apps/deck`) | no rebuild: the same pull, then the deck row's deploy button or `deck cmd deck deploy` |
| rt CLI or daemon source (`lib/`, `commands/`) | no rebuild: pull the dev daemon's source checkout on `main`, announce in #rt, then `rt daemon restart` |

## Run it

`--ref` takes any branch or tag pushed to `m4ttstack/rt` (merged or not),
or a sha on one of them; the script clones it. Run it from your own repo-tools
worktree when it has `scripts/build-dev-app.ts`, else from
`~/Documents/GitHub/repo-tools`:

```bash
bun scripts/build-dev-app.ts --ref main          # prints what it will do
bun scripts/build-dev-app.ts --ref main --yes > <scratchpad>/build-dev-app.log 2>&1
```

It takes several minutes; run it in the background, tell Matt it is
running, and read the log once when it exits.
The last line is the verdict:

- `✓ dev bundle rebuild (main at <sha>): ... relaunched (pid N); deck helper restarted`
- `✗ ...` names the step that failed and exits 1. A failed swap restores the
  previous app.

Then confirm the seal: `codesign --verify --strict /Applications/mattstack-dev.app`.

## What the script already does

Scratch clone at the ref, `scripts/fetch-deps.sh arm64`, `rt-tray/build.sh dev`,
kill the running dev app and wait for it to exit, move it aside, `ditto` the
new bundle in, `open` it, wait for a fresh pid, kickstart
`com.mattstack.deck.dev`. Doing any of these by hand is how the app ends up
built in a shared checkout, opened from a worktree path (a new identity for
Login Items and TCC), or running a stale deck helper.

## Common mistakes

| Mistake | Instead |
|---|---|
| `./build.sh dev` inside a checkout's `rt-tray/` | the script's scratch clone |
| `open <worktree>/rt-tray/mattstack-dev.app` | the app only ever runs from `/Applications/mattstack-dev.app` |
| `check-bundle.sh` to verify | it rebuilds both flavors; use the verdict line and `codesign --verify` |
| rebuilding for a board or deck change | the table above: those run from source |
| an unpushed ref | push first; the clone comes from GitHub |
