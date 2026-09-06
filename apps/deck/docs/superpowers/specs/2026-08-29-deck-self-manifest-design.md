# deck self-manifest: attach-source — design

Date: 2026-08-29
Status: ratified (approved by Matt in-session)
Builds on: `2026-08-28-deck-manifest-first-design.md` (the manifest,
`deck register`, action commands, the dev-mode gate).

## Problem

Every app is manifest-first now except deck itself. deck's record is not
created by `deck register`: `bootstrapSelf` (run by `deck setup`) writes it,
with `command` = the installed compiled binary at the path the launchd plist
execs (`~/.local/bin/deck` on a hand install, `~/.mattstack/deck/bin/deck`
from `install.sh`) and `workingDirectory` = the state dir
(`~/.mattstack/deck`), not the repo.

`applyManifest` treats deck like any other app, so `deck register` in the
deck repo would set `command` to the manifest's `start` and
`workingDirectory` to the repo: the platform would stop running the
installed binary and start running from a git checkout. A branch switch or
a moved folder then breaks the platform. That must never happen by
accident.

Two further mismatches: deck's action commands (rebuild) must run in the
repo, but the self record's `workingDirectory` is the state dir; and the
serve-shape reconciliation rules (`start` dropped from a supervised app is
refused) would fire on deck's record for the wrong reasons.

Matt's intent for deck's manifest is one thing: in dev mode, after a change,
rebuild deck from source and run the new build. A Deploy button on deck's
own row.

## Design

### Deploy rebuilds *from* source; deck never *runs from* source

`scripts/deploy.ts` already does the right thing: build a fresh compiled
binary from the repo, install it over the path the plist execs (read from
the self record via `deployTarget()`), restart, verify by health. The button
is just that command. Running from source (the interpreter executing the
checkout live) is refused, not supported.

### `sourceDirectory` on `AppRecord`

```ts
/** Where action commands run when it differs from workingDirectory. Only the platform sets it today. */
sourceDirectory?: string;
```

Generic field; no CLI sets it for ordinary apps. The command route spawns
with `cwd = record.sourceDirectory ?? record.workingDirectory`; the existing
"no manifest directory" 400 keys off that resolved cwd.

### The attach-source path in `applyManifest`

When the existing record is platform-managed (`isPlatformManagedBy(
existing.managedBy)`), `applyManifest` takes a distinct path instead of the
create/sync branches:

- **Refuse a serve shape.** A platform manifest that declares `start`,
  `port`, `altConfigs`, or `env` is a 400 (`"deck manages its own service;
  the platform manifest may only declare action commands"`). The manifest
  must not describe something deck cannot apply.
- **Refuse overlays.** `applyManifest(dir, activeAlt !== undefined, ...)`
  on a platform record is a 400; `deck alt deck <x>` therefore errors.
- **Never touch the serve shape.** No `registerApp`, no `editApp`, no
  driver calls: `command`, `port`, `workingDirectory`, `label`, `env` are
  `bootstrapSelf`'s.
- **Attach.** `putRecord({ ...existing, sourceDirectory: dir, commands:
  actionCommands })`. `activeAlt` is never set.
- **Identity is ignored.** The platform's name and icon are fixed
  (`rowFor` already serves `/favicon.svg` for a platform row);
  `ingestManifest` is not called. `displayName`/`description` in the file
  are allowed and ignored.
- **No self record yet.** A manifest named `deck` (or the legacy platform
  name) with no existing record is a 400 (`"run deck setup first"`), never a
  create: the create path would register a user app named deck running from
  source.

Ordinary apps are unaffected: the branch is gated on the record's
`managedBy`, which only `bootstrapSelf` sets to the platform id.

### deck's manifest

```json
{
  "name": "deck",
  "commands": {
    "deploy": "bun run deploy"
  }
}
```

`start` and `build` are removed: `start` is refused for the platform, and a
build that does not deploy has no use on deck's row.

### Self-restart during the deploy run

`bun run deploy` restarts deck partway through, so the in-memory run
record is lost and `GET .../commands/deploy/:runId` answers 404 after the
restart. The board already fires the POST, swallows the dropped connection,
and re-polls status; that is the documented behavior for a self-restarting
deploy and needs no change.

## Testing

`bun test core src`, existing harness (`scratch()`, fakes):

- applyManifest, platform record + manifest with only `commands.deploy`:
  `sourceDirectory` and `commands` written; `command`, `port`,
  `workingDirectory`, `label` byte-identical to before; `FakeServiceManager`
  saw no install/uninstall; `FakeEdgeProxy` aliases unchanged.
- Platform manifest declaring `start` / `port` / `altConfigs` / `env`: 400
  each, record untouched.
- `applyManifest(dir, "dev", ...)` on the platform record: 400.
- Manifest named `deck` with no record: 400, no record created.
- Command route: a record with `sourceDirectory` spawns with that cwd
  (fake spawn captures `cwd`); one without falls back to `workingDirectory`.
- Live, after deploying the change: `deck register --dir <deck repo>` from
  the repo, then in dev mode deck's board row shows a `deploy` button and
  `deck status` still reports the platform `up` on its original port.

## Deferred

- A run-from-source dev overlay for deck. Explicitly out: it replaces the
  platform with a checkout.
- Setting `sourceDirectory` for ordinary apps (an app whose service runs
  from a build dir with source elsewhere). The field exists; no CLI writes
  it until an app needs it.
- A reserved `commands.bundle` key for the mattstack.app bundle. Dropped:
  rt-tray only pulls published release URLs pinned in `deps.lock` and never
  reads a manifest, so the key would have no consumer. The contract on the
  artifact (self-contained darwin-arm64, bare `--version` exits 0) is
  enforced by `check-bundle.sh`, not by the manifest. Revisit only when a
  consumer exists.
