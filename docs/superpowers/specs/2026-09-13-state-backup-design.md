# State backup — encrypted, compressed, off-machine

**Date:** 2026-09-13
**Status:** Design, pre-implementation

## Problem

All mattstack app state (rt, board, gitq) lives in SQLite databases and JSON
files under `~/.mattstack/<app>/`. These are outside the home repo
(`~/.mattstack/user/`) and have zero backup, sync, or export mechanism.

The settings architecture (`docs/settings-architecture.md`, layer 3) classifies
this state as "re-derivable or acceptable-to-lose." That label is wrong for
several categories:

- **Board agent_states and triage memory**: which reviews are complete,
  in-progress, or need retry. Loss re-dispatches already-finished reviews.
- **Gates completion state**: multi-step gate progress resets.
- **Chat messages**: full message history with no external copy.
- **MR review sections**: computed review verdicts.
- **gitq stacks**: branch parent-chain topology that gitq needs to operate.

Machine loss, disk corruption, or accidental deletion leaves the board in
disarray and interrupts in-progress work with no recourse.

## Decisions and rationale

- **SQLite `.backup` via `VACUUM INTO`, not the `.backup()` API.** Bun's
  `bun:sqlite` does not expose `.backup()`. `VACUUM INTO` is already the
  established pattern in `db.ts` and is safe against concurrent writers and
  WAL sidecars.

- **`zstd -19` compression.** Benchmarked on real state DBs: `-19` compresses
  8.4MB state.db to 1.1MB (13%) in 1.3s. `--ultra -22` saves 2KB more but
  takes 1.9s and uses 270MB RAM vs 95MB. `-3` (default) produces 1.5MB in
  0.03s. `-19` is the sweet spot: near-optimal ratio without the memory/time
  cost of ultra.

- **`age` encryption with multiple recipients.** Encrypt each backup to both a
  personal age key (macOS Keychain, already exists via `lib/home/age-key.ts`)
  and a team age key (sops-encrypted in the team repo). Either key can decrypt
  independently, giving two recovery paths: fast local restore via Keychain,
  and machine-loss restore via the team repo. This satisfies security team
  requirements: encryption at rest, key separation, no single point of
  failure, auditable custody.

- **Git LFS for storage.** Encrypted backups are binary blobs that don't delta
  well in git. Without LFS, git history grows ~1.4MB per backup indefinitely
  with no way to prune. LFS stores the blobs externally; old versions can be
  pruned from the LFS server when no git ref points to them. The home repo
  stays small (only pointer files in history). GitHub Free includes 1GB LFS
  storage; GitLab Free includes 5GB. Both hosts support LFS natively.

- **Home repo snapshot engine handles commit/push transparently.** The daemon's
  `home-snapshot.ts` shells out to real `git` (not a JS library), does not use
  `--no-verify`, and has no custom `core.hooksPath`. LFS hooks fire on every
  add/commit/push without code changes. Glance and rt-client do no home-repo
  git operations and need no changes.

- **Every 4 hours via `scheduleSweep`.** Matches the established daemon sweep
  pattern. Max 4 hours of data loss. 6 backups/day at ~1.4MB each. LFS
  server-side pruning keeps storage bounded.

- **No shutdown hook.** Periodic-only. A graceful shutdown backup adds seconds
  to every daemon stop and only helps the graceful case (not crashes or power
  loss), which is the less important failure mode.

- **Skip `events.db`.** Re-derivable historical event bus data. Adds 132K per
  backup with no recovery value.

- **gitq stacks via tar.** The stacks dir contains small JSON files, not
  SQLite. `tar -c` the directory, then the same compress-encrypt pipeline
  produces a `.tar.zst.age` blob alongside the SQLite backups.

## Scope

### In scope

- rt/state.db, rt/gates.db, board/state.db, gitq/stacks/
- Backup pipeline: VACUUM INTO / tar, compress, encrypt, write to home repo
- Restore pipeline: pull, LFS fetch, decrypt, decompress, place, integrity check
- Daemon sweep (every 4 hours)
- CLI commands: extended `rt state backup`, extended `rt state restore`, new `rt state backup status`
- Setup/bootstrap flow
- 7-day working-tree retention with LFS prune

### Out of scope

- rt/events.db (re-derivable)
- rt/bg-claims.db, rt/herds.db (tiny, re-derivable)
- Cold-start re-derivation from GitLab/Linear (future work, orthogonal)
- YubiKey/hardware key support (upgrade path, not blocking)

## Architecture

### Backup pipeline

```
┌─────────────┐     ┌──────────┐     ┌───────────────┐     ┌──────────────────────┐
│ VACUUM INTO  │ ──► │ zstd -19 │ ──► │ age -R recip. │ ──► │ write to home repo   │
│ (or tar -c)  │     │          │     │               │     │ state-backups/<app>/  │
└─────────────┘     └──────────┘     └───────────────┘     └──────────────────────┘
                                                                     │
                                                            home-snapshot.ts
                                                            auto-commit + push
                                                            (within ~80 seconds)
```

**Output path:** `~/.mattstack/user/state-backups/<app>/<app>-<ISO-timestamp>.<ext>.zst.age`

Where `<ext>` is `.db` for SQLite sources and `.tar` for gitq stacks.

**Sources:**

| App | Source | Method | Output |
|-----|--------|--------|--------|
| rt | `~/.mattstack/rt/state.db` | `VACUUM INTO` | `rt/rt-state-<ts>.db.zst.age` |
| rt | `~/.mattstack/rt/gates.db` | `VACUUM INTO` | `rt/rt-gates-<ts>.db.zst.age` |
| board | `~/.mattstack/board/state.db` | `VACUUM INTO` | `board/board-state-<ts>.db.zst.age` |
| gitq | `~/.mattstack/gitq/stacks/` | `tar -c` | `gitq/gitq-stacks-<ts>.tar.zst.age` |

### Key management

**Recipients file:** `~/.mattstack/user/state-backups/recipients.txt`

Contains two public keys:
1. Personal age key (from `readAgeKey()`, private half in macOS Keychain)
2. Team age key (private half sops-encrypted in team repo `~/.mattstack/teams/<team>/secrets/`)

The backup script only needs public keys. Private keys are touched only at
restore time.

**Encryption:** `age -R recipients.txt -o <output> <input>`

Either recipient's private key can decrypt independently.

### Daemon sweep

Replace the existing daily `scheduleSweep("state-backup", ...)` with the full
pipeline:

- Boot delay: 60 seconds (existing)
- Interval: 4 hours (was 24 hours)
- Guard: `recipients.txt` must exist (backup is configured)
- On each tick: run the full pipeline for all sources, then prune

The existing local-only `VACUUM INTO` to `~/.mattstack/rt/backups/` is
superseded. The `--local` flag on `rt state backup` preserves it for manual
use.

### Retention

- **Working tree:** delete `.zst.age` files older than 7 days from
  `~/.mattstack/user/state-backups/`. The deletion commits via the snapshot
  engine.
- **Local LFS cache:** `git lfs prune` after retention cleanup.
- **Server-side LFS:** orphaned objects (no git ref points to them) are garbage
  collected by GitHub/GitLab on their own schedule.

### Restore flow

`rt state restore --from-backup`:

1. Refuse if daemon is running
2. `git -C ~/.mattstack/user pull` (get latest)
3. `git -C ~/.mattstack/user lfs pull` (download LFS blobs)
4. Find most recent backup set by timestamp (or `--at <timestamp>`)
5. Filter to requested apps (or all if no `--only`)
6. For each file:
   a. `age -d -i <keychain-key>` (try personal key first)
   b. If personal key fails, prompt for team key path
   c. `zstd -d` to decompress
   d. For SQLite: `PRAGMA integrity_check` on restored file
   e. Copy to target path under `~/.mattstack/<app>/`
7. Report what was restored

**Flags:**
- `--from-backup`: restore from home repo (required to distinguish from local restore)
- `--only rt|board|gitq`: restore individual app
- `--at <timestamp>`: point-in-time restore (default: most recent)
- `--dry-run`: show what would be restored, don't write

### Command UX

**`rt state backup`** (extended):
- Default: full pipeline (VACUUM INTO/tar, compress, encrypt, write to home repo)
- `--local`: legacy behavior (VACUUM INTO to `~/.mattstack/rt/backups/`)

**`rt state restore`** (extended):
- `rt state restore <path>`: existing local restore (unchanged)
- `rt state restore --from-backup [--only <app>] [--at <ts>] [--dry-run]`: restore from home repo

**`rt state backup status`** (new):
- Last backup time per app
- Next scheduled backup
- Backup count and total size in home repo
- LFS storage usage
- Recipient count

### Setup / bootstrap

Part of `rt setup` or standalone `rt state backup init`:

1. **Check deps:** `git-lfs` installed? `age` installed? `zstd` installed? (`deps.lock` bundles `age-keygen` but not `age` itself; `age` and `zstd` resolve via PATH)
2. **Install LFS:** `brew install git-lfs` if missing, then `git lfs install`
   in home repo
3. **Configure tracking:** add `.gitattributes` to home repo with
   `*.age filter=lfs diff=lfs merge=lfs -text`
4. **Create recipients file:** `~/.mattstack/user/state-backups/recipients.txt`
   with personal age public key from `readAgeKey()`. If team repo exists,
   prompt to add team recipient.
5. **First backup:** run the full pipeline immediately
6. **Verify round-trip:** decrypt + decompress to temp dir, integrity check

The daemon starts the 4-hour sweep automatically once `recipients.txt` exists.

## Error handling

- **Compression fails:** log warning, skip this cycle, retry next sweep. Clean
  up partial files in temp dir.
- **Encryption fails (missing age, missing recipients):** log error, fall back
  to local-only VACUUM INTO so state is captured unencrypted locally.
- **LFS push fails (network, auth):** the snapshot engine already handles push
  failures (retries on next commit cycle). The encrypted file is committed
  locally and pushes when connectivity returns.
- **Restore decryption fails:** try keychain key first, then prompt for team
  key path. If both fail, name which keys were tried.
- **Restore integrity check fails:** refuse to overwrite current DB, report
  which file is corrupt, suggest older backup via `--at`.
- **Daemon running during restore:** refuse with error (existing behavior).
- **Backup without setup (no `recipients.txt`, no LFS):** `rt state backup`
  prints a message pointing the user to `rt state backup init` and exits.
  The daemon sweep silently skips (guard: `recipients.txt` must exist).

## LFS + token auth

The snapshot engine's `gitWithToken` injects credentials via env vars for
pushes. LFS pre-push uses the same git credential mechanism. GitHub and GitLab
LFS auth piggybacks on git credentials, so this should work transparently. The
setup flow must verify a round-trip push (step 5) to confirm LFS auth works
with the token path.

## Testing

- Unit tests for the pipeline stages (compress, encrypt, prune) with mock
  filesystem
- Integration test: full round-trip (backup, restore, integrity check) under
  isolated HOME
- The daemon sweep is tested via the existing `scheduleSweep` test pattern
- LFS operations tested against a real (test) repo in CI, or skipped with a
  clear `skipIf(!hasGitLfs)` guard
