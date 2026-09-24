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

## Trying work in progress: `--local`

The default while iterating. From the repo-tools worktree that has the
change (committed or not; nothing needs pushing):

```bash
bun scripts/build-dev-app.ts --local --yes > <scratchpad>/build-dev-app.log 2>&1
```

It builds that working tree in a scratch copy and stages it; it does not
touch the running app. When it finishes, mattstack-dev's menu bar says
**new build ready** and the window's tab bar shows **New build · Restart**:
tell Matt to click it. Restarting swaps the build into `/Applications`,
reopens the app, and restarts deck and its managed apps.

Matt can do the same himself from the tray: **Rebuild (tree)** repeats the
last `--local` tree, **Rebuild from ▸** picks any live repo-tools worktree.

## Rebuilding from a pushed ref: `--ref`

For "put main (or a pushed branch) in the dev app now", e.g. after a merge.
It clones the ref from `m4ttstack/rt` and swaps it in immediately:

```bash
bun scripts/build-dev-app.ts --ref main --yes > <scratchpad>/build-dev-app.log 2>&1
```

The last line is the verdict: `✓ dev bundle rebuild (main at <sha>): ...
relaunched (pid N); deck helper and managed apps restarted`, or `✗ ...`
naming the failed step (a failed swap restores the previous app).

Either form takes several minutes: run it in the background, tell Matt it is
running, and read the log once when it exits. Run it from your own repo-tools
worktree, else from `~/Documents/GitHub/repo-tools`.

## What the script already does

Scratch copy (or clone), `rt-tray/build.sh dev`, then a swap by rename that
reopens the app and restarts deck and its managed apps (they run the
bundle's `Helpers/bun`, so they must move to the new bundle). Doing any of
this by hand is how the app ends up built in a shared checkout, opened from a
worktree path (a new identity for Login Items and TCC), or with managed apps
failing with EPERM on the deleted old bundle.

## Common mistakes

| Mistake | Instead |
|---|---|
| `./build.sh dev` inside a checkout's `rt-tray/` | the script's scratch clone |
| `open <worktree>/rt-tray/mattstack-dev.app` | the app only ever runs from `/Applications/mattstack-dev.app` |
| `check-bundle.sh` to verify | it rebuilds both flavors; use the verdict line and `codesign --verify` |
| rebuilding for a board or deck change | the table above: those run from source |
| committing or pushing work in progress just to try it | `--local` builds the working tree as it is |
| `--ref` on an unpushed branch | `--local`, or push first; `--ref` clones from GitHub |
