# Prod readiness for 2.13.0 (RT-279..284)

Status: draft for Matt's review, 2026-09-24. Target: a 2.13.0 DMG Ed can install on the morning of 2026-09-25.

## Why

Prod 2.12.0's first launch on Matt's Mac, after months in the dev app, came up broken: the daemon never started (launchd exit 78), chat never started (missing working dir), the gitq CLI was served as the gitq web app and looped, boxscore was not in the bundle, and the window showed a 502 and no tab icons until a relaunch. The read-only code map behind this spec (workflow `wf_51bfca22-c8a`) found two more: a clean prod install never serves board, and apps registered by prod have no icon even once deck is up.

Other people will build with the dev app and then open prod, so every one of these is a product bug.

## Success

- A clean install of 2.13.0 shows board, chat, console and boxscore healthy on the deck board, each tab with its name and icon, on the first launch, with no relaunch.
- Opening 2.13.0 on a machine that lived in dev mode (Matt's) serves the same four apps from the bundle, and switching back to dev serves the registrations from source again. Neither switch deletes the other flavor's rows.
- A prod app whose daemon launchd refuses to spawn heals itself on launch, with no terminal step.
- `rt uninstall <anything>` and `deck remove --managed <name>` can no longer remove more than asked.

## The rule (ratified by Matt, 2026-09-24)

- Prod: deck's mattstack apps are exactly the bundle's explicit list of shipped apps. "In the bundle" means bundled as an app, never "a binary with that name sits in `Contents/Helpers`" (the gitq CLI ships as a tool, not an app).
- Dev: deck's mattstack apps are whatever is registered on the machine, served from source.
- Both flavors share one registry and the `com.mattstack.deck.<app>` labels, so prod ignores rows outside its list (does not serve them, does not delete them). User-added apps run under either flavor.

## Design

### A. The served-app catalog lives in the bundle (repo-tools)

`rt-tray/deps.lock` helper rows gain an optional `serve` object: `{ "port": <number>, "args": [<string>...] }`. A row with `serve` is a bundled app; a row without it is a tool. Tonight's catalog: board (11006), chat (11002), console (11001), boxscore (11005); gitq and deck carry no `serve`. `parseDepsLock` (`lib/bundle-layout.ts`) validates the field. The bundle ships `deps.lock` in `Contents/Resources` (add the copy to `rt-tray/build.sh` if it is missing) so deck can read its own catalog.

### B. Deck's boot sweep enforces the rule (mattstack-apps, `apps/deck`)

The sweep (`reresolveManagedApps`, `apps/deck/src/api/register.ts`) is the single seam that runs after every flavor switch and on every deck start. It becomes:

- Deck reads the catalog from its bundle's `Contents/Resources/deps.lock` with its own small parser, pinned to repo-tools' parser by a shared fixture.
- **Prod:** for each catalog app it ensures an rt-managed row exists (creating one with the catalog port, or adopting a same-named `managedBy: user` row while keeping its dev link), serves `Contents/Helpers/<name> <serve.args>` with cwd `~/.mattstack/<name>`, creates that dir, installs or refreshes the plist, and starts the job when the dir was just created or the plist changed. Every other rt-managed row is **not served in this flavor**: its plist is uninstalled, the row and dev link are kept, and `/api/apps` hides it.
- **Dev:** unchanged in spirit. rt-managed rows serve source when linked, otherwise the dev bundle's binary with the catalog's `serve.args`. A linked row outside the catalog (Matt's gitq web app, if he re-adds it) serves from source.
- For catalog apps the catalog's args win over any stored `command` that points into a mattstack bundle's `Helpers` dir, so flavor-bound stored paths on teammates' machines stop raising "legacy stored command ignored".
- `specFor` refuses a missing cwd it does not own (a board issue instead of a plist launchd rejects with exit 78).
- Registry changes are additive: the older deck pinned in the other flavor must still read the file.
- `deck remove --managed <name>` removes only `<name>` (today it ignores the name and removes every managed row). The refusal for an rt-managed row stops suggesting `rt uninstall <app>`; it names `deck remove <name> --force`.
- Fix the stale `apps/deck/AGENTS.md` paragraph about units rendered via `convert.ts`.

### C. Bundled apps carry their identity (mattstack-apps + repo-tools)

Each bundled app's `mattstack.deck.json` and icon ship in the bundle at `Contents/Resources/apps/<name>/`. Deck reads display name, description, icon and badge from there for a catalog row with no source link, so prod tabs have icons on a clean install.

### D. boxscore becomes bundle-ready (mattstack-apps, then repo-tools)

Same shape as console: a `build:binary` script with embedded assets, `includeInBundle` and a `bundle` recipe in its manifest, LICENSE and license field, and a CI binary gate modeled on console's. The `bundle-apps` dispatch publishes `boxscore-v0.1.0` and flips the new deps.lock row from pending to bundled.

### E. rt setup and CLI cleanup (repo-tools)

- `deck.managed` stops registering individual apps (the gitq, chat and console legs and their `mkdirp`): installing deck and letting its sweep run is enough. The legacy `mrs` to `board` adoption stays as long as a machine can still carry an `mrs` row. The step's detail string and `steps-b.test.ts` follow.
- The gitq CLI stays exactly as it is: its deps.lock row, `DEFAULT_EXPOSED`, and the release preflight `standalone:gitq` pin check.
- `rt uninstall` rejects positional arguments (today `rt uninstall gitq` silently runs the whole-product uninstall off a TTY), and its deck step makes one targeted call.

### F. Tray launch lifecycle (repo-tools, `rt-tray`)

- Re-registering an agent runs the sequence that recovered the daemon tonight: synchronous unregister, a short settle, register, then start the job once. The plist hash is recorded only after the daemon (or deck) answers within a bounded wait; otherwise the next launch tries again.
- Spawn-health heal: if SMAppService reports enabled but the daemon is unreachable and launchd reports a refused spawn (last exit 78 or "spawn failed"), the tray runs one full unregister/register cycle and logs the outcome. One attempt per launch, never a loop.
- Version change stops `kickstart -k`-ing agents registered on this same launch (the kill-and-wait cost deck about 30s tonight) and no longer runs `deck restart --managed` (the sweep covers it). The version is recorded once the daemon and deck answer.

### G. Window waits for deck (repo-tools, `rt-tray`)

Matt's ruling: the whole window waits.

- The splash stays up until deck's `/healthz` answers and the app catalog is fetched, bounded at 90s. The stack animation plays as today; only when it has finished and deck is still not ready does a spinner appear beside it.
- At 90s the splash shows "Can't reach deck" with a Retry button and the reason the tray knows (deck agent status or exit code).
- The catalog re-fetches while it is stale, and missing icons re-fetch once it is fresh.
- A tab whose app answers a main-frame 5xx shows the existing failure overlay with Retry instead of a silent 502 page.
- UI validation: screenshots of a scratch-built dev app in both color schemes (splash waiting, spinner, can't-reach, loaded window). Fast Browser cannot drive the native window, so this uses `screencapture`.

### H. The VM check asserts the expected apps (repo-tools, `rt-tray/vm`)

`assert-installed.sh` (and the Sparkle update leg) check deck's `/api/v1/status` for the expected set in prod (board, chat, console and boxscore healthy, argv0 under the prod `Helpers`, no dev-link issues, no gitq web label) and every `.mattstack` route, not just the first.

### I. Release 2.13.0

Full gate: apps PRs, then `bundle-apps` for deck and boxscore, then the deps.lock PRs, then the rt PRs, then the release walkthrough, notarization and Sparkle feed. Afterwards, update Matt's prod through Sparkle and rebuild the dev app from main.

The release runs through the `rt:release` skill, and I consult Max over rt chat before and during the cut (he ran the last three releases).

## Order

1. In parallel: B + C (deck) and D (boxscore app) in mattstack-apps; A (deps.lock schema) and F + G (tray) and E (setup/CLI) in repo-tools.
2. After B and D merge: `bundle-apps` for deck and boxscore; merge the resulting deps.lock PRs, adding the `serve` fields.
3. H once the deps.lock rows land.
4. Release.

## Out of scope tonight (tickets to file)

- The "lived in dev mode first" VM leg (the rest of RT-284). It runs after the release.
- Flavor exclusivity at login: the other flavor's still-enabled agents reload at login, and takeover boots them out rather than retiring them.
- An Xcode Debug build with prod's bundle id started at login on 2026-09-24 and wrote prod's launch state. It needs its own identity or to skip login-item registration.

## Risks

- Deck version skew: the dev deck runs source HEAD while prod runs the pin, both writing one registry. Additive changes only, and a test that an older-shaped registry still loads.
- boxscore's first compiled build may surface bundling problems (SQLite, assets) only in the binary; its CI gate runs the binary.
- CodeRabbit may be rate-limited overnight; an Opus review stands in, per the house rule.
- The release walkthrough takes about 25 minutes and a failure there costs a cycle.

## Authority

Matt authorized, on 2026-09-24: merge each PR once CodeRabbit (or the stand-in review) and CI are green with findings addressed, and cut and publish 2.13.0 without waking him.
