# Board state.db

Move every board runtime state surface off APP_ROOT-anchored JSON files and
into one WAL-mode SQLite database, per the RT-48 suite-wide ruling (Matt,
2026-08-20: one SQLite state database per app; no new per-feature JSON state
files anywhere in the suite).

## Problem

Board state lives as JSON files under `<APP_ROOT>/state/`, and APP_ROOT is
derived from where the code runs: the repo root from a checkout,
`~/.mattstack/board` compiled. That path anchoring caused three incidents in
one week (2026-09-08 investigation):

- The Sep 6 fold-in moved the board between repos and orphaned every prior
  review state, which silently disabled the re-review latch on
  acme-web !43889 and !43878.
- A deck worktree preview (DECK-62: the manifest env never reached the
  process) booted with the worktree as APP_ROOT and forked live state.
- `bin/review-status.ts` writes landing with no prior file produced
  identity-less states (`mrUrl: ""`) that `readReviewStates` drops silently
  (BOARD-24), losing an approve outcome and a review report.

The file mechanics themselves are the same class RT-48 killed inside rt:
full-file `writeFileSync` read-modify-write, no locks across the server, the
triage cron, and N pane CLIs, and prune sweeps that delete records a database
would keep queryable.

## Decisions

All 2026-09-08, during design:

| Decision | Choice | Decided by |
|---|---|---|
| Instance model | One db at `~/.mattstack/board/state.db`; `BOARD_STATE_DB` env override for dev/preview server and triage runs | Matt |
| Pane handshake | Claim ticket: keep the `--state <path>` argv shape, path becomes an opaque handle | Matt |
| Rollout | One release, every surface at once, one-shot import | Matt |
| Suite scope | Board only; other apps' compliance is not this effort and gets no tickets now | Matt |
| Distribution | Fits the bundle story; settings stay behind the rt-client resolver; IF NOT EXISTS migrations only; ship as board's own release tag after apps PR 24; installed machines need a first-run JSON import | max (bundle pipeline owner) |

## The database

- Path: `BOARD_STATE_DB` when set, else `~/.mattstack/board/state.db`. HOME
  resolved at call time. Panes never need the env; see the claim ticket.
- `bun:sqlite`, copying rt's `lib/state/db.ts` pattern: lazy singleton
  `getStateDb()`, `openStateDb(path)` seam for tests, `closeStateDb()`.
  Pragmas on every open, in order: `busy_timeout` first, then
  `journal_mode = WAL`, then `synchronous = NORMAL`.
- Busy policy per writer flavor, rt's split: the long-running server defers
  cache-class writes on SQLITE_BUSY (warn and retry next sweep) but retries
  lifecycle and queue writes with short bounded backoff; CLIs wait
  (5000ms busy_timeout).
- `PRAGMA user_version` migrations, ordered in-code list, `BEGIN IMMEDIATE`
  with a re-read inside the transaction. All DDL `IF NOT EXISTS` (max: the
  runner replays V1..Vn on every bump, and SCHEMA_VERSION is claimed across
  branches on one machine).
- Corruption escape: an unopenable db is renamed `state.db.corrupt-<date>`,
  recreated empty, warned loudly. Failing migrations roll back and propagate.
- No module-load db access anywhere; every store initializes on first use.
- Store modules are single-owner per table behind one barrel
  (`src/state/index.ts`), rt's `lib/state/` shape.

## Schema v1

Three lifecycle tables mirroring today's per-lane state shapes:

- `reviews`, `responds`, `doctors`: identity (`mr_url` primary key within
  the table, `iid`), lifecycle (`status`, `message`, `outcome` where the
  lane has one), session plumbing (`session_id`, `agent_id`, `pane_id`,
  `tab_id`, `workspace_id`, gate fields where the lane has them),
  `started_at`, `updated_at`, plus `handle TEXT UNIQUE` (the claim ticket)
  and `report TEXT` (nullable; replaces the sibling `.md` file as the
  record).

Supporting tables mirroring their modules: `gates`, `drafts`, `nudges`,
`nudges_sent`, `outbox` (FIFO, bounded-retry writes like rt's
`notify_queue`), and `slack_messages` (today's per-MR `state/slack/` files).

A namespaced `kv (ns, k, v JSON, updated_at)` for the blobs: the two slack
index caches, the agent-status cursor, and triage memory
(`auto-dispatch.json`). Moving triage memory into the db also retires the
memory lock file: the cron's single-run guard becomes a claim row taken with
`BEGIN IMMEDIATE`.

## The claim ticket

Launch order changes from "write initial state file, then launch" to
"INSERT the row, then launch":

1. The launcher (server or triage) INSERTs the lifecycle row with full
   identity (`mr_url`, `iid`) and a `handle`: the same
   `<root>/state/<lane>/<slug>.json` path it hands today. The argv contract
   for wrapper skills and compiled team-pack verbs is unchanged:
   `--state <handle> --status-bin <path> [--report <path>]`.
2. The status CLI derives the db from the handle itself: third-ancestor root
   plus `/state.db`, the same derivation the agent-status emit uses for
   `appRoot` today. A preview board's panes therefore reach the preview's db
   with no environment, which is required because `rt agent start` carries
   none.
3. The CLI resolves the row by handle and UPDATEs it. No matching row is a
   loud error, never a fresh identity-less record. This structurally closes
   BOARD-24.
4. On a `done` write, the CLI reads the `--report` sibling file if present
   and stores its text into `report`; the file is scratch from then on.
   `reportReady` becomes `report IS NOT NULL`.

The agent-status event's `appRoot` scoping field carries the same derived
root it does today, so multi-board frame scoping on the bus is unchanged.

## Readers and prune

`readReviewStates()`, `readRespondStates()`, `readDoctorStates()`, gate and
draft and nudge reads become SELECTs behind the same function signatures
where practical. Prune sweeps become DELETEs, gated exactly as today: only
on a healthy, non-empty board snapshot, keyed on the full board.

## Import

The v1 migration ends with a one-shot import, guarded by a kv marker:

- Source: the invoking process's legacy `<APP_ROOT>/state/` tree (this
  covers the compiled home and a checkout equally), every surface that
  moves. Newest `updatedAt` wins per key. Sibling `.md` reports import into
  `report`.
- After a successful import the legacy dir is renamed
  `state.imported-<date>`; nothing deletes it.
- Installed machines hold JSON state today (max), so the import ships in the
  same release as the cutover.

## Out of scope

- Settings (`board.*` keys, `config.json`, `.env`): stay behind the
  rt-client settings resolver and APP_ROOT config files. Settings are
  RT-47's domain, not state.
- `logs/doctor-audit.jsonl`: logs stay append-only files, matching rt.
- `~/.mattstack/ci-attendants/`: shared surface; the watch-ci skill's shell
  scripts write these lease files directly, and they are already
  home-anchored.
- `state/board-port`: already retired by the agent-status-events work.
- Other apps' RT-48 compliance (gitq, deck, console): explicitly not this
  effort.

## Testing

- Per-store round-trips against `openStateDb(tempPath)`.
- Migration replay idempotence: run V1 twice, same schema, import once.
- Import from a fixture legacy tree: per-lane states, a sibling report, the
  kv blobs, newest-wins conflict, marker prevents re-import.
- Claim-ticket CLI paths, extending `status-bin.test.ts`: happy update by
  handle, loud error on unknown handle, report ingestion on done, db
  derivation from the handle for a non-default root.
- Prune gating: failed or empty snapshot deletes nothing.

## Risks

- One machine-wide db means a dev server run without `BOARD_STATE_DB`
  shares production state deliberately. That is the accepted tradeoff versus
  silent forking; the override is the documented escape.
- The handle stays path-shaped despite not being storage. Accepted: it
  carries the root derivation panes need, and dropping it later is cheap if
  the wrapper contract is ever re-cut.
- In-flight panes at cutover hold handles to files the import has already
  consumed. The import maps their paths to rows (the handle is the same
  string), so their next status write lands in the db; their state files are
  gone with the renamed dir, which only matters to a pane that crashed
  mid-write during the upgrade window.
