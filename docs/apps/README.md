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

## Setup

Requires [Bun](https://bun.sh) 1.1+.

```bash
bun install
cp .env.example .env          # then edit .env
```

Put a **read-only** token in `.env`:

```
GITLAB_BASE_URL=https://gitlab.com     # or your self-managed host
GITLAB_TOKEN=glpat-...                 # PAT with the read_api scope ONLY
```

> Use the **`read_api`** scope. Do **not** use the full `api` scope ... this tool never
> writes anything. Create a token at `<GITLAB_BASE_URL>/-/user_settings/personal_access_tokens`.

Bun loads `.env` automatically ... no extra config needed.

Then edit `config.ts` (committed, non-secret) to point at your people and scope:

```ts
export const config = {
  groupPath: "my-org/my-group",   // preferred: one bulk query over the group
  projectPaths: [],               // fallback: explicit "group/project" paths
  users: ["matthew", "doug"],     // the comparison set, by username
  currentUser: "matthew",         // highlighted + rank-badged
  defaultRange: "30d",
  concurrency: 6,
  sizeBand: { tooSmall: 10, tooLarge: 400 },  // MR size-health band, in changed lines
};
```

## Run

```bash
bun run dev
```

Starts the backend (default `http://localhost:8787`) and the Vite frontend
(`http://localhost:5173`, which proxies `/api` to the backend). Open the frontend URL.

Use the controls to change the date range, toggle the trend view, switch table/cards, and
force a refresh ... all without restarting.

For a production-style run: `bun run build && bun start` (the server then serves the built
app from `web/dist`).

## How the metrics work (and how they're gamed)

| Metric | Source | Gaming vector |
|---|---|---|
| Code added/deleted, Net | GraphQL `diffStatsSummary` on merged MRs | verbose code; resisting deletion |
| MRs merged | authored + `state: merged` in window | artificial micro-PRs |
| MRs reviewed | non-authored MRs with your in-window note or approval | rubber-stamping |
| Pipelines | REST `?username=` per project | trivial re-runs |
| **Review depth** | median inline (DiffNote) comments per reviewed MR | nitpick-spam (use median, not totals) |
| **Review latency** | first non-author note minus MR open (p50/p90) | a hollow "looking 👀" note ... pair with depth |
| **Revert rate** | merged MRs later reverted (`Revert "…"` / label) | fix-forward evades detection (labeled "detected only") |
| **MR size health** | % of merged MRs in the reviewable band | two-sided band resists both mega- and micro-PRs |
| **Coding-day streak** | distinct push-active days (events API) | a daily trivial push ... which is most of the habit anyway |
| **Reciprocity** | reviews given / reviews received | spray-reviewing (gate the given side on depth) |
| **Trend** | this window minus the prior equal window | almost nothing ... you only beat your past self |

See `gitlab-leaderboard-spec.md` for the exact definitions.

## Notes & limitations

- **GraphQL field/argument names drift by GitLab version and tier.** If a query fails,
  the error surfaces in the response `warnings`. The single place to adjust queries is
  [`server/gitlab/queries.ts`](server/gitlab/queries.ts) ... verify against
  `<baseUrl>/-/graphql-explorer`.
- **Approvals tier fallback:** if approval data isn't accessible, "MRs reviewed" and
  "reciprocity" fall back to note-author detection, flagged in the UI metric notes.
- **Caching:** raw fetch results are cached under `.cache/` keyed by `(scope, window)`.
  The prior window (for the trend) is fetched once, then cached. Use **Refresh** to bypass.
- **Trend storage** is limited to "current vs. one prior window." No long-run time series.
- **Coding days** only count push events visible to your token.

## Development

```bash
bun run test      # vitest ... metric math, ranking, validation, metadata (the correctness gate)
bun run typecheck # tsc over server + web (no `any` on the API contract)
```

The metric layer (`server/metrics/`) is pure functions over a normalized model
(`server/pipeline/model.ts`), so all the math is tested offline without a live GitLab.

### Headless mode + the evaluator

The whole pipeline (fetch → compute → **classify/rank**) is decoupled from the UI: ranking
and "who's #1" are decided server-side and travel in the JSON (`rank` per metric, `leaders`
map), driven by one source of truth for metric metadata in `shared/metrics.ts`. The UI just
renders. You can run and evaluate everything from the terminal:

```bash
bun run report                       # ranked standings table (per-metric leaders)
bun run report -- --range 7d --trend # 7-day window with trend deltas
bun run report -- --format json      # raw response JSON
bun run validate -- --refresh        # run the evaluator; exits non-zero on any integrity error
```

`bun run validate` is the feedback loop: it asserts ranking integrity (rank 1 ⇔ best value,
leaders correct, ties shared, trend consistency) and surfaces data-quality smells (a metric
that's uniform/all-zero across everyone often means it isn't populating). This is how the
bot-polluted review-latency and median-collapsed review-depth bugs were caught and fixed.
