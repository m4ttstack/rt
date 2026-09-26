# Board: say loudly when GitLab data is stale, and why

Spans two repos: `m4ttstack/rt` (daemon + `@mattstack/rt-client`) and this
repo (`apps/board`).

## Problem

On a bad GitLab day the board's only signal is `data as of 14:28` in the
footer, below every panel, so it is off-screen on any real board. The top
`gitlab fetch failing` banner never fires in that case: it only trips when
the board cannot read the rt daemon at all, and the daemon keeps answering
happily with old data.

The board also cannot say why. Every GitLab sync failure in the daemon is
logged and dropped; `project-mrs:read` returns only a `syncedAt`. On
2026-09-22 the daemon log shows GraphQL `500 Internal Server Error`s and
`Timeout on MergeRequest...` query errors (no 429s), and nothing on the
board said so.

## Fix

The daemon remembers each repo's last GitLab sync failure and returns it on
`project-mrs:read`. The board folds that and its own age check into one
freshness banner at the top of the page, amber first and red once it has
gone on for a while, and marks the browser tab.

## rt daemon (`m4ttstack/rt`)

**New module `lib/daemon/project-sync-health.ts`.** An in-memory map
`repoName -> ProjectSyncError`:

```ts
type ProjectSyncErrorKind = 'rate-limited' | 'auth' | 'server-error' | 'timeout' | 'other';
interface ProjectSyncError {
  since: number;   // first failure of the current unbroken failing run
  lastAt: number;  // most recent failure
  kind: ProjectSyncErrorKind;
  message: string; // raw error text, first 200 chars
}
```

- `recordSyncFailure(repo, err, now)`: sets `lastAt`, `kind`, `message`;
  keeps an existing entry's `since`, else `since = now`.
- `recordSyncSuccess(repo)`: deletes the entry.
- `readSyncHealth(repo)`: the entry or `undefined`.
- `classifySyncError(message)`, pure. glance throws plain `Error`s with
  the HTTP status in the text, in two wordings: `... failed: 500 Internal
  Server Error` and `<op>: HTTP 429 for <path>`. The status is the first
  match of `/(?:failed: |HTTP )(\d{3})\b/`. First rule that holds wins:
  1. status `429`: `rate-limited`
  2. status `401` or `403`: `auth`
  3. status `5xx`: `server-error`
  4. message contains `Timeout on` (GraphQL field timeouts) or
     `timed out`: `timeout`
  5. anything else: `other`

Memory only: a daemon restart clears it, and the next 5-minute cycle
records the failure again.

**Recording point.** `syncProjectMRs`'s single-flight wrapper
(`lib/daemon/project-sync.ts`) records the outcome of `syncImpl`: resolve
calls `recordSyncSuccess`, reject calls `recordSyncFailure` and rethrows.
Every sync path already funnels through it (the 5-minute cache-refresh
cycle, watcher start, forced reads), so no caller has to remember. A deep
reconcile that fails and falls back to a working delta resolves, so it
counts as success: data arrived. Author and section backfills do not move
`syncedAt` and are not recorded.

**`project-mrs:read`.** Adds `syncError` to the response data when
`readSyncHealth(repoName)` has an entry; omits the key otherwise. Forced
reads that fail keep returning `{ ok: false, error }` exactly as today.

**rt-client.** `commands.ts` exports `ProjectSyncErrorKind` and
`ProjectSyncError` and adds `syncError?: ProjectSyncError` to
`ProjectMRsData`. Additive; consumers that ignore it are unchanged.
Publish as `0.29.0`.

## Board (`apps/board`)

**Data.** `SyncScopeRead` gains `syncError?`. `aggregateSyncScope` returns
`syncError: BoardSyncError | null`: the failing project with the earliest
`since` (the longest outage), plus `projects`, the count of failing
projects. `fetchTeamMRs` passes each read's `syncError` through. The
snapshot type (`src/data.ts`, `src/server.ts`) and `src/client/types.ts`
gain `syncError`. `cache.ts`'s empty snapshot sets it `null`.

**Banner logic, `src/view.ts`.** Pure
`freshnessBanner({ fetchError, dataSyncedAt, syncError, now })` returns
`{ text, intent: 'warn' | 'bad', title?: string } | null`, first match wins:

| # | when | text | title (tooltip) |
|---|---|---|---|
| 1 | `fetchError` | `⚠ board can't refresh... data is 1h 43m old (as of 14:28)` | the fetchError |
| 2 | `syncError` and data stale or age unknown | `⚠ GitLab timing out since 14:31... board data is 1h 43m old (as of 14:28)` | the raw message, plus `(2 projects failing)` when more than one |
| 3 | data stale (age known) | `⚠ board data is 1h 43m old (as of 14:28)... rt sync is behind` | none |
| 4 | otherwise | no banner | |

- Kind wording in row 2: `timeout` "timing out", `server-error`
  "returning server errors", `rate-limited` "rate-limiting rt", `auth`
  "rejecting rt's token", `other` "sync failing".
- Unknown age (no `dataSyncedAt`) drops the `board data is ...` clause.
  Row 1 with unknown age reads `⚠ board can't refresh`.
- Stale means the existing `dataAgeLabel` rule: older than 10 minutes.
  `dataAgeLabel` and `freshnessBanner` share one threshold constant.
- Age reads `25m` under an hour, `1h 43m` from an hour.
- Intent: `warn` while the data is at most 30 minutes old, `bad` past 30.
  With unknown age, row 2 measures from `syncError.since` instead.
  `auth` and `fetchError` are always `bad`; neither heals by waiting.

**Rendering, `src/client/board/Board.tsx`.** The banner replaces the inline
`data.fetchError` banner in the same slot above the panels, as
`<div className="tui-banner" data-intent={intent === 'bad' ? 'bad' : undefined} role="status" title={title}>`.
While a banner shows, `document.title` carries a `⚠ ` prefix; it is
restored when the banner clears. The footer is unchanged.

The existing `.tui-banner` and `[data-intent='bad']` rules already pick
role tokens per `docs/ui-authoring.md` (`--text-warn-small` /
`--text-bad-small` on a 7% `--fill-*` tint, weight 500), so there is no
new colour and no new CSS.

**Fixture.** `tests/fixture/data.json` pins `dataSyncedAt` 60 minutes
before `meta.json`'s `now`, which would put the banner on every capture.
Move it to 2 minutes before `now` and add `"syncError": null`. Do not
re-baseline the capture PNGs from this branch: `capture:compare` is already
red on `main` (every baseline predates the theme work), so UI validation is
a direct before/after in Fast Browser instead.

## Acceptance

- A repo whose last project sync failed returns `syncError` with the
  classified `kind` on `project-mrs:read`; the next successful sync drops it.
- `since` stays pinned across consecutive failures; `lastAt` advances.
- Each of today's real messages (GraphQL 500, `Timeout on ...`) classifies
  as `server-error` / `timeout`; a 429 as `rate-limited`; 401/403 as `auth`.
- With data 1h 43m old and a timeout `syncError`, the board shows row 2's
  banner at the top in red and the tab title starts with `⚠`.
- With data 15 minutes old and no `syncError`, the board shows row 3's
  banner in amber.
- With fresh data, no banner and no `⚠` in the title, even when a
  `syncError` is present (a single blip stays quiet until data goes stale).
- A board on rt-client `0.29.0` against an older daemon (no `syncError`)
  falls back to rows 1 and 3.

## Testing

- rt: `classifySyncError` table test over real log messages; health-map
  tests (since pinning, clear on success); `project-sync` wrapper records
  on reject and on resolve; `project-mrs:read` includes and omits
  `syncError` (the handler's `overrides.sync` seam).
- board: `freshnessBanner` covers every row, the unknown-age variants, the
  intent switch at 30 minutes and the always-`bad` cases;
  `aggregateSyncScope` picks the earliest `since` and counts projects; a DOM
  test renders the banner and the title prefix.
- UI validation: Fast Browser against a scratch copy of the fixture with a
  stale `dataSyncedAt` and a timeout `syncError`, screenshots in light and
  dark (amber and red), plus the fresh fixture showing no banner.

## Rollout

1. rt PR (daemon + rt-client `0.29.0`), rt release, rt-client publish.
2. This repo: bump the catalog's `@mattstack/rt-client` pin `0.27.0` to
   `0.29.0` (this also picks up `0.28.0`, so every app's gates run), then
   the board change.
3. `bun run board:build` and `deck restart board` so the live board serves
   the new client and server.

## Out of scope

- Notifications outside the page (macOS, Slack).
- Honouring `Retry-After` or showing a next-retry time; glance does not
  surface it past its own retry loop.
- Surfacing `syncError` in console or boxscore; the field is there for them.
