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
    expect(getKvValue<{ a: number } | null>('t', 'k', null, db)).toEqual({ a: 1 });
  });
});
