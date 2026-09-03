/** Bump whenever the DDL below changes; db.ts drops and recreates every table on mismatch. */
export const SCHEMA_VERSION = 2;

export const TABLES = [
  "mr_index",
  "scan_meta",
  "mr_metrics",
  "pipelines",
  "push_events",
  "linear_issues",
  "linear_ids",
  "identities",
] as const;

export const DDL = `
CREATE TABLE IF NOT EXISTS mr_index (
  key TEXT PRIMARY KEY, project_path TEXT NOT NULL, iid INTEGER NOT NULL,
  title TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, merged_at TEXT, author_username TEXT,
  source_branch TEXT, labels TEXT NOT NULL, scanned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mr_index_updated ON mr_index (updated_at);
CREATE INDEX IF NOT EXISTS mr_index_merged ON mr_index (merged_at);
CREATE TABLE IF NOT EXISTS scan_meta (project_path TEXT PRIMARY KEY, last_scan TEXT NOT NULL, first_scan TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mr_metrics (key TEXT PRIMARY KEY, project_path TEXT NOT NULL, iid INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pipelines (key TEXT PRIMARY KEY, project_path TEXT NOT NULL, username TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pipelines_created ON pipelines (created_at);
CREATE TABLE IF NOT EXISTS push_events (key TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT NOT NULL, repository_id TEXT);
CREATE INDEX IF NOT EXISTS push_events_created ON push_events (created_at);
CREATE TABLE IF NOT EXISTS linear_issues (identifier TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS linear_ids (id TEXT PRIMARY KEY, valid INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities (username TEXT PRIMARY KEY, name TEXT, resolved INTEGER NOT NULL, user_id INTEGER, fetched_at TEXT NOT NULL);
`;
