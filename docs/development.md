# Development guide

Deeper notes for working on rt itself. The README covers the short version
(clone, `bun install`, run from source); this file covers the parts you only
need once you are changing the install path, the editor extension, the menu bar
app, or the release.

## Two apps: mattstack.app and mattstack-dev.app

A machine runs one of two apps at a time:

- **mattstack.app** (prod): its daemon, deck and CLI are the compiled rt
  inside the bundle.
- **mattstack-dev.app** (dev, `rt-tray/build.sh dev`): its daemon and CLI run
  your source checkout through bun.

To switch, open the other app, by hand or from Settings > General >
Developer. Opening an app by hand takes the Mac over: the other app's tray
gives up its daemon agent and login item and quits, the other app's launchd
jobs are booted out, and `~/.local/bin/rt` is pointed at the opened app (the
dev app writes a wrapper that runs `bun run <checkout>/cli.ts`; the prod app
links its bundled rt). Whatever sat at `~/.local/bin/rt` before is replaced.
A login-item launch never takes over: if the other app is running, it quits
quietly instead. Nothing records a mode; which app is active is simply the
one installed and running.

Each process knows its own flavor from whoever launched it:
`MATTSTACK_FLAVOR=dev|prod` in each app's launchd plists, exported by the dev
wrapper, and otherwise the build (a compiled rt is prod, a source run is dev).
`rt version` names the app the CLI belongs to.

The checkout the dev app runs is stored in `~/.mattstack/rt/state.db` (the
`dev-mode` kv row, which the dev daemon launcher also reads):

```bash
rt settings source-path                     # show it
rt settings source-path ~/code/repo-tools   # set it (rewrites the dev wrapper if it owns ~/.local/bin/rt)
```

## Exercising the installer

```bash
rt --post-install
```

This is the same entry point mattstack.app spawns for its Install button. It
runs in three phases:

1. Refuse to proceed if rt is running from a transient root, meaning a mounted
   DMG or a Gatekeeper-translocated copy. Drag mattstack.app to
   `/Applications` and run it again.
2. Sweep legacy state: migrate an old `~/.rt` tree into `~/.mattstack/rt`, and
   delete a stale phase-1 copy of the app under `~/Applications`.
3. Run `rt setup apply --non-interactive --team-of-one`, which is the real
   install: a registry of steps covering the home repo, team join, secrets,
   PATH links, intercepts, settings seeding, repo clones, service
   registration, the proxy, skills, cron triage, plugins, the browser helper,
   herdr integration, the editor extension, service start, a snapshot push,
   and a final verify.

`rt setup plan` shows the checklist before anything runs; `rt setup status`
shows the same checklist as a post-install health view.

Note that rt does **not** auto-run the installer on first invocation. An `rt`
with no `~/.mattstack/rt/daemon.json` prints a one-line hint pointing at
mattstack.app or `rt setup`, and nothing else. That is deliberate:
auto-running would make `rt setup plan` unreachable before an install.

## Verifying an installation

```bash
rt verify           # human output, exits 1 on critical failures
rt verify --ci      # same output, no ANSI colors, and a CI-appropriate severity set
rt verify --json    # structured JSON for tooling
```

`rt verify` is a read-only render of the same plan `rt setup plan` computes. It
does not install anything. Rows marked required are the critical ones: macOS
version, Command Line Tools, arm64 architecture, the `rt` binary, absence of
split legacy state dirs, the app bundle, the daemon, the install flavor,
herdr, Claude, the browser helper, plus credential and forge-reachability
groups. The editor extension, the vsix, shell integration, the `~/.local/bin`
link, and intercepts are reported but not critical.

`--ci` additionally downgrades the permission, account, and access groups (and
a few tool rows) to non-critical, since a runner has no keychain or logged-in
browser.

## Building a local compiled binary

Use this to test how the release binary behaves (compiled mode, no bun
dependency at runtime):

```bash
bun build --compile ./cli.ts --outfile /tmp/rt-local
/tmp/rt-local --version
```

A compiled `rt` reads the real `~/.mattstack` tree and will act on it. Run it
under an isolated HOME (`env -i HOME=$(mktemp -d) /tmp/rt-local ...`) unless you
specifically intend to touch your live install.

## The rt-context editor extension

```bash
cd extensions/vscode/rt-context
bun install
bun run watch           # live rebuild during development
bun run package         # outputs rt-context-x.x.x.vsix
bun run install-local   # packages + installs into Cursor
```

Or install a packaged build into every detected editor with
`rt settings extension`.

## The menu bar app

```bash
cd rt-tray
./build.sh debug    # build and open in Xcode
./build.sh release  # build release mattstack.app (prod)
./build.sh dev      # build release mattstack-dev.app (dev, runs the daemon from source)
./build.sh install  # build + copy mattstack.app into place
```

The tray app reads its version from `Info.plist`
(`CFBundleShortVersionString`), which the CI build injects via `git describe`.
Local builds report whatever is in the plist at build time.

Never rebuild, re-sign, or reinstall an app bundle macOS has already blessed.
Re-signing invalidates Login Items and TCC grants, and the failure is silent.
Build into a scratch directory instead.

## Release

Push a version tag; CI does the rest.

```bash
git tag v1.2.3
git push --tags
```

`.github/workflows/release.yml` then:

1. Compiles `rt` for `bun-darwin-arm64` and builds the Go `rt-ui` helper for
   arm64.
2. Fetches the pinned helper binaries listed in `rt-tray/deps.lock`.
3. Builds `mattstack.app` with the version baked into `Info.plist`, packages
   `rt-context.vsix` into `Contents/Resources/`, and signs and notarizes.
4. Runs a clean-room install from the built `.zip` on a fresh macOS runner:
   `rt --post-install`, a PATH check, `rt daemon install`, then
   `rt verify --ci`. This gates publication rather than following it.
5. Publishes the release assets: `mattstack-<version>.dmg`,
   `mattstack-<version>.zip`, Sparkle `.delta` files, `appcast.xml`, and
   `SHA256SUMS`.

rt ships an Apple silicon (arm64) build only. Intel Macs are not supported, and
`rt verify` fails the architecture row on one.

Updates reach users through Sparkle, driven by mattstack.app. `rt update` only
asks the app to check; it never downloads or installs anything itself.

`docs/release-and-distribution.md` carries the deeper release rules: the bundle
layout, signing, the marketplace publish, and the clean-room VM.
