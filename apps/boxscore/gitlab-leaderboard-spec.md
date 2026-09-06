# GitLab Performance Leaderboard ... Build Spec

A local, single-user dashboard that ranks a hand-picked set of GitLab users against
each other across four categories, over a configurable time window.

This is a personal/team comparison tool, not a formal evaluation system. See
**Caveats** before wiring these numbers into anything that matters.

---

## 1. Goal

Given a GitLab instance, a scope (group or list of projects), a list of usernames,
and a date range, render **sortable leaderboards** across two groups of metrics:

**Volume metrics (original ... output counts, known-gameable, see §9):**

1. **Code added / deleted** ... lines added and deleted across the user's merged MRs
2. **MRs merged** ... MRs authored by the user that merged in the window
3. **MRs reviewed** ... MRs the user reviewed (approved or commented), not authored by them
4. **Pipelines run** ... pipelines triggered by the user (cost is optional, see §4.4)

**Quality / consistency metrics (added to counterweight the volume metrics):**

5. **Review comment depth** ... inline (DiffNote) review comments per reviewed MR
6. **Review latency** ... time from MR open to first human review touch
7. **Revert rate** ... share of the user's merged MRs later reverted (change-failure proxy)
8. **MR size health** ... share of merged MRs landing in a reviewable size band
9. **Coding-day streak** ... distinct push-active days; current + longest streak
10. **Review reciprocity** ... reviews given vs. reviews received

Plus one cross-cutting display mode:

11. **Self-vs-self trend** ... every metric shown as this-window-minus-prior-window delta,
    so the tool can rank you against your own past, not only against teammates.

The current user's row should be highlighted, and their rank shown per category.
See **§4 gameability notes** ... the quality metrics exist specifically so the volume
metrics can't be gamed without the counterweight moving the wrong way.

---

## 2. Architecture

**Do not call the GitLab API directly from the browser.** gitlab.com does not return
permissive CORS headers for PAT-authenticated requests, so a pure client-side fetch
will fail. Keep the token server-side.

Recommended shape (adjust if you have a cleaner idea, but keep the token off the client):

- **Backend**: thin Node service (Hono or Express). Reads token from env, talks to the
  GitLab API, does all aggregation, exposes a single `GET /api/leaderboard` endpoint
  returning the computed JSON.
- **Frontend**: Vite + React + TypeScript + Tailwind. Calls the backend, renders tables.
- **Run model**: one command (`bun run dev`) starts both. Local only. No deploy target.

Stack matches my existing tooling preferences ... TypeScript throughout, minimal deps,
clean and readable over clever.

---

## 3. Configuration

All via `.env` + a small `config.ts`. No secrets in the browser, no secrets committed.

```
GITLAB_BASE_URL=https://gitlab.com        # or self-managed host
GITLAB_TOKEN=<PAT with read_api scope>    # read-only; do NOT use full `api` scope
```

```ts
// config.ts
export const config = {
  // Scope: provide ONE of these
  groupPath: "my-org/my-group",      // preferred for a monorepo group
  projectPaths: [] as string[],      // fallback: explicit project list

  // The custom comparison set
  users: ["matthew", "doug", "..."], // usernames

  currentUser: "matthew",            // highlighted + ranked

  // Window (defaults; UI can override)
  defaultRange: "30d",               // "7d" | "30d" | "90d" | custom
};
```

The UI must let me change the date range and refresh without restarting.

---

## 4. Metric definitions (be exact)

Prefer **GraphQL** for MR data (far fewer round trips than REST). Use **REST** for
pipelines. Field/argument names vary slightly by GitLab version ... verify the fuzzy
ones against the live schema at `/-/graphql-explorer` rather than trusting this doc.

### 4.1 Code added / deleted
- Source: each merged MR's diff summary (GraphQL `diffStatsSummary { additions deletions }`).
- Attribution: to the MR **author**.
- Filter: `state: merged`, `mergedAt` within window.
- Output per user: total additions, total deletions, net.

### 4.2 MRs merged
- Count of MRs where `author.username == user`, `state == merged`,
  `mergedAt` in window.
- (Author, not "merged_by" ... we want who did the work, not who clicked merge.)

### 4.3 MRs reviewed  *(fuzziest metric ... read this)*
- Definition: distinct MRs **not authored by the user** where, within the window, the
  user either (a) approved the MR, or (b) left at least one review note.
- Implementation options, in order of signal quality:
  1. Approvals via `approvedBy` on the MR node (firmest signal).
  2. Plus MRs where the user appears in `notes` authors (catches review comments
     without formal approval).
  - Assigned-as-reviewer alone does NOT count ... assignment isn't review.
- Verify the exact GraphQL args (`reviewerUsername`, `approved`, etc.) against the
  schema; they differ across versions. If approvals data isn't accessible on the
  instance's tier, fall back to note-author detection and label the metric accordingly.

### 4.4 Pipelines run
- REST: `GET /projects/:id/pipelines?username=:username&updated_after=&updated_before=&per_page=100`,
  iterated over each project in scope (no group-level pipelines endpoint).
- Output: count, plus a status breakdown (success / failed / canceled) if cheap.
- **Cost (optional, approximate):** there is no clean per-user CI-minutes API. If
  requested, approximate with summed pipeline `duration` and label it clearly as a
  proxy, not billed minutes.

### 4.5 Review comment depth
- Source: GraphQL/REST `notes` on each MR the user reviewed (not authored). Count notes
  where `type == DiffNote` (inline, code-anchored) vs `DiscussionNote`; drop `system: true`.
- Attribution: to the **note author** (reviewer), only on MRs they did not author.
- Output per user: median DiffNotes per reviewed MR (median, not total ... totals reward
  nitpick-spam). Optionally the DiffNote:DiscussionNote ratio.
- **Implemented as the mean.** A median collapses to 0 whenever fewer than half a reviewer's
  MRs carry inline comments, which is the common case, so it cannot discriminate reviewers.
- Purpose: quality counterweight to §4.3 (which counts approvals and rewards rubber-stamping).

### 4.6 Review latency (time-to-first-review)
- Definition: `earliest non-author, non-system note timestamp − createdAt` (use
  `prepared_at` instead of `createdAt` when the MR left draft, if available).
- Two cuts, both useful:
  - **Author-side:** how long the user's own MRs wait for first review (team's responsiveness to them).
  - **Reviewer-side:** the user's own median first-response time across MRs they reviewed.
- Output: p50 + p90 distribution, not a single mean.
- Pair with §4.5 in the UI so a hollow "looking 👀" note that stops the clock is visible.

### 4.7 Revert rate (change-failure proxy)
- Definition: `(merged MRs authored by the user that were later reverted) / (merged MRs in window)`.
- Detection (free, heuristic): MR title matches the auto-generated `Revert "<original>"`
  pattern, and/or a `revert` label, and/or a follow-up MR whose diff re-removes the prior
  MR's additions. **Label the metric "detected reverts only"** ... it undercounts fix-forward fixes.
- Purpose: the DORA-style quality counterweight that makes every speed/volume metric honest.

### 4.8 MR size health
- Source: GraphQL `diffStatsSummary { additions deletions }` (REST `changes_count` caps at
  `"1000+"`, so prefer GraphQL for accuracy).
- Definition: classify each merged MR into size bands (e.g. too-small `< ~10` lines /
  healthy / too-large `> ~400` lines) and report the **share in the healthy band**.
- Two-sided on purpose: penalizes both unreviewable mega-MRs and artificial micro-PR splitting.
- Framed as a **health signal, not a maximised reward**.

### 4.9 Coding-day streak
- Source: REST `GET /users/:id/events?action=pushed`, bucket timestamps to distinct
  calendar days within the window.
- Output: distinct coding days, current streak, and longest streak. A day counts once
  regardless of commit volume (so there's no fixup-commit incentive).
- Caveat: the events API only returns events visible to the PAT; note this in the README.
  Let PTO/configured non-working days pause rather than break a streak.

### 4.10 Review reciprocity
- Definition: `(distinct MRs the user gave substantive review on) / (distinct reviewers
  who engaged the user's own merged MRs)`. ~1.0 = pulling their weight in the review economy.
- Source: recombines data already gathered for §4.3 / §4.5 (note authors, `approvedBy`) ...
  no new API surface.
- Read with tenure context; gate the "given" side on §4.5 depth so spray-approving doesn't inflate it.

### 4.11 Self-vs-self trend (cross-cutting display mode)
- Not a new data source: compute every metric above for the current window **and** the
  prior equal-length window, and surface the per-user **delta**.
- Purpose: lets the tool gamify "you vs. your past self" rather than only inter-person
  ranking ... the safest framing if this is shared with teammates (see §9). Almost nothing
  to game, since you can only beat your own baseline.
- **Scope note:** this requires persisting per-window metric snapshots, which §8 originally
  listed as a non-goal. The §5 `.cache/` layer is the natural place to store them. This is
  a deliberate, additive scope change ... see updated §8.

### 4.12 Gameability notes (apply throughout)
Per the §9 caveats, follow these design rules so the leaderboard resists gaming:
- **Pair every speed/volume metric with a quality counterweight** (e.g. §4.6 latency with
  §4.5 depth; §4.2/§4.1 with §4.7 revert rate).
- **Prefer distributions and percentiles to raw counts** where it makes sense (§4.6, §4.8).
- **Prefer §4.11 self-vs-self trends over absolute inter-person rank** for the shared view.
- Treat §4.8 size health as a signal, never a points score.

---

## 5. API mechanics

- **Auth**: `PRIVATE-TOKEN` header (REST) / `Authorization: Bearer` (GraphQL).
- **Pagination**: handle it everywhere. GraphQL cursor (`pageInfo.hasNextPage` +
  `endCursor`); REST keyset or `per_page=100` + page loop. Do not assume one page.
- **Rate limits**: gitlab.com allows ~2000 authenticated REST req/min; GraphQL has
  query-complexity limits. Batch by querying the whole group's MRs once and bucketing
  by user in memory, rather than N queries per user. Add a small concurrency cap.
- **Caching**: cache raw API responses to `.cache/` keyed by `(scope, window)` so
  re-renders and range tweaks don't re-hammer the API. Add a "force refresh" control.

---

## 6. UI

- One **combined sortable table**: row per user, columns for each metric
  (additions, deletions, MRs merged, MRs reviewed, pipelines, plus the quality/consistency
  metrics from §4.5–§4.10). Click a header to sort.
- Highlight `currentUser`'s row; show their rank badge per column.
- Top controls: scope (read-only display is fine), date-range picker, refresh.
- **Volume vs. quality grouping:** visually separate the gameable volume columns (§4.1–§4.4)
  from the quality/consistency columns (§4.5–§4.10) so the counterweights read as a set.
- **Trend toggle (§4.11):** a mode that swaps absolute values for this-window-vs-prior-window
  deltas (▲/▼). This is the recommended default view when sharing with teammates.
- Secondary view (toggle): one focused leaderboard card per metric, ranked.
- Empty/zero states: show users with no activity as 0, not omitted.
- Keep it clean and legible. No chart library needed for v1 ... numbers + sorting first.
  A small bar per cell is a nice-to-have, not required.

---

## 7. Edge cases to handle

- Users with zero activity in the window (show as 0).
- MRs/pipelines straddling the window boundary (filter strictly by `mergedAt` /
  pipeline timestamp, not `createdAt`).
- Bot / service accounts in the group (only count configured `users`).
- Deleted or renamed users (match defensively; skip unresolved usernames with a warning).
- Large groups (pagination + caching are mandatory, not optional, here).
- Self-managed vs gitlab.com differences (driven entirely by `GITLAB_BASE_URL`).

---

## 8. Non-goals (v1)

- No auth/multi-user ... it's a local single-operator tool.
- ~~No historical trend storage / time series.~~ **Revised:** §4.11 needs the *prior*
  window's metric snapshot persisted to `.cache/`. Scope is limited to "current vs. one
  prior window" ... still no long-run time-series charts or trend database.
- No write operations of any kind (read-only token).
- No real CI billing integration.

---

## 9. Caveats (please surface these in the README)

These metrics are the textbook gameable proxies. Lines-of-code and MR-count reward
large diffs and lots of tiny MRs; "MRs reviewed" rewards rubber-stamping. Fine for
self-tracking and friendly comparison; do not let them become a real scoreboard people
are measured on, or the numbers will quietly stop meaning anything.

---

## 10. Deliverables

- Runnable repo: `bun install && bun run dev` starts backend + frontend locally.
- `.env.example` with the variables above.
- `README.md` covering setup, token scope (`read_api`), config, and the caveats in §9.
- Typed throughout; no `any` on the API response shapes.
