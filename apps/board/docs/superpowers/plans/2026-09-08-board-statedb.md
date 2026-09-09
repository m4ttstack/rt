# Board state.db Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every board runtime state surface off APP_ROOT-anchored JSON files into one WAL-mode SQLite db at `~/.mattstack/board/state.db`, per the RT-48 ruling.

**Architecture:** A board-local copy of rt's `lib/state/` pattern: one lazy-opened db module with `user_version` migrations, single-owner store modules behind existing function names, a claim-ticket handshake that keeps the `--state <path>` argv contract while the path becomes a db row key, and a one-shot legacy JSON import.

**Tech Stack:** bun:sqlite (built into bun, no new deps), bun test.

**Spec:** `apps/board/docs/superpowers/specs/2026-09-08-board-statedb-design.md` (read it first; it carries the decisions and their reasons).

## Global Constraints

- All DDL is `IF NOT EXISTS`; the migration runner replays V1..Vn on every bump (max's bundle constraint).
- No module-load db access anywhere: every export is a function; `getStateDb()` is lazy.
- bun:sqlite `db.transaction()` callbacks are synchronous; never wrap async code in one.
- No em dashes or en dashes in any text this plan produces (house rule; use "..." or parens).
- Comments follow clean-code rules: only constraints the code cannot show; no narration, no process references.
- Run `bun run tui-kit:build` once from the repo root before the first board test/typecheck run in a fresh worktree.
- Test command shape (from repo root): `bun test apps/board/src/__tests__/<file>.test.ts`; full suite gate: `bun run board:test && bun run board:typecheck`.
- Existing exported function names keep working wherever practical: callers of `readReviewStates()` et al. should not need signature changes beyond path-to-handle reinterpretation.
- Commit after every task with a short imperative message ending in the attribution line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: db core (`src/state/db.ts`) and kv blob accessors

**Files:**
- Create: `apps/board/src/state/db.ts`
- Create: `apps/board/src/state/kv-blob.ts`
- Create: `apps/board/src/state/busy.ts`
- Create: `apps/board/src/state/index.ts` (the barrel; every consumer outside `src/state/` imports through it)
- Test: `apps/board/src/__tests__/state-db.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - `boardStateRoot(): string` (dirname of `BOARD_STATE_DB` when set, else `~/.mattstack/board`; HOME read at call time)
  - `stateDbPath(): string` (`<boardStateRoot()>/state.db`)
  - `dbPathForRoot(root: string): string` (`<root>/state.db`)
  - `type DbFlavor = 'server' | 'cli'` (busy_timeout 250 vs 5000)
  - `getStateDb(flavor?: DbFlavor): Database` lazy singleton; `openStateDb(path: string, flavor?: DbFlavor): Database` explicit seam; `closeStateDb(): void`
  - `SCHEMA_VERSION = 1`
  - `getKvValue<T>(ns: string, key: string, fallback: T, db?: Database): T`, `setKvValue(ns: string, key: string, value: unknown, db?: Database): void`, `deleteKvValue(ns: string, key: string, db?: Database): void`
  - `busy.ts`: `runCriticalWrite(label: string, fn: () => void): void` (bounded retry, 3 attempts with 50ms backoff, rethrow after; for lifecycle rows and outbox, where a dropped write loses state) and `persistOrWarn(label: string, fn: () => void): void` (catch SQLITE_BUSY, console.error, move on; for cache-class writes: slack refs, indexes, kv cursor). Copy the split from rt's `lib/state/busy.ts`.
  - `openStateDb` NEVER runs the legacy import; only the real-path `getStateDb()` singleton does (Task 6). Tests opening temp dbs must never touch live JSON trees.

- [ ] **Step 1: Write the failing test**

```ts
// apps/board/src/__tests__/state-db.test.ts
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStateDb, SCHEMA_VERSION } from '../state/db.ts';
import { getKvValue, setKvValue } from '../state/kv-blob.ts';

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'board-statedb-')), 'state.db');
}

describe('state db', () => {
  test('open migrates to SCHEMA_VERSION with all v1 tables', () => {
    const db = openStateDb(tempDbPath());
    const version = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(version).toBe(SCHEMA_VERSION);
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
    for (const t of ['agent_states', 'drafts', 'nudges', 'nudges_sent', 'outbox', 'slack_refs', 'kv']) {
      expect(tables).toContain(t);
    }
  });

  test('re-open replays migrations idempotently', () => {
    const path = tempDbPath();
    openStateDb(path).close();
    const db = openStateDb(path);
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  });

  test('unopenable db is quarantined and recreated', () => {
    const path = tempDbPath();
    writeFileSync(path, 'this is not a sqlite database, definitely');
    const db = openStateDb(path);
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  });

  test('kv round-trips and falls back', () => {
    const db = openStateDb(tempDbPath());
    expect(getKvValue('t', 'missing', 'fallback', db)).toBe('fallback');
    setKvValue('t', 'k', { a: 1 }, db);
    expect(getKvValue('t', 'k', null, db)).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/board/src/__tests__/state-db.test.ts`
Expected: FAIL, cannot resolve `../state/db.ts`.

- [ ] **Step 3: Implement `src/state/db.ts` and `src/state/kv-blob.ts`**

`db.ts` (structure to follow; write it complete):

```ts
import { Database } from 'bun:sqlite';
import { mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export type DbFlavor = 'server' | 'cli';
export const SCHEMA_VERSION = 1;

const BUSY_TIMEOUT_MS: Record<DbFlavor, number> = { server: 250, cli: 5000 };
const MIGRATION_BUSY_TIMEOUT_MS = 5000;

export function boardStateRoot(): string {
  const override = process.env.BOARD_STATE_DB;
  if (override) return dirname(resolve(override));
  return join(process.env.HOME ?? homedir(), '.mattstack', 'board');
}
export function stateDbPath(): string {
  const override = process.env.BOARD_STATE_DB;
  if (override) return resolve(override);
  return join(boardStateRoot(), 'state.db');
}
export function dbPathForRoot(root: string): string {
  return join(root, 'state.db');
}

const V1_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_states (
  lane       TEXT NOT NULL,
  mr_url     TEXT NOT NULL,
  state      TEXT NOT NULL,
  handle     TEXT NOT NULL,
  report     TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (lane, mr_url)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_states_handle ON agent_states(handle);

CREATE TABLE IF NOT EXISTS drafts (
  mr_url     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  draft      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mr_url, kind)
);

CREATE TABLE IF NOT EXISTS nudges (
  id         TEXT PRIMARY KEY,
  nudge      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nudges_sent (
  mr_url     TEXT PRIMARY KEY,
  nudge      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id TEXT NOT NULL,
  entry      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_envelope_id ON outbox(envelope_id);

CREATE TABLE IF NOT EXISTS slack_refs (
  mr_url     TEXT PRIMARY KEY,
  ref        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  ns         TEXT NOT NULL,
  k          TEXT NOT NULL,
  v          TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ns, k)
);
`;

type Migration = (db: Database) => void;
const MIGRATIONS: Migration[] = [db => db.exec(V1_SCHEMA)];

function runMigrations(db: Database): void {
  db.exec(`PRAGMA busy_timeout = ${MIGRATION_BUSY_TIMEOUT_MS}`);
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let i = v; i < MIGRATIONS.length; i++) MIGRATIONS[i]!(db);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function openAt(path: string, flavor: DbFlavor): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA busy_timeout = ${MIGRATION_BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  runMigrations(db);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS[flavor]}`);
  return db;
}

export function openStateDb(path: string, flavor: DbFlavor = 'cli'): Database {
  try {
    return openAt(path, flavor);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/SQLITE_CORRUPT|SQLITE_NOTADB|file is not a database/i.test(msg)) throw err;
    const quarantine = `${path}.corrupt-${new Date().toISOString().slice(0, 10)}`;
    renameSync(path, quarantine);
    console.error(`state.db unopenable, quarantined to ${quarantine}: ${msg}`);
    return openAt(path, flavor);
  }
}

let singleton: Database | null = null;
export function getStateDb(flavor: DbFlavor = 'cli'): Database {
  if (!singleton) singleton = openStateDb(stateDbPath(), flavor);
  return singleton;
}
export function closeStateDb(): void {
  singleton?.close();
  singleton = null;
}
```

`kv-blob.ts`:

```ts
import { Database } from 'bun:sqlite';
import { getStateDb } from './db.ts';

export function getKvValue<T>(ns: string, key: string, fallback: T, db: Database = getStateDb()): T {
  const row = db.query('SELECT v FROM kv WHERE ns = ? AND k = ?').get(ns, key) as { v: string } | null;
  if (!row) return fallback;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return fallback;
  }
}

export function setKvValue(ns: string, key: string, value: unknown, db: Database = getStateDb()): void {
  db.query(
    `INSERT INTO kv (ns, k, v, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ns, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
  ).run(ns, key, JSON.stringify(value), Date.now());
}

export function deleteKvValue(ns: string, key: string, db: Database = getStateDb()): void {
  db.query('DELETE FROM kv WHERE ns = ? AND k = ?').run(ns, key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/board/src/__tests__/state-db.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/state/db.ts apps/board/src/state/kv-blob.ts apps/board/src/__tests__/state-db.test.ts
git commit -m "board: state.db core, v1 schema, kv blob accessors"
```

---

### Task 2: agent-states store and the three lane adapters

**Files:**
- Create: `apps/board/src/state/agent-states.ts`
- Modify: `apps/board/src/review-state.ts` (gut file IO, keep every exported name)
- Modify: `apps/board/src/respond-state.ts` (same)
- Modify: `apps/board/src/doctor-state.ts` (same)
- Test: `apps/board/src/__tests__/agent-states.test.ts`
- Modify: `apps/board/src/__tests__/review-state.test.ts`, `respond-state.test.ts`, `doctor-state.test.ts`, `review-status.test.ts`, `respond-status.test.ts` (all exercise the same file IO; retarget each to a temp db via `openStateDb`)

**Interfaces:**
- Consumes: Task 1's `getStateDb`, `openStateDb`, `boardStateRoot`.
- Produces (in `agent-states.ts`):
  - `type Lane = 'review' | 'respond' | 'doctor'`
  - `mintHandle(lane: Lane, mrUrl: string, root?: string): string` (`<root>/state/<lane>s/<slug>.json`, slug logic moved verbatim from `reviewFilePath`)
  - `insertAgentState(lane: Lane, mrUrl: string, iid: number, state: object, handle: string, db?): void` (upsert on (lane, mr_url); refreshes handle)
  - `updateByHandle(handle: string, patch: object, now: number, db?): object | null` (read-merge-write in one transaction; null when no row exists: callers treat that as a loud error, never a fresh row)
  - `updateByMr(lane: Lane, mrUrl: string, patch: object, now: number, db?): object | null`
  - `readStates(lane: Lane, db?): Map<string, object>` (keyed mrUrl; each state gets `reportReady: report IS NOT NULL` stamped at read)
  - `readReport(lane: Lane, mrUrl: string, db?): string | null`
  - `setReportByHandle(handle: string, text: string, db?): boolean`
  - `pruneStates(lane: Lane, keepUrls: ReadonlySet<string>, db?): void` (also best-effort unlinks each removed row's handle-sibling `.md` scratch file, so pane report handoffs never accumulate)
- The lane adapters keep their existing exported names as thin wrappers, e.g. `readReviewStates()` returns `readStates('review')` cast to `Map<string, ReviewState>`; `writeReviewState(handle, patch, now?)` first tries `updateByHandle`, and when no row exists it requires `patch.mrUrl` and `patch.iid` to insert, else throws `Error('review state write with no prior row and no identity: <handle>')`. `reviewFilePath(mrUrl)` returns `mintHandle('review', mrUrl)`. `reviewReportPath(handle)` keeps returning the sibling `.md` path (still the scratch handoff a pane writes). `readReviewReport(mrUrl)` reads the db. Prune functions delegate to `pruneStates`.
- `respond-state.ts` and `doctor-state.ts` mirror this exactly for their own state types and helper exports (`attachResponds`, `attachDoctors`, `respondOutcome` and friends are pure and unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// apps/board/src/__tests__/agent-states.test.ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStateDb } from '../state/db.ts';
import {
  insertAgentState, mintHandle, pruneStates, readReport, readStates,
  setReportByHandle, updateByHandle,
} from '../state/agent-states.ts';

const URL = 'https://gitlab.example.com/g/p/-/merge_requests/7';

function db() {
  return openStateDb(join(mkdtempSync(join(tmpdir(), 'board-as-')), 'state.db'));
}

describe('agent states', () => {
  test('insert then update by handle merges fields', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState('review', URL, 7, { mrUrl: URL, iid: 7, status: 'queued', startedAt: 1, updatedAt: 1 }, h, d);
    const merged = updateByHandle(h, { status: 'done', outcome: 'comment' }, 2, d) as { status: string; outcome: string; mrUrl: string };
    expect(merged.status).toBe('done');
    expect(merged.mrUrl).toBe(URL);
    expect(readStates('review', d).get(URL)).toMatchObject({ status: 'done', outcome: 'comment', reportReady: false });
  });

  test('update by unknown handle returns null, writes nothing', () => {
    const d = db();
    expect(updateByHandle('/nope/state/reviews/x.json', { status: 'done' }, 2, d)).toBeNull();
    expect(readStates('review', d).size).toBe(0);
  });

  test('report ingestion flips reportReady', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState('review', URL, 7, { mrUrl: URL, iid: 7, status: 'reviewing', startedAt: 1, updatedAt: 1 }, h, d);
    expect(setReportByHandle(h, '# report', d)).toBe(true);
    expect(readStates('review', d).get(URL)).toMatchObject({ reportReady: true });
    expect(readReport('review', URL, d)).toBe('# report');
  });

  test('prune keeps only listed urls', () => {
    const d = db();
    insertAgentState('review', URL, 7, { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 }, mintHandle('review', URL, '/r'), d);
    pruneStates('review', new Set<string>(), d);
    expect(readStates('review', d).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/board/src/__tests__/agent-states.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `agent-states.ts`, then rewire the three adapters**

Core of `agent-states.ts` (write complete; the slug function moves verbatim from today's `reviewFilePath`):

```ts
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { boardStateRoot, getStateDb } from './db.ts';

export type Lane = 'review' | 'respond' | 'doctor';
const LANE_DIR: Record<Lane, string> = { review: 'reviews', respond: 'responds', doctor: 'doctors' };

function slug(mrUrl: string): string {
  return mrUrl.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
}

export function mintHandle(lane: Lane, mrUrl: string, root: string = boardStateRoot()): string {
  return join(root, 'state', LANE_DIR[lane], `${slug(mrUrl)}.json`);
}

export function insertAgentState(
  lane: Lane, mrUrl: string, iid: number, state: object, handle: string,
  db: Database = getStateDb()
): void {
  const full = { mrUrl, iid, ...state };
  db.query(
    `INSERT INTO agent_states (lane, mr_url, state, handle, report, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(lane, mr_url) DO UPDATE SET
       state = excluded.state, handle = excluded.handle, report = NULL,
       updated_at = excluded.updated_at`
  ).run(lane, mrUrl, JSON.stringify(full), handle, Date.now());
}

export function updateByHandle(
  handle: string, patch: object, now: number, db: Database = getStateDb()
): object | null {
  const tx = db.transaction(() => {
    const row = db.query('SELECT lane, mr_url, state FROM agent_states WHERE handle = ?')
      .get(handle) as { lane: string; mr_url: string; state: string } | null;
    if (!row) return null;
    const merged = { ...JSON.parse(row.state), ...definedFields(patch), updatedAt: now };
    db.query('UPDATE agent_states SET state = ?, updated_at = ? WHERE lane = ? AND mr_url = ?')
      .run(JSON.stringify(merged), now, row.lane, row.mr_url);
    return merged;
  });
  return tx() as object | null;
}

function definedFields(patch: object): object {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
}
```

`updateByMr`, `readStates` (stamping `reportReady`), `readReport`, `setReportByHandle`, `pruneStates` follow the same one-statement shapes. Then rewire the adapters, keeping exported names; delete the fs imports and dir constants they no longer need (keep `REVIEW_DIR` etc. only if the legacy import in Task 6 wants the names; it does not... it re-derives legacy paths itself, so delete them and fix any imports).

- [ ] **Step 4: Run tests, migrate the existing suite**

Run: `bun test apps/board/src/__tests__/agent-states.test.ts apps/board/src/__tests__/review-state.test.ts`
Retarget `review-state.test.ts` cases to use `openStateDb` on a temp path via a test seam: adapters accept an optional trailing `db` parameter defaulting to `getStateDb()`. The prune tests keep their keep-set semantics.
Expected: PASS.

- [ ] **Step 5: Fix compile fallout in server/triage callers**

Run: `bun run board:typecheck`
Call sites that passed directories (`readReviewStates(dir)`) now pass nothing or a db; launch-time initial writes now call `insertAgentState` semantics through the adapters (`writeReviewState(reviewFilePath(mrUrl), { mrUrl, iid, status: 'queued', ... })`). Fix until clean.

- [ ] **Step 6: Commit**

```bash
git add -A apps/board
git commit -m "board: agent_states store; review/respond/doctor state moves to db"
```

---

### Task 3: claim-ticket CLIs

**Files:**
- Modify: `apps/board/bin/review-status.ts`
- Modify: `apps/board/bin/respond-status.ts`
- Modify: `apps/board/bin/doctor-status.ts`
- Modify: `apps/board/src/gates/verbs.ts` (the gate CLI's actual state IO: `readGateVerbState`'s `readFileSync` becomes `readByHandle`; its gate-id writes already flow through `writeReviewState`/`writeRespondState`/`writeDoctorState`, which Task 2 rewired)
- Modify: `apps/board/bin/gate.ts` (only argv plumbing; the IO lives in verbs.ts)
- Modify: `apps/board/src/agent-status/emit.ts` (no behavior change; confirm `boardRootFromStatePath` still feeds `appRoot`)
- Modify: `apps/board/src/server.ts:3002` (the feed's `appRoot: APP_ROOT` becomes `appRoot: boardStateRoot()`; post-cutover panes emit `boardStateRoot()`-derived roots, and a checkout server comparing against APP_ROOT would silently drop every one of its own panes' events)
- Test: `apps/board/src/__tests__/status-bin.test.ts` (extend), `apps/board/src/__tests__/gates-verbs.test.ts` (retarget from state files to db rows)

**Interfaces:**
- Consumes: Task 2's `updateByHandle`, `setReportByHandle`, Task 1's `dbPathForRoot`, `openStateDb`; existing `boardRootFromStatePath`.
- Produces: the CLI behavior later tasks and the wrappers rely on:
  - `<status-bin> review-status <handle> <status> [message] [--outcome ...] [--session ...]` resolves its db as `openStateDb(dbPathForRoot(boardRootFromStatePath(handle)), 'cli')`, updates by handle, and EXITS 1 with `no state row for <handle>; was this pane launched by a board on this machine?` when no row matches.
  - On a `done` write, if the sibling report file (`handle` with `.md` for review/respond) exists, its text is stored via `setReportByHandle` after the status update.
  - The agent-status emit still receives `boardRootFromStatePath(handle)` as `appRoot`, and the signal's `mrUrl`/`iid` now come from the merged row, so an emit can never carry an empty mrUrl.

- [ ] **Step 1: Extend the failing test**

Add to `status-bin.test.ts`. Its existing cases hand the CLI a shallow `<tmp>/review.json` path; after the rewire the root derivation lands two levels up and no row exists, so rearrange them onto `<root>/state/reviews/<slug>.json` depth with rows inserted first. Then add:

```ts
test('review-status writes the db row by handle and ingests the report on done', async () => {
  // arrange: temp root; openStateDb(dbPathForRoot(root)); insertAgentState('review', URL, 7, {...queued}, mintHandle('review', URL, root))
  // write `${handle.replace(/\.json$/, '')}.md` with '# report'
  // act: run bin/review-status.ts `<handle> done reviewed --outcome comment`
  // assert exit 0; readStates('review', db) has status done, outcome comment, reportReady true
});

test('review-status exits 1 loudly on an unknown handle', async () => {
  // act: run with a handle under the temp root that has no row
  // assert exit code 1 and stderr containing 'no state row for'
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `bun test apps/board/src/__tests__/status-bin.test.ts`
Expected: the two new cases FAIL (CLI still writes files).

- [ ] **Step 3: Rewire the four CLIs**

In `review-status.ts`, replace the `writeReviewState` call with:

```ts
import { boardRootFromStatePath } from '../src/agent-status/emit.ts';
import { dbPathForRoot, openStateDb } from '../src/state/db.ts';
import { setReportByHandle, updateByHandle } from '../src/state/agent-states.ts';

const db = openStateDb(dbPathForRoot(boardRootFromStatePath(parsed.path)), 'cli');
const merged = updateByHandle(
  parsed.path,
  {
    status,
    ...(parsed.message ? { message: parsed.message } : {}),
    ...(outcome ? { outcome } : {}),
    ...(sessionId ? { sessionId } : {}),
  },
  Date.now(),
  db
) as (ReviewState & { mrUrl: string; iid: number }) | null;
if (!merged) {
  console.error(`no state row for ${parsed.path}; was this pane launched by a board on this machine?`);
  process.exit(1);
}
if (status === 'done') {
  const reportPath = parsed.path.replace(/\.json$/, '') + '.md';
  try {
    setReportByHandle(parsed.path, await Bun.file(reportPath).text(), db);
  } catch {}
}
```

The emit call keeps its shape: `emitAgentStatus({ mrUrl: merged.mrUrl, iid: merged.iid, ... }, boardRootFromStatePath(parsed.path))`. Mirror the same rewire in `respond-status.ts` and `doctor-status.ts` (doctor has no report file; skip ingestion there). `gate.ts` swaps its state-file read for `updateByHandle`-family reads: add `readByHandle(handle, db?): object | null` to `agent-states.ts` (one SELECT) and use it for `gateId`/`gateKind`, and its gate-id writes go through `updateByHandle`.

- [ ] **Step 4: Run the suite**

Run: `bun test apps/board/src/__tests__/status-bin.test.ts && bun run board:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/board
git commit -m "board: status CLIs resolve db rows by claim-ticket handle"
```

---

### Task 4: launcher-side inserts

**Files:**
- Modify: `apps/board/src/server.ts` (review and respond launch paths: write the initial `queued` row via the adapters before `rt agent start`, with handles minted by `mintHandle`)
- Modify: `apps/board/src/review-launch.ts`, `apps/board/src/respond-launch.ts` if the initial write lives there (follow where `writeReviewState(...status: 'queued'...)` happens today and keep it there)
- Modify: `apps/board/bin/triage.ts` and `apps/board/src/triage/run.ts` (doctor dispatch initial write; `doctorFilePath` now mints handles)
- Test: existing launch tests (`review-launch`, `triage-run`) retargeted to temp dbs

**Interfaces:**
- Consumes: Task 2's adapters (which already perform insert-with-identity when given `mrUrl` + `iid`).
- Produces: every `--state` argument handed to a pane is a `mintHandle` product under the launching board's `boardStateRoot()`, and a row exists before the pane starts.

- [ ] **Step 1: Find every initial-state write and pane launch**

Run: `grep -rn "status: 'queued'\|reviewFilePath\|respondFilePath\|doctorFilePath" apps/board/src apps/board/bin --include="*.ts" | grep -v __tests__`
List each call site; each must (a) mint the handle via the adapter, (b) write the initial row with full identity, (c) pass that same handle as `--state`.

- [ ] **Step 2: Retarget tests, watch them fail**

The launch tests assert state files appear; retarget them to assert rows via `readStates(lane, db)`.
Run: `bun test apps/board/src/__tests__/review-launch.test.ts apps/board/src/__tests__/triage-run.test.ts`
Expected: FAIL before the rewire, PASS after Step 3.

- [ ] **Step 3: Rewire the call sites, run the full gate**

Run: `bun run board:test && bun run board:typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A apps/board
git commit -m "board: launchers insert claim-ticket rows before pane start"
```

---

### Task 5: supporting stores (drafts, nudges, nudges_sent, outbox, slack_refs, slack indexes, triage memory, cursor, cron claim)

**Files:**
- Modify: `apps/board/src/draft-state.ts`, `apps/board/src/peer/nudges.ts`, `apps/board/src/peer/outbox.ts`, `apps/board/src/slack.ts`, `apps/board/src/triage/memory.ts`
- Modify: `apps/board/src/triage/audit.ts` (`AUDIT_PATH` moves to `join(boardStateRoot(), 'logs', 'doctor-audit.jsonl')`, still JSONL)
- Modify: `apps/board/src/server.ts` (agent-status cursor file becomes `kv` ns `agent-status`, key `cursor`)
- Test: each module's existing test file retargeted; new cases for the cron claim

**Interfaces:**
- Consumes: Task 1's kv accessors and db seams.
- Produces:
  - Each module keeps its exported names; the `dir`/`path` defaulted parameters become optional `db: Database = getStateDb()` parameters (tests pass temp dbs).
  - Rows store the whole object as JSON in the table's blob column (`draft`, `nudge`, `entry`, `ref`), exactly the object the module's interface already defines; keys per the schema in Task 1.
  - `outbox`: `enqueueOutbox` INSERTs with `INSERT OR IGNORE` (the UNIQUE envelope_id index preserves today's dedupe-by-id); `drainOutbox`'s reader consumes in `id` order and DELETEs on success; INSERT/DELETE go through `runCriticalWrite` since a dropped queue write loses a peer message. Lifecycle inserts/updates in Tasks 2-4 use `runCriticalWrite` too; slack refs, indexes, and the cursor use `persistOrWarn`.
  - `triage/memory.ts`: `readMemory`/`writeMemory` become kv blob reads/writes (ns `triage`, key `memory`); `writeRefreshedIdentity` becomes a transaction (fresh read + field write). `tryAcquireMemoryLock`/`releaseMemoryLock` are replaced by `tryClaimCron(now, db?): string | false` and `releaseCron(token, db?)` over kv ns `triage`, key `cron-claim` storing `{ token, at }`: a claim younger than 2 minutes refuses, an older one is reclaimed; release deletes only its own token. `bin/triage.ts` swaps to these names.
  - `slack.ts`: `writeSlackRef`/`readSlackRefs` use `slack_refs`; `readIndex(channelName)`/`writeIndex(channelName, ...)` use kv ns `slack-index`, key = the channel NAME slug exactly as `slackIndexPath` slugs it today (the files are `state/slack-index-<name-slug>.json`; nothing is keyed by channel id); `adoptLegacyIndex` is deleted, and the pre-tabs single `state/slack-index.json` cache is deliberately dropped rather than imported (it is a cache; one channel resync rebuilds it).

- [ ] **Step 1: Retarget each module's tests, add the cron-claim cases**

New cases in the memory test file:

```ts
test('cron claim refuses a live holder and reclaims a stale one', () => {
  const d = db();
  const t1 = tryClaimCron(1_000, d);
  expect(t1).not.toBe(false);
  expect(tryClaimCron(2_000, d)).toBe(false);
  expect(tryClaimCron(1_000 + 3 * 60_000, d)).not.toBe(false);
});
test('release only deletes its own token', () => {
  const d = db();
  const t1 = tryClaimCron(1_000, d) as string;
  const t2 = tryClaimCron(1_000 + 3 * 60_000, d) as string;
  releaseCron(t1, d);
  expect(tryClaimCron(1_000 + 3 * 60_000 + 1, d)).toBe(false);
  releaseCron(t2, d);
});
```

- [ ] **Step 2: Run to verify failures, then implement module by module**

Run after each module: its own test file; after all: `bun run board:test && bun run board:typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A apps/board
git commit -m "board: drafts, nudges, outbox, slack, triage memory and cursor move to db"
```

---

### Task 6: one-shot legacy import

**Files:**
- Create: `apps/board/src/state/legacy-import.ts`
- Modify: `apps/board/src/state/db.ts` (call the import after migrations when the kv marker is absent)
- Test: `apps/board/src/__tests__/legacy-import.test.ts`

**Interfaces:**
- Consumes: every Task 1/2/5 store writer; `boardStateRoot()`.
- Produces: `importLegacyState(db: Database, roots: string[]): { imported: number, skipped: number }`, invoked ONLY from `getStateDb()` (the real-path singleton) after `runMigrations`, when `getKvValue('meta', 'legacy-import-done', false, db)` is false, with roots = dedup of `[APP_ROOT, boardStateRoot()]`. `openStateDb` never imports: tests hand `importLegacyState` their own fixture roots explicitly, and temp dbs never touch live trees.

- [ ] **Step 1: Write the failing test**

Build a fixture legacy tree in a temp dir:

```
<root>/state/reviews/<slug>.json     ({ mrUrl, iid, status: 'done', outcome: 'comment', startedAt, updatedAt: 100 })
<root>/state/reviews/<slug>.md       ('# report')
<root>/state/responds/<slug>.json
<root>/state/doctors/<slug>.json
<root>/state/drafts/<file>.json
<root>/state/nudges/<id>.json
<root>/state/nudges-sent/<slug>.json
<root>/state/outbox/<id>.json
<root>/state/slack/<slug>.json
<root>/state/auto-dispatch.json
<root>/state/agent-status-cursor    (raw string)
<root>/state/slack-index-<channel-name-slug>.json
```

Cases:
- every surface lands in its table/kv slot; the review's `.md` lands in `report`; handles follow the in-flight rule below
- two roots offering the same key: newest `updatedAt` wins
- identity-less legacy files (`mrUrl: ""`) are skipped, counted in `skipped`
- after import the legacy `state/` dir is renamed `state.imported-<YYYY-MM-DD>` and the kv marker is set; a second `openStateDb` run imports nothing

In-flight panes hold legacy `--state` paths, and the spec promises their next write lands in the db. The handle rule that delivers it: an imported lifecycle row keeps the LEGACY path as its handle when the row came from a root whose `dbPathForRoot(root)` equals the db being imported into (the pane's derivation then finds this db and this row), and gets a freshly minted handle otherwise. Test both branches, and drop the re-minted claim in the first bullet above in favor of this rule.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/board/src/__tests__/legacy-import.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the import**

Synchronous, inside one transaction after migrations. Per surface: readdir, JSON.parse with try/catch (corrupt file = skip + count), upsert keyed as in Task 1's schema with newest-updatedAt conflict resolution (`ON CONFLICT ... WHERE excluded.updated_at > updated_at` shape, or read-compare-write inside the transaction). Rename each imported root's `state/` dir afterwards; set the marker last.

- [ ] **Step 4: Run the full gate**

Run: `bun run board:test && bun run board:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/board
git commit -m "board: one-shot legacy JSON import into state.db"
```

---

### Task 7: sweep the stragglers and gate the pattern

**Files:**
- Modify: `apps/board/src/server.ts` (db flavor `server` at boot; prune sweeps already store-backed; the `GATE_DIR` boot cleanup is DELETED along with the `GATE_DIR` constant in `src/gates/store.ts`, since Task 6's rename of the whole legacy `state/` dir subsumes it and the purity guard forbids the pattern)
- Modify: `apps/board/src/app-root.ts` (doc comment: APP_ROOT owns config.json and .env only)
- Modify: `apps/board/AGENTS.md` or `apps/board/README.md` state sections to describe `~/.mattstack/board/state.db`, `BOARD_STATE_DB`, and the claim ticket
- Test: `apps/board/src/__tests__/state-purity.test.ts` (new)

**Interfaces:**
- Consumes: everything prior.
- Produces: a source-guard test in the vein of rt's rt-paths guard.

- [ ] **Step 1: Write the source guard**

```ts
// apps/board/src/__tests__/state-purity.test.ts
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['src', 'bin'];
const ALLOWED = new Set(['src/state/db.ts', 'src/state/legacy-import.ts', 'src/state/agent-states.ts']);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

describe('state purity', () => {
  test("no module outside src/state joins a 'state' path under APP_ROOT", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(import.meta.dir, '..', '..', root).replace('/src/__tests__/../..', ''))) {
        const rel = file.split('/apps/board/')[1]!;
        if (ALLOWED.has(rel) || rel.includes('__tests__')) continue;
        const src = readFileSync(file, 'utf8');
        if (/join\(APP_ROOT,\s*'state'/.test(src)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

(Adjust the path plumbing so the walker actually roots at `apps/board`; the assertion is the deliverable.)

- [ ] **Step 2: Run it, fix every offender it finds**

Run: `bun test apps/board/src/__tests__/state-purity.test.ts`
Expected: initially FAIL listing any module still deriving state paths from APP_ROOT; fix each by moving it onto the Task 1/2/5 stores; then PASS.

- [ ] **Step 3: Full gate, then commit**

Run: `bun run board:test && bun run board:typecheck && bun run board:build`
Expected: PASS.

```bash
git add -A apps/board
git commit -m "board: state purity guard, docs, APP_ROOT reduced to config"
```

---

### Task 8: live cutover verification (manual, with Matt)

Not a code task. Before merging: run the server from the branch against the real machine (`bun run board:dev` or the deck-registered entry), confirm the import banner in logs, confirm `~/.mattstack/board/state.db` holds the four live MRs' review states, resolve nothing on GitLab, and confirm one triage tick's audit line lands at the new log path. This is the point to double-check the in-flight-pane handle rule from Task 6 against any pane still running.
