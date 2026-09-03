# Boxscore Data Layer (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace boxscore's JSON envelope cache and hand-rolled GitLab transport with one sqlite store plus glance-backed fetchers, so a window is a query rather than a cached envelope and a roster change is served on the next refresh.

**Architecture:** `server/store/` owns one sqlite file with eight tables and every read/write behind typed accessors. `server/source/` turns glance's six metric reads into the existing domain model. `server/refresh/` runs the watermark-driven refresh from spec 7.3 against the store. A query module builds the metrics layer's `FetchResult` from store rows for any window, which retires `sliceOutcome` and the covering-envelope logic. `server/gitlab/`, `server/cache/`, `server/pipeline/`, and `server/jobs/` are deleted. The metrics layer and every wire type are untouched.

**Tech Stack:** TypeScript, Bun (`bun:sqlite`, WAL), vitest, `@mattstack/glance` ^0.24.0, `@mattstack/rt-client` ^0.12.0, Hono.

**Spec:** docs/superpowers/specs/2026-09-02-mattstack-integration-design.md, section 7 (also D1, D7, and the section 10 inventory rows marked SP4). Conflicts resolve against the spec.

## Global Constraints

- Branch `feat/data-layer` off `feat/mattstack-integration-spec`, in a git worktree under `.worktrees/`. Validation after every task: `bun run test` and `bun run typecheck`, both green.
- **The metrics layer is frozen.** `server/metrics/**` and `shared/**` are not edited by any task. The contract it consumes stays exactly:
  `FetchResult { mrs: NormMr[]; pipelines: NormPipeline[]; pushEvents: NormPushEvent[]; linearIssues: NormLinearIssue[]; approvalsAvailable: boolean }`, plus `SnapshotOptions extends CohortOptions { users }` and `EvidenceContext extends CohortOptions { baseUrl }`. Field names and types in `server/pipeline/model.ts` move verbatim to their new home; nothing is renamed.
- **Wire types are frozen.** `shared/types.ts` is not edited. `LeaderboardResponse`, `UserDetailResponse`, `RefreshProgress` (including its seven `phase` strings), `RefreshStatusResponse`, and every `WarningCode` keep their current shape and meaning, so the untouched frontend keeps working.
- **`preparedAt` stays null.** No query has ever fetched it, so `cohorts.ts`'s `m.preparedAt ?? m.createdAt` already falls back on every MR (spec section 9). Do not add it, and do not "fix" the fallback: that would change every review-latency number.
- All glance calls pass the refresh job's `AbortSignal` and rely on glance 0.24.0's built-in retry. `server/util/http.ts` survives for Linear only; no new wrapper goes around a glance call.
- Store path `~/.mattstack/boxscore/boxscore.sqlite` (WAL), overridable by `BOXSCORE_DB` for tests. Every write is a transaction. Schema version mismatch drops and recreates every table, matching today's `mr-store.ts` strategy.
- Tests never touch `~/.mattstack`: `vitest.config.ts` pins `BOXSCORE_DB` to a temp path the way it pins `BOXSCORE_CACHE_DIR` today, and store tests use their own file per suite.
- The layering ratchet in `test/layering.test.ts` must keep passing and must be extended to the new directories: `server/source`, `server/store`, and `server/refresh` may never import `server/metrics`.
- House rules: no em dashes; comments only state constraints the code cannot show; commit after every task with a short imperative message.

---

### Task 1: The sqlite store

**Files:**
- Create: `server/store/schema.ts`, `server/store/db.ts`, `server/store/index.ts`
- Test: `test/store.test.ts`
- Modify: `vitest.config.ts` (add `BOXSCORE_DB` to `env`)

**Interfaces:**
- Produces (Tasks 2-5 consume): a `Store` object from `getStore()` with these methods, all synchronous over `bun:sqlite` except where noted, every mutator wrapped in a transaction:
  - `upsertIndexRows(rows: readonly IndexRow[]): void`
  - `indexRowsUpdatedWithin(startIso: string, endIso: string): IndexRow[]`
  - `indexRowsByKeys(keys: readonly string[]): IndexRow[]`
  - `lastScan(projectPath: string): string | null` / `setLastScan(projectPath: string, iso: string): void`
  - `upsertMrMetrics(rows: readonly StoredMetrics[]): void`
  - `mergedMetricsKeys(keys: readonly string[]): Set<string>`
  - `metricsByKeys(keys: readonly string[]): StoredMetrics[]`
  - `upsertPipelines(rows: readonly StoredPipeline[]): void` / `pipelinesBetween(startIso, endIso): StoredPipeline[]`
  - `upsertPushEvents(rows: readonly StoredPushEvent[]): void` / `pushEventsBetween(startIso, endIso): StoredPushEvent[]`
  - `upsertLinearIssues(rows: readonly StoredLinearIssue[]): void` / `linearIssuesForMrKeys(keys: readonly string[]): StoredLinearIssue[]`
  - `isValidLinearId(id: string): boolean | null` / `putLinearIds(entries: readonly { id: string; valid: boolean }[]): void` / `linearIdStats(): { valid: number; invalid: number }`
  - `upsertIdentities(rows: readonly StoredIdentity[]): void` / `identities(usernames: readonly string[]): StoredIdentity[]`
  - `counts(): { mrIndex: number; mrMetrics: number; pipelines: number; pushEvents: number; linearIssues: number }`
  - `clear(): void` (drops every table's rows in one transaction, keeps the file)
  - `close(): void`, and `__resetStore(): void` for tests
- `mrKey(projectPath: string, iid: number): string` returning `` `${projectPath}:${iid}` ``, exported and reused everywhere a key is formed.
- The row types, exported from `server/store/index.ts` and used verbatim by Tasks 2-5. They mirror glance's read shapes plus the store's own bookkeeping columns; none of them is the metrics layer's `NormMr` (that is assembled in Task 3):

```ts
export type MrState = "merged" | "opened" | "closed" | "locked";

export interface IndexRow {
  projectPath: string;
  iid: number;
  title: string;
  state: MrState;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  authorUsername: string | null;
  sourceBranch: string | null;
  labels: string[];
  /** When this row was last written by a scan. Bookkeeping, not from glance. */
  scannedAt: string;
}

export interface StoredNote {
  authorUsername: string | null;
  createdAt: string;
  system: boolean;
  inline: boolean;
}

export interface StoredMetrics {
  projectPath: string;
  iid: number;
  description: string | null;
  diffStats: { additions: number; deletions: number; filesChanged: number } | null;
  fileStats: { path: string; additions: number; deletions: number }[];
  labels: string[];
  approvedByUsernames: string[];
  notes: StoredNote[];
}

export interface StoredPipeline {
  /** Glance's scoped id, e.g. "gitlab:pipeline:9". */
  id: string;
  projectPath: string;
  username: string | null;
  status: string;
  createdAt: string;
}

export interface StoredPushEvent {
  username: string;
  createdAt: string;
  repositoryId: string | null;
}

export interface StoredLinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  assignedUser: string | null;
  linkedMrs: { iid: number; projectPath: string }[];
  stateType: string | null;
  stateName: string | null;
}

export interface StoredIdentity {
  username: string;
  name: string | null;
  resolved: boolean;
  userId: number | null;
  /** Drives the one-day identity refresh rule in spec 7.3 step 1. */
  fetchedAt: string;
}

export type Store = ReturnType<typeof getStore>;
```

`StoredLinearIssue` is field-for-field the metrics layer's `NormLinearIssue`, so Task 3 passes it through unchanged.

- [ ] **Step 1: Write the failing tests**

`test/store.test.ts`. Use a per-suite temp DB via `process.env.BOXSCORE_DB` set before importing the module, and `__resetStore()` in `afterEach`. Cover:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "boxscore-store-"));
process.env.BOXSCORE_DB = join(dir, "test.sqlite");

const { getStore, mrKey, __resetStore } = await import("../server/store/index.js");

afterEach(() => __resetStore());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const row = (over: Partial<IndexRow> = {}): IndexRow => ({
  projectPath: "g/p", iid: 1, title: "t", state: "merged",
  createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-02T00:00:00Z",
  mergedAt: "2026-05-02T00:00:00Z", authorUsername: "ada",
  sourceBranch: "b", labels: [], scannedAt: "2026-05-03T00:00:00Z", ...over,
});

describe("index rows", () => {
  it("upserts by project:iid, last write wins, and round-trips labels", () => {
    const s = getStore();
    s.upsertIndexRows([row({ labels: ["bug"] })]);
    s.upsertIndexRows([row({ title: "renamed", labels: ["bug", "ui"] })]);
    const out = s.indexRowsByKeys([mrKey("g/p", 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("renamed");
    expect(out[0].labels).toEqual(["bug", "ui"]);
  });

  it("selects by updatedAt window, inclusive of both bounds", () => {
    const s = getStore();
    s.upsertIndexRows([
      row({ iid: 1, updatedAt: "2026-05-01T00:00:00Z" }),
      row({ iid: 2, updatedAt: "2026-05-15T00:00:00Z" }),
      row({ iid: 3, updatedAt: "2026-06-01T00:00:00Z" }),
    ]);
    const got = s.indexRowsUpdatedWithin("2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z");
    expect(got.map((r) => r.iid).sort()).toEqual([1, 2, 3]);
    expect(s.indexRowsUpdatedWithin("2026-05-02T00:00:00Z", "2026-05-20T00:00:00Z").map((r) => r.iid)).toEqual([2]);
  });

  it("a scan watermark is per project and absent until set", () => {
    const s = getStore();
    expect(s.lastScan("g/p")).toBeNull();
    s.setLastScan("g/p", "2026-05-03T00:00:00Z");
    expect(s.lastScan("g/p")).toBe("2026-05-03T00:00:00Z");
    expect(s.lastScan("g/other")).toBeNull();
  });
});

describe("metrics rows", () => {
  it("mergedMetricsKeys returns only rows whose index state is merged", () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1, state: "merged" }), row({ iid: 2, state: "opened", mergedAt: null })]);
    s.upsertMrMetrics([metrics("g/p", 1), metrics("g/p", 2)]);
    const keys = s.mergedMetricsKeys([mrKey("g/p", 1), mrKey("g/p", 2)]);
    expect([...keys]).toEqual([mrKey("g/p", 1)]);
  });

  it("round-trips notes, diffStats, fileStats, labels, and approvers", () => {
    const s = getStore();
    const m = metrics("g/p", 1);
    s.upsertMrMetrics([m]);
    expect(s.metricsByKeys([mrKey("g/p", 1)])[0]).toEqual(m);
  });
});

describe("time-ranged rows", () => {
  it("pipelines and push events select by createdAt window", () => {
    const s = getStore();
    s.upsertPipelines([
      { id: "gitlab:pipeline:1", projectPath: "g/p", username: "ada", status: "success", createdAt: "2026-05-01T00:00:00Z" },
      { id: "gitlab:pipeline:2", projectPath: "g/p", username: "ada", status: "failed", createdAt: "2026-06-10T00:00:00Z" },
    ]);
    s.upsertPushEvents([
      { username: "ada", createdAt: "2026-05-02T00:00:00Z", repositoryId: "gitlab:42" },
      { username: "ada", createdAt: "2026-06-10T00:00:00Z", repositoryId: "gitlab:42" },
    ]);
    expect(s.pipelinesBetween("2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z").map((p) => p.id)).toEqual(["gitlab:pipeline:1"]);
    expect(s.pushEventsBetween("2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z")).toHaveLength(1);
  });
});

describe("linear", () => {
  it("issues come back for the MR keys that link them", () => {
    const s = getStore();
    s.upsertLinearIssues([
      { id: "1", identifier: "ENG-1", title: "a", url: "u1", assignedUser: "ada",
        linkedMrs: [{ projectPath: "g/p", iid: 1 }], stateType: "completed", stateName: "Done" },
      { id: "2", identifier: "ENG-2", title: "b", url: "u2", assignedUser: "bob",
        linkedMrs: [{ projectPath: "g/p", iid: 99 }], stateType: "started", stateName: "In Progress" },
    ]);
    const got = s.linearIssuesForMrKeys([mrKey("g/p", 1)]);
    expect(got.map((i) => i.identifier)).toEqual(["ENG-1"]);
    expect(got[0].linkedMrs).toEqual([{ projectPath: "g/p", iid: 1 }]);
  });
  it("id validity is tri-state and cached", () => {
    const s = getStore();
    expect(s.isValidLinearId("ENG-1")).toBeNull();
    s.putLinearIds([{ id: "ENG-1", valid: true }, { id: "ENG-2", valid: false }]);
    expect(s.isValidLinearId("ENG-1")).toBe(true);
    expect(s.isValidLinearId("ENG-2")).toBe(false);
    expect(s.linearIdStats()).toEqual({ valid: 1, invalid: 1 });
  });
});

describe("lifecycle", () => {
  it("clear empties every table but keeps the store usable", () => {
    const s = getStore();
    s.upsertIndexRows([row()]);
    s.upsertPipelines([pipeline()]);
    s.clear();
    expect(s.counts()).toEqual({ mrIndex: 0, mrMetrics: 0, pipelines: 0, pushEvents: 0, linearIssues: 0 });
    s.upsertIndexRows([row()]);
    expect(s.counts().mrIndex).toBe(1);
  });

  it("a schema version bump drops and recreates every table", () => { /* write rows, bump user_version to a lower number, reopen, assert empty */ });

  it("a failing write in a batch leaves the table unchanged", () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 })]);
    expect(() => s.upsertIndexRows([row({ iid: 2 }), null as unknown as IndexRow])).toThrow();
    expect(s.counts().mrIndex).toBe(1);
  });
});
```

`metrics(projectPath, iid)` and `pipeline()` are local builders in the same shape as `row()`. The two remaining
elided bodies (the schema-version drop and the metrics round-trip) are described in their `it` names and follow
the neighbouring pattern; every `it` must assert, and the transaction test is the one that proves the batch guarantee.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/store.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement the schema**

`server/store/schema.ts` holds `SCHEMA_VERSION = 1` and the DDL. Eight tables, per spec 7.2:

```sql
CREATE TABLE IF NOT EXISTS mr_index (
  key TEXT PRIMARY KEY, project_path TEXT NOT NULL, iid INTEGER NOT NULL,
  title TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, merged_at TEXT, author_username TEXT,
  source_branch TEXT, labels TEXT NOT NULL, scanned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mr_index_updated ON mr_index (updated_at);
CREATE INDEX IF NOT EXISTS mr_index_merged ON mr_index (merged_at);
CREATE TABLE IF NOT EXISTS scan_meta (project_path TEXT PRIMARY KEY, last_scan TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mr_metrics (key TEXT PRIMARY KEY, project_path TEXT NOT NULL, iid INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pipelines (key TEXT PRIMARY KEY, project_path TEXT NOT NULL, username TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pipelines_created ON pipelines (created_at);
CREATE TABLE IF NOT EXISTS push_events (key TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT NOT NULL, repository_id TEXT);
CREATE INDEX IF NOT EXISTS push_events_created ON push_events (created_at);
CREATE TABLE IF NOT EXISTS linear_issues (identifier TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS linear_ids (id TEXT PRIMARY KEY, valid INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities (username TEXT PRIMARY KEY, name TEXT, resolved INTEGER NOT NULL, user_id INTEGER, fetched_at TEXT NOT NULL);
```

Rows whose payload is a nested object (`mr_metrics`, `linear_issues`) store JSON in `data`; scalar columns exist only where a query filters on them. `pipelines.key` is `` `${projectPath}:${id}` ``; `push_events.key` is `` `${username}:${createdAt}:${repositoryId ?? ""}` `` (spec 7.2).

- [ ] **Step 4: Implement the store**

`server/store/db.ts` opens the DB: path from `process.env.BOXSCORE_DB ?? join(HOME, ".mattstack", "boxscore", "boxscore.sqlite")`, `mkdir` the parent, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, then compare `PRAGMA user_version` to `SCHEMA_VERSION` and, on mismatch, `DROP TABLE IF EXISTS` every table before recreating and setting the version. `server/store/index.ts` exports `getStore()` (lazy singleton), `mrKey`, `__resetStore()`, and the row types.

Unlike today's `mr-store.ts`, do NOT add an in-memory fallback: the server and the tests both run under Bun, and a silent fallback hides a broken store. If `bun:sqlite` is unavailable, throw with a message naming the runtime requirement.

Every mutator takes an array and wraps it in `db.transaction(...)`, so a partial batch cannot land.

- [ ] **Step 5: Pin the test DB**

In `vitest.config.ts`, add `BOXSCORE_DB` to the existing `env` block, pointing at a path under the repo's ignored test scratch (alongside `BOXSCORE_CACHE_DIR: ".cache-test"`), so no test can reach the real store even if it forgets its own temp file.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test` and `bun run typecheck`. Expected: the existing suite green plus the new file.

- [ ] **Step 7: Commit**

```bash
git add server/store test/store.test.ts vitest.config.ts
git commit -m "add server/store: one sqlite store with typed accessors"
```

---

### Task 2: Glance-backed source module

**Files:**
- Create: `server/source/provider.ts`, `server/source/mrs.ts`, `server/source/activity.ts`, `server/source/identities.ts`, `server/source/index.ts`
- Test: `test/source.test.ts`
- Modify: `package.json` (add `"@mattstack/glance": "^0.24.0"`), then `bun install`

**Interfaces:**
- Consumes: `readSettings`, `Env`, `ConfigError` from `server/config/`; glance's `GitLabProvider` and its six metric reads.
- Produces (Task 4 consumes):
  - `makeProvider(env: Env): GitProvider` in `provider.ts` (constructs `new GitLabProvider(env.baseUrl, env.token)`).
  - `scanProject(provider, projectPath, updatedAfter, io): Promise<IndexRow[]>` mapping `MergeRequestIndexRow` to the store's `IndexRow` (adds `scannedAt`).
  - `fetchMetrics(provider, projectPath, iid, io): Promise<StoredMetrics | null>` mapping `MergeRequestMetrics`.
  - `fetchPipelinesFor(provider, projectPath, username, window, io): Promise<StoredPipeline[]>`
  - `fetchPushesFor(provider, userId, window, io): Promise<StoredPushEvent[]>`
  - `resolveIdentity(provider, username, io): Promise<StoredIdentity>`
  - `type SourceIO = { signal?: AbortSignal }`
- The mapping functions are pure and exported separately from the fetchers (`toIndexRow`, `toStoredMetrics`, `toStoredPipeline`, `toStoredPushEvent`) so tests can pin them without a provider.

- [ ] **Step 1: Write the failing tests**

`test/source.test.ts` uses a hand-rolled fake provider object (not a mock library): an object literal with the six methods returning canned glance shapes, recording its call arguments. Assert:
- `scanProject` passes `{ projectPaths: [path], updatedAfter, signal }` and stamps `scannedAt` on every row.
- `toIndexRow` maps every field one-to-one and defaults `labels` to `[]` when glance returns none.
- `toStoredMetrics` maps `notes` (author, createdAt, system, inline), `diffStats` summary, `fileStats`, `labels`, and `approvedByUsernames`, and preserves note order.
- `fetchMetrics` returns null when glance returns null (MR gone).
- `fetchPipelinesFor` passes `username`, `updatedAfter`, `updatedBefore` and maps `status` through unchanged (already lowercased by glance).
- `fetchPushesFor` passes `action: "pushed"` and calendar-date bounds derived from the window, and maps `repositoryId`.
- `resolveIdentity` marks `resolved: false` with no throw when the user is not found, and stamps `fetchedAt`.
- Every fetcher forwards `signal` to the glance call it makes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/source.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

Each fetcher is a thin call plus a pure mapper; no retry wrapper (glance 0.24.0 owns retry) and no concurrency (the refresh module owns fan-out). Identity resolution uses the provider's existing user lookup; when glance offers no direct username lookup, use `provider.restRequest("GET", \`/users?username=${encodeURIComponent(username)}\`, undefined, "resolveIdentity", { signal, retry: true })` and take the exact-username match, matching today's `fetch.ts:84-101` semantics including the unresolved case.

`server/source/index.ts` re-exports the fetchers and mappers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test` and `bun run typecheck`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/source test/source.test.ts package.json bun.lock
git commit -m "add server/source: glance-backed fetchers and pure mappers"
```

---

### Task 3: The query layer

**Files:**
- Create: `server/store/query.ts`, `server/store/model.ts`
- Test: `test/query.test.ts`
- Modify: `test/layering.test.ts` (add the new directories to the ratchet)

**Interfaces:**
- `server/store/model.ts` holds the domain model moved verbatim from `server/pipeline/model.ts` (`MrState`, `NormNote`, `NormMr`, `NormPipeline`, `NormPushEvent`, `NormLinearIssue`, `FetchResult`, `UserIdentity`). Field names and types are unchanged; only the file location moves. `server/pipeline/model.ts` is deleted in Task 5 and every importer repointed there.
- Produces (Tasks 4-5 consume):
  - `buildFetchResult(store: Store, window: TimeWindow, roster: readonly string[]): FetchResult`
  - `storedIdentities(store: Store, roster: readonly string[]): Record<string, UserIdentity>`
  - `hasDataFor(store: Store, projects: readonly string[]): boolean` (every configured project has a `scan_meta` row; the cold-store probe that replaces `ColdCacheError`'s cache check)

- [ ] **Step 1: Write the failing tests**

`test/query.test.ts` seeds a temp store directly through Task 1's accessors, then asserts `buildFetchResult`:
- `mrs` contains an MR whose `updatedAt` is inside the window, joined with its metrics row (notes, diffStats, fileStats, labels, approvers) and with `additions`/`deletions`/`fileCount` derived from the metrics summary.
- An index row with no metrics row still appears, with empty notes, zero counts, and `approvedByUsernames: []`, so a listing-only MR never disappears from the corpus.
- `preparedAt` is null on every row (the frozen behavior).
- Window selection matches today: the same predicate `sliceOutcome` used, i.e. an MR is in-window when `updatedAt` falls within `[start, end]`.
- `pipelines` and `pushEvents` filter on `createdAt` within the window; push events use the same one-day widening on each side that `slice.ts:31-34` documents.
- `linearIssues` returns only issues linked to in-window MRs eligible for discovery (`state !== "closed"`), matching `slice.ts:38-43`.
- `approvalsAvailable` is true when any stored metrics row has a non-empty `approvedByUsernames`, false otherwise.
- `storedIdentities` returns a `Record` keyed by username including unresolved entries.
- `hasDataFor` is false when any configured project lacks a scan row, true when all have one.

Port the fixture expectations in `test/slicing.test.ts` that pin window behavior: those characterization assertions must survive as query-layer assertions rather than being deleted with `sliceOutcome`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/query.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`buildFetchResult` issues one query per table (index rows by `updatedAt`, metrics by the resulting keys, pipelines and pushes by `createdAt`, linear issues by MR key) and assembles `FetchResult`. It performs no network work and takes no signal.

Note the deliberate divergence this replaces: `slice.ts` had to bound `updatedAt` on both sides because an envelope held a wider fetch; the store has the same requirement for the same reason (the prior window must not see MRs updated during the current one), so keep the two-sided bound and carry the comment's reasoning across.

- [ ] **Step 4: Extend the layering ratchet**

In `test/layering.test.ts`, add `server/source`, `server/store`, and `server/refresh` to the set of directories forbidden from importing `server/metrics`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test` and `bun run typecheck`. Expected: green.

- [ ] **Step 6: Commit**

```bash
git add server/store/query.ts server/store/model.ts test/query.test.ts test/layering.test.ts
git commit -m "add the query layer: a window is a store query, not an envelope slice"
```

---

### Task 4: The refresh algorithm

**Files:**
- Create: `server/refresh/run.ts`, `server/refresh/job.ts`, `server/refresh/index.ts`
- Test: `test/refresh.test.ts`
- Modify: `test/jobs.test.ts` (repoint imports; assertions unchanged)

**Interfaces:**
- Consumes: Task 1's store, Task 2's fetchers, Task 3's query, `server/linear/fetch.ts`'s `resolveLinearTickets` and `eligibleForLinearDiscovery`, `server/util/concurrency.ts`'s `mapLimit`, `CONCURRENCY` from config.
- Produces:
  - `runRefresh(opts: RefreshRunOptions): Promise<LeaderboardWarning[]>` in `run.ts`, where
    `RefreshRunOptions = { store: Store; provider: GitProvider; settings: BoxscoreSettings; env: Env; window: TimeWindow; signal?: AbortSignal; onProgress?: (p: Omit<RefreshProgress, "window">) => void }`
  - `job.ts` re-exports the job model from today's `server/jobs/refresh.ts` with its behavior unchanged: `startRefresh`, `getRefresh`, `cancelRefresh`, `toStatusResponse`, `__resetJobs`, the single-job singleton, the 10-minute timeout, and the cancelled-vs-error status rules.

- [ ] **Step 1: Write the failing tests**

`test/refresh.test.ts` drives `runRefresh` with a fake provider and a temp store. Assert, per spec 7.3:
- Identities are resolved only for roster users missing from `identities` or older than a day; a fresh identity is not re-fetched.
- The roster passed to the scan is visible plus hidden members, so hiding a user does not evict their data.
- Each project scans with `updatedAfter = lastScan(project)`, falling back to the base-window start when absent.
- **A failed project scan leaves that project's watermark alone and does not block the others** (the spec's named defect fix): make project A throw and project B succeed, then assert `lastScan("A")` is unchanged, `lastScan("B")` advanced, and a `mr_fetch_failed` warning was returned.
- The eligible-for-detail set is index rows authored by the roster within the base window, plus any row whose title matches the revert pattern regardless of author.
- Metrics are fetched only for eligible rows missing from `mr_metrics` or present with a non-merged state; a merged row already stored is not re-fetched.
- Metrics persist in batches of 25, and a mid-run abort banks the completed batches (assert rows present after the abort rejects).
- Progress emits the same phase strings in the same order as today: `users`, `mrs-list`, `mrs-detail`, `pipelines`, `pushes`, `linear`.
- Every warning code the old pipeline could emit still emits under its equivalent condition.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/refresh.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`runRefresh` follows spec 7.3's six steps in order, using `mapLimit(..., CONCURRENCY, ...)` for each fan-out exactly as `fetch.ts` does today, checking `signal?.throwIfAborted()` at every phase boundary, and upserting through the store's transactional mutators. It returns the accumulated warnings rather than throwing on partial failure; only an abort or a total failure propagates.

`job.ts` is a move, not a rewrite: copy `server/jobs/refresh.ts` verbatim and change only its import paths. Its tests come along unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test` and `bun run typecheck`. Expected: green, including the moved `test/jobs.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/refresh test/refresh.test.ts test/jobs.test.ts
git commit -m "add server/refresh: watermark-driven refresh against the store"
```

---

### Task 5: Wire the server and delete the old layers

**Files:**
- Modify: `server/leaderboard.ts`, `server/app.ts`, `server/bots.ts`, `server/linear/fetch.ts`, `server/cli.ts`
- Delete: `server/gitlab/` (whole directory), `server/cache/` (whole directory), `server/pipeline/` (whole directory), `server/jobs/` (whole directory), `server/util/graphql.ts`
- Delete tests: `test/cache.test.ts`, `test/mr-store.test.ts`, `test/slicing.test.ts`, `test/detail-persist.test.ts`, `test/mapping.test.ts`
- Modify tests: `test/endpoints.test.ts`, `test/linear-resolve.test.ts`, `test/progress.test.ts`, `test/abort.test.ts`

**Interfaces:**
- After this task nothing imports `server/gitlab`, `server/cache`, `server/pipeline`, `server/jobs`, or `server/util/graphql`. `server/util/http.ts` survives, imported only by `server/linear/`.

- [ ] **Step 1: Rewire `leaderboard.ts`**

`loadOrFetch` is replaced by: build the provider and settings, and when `opts.refresh` is true run `runRefresh` first; then always build the response from `buildFetchResult(store, window, roster)`. `fromCache` becomes "no refresh ran on this request", which is what the field already means to the UI. `ColdCacheError` survives with its message and its `app.ts` 200-with-`{cached:false}` mapping, now thrown when `opts.cacheOnly && !opts.refresh && !hasDataFor(store, settings.projects)`. `sliceOutcome`, `cacheKey`, `readCache`, `readCoveringCache`, and `writeCache` all disappear from this file. `BuildContext` is constructed exactly as today, with `identities` from `storedIdentities`.

- [ ] **Step 2: Rewire `bots.ts`**

Today it hand-parses the ten most recent envelope JSON files (`server/bots.ts:31,42`) and would silently return `[]` once envelopes are gone. Replace that with a store query: read every stored metrics row's note authors and approver usernames, plus index-row author usernames, and test them against the bot patterns, excluding usernames present in `identities`. Its exported signature `scanSuspectedBots(extraPatterns: string[]): Promise<SuspectedBot[]>` and the `--format bots` CLI output are unchanged.

- [ ] **Step 3: Rewire `linear/fetch.ts`**

Its Linear-ID validity cache moves from `cache/mr-store.ts` to the store's `isValidLinearId`/`putLinearIds`/`linearIdStats`. Nothing else in the module changes; `eligibleForLinearDiscovery` and `resolveLinearTickets` keep their signatures, and `server/util/http.ts` stays as its transport.

- [ ] **Step 4: Rewire `app.ts`**

`/api/cache/stats` now reports the store's `counts()` mapped onto the existing `CacheStatsResponse` wire shape (`mrDetails`, `mrList`, `linearIds`), and `/api/cache/clear` calls `store.clear()`, which now genuinely drops every table rather than leaving envelopes behind (spec section 10). Route paths, methods, and response shapes are unchanged. Refresh routes import from `server/refresh/`.

- [ ] **Step 5: Delete and migrate the tests**

Delete the five test files whose subject is gone (`cache`, `mr-store`, `slicing`, `detail-persist`, `mapping`), having already carried `slicing`'s window characterizations into `test/query.test.ts` in Task 3. Repoint `test/endpoints.test.ts` to seed the store through its accessors instead of writing envelope files, keeping every existing assertion including the new route-absence test. Repoint `test/linear-resolve.test.ts` at the store's Linear-ID cache. Repoint `test/progress.test.ts` and `test/abort.test.ts` imports; their assertions do not change.

- [ ] **Step 6: Validate**

Run: `bun run test` and `bun run typecheck`, then `grep -rn "cache/store\|cache/mr-store\|pipeline/fetch\|server/gitlab\|util/graphql" server test --include="*.ts"` and expect no hits. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "serve from the store; delete gitlab, cache, pipeline, and jobs"
```

---

### Task 6: README and a live smoke run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

Update the architecture and data sections: one sqlite store at `~/.mattstack/boxscore/boxscore.sqlite` (override `BOXSCORE_DB`), glance owns transport, a window is a query so a roster change is served on the next refresh, and merged MRs stay immutable so post-merge comments do not reach review metrics (spec 7.4, kept from today).

- [ ] **Step 2: Live smoke**

Run `bun server/cli.ts --range 7d --refresh` against the real configured projects, then `bun server/cli.ts --range 7d` a second time and confirm the second run serves from the store without a refresh. Compare the standings table against the pre-migration output recorded in the task report; a metric that moves is a finding to report, not a number to accept, with the one expected exception being none (this migration is behavior-preserving by construction).

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "README: sqlite store, glance transport, window-as-query"
```
