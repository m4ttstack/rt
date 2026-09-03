import { getDb, resetDb } from "./db.js";
import { TABLES } from "./schema.js";

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

/** Store key for one MR, shared by every table that's keyed off (projectPath, iid). */
export function mrKey(projectPath: string, iid: number): string {
  return `${projectPath}:${iid}`;
}

function pipelineKey(projectPath: string, id: string): string {
  return `${projectPath}:${id}`;
}

function pushEventKey(row: StoredPushEvent): string {
  return `${row.username}:${row.createdAt}:${row.repositoryId ?? ""}`;
}

function placeholders(n: number): string {
  return `(${Array(n).fill("?").join(",")})`;
}

interface IndexRowRecord {
  project_path: string;
  iid: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  author_username: string | null;
  source_branch: string | null;
  labels: string;
  scanned_at: string;
}

function toIndexRow(r: IndexRowRecord): IndexRow {
  return {
    projectPath: r.project_path,
    iid: r.iid,
    title: r.title,
    state: r.state as MrState,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    mergedAt: r.merged_at,
    authorUsername: r.author_username,
    sourceBranch: r.source_branch,
    labels: JSON.parse(r.labels) as string[],
    scannedAt: r.scanned_at,
  };
}

function buildStore() {
  const db = getDb();

  const stmtUpsertIndex = db.query(
    `INSERT OR REPLACE INTO mr_index
      (key, project_path, iid, title, state, created_at, updated_at, merged_at, author_username, source_branch, labels, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtIndexUpdatedWithin = db.query(
    "SELECT * FROM mr_index WHERE updated_at >= ? AND updated_at <= ?",
  );
  const stmtAllIndexRows = db.query("SELECT * FROM mr_index");
  const stmtLastScan = db.query("SELECT last_scan FROM scan_meta WHERE project_path = ?");
  const stmtScanFloor = db.query("SELECT first_scan FROM scan_meta WHERE project_path = ?");
  const stmtRecordScan = db.query(
    `INSERT INTO scan_meta (project_path, last_scan, first_scan) VALUES (?, ?, ?)
     ON CONFLICT (project_path) DO UPDATE SET
       last_scan = excluded.last_scan,
       first_scan = MIN(first_scan, excluded.first_scan)`,
  );

  const stmtUpsertMetrics = db.query(
    "INSERT OR REPLACE INTO mr_metrics (key, project_path, iid, data) VALUES (?, ?, ?, ?)",
  );

  const stmtUpsertPipeline = db.query(
    "INSERT OR REPLACE INTO pipelines (key, project_path, username, status, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const stmtPipelinesBetween = db.query(
    "SELECT key, project_path, username, status, created_at FROM pipelines WHERE created_at >= ? AND created_at <= ?",
  );

  const stmtUpsertPushEvent = db.query(
    "INSERT OR REPLACE INTO push_events (key, username, created_at, repository_id) VALUES (?, ?, ?, ?)",
  );
  const stmtPushEventsBetween = db.query(
    "SELECT username, created_at, repository_id FROM push_events WHERE created_at >= ? AND created_at <= ?",
  );

  const stmtUpsertLinearIssue = db.query("INSERT OR REPLACE INTO linear_issues (identifier, data) VALUES (?, ?)");
  const stmtAllLinearIssues = db.query("SELECT data FROM linear_issues");

  const stmtIsValidLinearId = db.query("SELECT valid FROM linear_ids WHERE id = ?");
  const stmtPutLinearId = db.query("INSERT OR REPLACE INTO linear_ids (id, valid) VALUES (?, ?)");
  const stmtLinearIdStats = db.query("SELECT valid, COUNT(*) as c FROM linear_ids GROUP BY valid");

  const stmtUpsertIdentity = db.query(
    "INSERT OR REPLACE INTO identities (username, name, resolved, user_id, fetched_at) VALUES (?, ?, ?, ?, ?)",
  );

  const stmtCountMrIndex = db.query("SELECT COUNT(*) as c FROM mr_index");
  const stmtCountMrMetrics = db.query("SELECT COUNT(*) as c FROM mr_metrics");
  const stmtCountPipelines = db.query("SELECT COUNT(*) as c FROM pipelines");
  const stmtCountPushEvents = db.query("SELECT COUNT(*) as c FROM push_events");
  const stmtCountLinearIssues = db.query("SELECT COUNT(*) as c FROM linear_issues");

  return {
    upsertIndexRows(rows: readonly IndexRow[]): void {
      const tx = db.transaction((batch: readonly IndexRow[]) => {
        for (const r of batch) {
          stmtUpsertIndex.run(
            mrKey(r.projectPath, r.iid),
            r.projectPath,
            r.iid,
            r.title,
            r.state,
            r.createdAt,
            r.updatedAt,
            r.mergedAt,
            r.authorUsername,
            r.sourceBranch,
            JSON.stringify(r.labels),
            r.scannedAt,
          );
        }
      });
      tx(rows);
    },

    indexRowsUpdatedWithin(startIso: string, endIso: string): IndexRow[] {
      return (stmtIndexUpdatedWithin.all(startIso, endIso) as IndexRowRecord[]).map(toIndexRow);
    },

    allIndexRows(): IndexRow[] {
      return (stmtAllIndexRows.all() as IndexRowRecord[]).map(toIndexRow);
    },

    indexRowsByKeys(keys: readonly string[]): IndexRow[] {
      if (keys.length === 0) return [];
      const rows = db
        .query(`SELECT * FROM mr_index WHERE key IN ${placeholders(keys.length)}`)
        .all(...keys) as IndexRowRecord[];
      return rows.map(toIndexRow);
    },

    /** The incremental watermark: when the project's last successful index scan started. */
    lastScan(projectPath: string): string | null {
      const row = stmtLastScan.get(projectPath) as { last_scan: string } | null;
      return row?.last_scan ?? null;
    },
    /** The scan floor: the earliest `updatedAfter` any successful scan of the project has covered. */
    scanFloor(projectPath: string): string | null {
      const row = stmtScanFloor.get(projectPath) as { first_scan: string } | null;
      return row?.first_scan ?? null;
    },
    /** Advance the watermark to `at` and lower the floor to `from` when it reaches further back. */
    recordScan(projectPath: string, scan: { from: string; at: string }): void {
      stmtRecordScan.run(projectPath, scan.at, scan.from);
    },

    upsertMrMetrics(rows: readonly StoredMetrics[]): void {
      const tx = db.transaction((batch: readonly StoredMetrics[]) => {
        for (const r of batch) {
          const { projectPath, iid, ...rest } = r;
          stmtUpsertMetrics.run(mrKey(projectPath, iid), projectPath, iid, JSON.stringify(rest));
        }
      });
      tx(rows);
    },

    mergedMetricsKeys(keys: readonly string[]): Set<string> {
      if (keys.length === 0) return new Set();
      const rows = db
        .query(
          `SELECT mi.key as key FROM mr_index mi
           JOIN mr_metrics mm ON mm.key = mi.key
           WHERE mi.key IN ${placeholders(keys.length)} AND mi.state = 'merged'`,
        )
        .all(...keys) as { key: string }[];
      return new Set(rows.map((r) => r.key));
    },

    metricsByKeys(keys: readonly string[]): StoredMetrics[] {
      if (keys.length === 0) return [];
      const rows = db
        .query(`SELECT project_path, iid, data FROM mr_metrics WHERE key IN ${placeholders(keys.length)}`)
        .all(...keys) as { project_path: string; iid: number; data: string }[];
      return rows.map((r) => ({
        projectPath: r.project_path,
        iid: r.iid,
        ...(JSON.parse(r.data) as Omit<StoredMetrics, "projectPath" | "iid">),
      }));
    },

    upsertPipelines(rows: readonly StoredPipeline[]): void {
      const tx = db.transaction((batch: readonly StoredPipeline[]) => {
        for (const r of batch) {
          stmtUpsertPipeline.run(pipelineKey(r.projectPath, r.id), r.projectPath, r.username, r.status, r.createdAt);
        }
      });
      tx(rows);
    },
    pipelinesBetween(startIso: string, endIso: string): StoredPipeline[] {
      const rows = stmtPipelinesBetween.all(startIso, endIso) as {
        key: string;
        project_path: string;
        username: string | null;
        status: string;
        created_at: string;
      }[];
      // pipelines has no scalar id column (schema.ts DDL); the id is everything in
      // `key` after the "<project_path>:" prefix, which pipelineKey() always writes.
      return rows.map((r) => ({
        id: r.key.slice(r.project_path.length + 1),
        projectPath: r.project_path,
        username: r.username,
        status: r.status,
        createdAt: r.created_at,
      }));
    },

    upsertPushEvents(rows: readonly StoredPushEvent[]): void {
      const tx = db.transaction((batch: readonly StoredPushEvent[]) => {
        for (const r of batch) {
          stmtUpsertPushEvent.run(pushEventKey(r), r.username, r.createdAt, r.repositoryId);
        }
      });
      tx(rows);
    },
    pushEventsBetween(startIso: string, endIso: string): StoredPushEvent[] {
      const rows = stmtPushEventsBetween.all(startIso, endIso) as {
        username: string;
        created_at: string;
        repository_id: string | null;
      }[];
      return rows.map((r) => ({ username: r.username, createdAt: r.created_at, repositoryId: r.repository_id }));
    },

    upsertLinearIssues(rows: readonly StoredLinearIssue[]): void {
      const tx = db.transaction((batch: readonly StoredLinearIssue[]) => {
        for (const r of batch) stmtUpsertLinearIssue.run(r.identifier, JSON.stringify(r));
      });
      tx(rows);
    },
    linearIssuesForMrKeys(keys: readonly string[]): StoredLinearIssue[] {
      const keySet = new Set(keys);
      const rows = stmtAllLinearIssues.all() as { data: string }[];
      const issues = rows.map((r) => JSON.parse(r.data) as StoredLinearIssue);
      return issues.filter((issue) =>
        issue.linkedMrs.some((lm) => keySet.has(mrKey(lm.projectPath, lm.iid))),
      );
    },

    isValidLinearId(id: string): boolean | null {
      const row = stmtIsValidLinearId.get(id) as { valid: number } | null;
      return row === null ? null : row.valid === 1;
    },
    putLinearIds(entries: readonly { id: string; valid: boolean }[]): void {
      const tx = db.transaction((batch: readonly { id: string; valid: boolean }[]) => {
        for (const e of batch) stmtPutLinearId.run(e.id, e.valid ? 1 : 0);
      });
      tx(entries);
    },
    linearIdStats(): { valid: number; invalid: number } {
      const rows = stmtLinearIdStats.all() as { valid: number; c: number }[];
      let valid = 0;
      let invalid = 0;
      for (const r of rows) {
        if (r.valid === 1) valid = r.c;
        else invalid = r.c;
      }
      return { valid, invalid };
    },

    upsertIdentities(rows: readonly StoredIdentity[]): void {
      const tx = db.transaction((batch: readonly StoredIdentity[]) => {
        for (const r of batch) {
          stmtUpsertIdentity.run(r.username, r.name, r.resolved ? 1 : 0, r.userId, r.fetchedAt);
        }
      });
      tx(rows);
    },
    identities(usernames: readonly string[]): StoredIdentity[] {
      if (usernames.length === 0) return [];
      const rows = db
        .query(`SELECT * FROM identities WHERE username IN ${placeholders(usernames.length)}`)
        .all(...usernames) as {
        username: string;
        name: string | null;
        resolved: number;
        user_id: number | null;
        fetched_at: string;
      }[];
      return rows.map((r) => ({
        username: r.username,
        name: r.name,
        resolved: r.resolved === 1,
        userId: r.user_id,
        fetchedAt: r.fetched_at,
      }));
    },

    counts(): { mrIndex: number; mrMetrics: number; pipelines: number; pushEvents: number; linearIssues: number } {
      return {
        mrIndex: (stmtCountMrIndex.get() as { c: number }).c,
        mrMetrics: (stmtCountMrMetrics.get() as { c: number }).c,
        pipelines: (stmtCountPipelines.get() as { c: number }).c,
        pushEvents: (stmtCountPushEvents.get() as { c: number }).c,
        linearIssues: (stmtCountLinearIssues.get() as { c: number }).c,
      };
    },

    clear(): void {
      const tx = db.transaction(() => {
        for (const table of TABLES) db.exec(`DELETE FROM ${table}`);
      });
      tx();
    },

    close(): void {
      resetDb();
    },
  };
}

let store: ReturnType<typeof buildStore> | null = null;

export function getStore(): Store {
  if (!store) store = buildStore();
  return store;
}

/** Test-only: closes the current handle so the next getStore() rebuilds it from scratch. */
export function __resetStore(): void {
  if (store) store.close();
  store = null;
}

export type Store = ReturnType<typeof buildStore>;
