# Deck runs from source in the dev app (DECK-63)

## Goal

In the dev app (`mattstack-dev.app`), deck runs from the linked
`mattstack-apps` checkout, and the deploy button on the deck row makes the
latest source live. The workflow is: merge, pull the checkout on `main`,
click deploy. A deck change never needs a dev-app rebuild or a release.

The prod app (`mattstack.app`) is unchanged: it runs the `deps.lock` pinned
deck, and deploy stays refused there.

## Why this is needed

apps#122 made the app's SMAppService helper the only deck (two decks were
fighting over one port set), and #125 made `bun run deploy` refuse under
helper ownership, because deploy writes a new binary to the path launchd
execs and that path is now `Contents/Helpers/deck` inside a signed bundle.
Overwriting a file there breaks the bundle's signature and gives deck a new
TCC identity. Since then the dev app runs the pinned release, and the deploy
button can only fail (four "owns deck" refusals in `deck.err.log` on
2026-09-23).

Board, console and the other served apps already run from the checkout in
dev. The rt daemon does too, through `rt-tray/Sources-daemon-shim` (the dev
bundle's `Contents/MacOS/rt`, a signed exec-proxy that runs
`bun lib/daemon.ts` from the repo-tools checkout, today as
`~/.bun/bin/bun` under launchd, which already has the TCC grant to read
`~/Documents`). Deck gets the same shape.

## Design

### 1. Deck dev shim (repo-tools `rt-tray`, dev flavor only)

**Targets.** Two new SwiftPM targets in `rt-tray/Package.swift`:

- `DeckShimLogic` (library): the pure choice function below. No I/O of its
  own; the file system and environment arrive as injected closures.
  `MattstackCoreChecks` gains a dependency on it so the choice is tested
  there.
- `deck-dev-shim` (executable, `Sources-deck-shim/main.swift`): the thin
  I/O wrapper that gathers inputs, calls `DeckShimLogic`, logs, and execs.
  It depends only on `DeckShimLogic` and Foundation (static, no framework
  rpath from `Contents/Helpers`).

The deck shim does NOT read rt's dev-mode config: bun is
`$HOME/.bun/bin/bun` (the same bun the rt daemon runs today). This avoids
copying `rt-daemon-shim`'s SQLite reader.

**Bundling** (`rt-tray/build.sh`, dev flavor only):

- Build the new product on both build paths: the swift path already builds
  every product; the xcode path (`build.sh:94-97`, the default when
  `project.yml` exists) must add `swift build -c release --product
  deck-dev-shim` next to the existing `rt-daemon-shim` line.
- `bundle_helpers` stages the pinned deck from `deps.lock` at
  `Contents/Helpers/deck` as today. Then, dev flavor only, move it to
  `Contents/Helpers/deck-pinned` and copy the shim to
  `Contents/Helpers/deck`.
- Signing: the existing `HELPER_ENTITLEMENTS` entry for `Contents/Helpers/deck`
  now signs the shim (jit, identifier `com.mattstack.helper.deck`, the
  identifier the deck plist's `BundleProgram` has always run). Add
  `HELPER_ENTITLEMENTS+=("$CONTENTS/Helpers/deck-pinned	jit")` in the dev
  branch, or `deck-pinned` stays unsigned and the outer seal
  (`build.sh:516`) fails with "code object is not signed at all".
- `rt-tray/check-bundle.sh`: add `deck-pinned` to the `allowed` list of
  top-level `Contents/Helpers` entries (`check-bundle.sh:371-385`), assert
  that in the dev flavor `Contents/Helpers/deck` is the shim and
  `deck-pinned` exists, and in prod that `deck-pinned` does not exist. The
  deck row's `--version` probe (`check-bundle.sh:341-352`) runs under
  `env -i HOME=<tmp> PATH=/usr/bin:/bin` in the dev flavor (as the daemon-shim cases do at
  `check-bundle.sh:573`); with no registry there, the shim falls back to
  pinned and prints the pinned version.
- Prod is untouched: `Contents/Helpers/deck` stays the pinned binary and
  there is no `deck-pinned`.

**The choice** (`DeckShimLogic`), run on every launch: the launchd `serve`
and every CLI call alike, since deck composes its PATH with
`Contents/Helpers` first (`apps/deck/src/services/exec-env.ts:47-48`):

- The bundle root is derived from the shim's own executable path
  (`_NSGetExecutablePath`, then `realpath`, then three `dirname`s:
  `.app/Contents/Helpers/deck`). `argv[0]` is relative under launchd, so it
  is not used.
- **Source** when all of these hold:
  - `~/.mattstack/deck/registry.json` is trusted (owned by this uid, not
    group- or other-writable, the same rule `rt-daemon-shim`'s
    `isTrustedConfigFile` applies), parses as JSON of shape
    `{ "version": 1, "apps": { "deck": { "dev": { "workingDirectory": "<abs>" } } } }`,
    and that `workingDirectory` is absolute;
  - `<workingDirectory>/src/main.ts` exists;
  - `$HOME/.bun/bin/bun` exists and is executable.

  Then exec `$HOME/.bun/bin/bun <workingDirectory>/src/main.ts <args...>`.
- **Pinned** otherwise: exec `Contents/Helpers/deck-pinned <args...>`.
- Both paths add `DECK_BUNDLE_ROOT=<absolute .app path>` and
  `DECK_RUN_MODE=source|pinned` to the environment, the pinned path also
  adds `DECK_RUN_REASON=<one-line reason>`, and the working directory is
  unchanged. These three variables are the whole cross-repo contract
  between the shim and deck; nothing parses a log.
- The choice function returns the mode plus, for pinned, the reason (which
  condition failed), so the reason is testable and loggable.

**Logging.** For `serve`, the shim first redirects stderr to
`~/.mattstack/deck/logs/deck.err.log` (append), because the deck plist sets
no `StandardErrorPath`, then writes one line naming the mode and, for
pinned, the reason, formatted `deck-dev-shim: source` or
`deck-dev-shim: pinned: <reason>` (for humans; deck never reads it). CLI calls keep the caller's stderr and print nothing on
the source path, so CLI output is unchanged; on the pinned path a CLI call
also stays quiet (the serve log already records why).

**Exit.** If `execv` fails after the choice, the shim exits 1 so launchd
restarts it. A deck that crashes after booting from source is not caught by
the shim: launchd restarts the shim, which runs source again. A crash loop is
louder than silently serving stale code, and the deck row shows it.

### 2. Deck honors the shim (mattstack-apps `apps/deck`)

**Bundle root.** `bundleRootFromExec` (`src/services/bundle-layout.ts`),
when called with no explicit `execPath` argument, first returns
`process.env.DECK_BUNDLE_ROOT` if it is set, absolute, ends in `.app`, and
has `Contents/Info.plist`; otherwise today's `process.execPath` logic. A
call that passes an explicit `execPath` (the existing tests) ignores the
environment, so those tests stay environment-independent. Under bun,
`process.execPath` is bun, so without this every caller loses the bundle.
All bundle-root consumers go through `bundleRootFromExec` or
`bundleHelpersDir`: `main.ts`, `cli/client.ts`, `cli/setup.ts`,
`cli/update.ts`, `registry/serve-shape.ts`, `services/exec-env.ts`,
`scripts/deploy.ts`. The two direct `process.execPath` reads
(`cli/setup.ts:107`, `cli/update.ts:52,104`) sit behind helper-owned
refusals and are not reached under the shim.

**Run mode is observable.** The serving deck records its mode:
`api.json` (`src/api/state.ts`) gains `runMode: 'source' | 'pinned' |
'standalone'`, from `DECK_RUN_MODE` (absent means `standalone`, a deck not
run by the shim), and, when pinned, `runReason` from `DECK_RUN_REASON`.
Readers treat a missing `runMode` as `standalone`.

**Deploy.** `scripts/deploy.ts`'s mode choice becomes a pure, tested
function over (helper-owned, run mode). The run mode is `DECK_RUN_MODE`
when set (a deploy the serving deck spawned: the row's button or
`deck cmd deck deploy`), else the serving deck's `api.json` `runMode` (a
terminal `bun run deploy` from the checkout):

| Helper owns deck | Run mode | Deploy does |
|---|---|---|
| no | (any) | today's build, install over the self record's program, restart, health check, restore on failure |
| yes | `source` | restart-only (below) |
| yes | `pinned` | refuse: "deck is running the pinned release because <reason>; fix the checkout or bun, then restart deck" |
| yes | `standalone` or unknown | refuse as today, adding that in the dev app the last `deck-dev-shim:` line in `deck.err.log` says why source is not running (a helper without the shim: prod, or a dev app built before this change; rebuilding the dev app resolves it) |

Restart-only:

- `$HOME/.bun/bin/bun install --frozen-lockfile` at the checkout's
  workspace root, with the same bun that serves (fast when current;
  prevents a crash loop after a dependency bump).
- `deck restart deck` (kickstart of the running helper label via
  `runningLabel`, `src/api/register.ts:380-399`; the socket drop is
  tolerated as today). The deploy child survives the self-restart (the live
  log shows a button deploy printing its health result after the restart).
- The existing 20s `/healthz` wait, then read `api.json` and require
  `runMode === 'source'`. If healthy but pinned, exit 1 quoting
  `api.json`'s `runReason` (the source could not start and the shim fell
  back).
- On timeout, print the existing log tails and exit 1. No binary restore.
- No `bun run build` and no `build:board`: the board UI is static text
  imports of committed `core/generated/board.{js,css}`
  (`core/board-assets.ts:5-6`), byte-checked by
  `core/generated-fresh.test.ts`, so a checkout on `main` already carries it.

`deployTarget` keeps refusing for the pinned or shim-less helper.

**The deploy button.** Dev buttons already show only when rt dev mode is on
and the manifest is linked (`src/registry/serve-shape.ts:56-69`, gate
`src/api/dev-mode.ts`), so prod never shows it. With the shim the button
works. The one place it can still only fail is a dev app built before this
change (no shim); that is transitional and a dev-app rebuild resolves it.
No board work is in scope.

### 3. Docs

- `apps/deck/AGENTS.md` "Run only from main": in the dev app, deck runs the
  linked checkout through the shim, so the flow is merge, pull, deploy;
  `api.json`'s `runMode` (and `runReason`) says which mode is serving.
- repo-tools `AGENTS.md`: the held "Getting a change into the running dev
  app" note (branch `agents-dev-app-deploy`) is rewritten to this flow and
  lands with the shim.
- The build-dev-app script and thin skill Matt asked for are written after
  this lands (a script that builds the dev app in a scratch tree and
  replaces `/Applications/mattstack-dev.app`, and a skill that calls it).
  They are needed only for shim or tray changes now.

## Failure behavior

| Situation | Result |
|---|---|
| Checkout moved or deleted, or `src/main.ts` missing | Pinned deck serves; `runMode: pinned` with `runReason`; the serve log names why |
| bun missing | Same as above |
| `registry.json` missing, unreadable, untrusted, or no deck `dev.workingDirectory` | Same as above |
| Source deck throws at boot | launchd restarts the shim, which runs source again; an import-time crash loop is visible in `deck.err.log` (before deck redirects output), a crash after boot in `agent.log` (`src/agent-log.ts`) |
| Deploy while `runMode: pinned` (dev) | Refuses, naming the reason |
| Deploy restart comes back pinned | Exit 1 with the shim's reason |
| Deploy restart not healthy in 20s | Log tails printed, exit 1 |
| First pinned fallback after a rebuild | `deck-pinned` is signed `com.mattstack.helper.deck-pinned`, a new code identity, so macOS may ask once to let it read Documents |
| Prod app | Unchanged |

The `runMode: pinned` rows above assume a `deck-pinned` binary built with this
change. Today's pinned fallback is deck 1.0.6 (`deps.lock`), which predates
`runMode`: it writes no `runMode` field at all, so a pinned fallback reads as
`standalone` in `api.json` until the pin is bumped past this change.

## Testing

- **Deck:** `bundleRootFromExec` honors a valid `DECK_BUNDLE_ROOT`, rejects
  an invalid one, and ignores it when an explicit `execPath` is passed;
  deploy's mode choice (the table above) as a pure function; `api.json`
  round-trips `runMode` and `runReason` and reads a missing `runMode` as
  `standalone`. The
  existing suite stays green (`bun test core src`).
- **Shim:** `DeckShimLogic` cases in `MattstackCoreChecks`: source when all
  conditions hold; pinned with the right reason for each failed condition
  (untrusted registry, bad JSON, no deck record, relative directory,
  missing `src/main.ts`, missing bun); bundle root derivation from an
  executable path.
- **Bundle:** `check-bundle.sh` dev and prod assertions above.
- **Real check (controller-run, not a subagent):** Matt authorized the
  controller to rebuild and install the dev app on 2026-09-23. Build in a
  scratch tree, replace `/Applications/mattstack-dev.app` by moving the old
  one aside, confirm the deck process is `bun …/apps/deck/src/main.ts serve`
  and `api.json` says `source`, run `deck cmd deck deploy` and see it come
  back healthy and `source`, then re-register board and console and see
  `badge` in `/api/apps` (the badge rollout this unblocks).

## Out of scope

- `~/.local/bin/deck` is a stale compiled CLI left from before helper
  ownership. It is not changed here.
- The rt:release machine-update verify reads `deck --version` from
  `Contents/Helpers/deck`; in the dev flavor that is now the source version.
  The verify step should read `deck-pinned` in the dev flavor; noted for
  the release skill, not changed here.
