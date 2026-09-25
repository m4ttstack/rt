A follow-up to 2.13.0: Sparkle updates install on the first click, and deck's Add app registers an app from its manifest.

### Updates

- "Install and Relaunch" now installs on the first click even with the mattstack window open. The window-close quit interception used to cancel Sparkle's quit, so the app only closed its window and the install waited for another click; Sparkle's own installer is now let through while an install is running (RT-296, #451). Updating to 2.13.1 from 2.13.0 or earlier still goes through the old app's code, so if the window only closes, click Install and Relaunch again.

### Deck 1.1.1

- Add app asks for the app's directory and registers it from its `mattstack.deck.json`, the same as `deck register --dir` (port, start command, env, action commands, name and icon); a directory without a manifest falls back to name, command and working directory (RT-297, #452)
- Add app never changes an app that is already registered: it reports "already registered" instead of relinking or restarting it
- the route-only "I run this myself" option is gone from Add app
- a relative or missing directory is refused before anything registers, `deck register --dir` resolves a relative path, and typing in the form no longer jumps focus back to the Name field

### Glitter

- the diff pane tints added and removed rows, highlights whole files so multi-line comments and markdown headings color correctly, and soft-wraps long lines (#443)

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.13.0...v2.13.1
