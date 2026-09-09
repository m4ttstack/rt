import { Database } from 'bun:sqlite';
import { mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

import { APP_ROOT } from '../app-root.ts';
import { getKvValue } from './kv-blob.ts';
import { importLegacyState } from './legacy-import.ts';

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
  if (!singleton) {
    singleton = openStateDb(stateDbPath(), flavor);
    if (!getKvValue('meta', 'legacy-import-done', false, singleton)) {
      importLegacyState(singleton, [...new Set([APP_ROOT, boardStateRoot()])]);
    }
  }
  return singleton;
}
export function closeStateDb(): void {
  singleton?.close();
  singleton = null;
}
