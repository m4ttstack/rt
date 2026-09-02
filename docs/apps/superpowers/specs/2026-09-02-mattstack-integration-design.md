# Boxscore into mattstack: integration design

Date: 2026-09-02
Status: approved design, pre-plan
Repo: boxscore (this repo), with changes landing in glance, repo-tools (rt-client registry), and board

## 1. Summary

Boxscore is a single-operator GitLab engineering-metrics leaderboard that grew
without a plan. It is already registered with deck (port 11005). This design
folds it into the mattstack suite as five sub-projects plus one follow-up:

1. Metrics-layer hardening (boxscore only, no external dependency)
2. Settings and secrets cut-over (rt-client registry rows, then boxscore)
3. Glance primitives (typed, stateless fetchers boxscore needs and glance lacks)
4. Boxscore data layer rebuilt on those primitives
5. UI migration to app-kit and app-server, after a design pass
6. Follow-up: board reads the promoted roster; daemon retains merged MRs in-window

Sub-projects 1, 2, and 3 are independent of each other. 4 depends on 3.
5 depends on 2 and can run in parallel with 4 because the wire contract in
`shared/types.ts` is frozen across 4.

## 2. What exists today (findings that shaped the design)

**Glance** (`@mattstack/glance`) is a stateless client SDK over a two-forge
`GitProvider` interface. It has no daemon, server, store, or cache. Its
`PullRequest` type lacks `mergedAt` and `labels`; it has no group-level MR
query, no per-file diff stats, no notes on the MR, no push events, no
per-user pipelines, and no Linear awareness.

**The rt daemon** keeps typed stores at the grant level the user set
(`project-mrs`, `discussions`, branch enrichment) in `~/.mattstack/rt/state.db`.
Its design records rule: "no per-requester caches: an app must never be able
to conjure background API spend" and "consumers own their author lists; rt
owns permission and window." The `project-mrs` store holds open MRs in a
30-day window and prunes terminal-state MRs on the next full sync. The
`secrets:read` verb, scope `extension`, already returns `gitlabToken` and
`linearApiKey`.

**The board** keeps its roster at team scope as `board.members`
(`[{username, name?}]`, GitLab usernames) with a per-user overlay
`board.hiddenMembers`. It is not an app-kit adopter; it runs raw `Bun.serve`
with tui-kit and settings-kit. Boxscore's roster (7 users) and the board's
(5 users) already disagree: one boxscore user sits in the board's hidden
overlay and one appears in neither board list.

**App-kit / app-server**: Mantine 9 behind an eslint import wall, wouter,
`serveMattstackApp` over Hono. React 19, Vite 8, vitest 4 are floors. No SSE,
no scheduler, no per-app data directory convention, no `idleTimeout`
passthrough. Console is the reference adopter and carries a task-by-task
migration plan. Both packages are private on npm.

**Suite settings**: one registry in rt-client (`registry-defs.ts`), flat
dotted keys with app prefixes, scopes `team < user < machine`. Cross-app keys
live under `mattstack.*` at team scope. Consumer apps hold a copy of rt-client,
so a new key ships as registry row, build, publish, bump.

## 3. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Where the GitLab data path lives | Glance gains typed stateless fetchers. Boxscore owns metrics and its own history cache. The daemon supplies secrets and settings only. Retaining merged MRs in the daemon is a follow-up, not this wave. |
| D2 | Roster home | New `mattstack.roster` team key, same shape as `board.members`. Boxscore reads it now; the board migrates in its own PR. Hidden overlays stay per app at user scope. |
| D3 | Legacy config cut-over | Hard cutover. The app reads only the settings stores. `config.ts`, `settings.json`, `.env`, and `server/settings.ts` are deleted. No ownership latch, no registry defaults. Values move once by script. |
| D4 | Defect fix order | Metrics-layer defects are fixed first as sub-project 1, before the data-layer rebuild. |
| D5 | Settings UI during cut-over | The in-app settings page and its routes are deleted in sub-project 2. `rt settings` and the console settings page cover editing until sub-project 5 rebuilds the page on settings-kit. |
| D6 | Current user | Derived from the token via `validateToken()`. No setting. |
| D7 | Cache location | `~/.mattstack/boxscore/` (runtime layer per the suite's three-layer rule). HOME resolved at call time. `BOXSCORE_HOME` overrides for tests. |
| D8 | Wire contract | The JSON shapes of the leaderboard, detail, refresh, and cache responses in `shared/types.ts` do not change in sub-projects 1 through 4. Type narrowings that keep the same JSON (such as the warning-code union in SP1) are allowed, and types whose only route is deleted in SP2 (`AppSettings`, `LinearStateInfo`, `SuspectedBot`) leave the file with that route. |

## 4. Sub-project 1: metrics-layer hardening

Scope: `server/metrics/`, `shared/`, `server/pipeline/model.ts`, and the tests
that pin them. No fetch, cache, settings, or UI changes.

Work items:

1. **Team-ticket cohort parity.** `snapshot.ts` gates "authored and merged" on
   `hasTeamTicket` when a Linear team is set; `evidence.ts` does not. Both
   consume one cohort. A test asserts the snapshot's `mrsMerged` equals the
   evidence row count for the same user and window.
2. **One cohort module.** Extract `server/metrics/cohorts.ts` exposing the
   per-user cohorts (authored-merged, reviewed, reverted, pipelines, push
   days, Linear issues) with the filters applied. Snapshot derives values
   from cohorts; evidence derives rows from the same cohorts. The ~150
   duplicated lines in `evidence.ts` go away.
3. **Metric table is the single source.** `UserMetrics` keys and the `METRICS`
   descriptor table cannot diverge. `METRICS` is an ordered array, so the
   check is type-level: a tuple of its `key` literals is asserted equal to
   the `MetricKey` union (both directions), and a key missing from either
   side fails `tsc`. Display order stays in the array.
   `revertedCount` and `currentStreak` are computed but never shown: add
   descriptors so they display. Dropping them is the fallback if the display
   is judged noise during sub-project 5.
4. **Layering.** `pipeline/fetch.ts` stops importing `metrics/reverts.ts`; the
   revert-title predicate is passed in or moved to `shared/`. `UserIdentity`
   moves from `metrics/trend.ts` to `pipeline/model.ts`.
5. **Doc alignment.** Review depth is computed as a mean on purpose:
   `snapshot.ts` records that the median collapses to zero whenever fewer
   than half of a reviewer's MRs carry inline comments, which is the common
   case, and the README lists that collapse as a fixed bug. The code stays.
   The README metrics table and the `UserMetrics.reviewDepth` comment in
   `shared/types.ts` still say median; align both to mean.
6. **Warning codes.** `LeaderboardWarning.code` becomes a string-literal union.

Done when: all existing tests pass, the new parity test passes, and
`bun run typecheck` is clean.

## 5. Sub-project 2: settings and secrets

### 5.1 New registry rows (repo-tools, `packages/rt-client/src/settings/registry-defs.ts`)

A new `// --- mattstack (shared team truth) ---` row and a new
`// --- boxscore ---` block. The boxscore block comment states: no
`default` on any row; fallbacks live in the app-side read.

| Key | Scope | Type | Merge | Shape |
|---|---|---|---|---|
| `mattstack.roster` | team | array | replace | `[{username: string, name?: string}]` |
| `boxscore.hiddenMembers` | user | array | replace | usernames hidden from this developer's leaderboard |
| `boxscore.projects` | team | array | replace | `["group/project"]`; group scope is dropped (see 5.4) |
| `boxscore.linearDoneStates` | team | array | replace | Linear state names that count as done; empty means completed plus canceled types |
| `boxscore.sizeBand` | team | object | deep | `{tooSmall: number, tooLarge: number}` |
| `boxscore.excludeFilePatterns` | team | array | replace | globs excluded from line counts |
| `boxscore.ignoredMrs` | team | array | replace | `"!123"` or `"group/project!123"` |
| `boxscore.botPatterns` | team | array | replace | extra regex sources beyond the built-ins |
| `boxscore.defaultRange` | user | string | replace | `"7d"`, `"30d"`, or `"90d"` |

`board.members` keeps its row; its description gains one sentence pointing at
`mattstack.roster` as the successor.

### 5.2 Existing keys reused

| Need | Key | Note |
|---|---|---|
| GitLab host | field `forge.host` of the single object key `mattstack.integrations` (team, deep merge) | present in the acme-web team store as of 2026-09-02 (written by the MAT-403 audit pass); the import verifies it and fills it only if missing. Suite precedent: team creation copies `forge.host` into `board.gitlabHost`, which the board fetches against, so boxscore fetching against it follows that precedent. |
| Linear team key | field `linear.teamKey` of the same object key | present as of 2026-09-02 (same audit pass); the import verifies rather than writes |
| Tokens | secrets store, `rt` domain | `gitlabToken`, `linearApiKey`; read env-first, then `secrets:read` scope `extension` |

`mattstack.integrations` is one registry key holding one object; its fields
are not keys. `rt settings explain mattstack.integrations.forge.host` reports
an unknown setting, and that is expected. Reads call
`getSetting("mattstack.integrations")` and pick the field. Writes must read
the current object, merge the new fields in, and write the whole object back,
because `setSetting` replaces the value at the key and the live team store
already holds a `slack` block that a bare write would delete.

### 5.3 Boxscore reads

- `server/config/` replaces `config.ts`, `server/settings.ts`, and
  `server/env.ts` (the `Env` type threaded through the fetchers becomes a
  config-module type): one module
  that calls `getSetting` from `@mattstack/rt-client` per key on every read
  (no module-load caching) and applies fallbacks. Every key read goes through
  it. Nothing else in the server touches the resolver.
- Secrets: `server/config/secrets.ts` mirrors the board's `board-secrets.ts`:
  env vars win, then `secrets:read` over the unix socket with the api-token
  from `~/.mattstack/rt/api-token`, scope `extension`. A failure degrades to
  "not configured" with one warning; Linear absent means the delivery metric
  is skipped, GitLab absent surfaces as the existing per-request env error.
- Current user: `provider.validateToken()` at boot and after any secrets
  reload; cached in memory between those points.
- Concurrency becomes a code constant (6). Port comes from `PORT`, set by
  deck. Base URL comes from the forge host field of `mattstack.integrations`.

### 5.4 Scope change

`groupPath` is dropped. `boxscore.projects` is the only scope. Group mode was
never used (the committed config has it empty) and every other suite app is
project-keyed. Glance's index fetcher still supports groups (section 6) for
future apps; boxscore does not expose it.

### 5.5 One-time import

`scripts/import-legacy-settings.ts` reads `config.ts`, `settings.json`, and
`.env`, writes each value with `setSetting(key, value, scope)`, then reads
every key back and fails loudly if any read does not equal what was written.
For `mattstack.integrations` it reads the current object and fills only the
fields that are missing (both are expected to be present already after the
2026-09-02 audit pass), writing the merged object back only when something
changed. From `.env` it consumes only
`GITLAB_BASE_URL`; the two tokens cannot be settings, so the script instead
checks that the `rt` secrets domain already holds `gitlabToken` and
`linearApiKey` (both names exist there today) and stops with instructions if
either is missing. Only after a clean verify does the script print the
`git rm` list. Team-scope
writes land in the acme-web team repo working copy and need a commit and
push; the script says so. The roster written to `mattstack.roster` is
boxscore's 7-user list merged with the board's 5 (union, names from the
board where present). Users boxscore scored but the board hides go into
`boxscore.hiddenMembers` only if Matt asks; by default they are visible.

### 5.6 Deletions

`config.ts`, `settings.json`, `.env`, `.env.example`, `server/settings.ts`,
`server/env.ts`, `web/src/components/SettingsPage.tsx`, the `/api/settings*` routes, the
`/api/settings/linear-states` and `/api/settings/suspected-bots` routes, and
the settings link in `App.tsx`. `scanSuspectedBots` survives as a CLI
subcommand (`bun server/cli.ts --format bots`) so bot discovery is still
possible without a page.

### 5.7 Delivery order

1. Registry rows in repo-tools, landed on main after the MAT-403 audit
   commits (a `chat.viewerUrl` default; the `board.rtRepos` row removed),
   plus a boxscore table in
   `docs/superpowers/specs/2026-08-20-suite-settings-migration.md` (the
   per-app key table the settings architecture doc points at); `bun run
   build` in rt-client; publish a version bump. That audit pass publishes
   nothing itself, so this publish carries its two row changes as well.
   Agreed with max on 2026-09-02: max lands first, boxscore's rows go on
   top.
2. Bump `@mattstack/rt-client` in boxscore; add `server/config/`.
3. Run the import script; commit and push the team store change.
4. Delete the legacy files and routes; update README.
5. Move the cache directory (section 7.2) at the same time so no
   cwd-relative path remains.

## 6. Sub-project 3: glance primitives

All additions are GitLab-first. Each new `GitProvider` method is optional
(`method?()`), paired with a `ProviderCapabilities` flag, and the
`providerConformance.ts` guard covers the GitLab implementation. GitHub
returns `capabilities.<flag> === false` and does not implement the method in
this wave.

### 6.1 Field additions

`PullRequest` gains `mergedAt: string | null` and `labels: string[]`, added
to both `MR_DASHBOARD_FRAGMENT` and `MR_LIST_FRAGMENT` and to the GitHub
mapper (GitHub already has `merged_at` and labels available). Existing
consumers are unaffected; the board may use `mergedAt` later.

### 6.2 New reads

| Method | Input | Output | Notes |
|---|---|---|---|
| `fetchMergeRequestIndex` | `{groupPath} \| {projectPaths}`, `updatedAfter`, optional `states`, optional `onPage` | `MergeRequestIndexRow[]`: `iid, projectPath, title, state, createdAt, updatedAt, mergedAt, authorUsername, sourceBranch, labels` | Sorted `UPDATED_DESC`, 100 per page, stops when a whole page is older than `updatedAfter`. Group mode uses `includeSubgroups: true`. |
| `fetchMergeRequestMetrics` | `projectPath, iid` | `MergeRequestMetrics`: `description, diffStatsSummary, diffStats[] (path, additions, deletions), labels, approvedByUsernames, notes[] (authorUsername, createdAt, system, inline)` | Notes paginate to exhaustion. `inline` is `position != null`. |
| `fetchGroupProjects` | `groupPath` | `string[]` of full paths | `includeSubgroups: true` |
| `fetchProjectPipelines` | `projectPath, {username?, updatedAfter, updatedBefore}` | `PipelineSummary[]`: `id, status, createdAt, username` | REST, paginated |
| `fetchUserEvents` | `userId, {action, after, before}` | `UserEvent[]`: `createdAt, projectId, action` | REST `/users/:id/events`, paginated |
| `fetchProject` | `projectPath` | `{id: number, fullPath: string}` | REST |

`fetchUser` (exists) resolves usernames to `UserRef` including the numeric id
needed by `fetchUserEvents`.

### 6.3 Tests and release

Unit tests per method with the transport stubbed, following the package's
existing pattern. Live conformance: a `runMetricsReadConformance` block in
`tests/live/conformance.ts`, run from the full runner and from a new
read-only `tests/live/reads-runner.ts` against the harness project with the
demo credentials in `harness_credentials.json`; every new method is also
declared in the harness's expectation tables. Release as a minor version;
boxscore pins it in sub-project 4.

## 7. Sub-project 4: boxscore data layer

### 7.1 Module layout

```
server/
  config/        settings + secrets + env reads (from sub-project 2; replaces env.ts)
  source/        glance-backed fetchers -> domain model (replaces gitlab/, most of pipeline/fetch.ts)
  store/         sqlite store, one file (replaces cache/)
  refresh/       the refresh algorithm and job (replaces jobs/ and pipeline/slice.ts)
  metrics/       unchanged from sub-project 1
  linear/        ticket discovery + verification, now reading its key from config/
  app.ts         routes; wire types unchanged
```

`server/gitlab/` and `server/util/graphql.ts` are deleted; glance owns
transport, retry, and pagination. `server/util/http.ts` stays for Linear
until Linear also moves behind a client.

### 7.2 Store

One sqlite file at `~/.mattstack/boxscore/boxscore.sqlite` (WAL). Tables:

| Table | Key | Holds |
|---|---|---|
| `mr_index` | `project:iid` | index rows from 6.2, plus `scannedAt` |
| `scan_meta` | `project` | last successful index scan per project |
| `mr_metrics` | `project:iid` | `MergeRequestMetrics` for MRs the roster authored; immutable once `state = merged` |
| `pipelines` | `project:id` | pipeline summaries |
| `push_events` | `user:createdAt:projectId` | push events |
| `linear_issues` | identifier | verified issues with linked MR keys and state |
| `linear_ids` | identifier | validity cache (kept from today) |
| `identities` | username | resolved `UserRef` with `fetchedAt` |

Envelope JSON files and `sliceOutcome` are removed. Window selection is a
query: merged MRs by `mergedAt`, reviewed MRs by note timestamps, pipelines
and pushes by `createdAt`. The metrics layer still receives a `FetchResult`
built from the query, so `computeSnapshot` and `buildUserEvidence` do not
change.

### 7.3 Refresh algorithm

Inputs: roster (visible plus hidden, so hiding a user does not evict data),
projects, base window (90 days, 180 with trend, unchanged from today).

1. Resolve identities for roster users not in `identities` or older than a day.
2. For each project, `fetchMergeRequestIndex` with `updatedAfter = last
   successful scan for that project`, falling back to the base window start.
   Upsert rows. Advance `scan_meta` for that project only on success.
3. Eligible-for-detail set: index rows authored by the roster within the base
   window, plus any row whose title matches the revert pattern. Fetch
   `fetchMergeRequestMetrics` for eligible rows missing from `mr_metrics` or
   present with a non-merged state. Persist in batches of 25 as today.
4. Pipelines per (project, roster user) and pushes per roster user over the
   base window, upserted.
5. Linear discovery over eligible rows, verification, upsert.
6. Progress phases and the job model (`startRefresh`, cancel, timeout,
   polling) are unchanged in behavior; the job now runs against the store.

Invariants that fix today's defects by construction: the store is not keyed
by roster or window, so a roster change is served on the next refresh; a
failed project scan leaves its watermark alone; a clear drops every table;
every write is a transaction.

### 7.4 Merged MRs are immutable

Kept from today. Post-merge comments do not reach review metrics. This is a
documented limitation, not a defect, and the README says so.

## 8. Sub-project 5: UI migration

Designed on 2026-09-02 and approved. The canvas is
https://claude.ai/code/artifact/6eb6743f-a7bc-4d7c-8381-9efa25152863 and its
working files live in `docs/superpowers/design/boxscore-ui/` (regenerate with
`node build.mjs`). Five artboards: leaderboard, leaderboard mid-refresh with
trend on, cards, person detail with evidence, settings. Inputs the plan
still needs beyond the canvas:

- Console's plan at `console/docs/superpowers/plans/2026-08-28-console-app-kit-migration.md` is the template.
- React 19, Vite 8, vitest 4, Mantine 9 on `@mattstack/app-kit`; nothing under `web/src/components/ui` survives.
- Layout moves to `src/server` and `src/app`; the existing `shared/` becomes `src/shared`.
- wouter replaces `useHashRoute`; the routes are leaderboard, `user/:name`, `user/:name/:stat`, settings.
- react-query over Hono RPC replaces `web/src/api.ts`; job polling stays.
- The settings page is rebuilt on settings-kit hooks over the `boxscore.*` and `mattstack.roster` keys, with the board's `ConfigModal` composite shapes as reference.
- `serveMattstackApp` replaces `server/index.ts`; `/api/health` becomes the frame's.
- The `mattstack.deck.json` `dev.start` changes to the new entry point.

## 9. Follow-ups (not this wave)

- **Board reads `mattstack.roster`** behind its latch with `board.members` as fallback; retire `board.members` once both apps read the new key.
- **Promote `board.projects`** to a suite key and point `boxscore.projects` at it.
- **Daemon retains merged MRs** within `projectMrsWindowDays` once glance carries `mergedAt`; boxscore then serves the recent window from `project-mrs:read` and backfills only history.
- **GitHub implementations** of the 6.2 methods.

## 10. Defect and structure inventory

Verified in source during this design:

| Item | Where | Resolved by |
|---|---|---|
| Team-ticket gate applied in snapshot, not evidence | `server/metrics/snapshot.ts:204`, `server/metrics/evidence.ts:52` | SP1 |
| Cache key ignores roster | `server/leaderboard.ts:72,96` | SP4 |
| Watermark advances on partial list failure | `server/pipeline/fetch.ts:141-153` | SP4 |
| Clear removes sqlite but not envelopes | `server/app.ts:156`, `server/cache/mr-store.ts:190` | SP4 |
| Envelope writes are not atomic | `server/cache/store.ts:148` | SP4 |
| Notes fetched with `first: 100`, never paged | `server/gitlab/queries.ts:55` | SP3 |
| Cwd-relative cache and settings paths | `server/cache/store.ts:11`, `server/settings.ts:5` | SP2 |
| Real usernames and project path committed | `config.ts` | SP2 |

Reported by the audit and accepted as structure work:

| Item | Resolved by |
|---|---|
| Evidence duplicates snapshot cohort logic | SP1 |
| Adding a metric touches six places; two metrics computed but never shown | SP1 |
| Cache format is the fetcher's raw output; slicing cites fetcher internals | SP4 |
| Fetch pipeline imports from metrics; fetchers write the cache; cache stores raw GitLab shapes | SP1 (layering), SP4 (store) |
| Warnings as an untyped mutated array through positional params | SP1 (codes), SP4 (context object) |
| Review depth documented as median, computed as mean | SP1 |
| No tests for settings, bots, CLI, or UI | settings deleted (SP2); CLI and UI tests in SP4 and SP5 |

Preserved as-is: `shared/metrics.ts` descriptors and accessors,
`metrics/ranking.ts`, `metrics/validate.ts`, `metrics/stats.ts`,
`metrics/reverts.ts`, `util/window.ts`, `util/http.ts` (until Linear moves),
`jobs/refresh.ts` job model, `linear/ticket.ts`, the `MetricEvidence` to
`EvidenceTable` contract, and their tests.

## 11. Error handling

- Settings resolver throws on an unknown key for a `boxscore.*` or
  `mattstack.roster` read: that is a stale rt-client copy, surfaced at boot
  with the key name and the bump instruction. Fields of
  `mattstack.integrations` are never read as keys (section 5.2).
- Secret read failure degrades to "not configured" with one warning per
  process; never retried per request.
- Glance transport errors carry through as today's warning codes
  (`mr_fetch_failed`, `pipeline_fetch_failed`, `events_fetch_failed`,
  `mr_detail_partial`); the refresh continues and the response lists them.
- A refresh cancelled or timed out still keeps every persisted batch.

## 12. Testing

- SP1: existing metrics tests plus the cohort parity test; characterization
  fixtures in `test/fixtures/outcome.ts` stay green.
- SP2: config module tests against a temp `HOME`, repointed in a vitest
  `setupFiles` entry (boxscore runs vitest, not `bun test`, so the suite's
  bunfig preload pattern is mirrored there); import script tested against
  fixture files; no test touches the real `~/.mattstack`.
- SP3: glance unit tests per method; live conformance behind `GLANCE_LIVE=1`.
- SP4: store tests against a temp sqlite; source tests with a stubbed
  `GitProvider` (interface, not HTTP); refresh algorithm tests for the
  watermark, eligibility, and clear invariants; endpoint tests unchanged
  because the wire contract is frozen.
- SP5: per the design pass.

## 13. Non-goals

- Multi-user or auth. Still a single-operator app.
- Any daemon store changes in this wave.
- GitHub support in boxscore.
- Long-run time series beyond current versus prior window.
