# Forge Leaderboard

A local, single-operator dashboard that ranks a hand-picked set of GitLab users against
each other across a window, on both **volume** metrics (lines, MRs merged/reviewed,
pipelines) and **quality / consistency** metrics (review depth, review latency, revert
rate, MR size health, coding-day streak, review reciprocity), with an optional
**self-vs-self trend** view.

The token stays **server-side only** ... the browser never sees it.

> ## ⚠️ Read this before you share it with anyone
>
> These metrics are the textbook gameable proxies. Lines-of-code and MR-count reward large
> diffs and lots of tiny MRs; raw "MRs reviewed" rewards rubber-stamping. The quality
> columns exist precisely as **counterweights** ... pair every speed/volume number with its
> quality partner (latency with depth, merges with revert rate) and prefer the **trend**
> view (you vs. your past self) over absolute ranking.
>
> This is fine for self-tracking and friendly comparison. **Do not let it become a real
> scoreboard people are measured on**, or the numbers will quietly stop meaning anything
> (Goodhart's Law). Individual output leaderboards are uniformly described as harmful in the
> engineering-metrics literature; that warning is the whole reason the trend view and the
> quality counterweights exist.

---

## Architecture

- **`src/server`** is a [`@mattstack/app-server`](https://github.com/m4ttstack/app-server)
  app: a single Hono route table (`src/server/routes.ts`, mounted as `AppType` for the
  client's typed RPC) served through `serveMattstackApp` from `src/server/index.ts`. The
  metric math, GitLab fetch/store layer, and CLI live under it (`metrics/`, `store/`,
  `refresh/`, `linear/`, `cli.ts`); see "Notes & limitations" below for how that part works.
- **`src/app`** is a [`@mattstack/app-kit`](https://github.com/m4ttstack/apps) app:
  `MattstackShell` for the frame/rail, [wouter](https://github.com/molefrog/wouter) for
  routing (`src/app/routes.ts` maps four routes ... `/`, `/user/:name`,
  `/user/:name/:stat`, `/settings` ... to a small `AppRoute` union), and
  [`@tanstack/react-query`](https://tanstack.com/query) for data fetching
  (`src/app/hooks/useLeaderboard.ts`, `useUserDetail`) over a Hono RPC client
  (`src/app/api.ts`, typed against the server's `AppType`) so query params and response
  shapes stay compiler-checked end to end.
- **`src/shared`** holds the wire types (`types.ts`) and metric metadata (`metrics.ts`)
  both sides import ... the one place a metric's key, label, and formatting are defined.
- **Settings** are not a committed config file: they live in the rt settings store and are
  edited in-app at `/settings` (`src/app/settings/SettingsPage.tsx`), which talks to
  `@mattstack/settings-kit`'s `useSettingKey`/`useSettingsScope` hooks against
  `settingsHandler` mounted at `/api/settings` in `src/server/routes.ts`. `rt settings list`
  still works for a read-only check from the terminal; see "Setup" below.

## Setup

Requires [Bun](https://bun.sh) 1.1+.

```bash
bun install
```

Configuration lives in rt settings, not in a committed file (edit it at the app's
`/settings` page, or read it from the terminal). List boxscore's current values with:

```bash
rt settings list | grep boxscore
```

The scope and roster come from the shared `mattstack.roster` and `mattstack.integrations`
keys (GitLab host under `forge.host`, Linear team key under `linear.teamKey`); everything
boxscore-specific (`boxscore.projects`, `boxscore.hiddenMembers`, `boxscore.sizeBand`,
`boxscore.linearDoneStates`, `boxscore.excludeFilePatterns`, `boxscore.ignoredMrs`,
`boxscore.botPatterns`, `boxscore.defaultRange`) is set the same way. See the `rt:settings`
skill for how to write a key.

Secrets (the GitLab PAT and, optionally, a Linear API key) live in the rt secrets store
under `gitlabToken` / `linearApiKey`, scope `extension`. Use a **read-only** GitLab PAT
(`read_api` scope only, never full `api`). For a one-off run outside the daemon,
`GITLAB_TOKEN` / `LINEAR_API_KEY` env vars still take priority.

The port comes from deck via `PORT` (11005 in `mattstack.deck.json`, used as the fallback
when `PORT` isn't set).

Bot discovery (scanning the store for suspected non-human commenters) is a CLI
subcommand, not a UI page:

```bash
bun src/server/cli.ts --format bots
```

## Run

```bash
bun run dev:server   # Bun/Hono API server, hot-reloading, on :11005 (or $PORT)
bun run dev          # Vite dev server on :5173, proxying /api and /ws to it
```

Open the Vite URL (`http://localhost:5173`). Use the controls to change the date range,
toggle the trend view, switch table/cards, and force a refresh ... all without restarting.

For a production-style run: `bun run build && bun run serve` (the server then serves the
built app straight out of `dist/`).

## How the metrics work (and how they're gamed)

| Metric                  | Source                                                | Gaming vector                                                                           |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Code added/deleted, Net | GraphQL `diffStatsSummary` on merged MRs              | verbose code; resisting deletion                                                        |
| MRs merged              | authored + `state: merged` in window                  | artificial micro-PRs                                                                    |
| MRs reviewed            | non-authored MRs with your in-window note or approval | rubber-stamping                                                                         |
| Pipelines               | REST `?username=` per project                         | trivial re-runs                                                                         |
| **Review depth**        | mean inline (DiffNote) comments per reviewed MR       | nitpick-spam (a per-MR mean, never a total; a median collapses to 0 for most reviewers) |
| **Review latency**      | first non-author note minus MR open (p50/p90)         | a hollow "looking 👀" note ... pair with depth                                          |
| **Revert rate**         | merged MRs later reverted (`Revert "…"` / label)      | fix-forward evades detection (labeled "detected only")                                  |
| **MR size health**      | % of merged MRs in the reviewable band                | two-sided band resists both mega- and micro-PRs                                         |
| **Coding-day streak**   | distinct push-active days (events API)                | a daily trivial push ... which is most of the habit anyway                              |
| **Reciprocity**         | reviews given / reviews received                      | spray-reviewing (gate the given side on depth)                                          |
| **Trend**               | this window minus the prior equal window              | almost nothing ... you only beat your past self                                         |

See `gitlab-leaderboard-spec.md` for the exact definitions.

## Notes & limitations

- **GitLab transport is owned by [`@mattstack/glance`](https://github.com/m4ttstack/glance),**
  not this repo ... GraphQL/REST field names, pagination, and retries live there. If a
  query fails, the error surfaces in the response `warnings`; verify field names against
  `<baseUrl>/-/graphql-explorer` and adjust glance, not boxscore.
- **Approvals tier fallback:** if approval data isn't accessible, "MRs reviewed" and
  "reciprocity" fall back to note-author detection, flagged in the UI metric notes.
- **One store, no cache:** every fetched MR, pipeline, and push event lands in a single
  sqlite database at `~/.mattstack/boxscore/boxscore.sqlite` (override with `BOXSCORE_DB`).
  There is no per-window envelope cache ... a window is a query over the store, computed
  fresh from whatever rows currently satisfy it. That means a roster change (adding or
  hiding a member) is reflected on the very next refresh, with no stale cache to bypass.
  **Refresh** re-scans each configured project from its last watermark and upserts what
  changed; a plain load re-runs the same query against what's already stored, with no
  network call.
- **Merged MRs are re-fetched until their snapshot settles.** Each stored metrics row
  carries the MR's `updatedAt` at fetch time (`mr_metrics.metrics_updated_at`); a refresh
  skips a merged MR only once that stamp covers the index's latest `updatedAt`. If review
  activity (a note, an approval) moved the MR after the snapshot, it is re-fetched. This
  matters because reviews land right before merge: a snapshot taken while the MR was still
  open would otherwise freeze that review out, undercounting MRs reviewed, review depth,
  review latency, reciprocity, and even the diff totals. Non-merged rows are always
  re-fetched.
- **Trend storage** is limited to "current vs. one prior window." No long-run time series.
- **Coding days** only count push events visible to your token.

## Development

| Script               | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `bun run dev`        | Start the Vite dev server (`src/app`).                              |
| `bun run dev:server` | Start the Bun/Hono API server (`src/server`) with hot reload.       |
| `bun run build`      | Typecheck then production build (`vite build`) into `dist/`.        |
| `bun run serve`      | Run the production server against the built `dist/`.                |
| `bun run report`     | Ranked standings table from the terminal (see below).               |
| `bun run validate`   | Run the evaluator; exits non-zero on any ranking-integrity error.   |
| `bun run test`       | Vitest: server tests (`test/`) plus component tests (`src/app/**`). |
| `bun run typecheck`  | `tsc --noEmit` over the whole tree (server, app, shared).           |
| `bun run lint`       | ESLint over `src`.                                                  |

The metric layer (`src/server/metrics/`) is pure functions over a normalized model
(`src/server/store/model.ts`), so all the math is tested offline without a live GitLab.

### Headless mode + the evaluator

The whole pipeline (fetch → compute → **classify/rank**) is decoupled from the UI: ranking
and "who's #1" are decided server-side and travel in the JSON (`rank` per metric, `leaders`
map), driven by one source of truth for metric metadata in `src/shared/metrics.ts`. The UI
just renders. You can run and evaluate everything from the terminal:

```bash
bun run report                       # ranked standings table (per-metric leaders)
bun run report -- --range 7d --trend # 7-day window with trend deltas
bun run report -- --format json      # raw response JSON
bun run validate -- --refresh        # run the evaluator; exits non-zero on any integrity error
```

`bun run validate` is the feedback loop: it asserts ranking integrity (rank 1 ⇔ best value,
leaders correct, ties shared, trend consistency) and surfaces data-quality smells (a metric
that's uniform/all-zero across everyone often means it isn't populating). This is how the
bot-polluted review-latency and review-depth calculation bugs were caught and fixed.
