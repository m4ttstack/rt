# CLAUDE.md

boxscore is the **Forge Leaderboard**. Its contract lives in `README.md`
(architecture, setup, the metric table, the refresh model, limitations) and
`gitlab-leaderboard-spec.md` (exact per-metric definitions). Read those first;
this file only adds what bites when picking up an edit or a bug fix.

## Verifying a number

The board is a query over a local sqlite store
(`~/.mattstack/boxscore/boxscore.sqlite`, override with `BOXSCORE_DB`); nothing
is cached per window. To reproduce or debug one cell of the board:

```bash
bun run report -- --detail <gitlab-username> --range 30d   # the exact MRs/notes/pipelines behind each metric for one user
bun run report -- --range 7d                               # ranked standings
bun run report -- --range 30d --format json                # raw response JSON
```

`--detail` prints the evidence rows a metric was built from, so you can diff the
store against ground truth. Before concluding a number is wrong, cross-check the
source with `glab` (an MR's `/notes`, or its GraphQL `diffStatsSummary`) rather
than trusting the store... the store can lag GitLab.

## Gotchas

- **Only `7d`, `30d`, `90d` are valid range presets.** Any other `--range` value
  (or `range` query param) silently falls back to `boxscore.defaultRange`, so
  `--range 14d` quietly reports the default window. Custom ranges need explicit
  `--start`/`--end`.
- **The store is incremental, and merged MRs settle.** A refresh scans each
  project from its watermark and upserts what changed; a merged MR is re-fetched
  only until its stored snapshot covers its latest `updatedAt` (the "Merged MRs"
  note in the README). To force a clean rebuild, bump `SCHEMA_VERSION` in
  `src/server/store/schema.ts` (db.ts drops and recreates every table on
  mismatch) or delete the sqlite file; a plain `--refresh` will not re-fetch a
  settled merged MR.
- **Settings live in the rt store, not a config file** (`rt settings get
boxscore.*`, `rt settings get mattstack.roster`), edited in-app at `/settings`.
- **GitLab transport is `@mattstack/glance`, not this repo.** Field-name or
  pagination bugs get fixed there; boxscore surfaces the failure in the response
  `warnings`.
- **Metric math is pure** (`src/server/metrics/`), tested offline against a
  normalized model. Add a failing test in `test/` before changing a computation;
  `bun run validate` asserts ranking integrity and flags all-zero/uniform
  metrics that aren't populating.
