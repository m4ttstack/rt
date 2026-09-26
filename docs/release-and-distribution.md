# Release & distribution — the mac app and everything it ships

The maintenance reference for mattstack.app's release pipeline and bundle.
CLAUDE.md carries the always-on rules (isolated HOME, never re-sign blessed
bundles, module registry, bytecode); this file is the map of how a release
actually works and the traps that were found by running it for real.
MAT-386 (Linear, mattstack workspace) is the historical record of how each
piece was proven; `docs/architecture.md` links the governing design docs.

## What a release ships

One tag (`v*`) produces, via `.github/workflows/release.yml` on macos-15:

- `mattstack-<ver>.dmg` and `.zip` — the app, signed + notarized + stapled
  (`scripts/release/make-dmg.sh`, `make-zip.sh`); the compiled rt CLI ships
  inside the bundle, there is no separate `rt-darwin-*.tar.gz` asset
- `SHA256SUMS` over the dmg/zip (the workflow's Checksums step). Sparkle
  `.delta` files are attempted but never materialize, by accepted decision
  (MAT-395): `build.sh` signs every plain file under `Contents/Helpers`
  individually, codesign stores those signatures as extended attributes, and
  Sparkle's `BinaryDelta` refuses to diff xattr'd trees. `appcast.sh`
  tolerates the delta failure and every update ships as the full ~260 MB
  zip; the update leg is proven on that path. Revisit only if the user base
  or update cadence makes delta bandwidth matter, or if the Helpers tree is
  restructured for another reason.
- `appcast.xml` — the Sparkle feed (`scripts/release/appcast.sh`)
- the published plugin marketplace (`scripts/release/marketplace.sh`,
  generated from `marketplace/marketplace.json`; url-pinned sources resolve
  at generation time, `--refresh` re-resolves)

`workflow_dispatch` runs everything **except publish** — the standing dry
run. A dispatch's DMG lands as the `release-dry-run` artifact and is fully
notarized/stapled when the Developer ID secrets are configured (ad-hoc
signed with a warning when they are not; a **tag** hard-fails without them).

## Secrets and gates

- Developer ID cert + notarization creds: required on tags, optional
  (ad-hoc) on dispatch. `scripts/release/notarize.sh` does submit + staple
  for the app AND the dmg; the workflow then asserts Gatekeeper accepts the
  stapled app — that assertion is what a user's machine enforces offline,
  so it runs after notarize, never before.
- `MARKETPLACE_TOKEN` — pushes the generated marketplace. Must exist before
  the next tag (MAT-386 §10).
- `scripts/bench-startup.ts` gates startup regressions in the workflow
  (see CLAUDE.md "Module registry" for what usually causes them).

## Signing rules that cost real time to learn

- Everything under `Contents/Helpers` is nested code: one unsigned file
  fails the outer seal. Helpers arrive via `rt-tray/deps.lock` (pinned
  url + sha256 per tool); `rt-tray/check-bundle.sh` asserts presence AND
  runs every helper from inside the signed bundle (`--version` smoke).
  Adding a helper = a deps.lock entry; check-bundle picks it up from the
  lock, no script edit.
- A helper the project publishes no darwin-arm64 binary for is compiled by
  `fetch-deps.sh` from its sha-pinned source release (`archive: "make-src"`,
  zstd today) rather than lifted from a Homebrew bottle, which links dylibs
  under `/opt/homebrew` that a user's Mac does not have. Every make-src
  build is then gated on `otool -L`: linking outside `/usr/lib` and
  `/System` fails the fetch instead of shipping a binary that dies on a
  brew-less machine.
- Never rebuild, re-sign, or reinstall a bundle macOS has blessed
  (`/Applications/mattstack.app`, `rt-tray/mattstack-dev.app`) — re-signing
  silently invalidates Login Items and TCC/FDA grants. Build into scratch.
- Updating the installed app (Sparkle or manual) costs the FDA grant —
  quit the app first, expect to re-grant after.

## Privileged proxy helper (mattstack-proxy-install)

The bundle ships a first-party Swift helper, `rt-tray/proxy-helper/`, built
by `build.sh` into `Contents/Helpers/mattstack-proxy-install` and signed like
every other helper. It is what lets `proxy.install` (`rt setup apply`)
install portless as a root LaunchDaemon on 443 instead of skipping. portless
itself is vendored and pinned through `rt-tray/deps.lock` like any other
third-party tool (`bundlePath: Contents/Helpers/portless-dist`); the already
bundled `node` row runs it, so no extra runtime ships. The helper's argv
contract (`install`, `remove`, `trust`, `--version`) is consumed by
`PrivilegedInstaller.swift` in this same repo, which is why it is a checked-in
SwiftPM target rather than a deps.lock-pinned release artifact.

Pin model: root must never run a payload it cannot verify, so `install`
refuses a `portless-dist`/`node` tree whose sha256 does not match the values
compiled into the helper at build time. Those pins come from
`rt-tray/proxy-helper/scripts/gen-pins.sh <app-version> <portless-dist-dir>
<node-binary>` (three required path arguments, no default for any of them).
`build.sh` runs it AFTER the Helpers signing loop, not before: codesign
rewrites a Mach-O in place, so a pin taken from the fetched (pre-sign) dep
would describe bytes that never ship, and the helper would refuse its own
payload at install time. `check-bundle.sh` re-asserts the shipped
`--version` line, the codesign identifier
(`com.mattstack.helper.mattstack-proxy-install`), and that `portless-dist`
ships, so a build that skips or reorders `gen-pins.sh` fails there instead of
at install time on someone's machine.

Install raises two admin dialogs, not one: the escalation prompt
(`AuthorizationExecuteWithPrivileges`) that reaches the helper at all, and
then macOS's own Certificate Trust Settings prompt for `security
add-trusted-cert`. The two cannot collapse into one: `com.apple.trust-settings.admin`
requires its own interactive `authenticate-admin` every time, root and
Developer ID signing included, and the credential the first prompt collected
is never reused for the second. `NeedModels.swift`'s prompt text says so up
front ("macOS will ask twice").

CA trust is the one non-fatal step in the install, and it runs LAST, after
`launchctl bootstrap`: portless does not mint its CA until the daemon it just
started actually runs, so there is nothing to trust until the LaunchDaemon is
up (the helper polls for `ca.pem` for up to 20s). A declined or failed trust
write does not fail the install: the proxy installs and serves untrusted,
and the outcome travels back on its own stdout line
(`MATTSTACK_TRUST=ok|declined|failed`) ahead of the `MATTSTACK_EXIT` trailer.
The `tool.proxy` validator row (`lib/setup/validators/tools.ts`) turns an
untrusted-but-current-version install into a `needs-you` row ("Browsers will
warn until the proxy certificate is trusted") with a "Trust certificate"
action; a version-drifted install gets the same treatment with "Update
proxy". Both actions, and a plain "Install proxy", resolve to the same
`setup apply --only proxy.install` verb (`--only` runs that step alone, where
`--from` would carry the rest of the install behind it): the step itself reads
plist presence, deployed-vs-pinned version, and CA trust state, and decides
whether to install, update, adopt a portless install that predates mattstack
(a plist with no VERSION beside it), or only re-run the trust write (the
helper's `trust` op, reached through its own tray route
`POST /privileged/proxy-trust` beside
`/privileged/proxy-install`), so no remedy can point at a route that disagrees
with what the row reported.

A version-drifted proxy (the deployed `/Library/Application
Support/mattstack/proxy/VERSION` disagreeing with the bundle's pinned
portless) re-runs that same install step rather than a separate update path:
the helper boots the running daemon out before bootstrapping the
replacement, so an update costs one admin prompt, same as a fresh install,
and root never follows a bundle update on its own.

Remove ties into `rt uninstall`'s existing `proxy.remove` action: bootout,
delete the plist and the sudoers rule, delete the CA from the System
keychain (its common name is read back from the installed `ca.pem`, since
deletion has to name the certificate), and delete the root copy. Every step
is idempotent: absence at any point is success, not something to report as
a failure.

Full security model and rulings: `docs/superpowers/specs/2026-09-08-proxy-helper-design.md`.

## The clean-room proof (what "it installs" means here)

Two layers, both green as of 2026-08-24:

1. **CI**: `scripts/e2e-cleanroom.sh` under a simulated HOME — the full
   20-step install: `rt --post-install` → daemon → `rt verify --ci` →
   `check-bundle --app` → Gatekeeper via quarantine. Note it needs bun
   (check-bundle parses deps.lock with it) — CI's setup-bun provides it.
2. **Real VM**: `rt-tray/vm/` (its README is the harness reference).
   Golden image lifecycle: `golden/build-golden.sh <ver>` pulls the
   cirruslabs image, provisions, pauses ONCE for manual clicks —
   Accessibility grants AND the Gatekeeper policy toggle (below) — then
   `verify-golden.sh` asserts 13 invariants. A golden is never booted
   again; runs clone it (`run/walkthrough.sh --ver 26 --dmg <dmg>
   --scenario headless`).

VM truths that only a real run surfaced (all encoded in the harness now):

- cirruslabs images ship Gatekeeper **App-Store-only** (`developer id
  disabled`) — a notarized Developer ID app is rejected with the "not
  downloaded from the App Store" dialog. Stricter than any real Mac; the
  toggle is Settings-UI/MDM-only (SIP blocks every CLI route), so it is a
  build-golden manual step and a verify-golden assertion.
- A `ditto`-copied quarantined app **translocates** on open (runs from a
  randomized read-only mount; background services can't register). Finder
  drags never translocate, so the harness strips quarantine after the
  spctl assessment — and verifies the strip took.
- `softwareupdate` label format is `Command Line Tools for Xcode 26.6-26.6`
  (space form), catalog order ≠ version order, and a freshly-poked catalog
  needs one scan cycle before CLT labels appear.

## Install-time product contracts

- `rt --post-install` refuses transient roots (DMG/translocated), sweeps
  legacy installs, then runs `rt setup apply --non-interactive
  --team-of-one` (commands/post-install.ts documents the order and why).
- Non-interactive apply gates on **hard preconditions only** —
  `tool.macos` + `tool.clt` (`commands/setup.ts`, HARD_PRECONDITION_IDS):
  git is required (settings and the home repo are git-backed), everything
  else (herdr, claude…) degrades gracefully. `--force` bypasses.
- `rt tools install apple-clt` installs Command Line Tools headlessly via
  the softwareupdate trigger-file flow — no dialog, works as a non-root
  admin, ~2 min, success claimed only after a green `git --version`
  re-probe (`lib/setup/tools-install.ts`). Dialog trigger is the fallback
  and reports `ok: false` (progress, not completion).

### Flavor exclusivity

One app runs a machine at a time: prod (`mattstack.app`, jobs
`com.mattstack.daemon` and `com.mattstack.deck`) or dev
(`mattstack-dev.app`, the same labels with `.dev`). Nothing stores which
one; each process's flavor is set by its launcher (`MATTSTACK_FLAVOR` in
each job's plist, exported by the dev `~/.local/bin/rt` wrapper, else the
build: a compiled rt is prod). Opening an app by hand takes the machine
over (`rt flavor takeover`: the other tray retires its daemon agent and
login item and quits, the other app's jobs are booted out, and
`~/.local/bin/rt` points at the opened app). A login-item launch never
takes over; it stands down while the other app's tray runs. A daemon
parks only while the other flavor's daemon still holds `rt.sock`, or when
its own flavor disagrees with the job that started it. `docs/development.md`
has the day-to-day view.

A machine that still carries the retired `mattstack.mode` setting needs no
cleanup: the resolver skips it silently. A machine sitting in a half-state
(both apps registered, or the wrong daemon holding `rt.sock`) clears it by
opening the app it should run, or manually with `launchctl bootout
gui/$UID/<wrong-label>`.

## Sparkle / updates

`appcast.sh` signs the feed; the appcast URL is baked prod-side, and a
prod build honours `MATTSTACK_APPCAST_URL` only with
`--allow-appcast-override` (the VM walkthrough's update leg uses this).
The update path is proven in the VM harness (MAT-394, rt#195): silent
in-place install and relaunch, daemon restart, `rt --version`, 2.8.0 to a
real 2.8.1 build. The prod-Mac leg (Create Release → appcast → an installed
app on real hardware) still awaits the first real tag; treat that first run
as a verification exercise, not a routine.

## App builds in release.yml (build-apps)

The apps are built in-tree by `build-apps`, and deps.lock's tree rows carry
no url. Board, boxscore, chat, console and deck live at `apps/*` in this
checkout and are `source: "tree"` rows in `rt-tray/deps.lock`: no url, no
sha256, nothing to pin. `release.yml`'s `build-apps` job builds them all
from the tagged commit: `bun install --frozen-lockfile`, then
`scripts/build-apps.ts`, which itself builds the platform packages under
`packages/*` via turbo before running each app's own compile recipe.
`build-apps` holds no signing key; signing happens later, in the same
Helpers loop every other bundled binary goes through. A change merged to
main ships in the very next release by construction: there is no separate
dispatch, no bot PR, and no pin to bump.

gitq stays its own repo (`~/Documents/GitHub/gitq`) rather than living
under `apps/*` here, and its `deps.lock` row keeps a `repo`/`url`/`sha256`
pin instead of `source: "tree"`, so it is not built by `build-apps`; it
stays on the same standalone pin-freshness policy as fast-browser (see
`skills/rt-release/SKILL.md`).

`apps/AGENTS.md` is the contract for what lives under `apps/*` and
`packages/*` (catalog rules, turbo, per-app scripts, UI authoring); read it
before adding an app or changing how one builds.

### Adding a served app

1. **The app must answer `--version` with a bare semver and exit 0.**
   `build-apps` smoke-tests the built artifact under an isolated HOME
   right after compiling it, checking only that `--version` exits 0 (a
   server that just starts listening hangs the probe); it never compares
   the printed version against the tag, which `update-machine` does
   separately. Apps on `@mattstack/app-server` get this from
   `serveMattstackApp` (0.1.2 or later): pass `version` from
   `package.json`, never a hardcoded string, or the tag and the binary
   disagree.
2. **A compiled Bun server needs embedded assets.** The console pattern:
   `build:binary` runs `vite build && mattstack-embed-assets && bun build
   --compile`; the server passes `embedded: () => import('./embedded/manifest'
   as string)`; tsconfig excludes the generated manifest; `.gitignore`
   carries `dist-bin` and the manifest path.
3. **`serve: { port, args }` on the deps.lock row marks it a served app.**
   `parseDepsLock` requires the row's bundlePath and exec to be exactly
   `Contents/Helpers/<name>`, a port from 1024 to 65535 used by no other
   served row, and args with no whitespace. Relax a `serve` rule only after a
   release whose parser already accepts the relaxed form has shipped:
   after a Sparkle update a still-running daemon re-reads the replaced
   bundle's lock with its old parser, and a lock it rejects sends every
   bundled tool lookup back to PATH until the daemon restarts.
4. **Identity and skills ride the build alongside the binary.**
   `build-apps` stages every built row's identity into `<name>-identity`
   (name, displayName, description, icon, badge, validated svg-rooted and
   under 64 KB); an app whose manifest declares no displayName or icon
   (deck itself) stages nothing. `build.sh` lands identity at
   `Contents/Resources/apps/<name>/` only for the deps.lock rows that
   carry `serve`. When the deps.lock row sets `skills: true`, `build-apps`
   also copies `apps/<name>/skills` into `<name>-skills`, landed at
   `Contents/Helpers/skills/<name>/`. Skill directory names must be
   dot-free (codesign reads a dotted directory as a nested bundle) and
   carry a `SKILL.md`; `check-bundle.sh` asserts both.

Workflow lint: the checks workflow runs actionlint over `checks.yml`,
`e2e.yml`, `purity.yml`, and `renovate.yml`. `release.yml` is grandfathered
(pre-existing SC2086/SC2129 style findings only).

### Two channels ship skills — pick deliberately

- **A bundled binary → `rt skills link --from`**: the `<name>-skills`
  directory `build-apps` stages (a tree row) or `fetch-deps.sh`
  materializes (a downloaded tool) rides the bundle to
  `Contents/Helpers/skills/<name>/`, reconciled into `~/.claude/skills`
  by frontmatter name. `skills/.skillsignore` (rt's
  own skills) keeps maintainer-only skills off user machines; a plain
  `rt skills link` in a checkout ignores it, because that is the author.
  Right for skills addressed by their bare name (`rt:chat` rides rt's
  own surface this way).
- **A marketplace plugin**: `marketplace/marketplace.json` in this repo is
  the generator source; `scripts/release/marketplace.sh` REPLACES the
  published m4ttstack/mattstack-marketplace tree wholesale, so anything
  living only in the published repo (or only in the local dev marketplace
  working copy, which has no git remote) dies on the next publish. Plugins
  with no repo of their own ship inline under `marketplace/plugins/`
  (string source `"./plugins/<name>"`); everything else is a url-pinned
  git source. Required when the `<plugin>:` namespace is a wire contract
  (`rt chat invite` types `/chat:join`) or the plugin carries hooks —
  `linkBundledSkills` handles skills dirs only, never hooks.
- A baseline plugin reaches users only if it is BOTH published in the
  marketplace AND listed in `BASE_PLUGINS` (`lib/setup/steps/plugins.ts`).
  The chat plugin needed both wires; check both when adding one.

## Still unproven (as of 2026-08-24)

- A real tag cut end to end (publish + Sparkle update leg + marketplace
  push with MARKETPLACE_TOKEN).
- The walkthrough's full-green 10/10 report (gitless persona asserting the
  graceful refusal, then rt driving the headless CLT install and
  continuing) — parked follow-up; each layer is proven individually.
- An invite redeemed by a second machine.
