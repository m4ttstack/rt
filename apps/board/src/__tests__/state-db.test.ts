import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import {
  boardStateRoot,
  closeStateDb,
  getStateDb,
  openStateDb,
  SCHEMA_VERSION,
  SchemaTooNewError,
  stateDbPath,
} from '../state/db.ts';
import { getKvValue, setKvValue } from '../state/kv-blob.ts';

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'board-statedb-')), 'state.db');
}

describe('state db', () => {
  test('open migrates to SCHEMA_VERSION with all v1 tables', () => {
    const db = openStateDb(tempDbPath());
    const version = (
      db.query('PRAGMA user_version').get() as { user_version: number }
    ).user_version;
    expect(version).toBe(SCHEMA_VERSION);
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map(r => r.name);
    for (const t of [
      'agent_states',
      'drafts',
      'nudges',
      'nudges_sent',
      'outbox',
      'slack_refs',
      'kv',
    ]) {
      expect(tables).toContain(t);
    }
  });

  test('re-open replays migrations idempotently', () => {
    const path = tempDbPath();
    openStateDb(path).close();
    const db = openStateDb(path);
    expect(
      (db.query('PRAGMA user_version').get() as { user_version: number })
        .user_version
    ).toBe(SCHEMA_VERSION);
  });

  test('unopenable db is quarantined and recreated, sidecars renamed alongside', () => {
    const path = tempDbPath();
    writeFileSync(path, 'this is not a sqlite database, definitely');
    writeFileSync(path + '-wal', 'stale wal pages');
    writeFileSync(path + '-shm', 'stale shm');
    const db = openStateDb(path);
    expect(
      (db.query('PRAGMA user_version').get() as { user_version: number })
        .user_version
    ).toBe(SCHEMA_VERSION);
    const quarantine = `${path}.corrupt-${new Date().toISOString().slice(0, 10)}`;
    expect(existsSync(quarantine)).toBe(true);
    expect(existsSync(quarantine + '-wal')).toBe(true);
    expect(existsSync(quarantine + '-shm')).toBe(true);
  });

  test('a future schema version is rejected, not quarantined', () => {
    const path = tempDbPath();
    const db = openStateDb(path);
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();

    expect(() => openStateDb(path)).toThrow(SchemaTooNewError);
    // A future-schema db is not corrupt: it must still be the same file,
    // never renamed aside and replaced the way a genuinely unopenable db is.
    // Inspect the raw file directly (not via openStateDb, which would just
    // throw again) to confirm nothing quarantined or recreated it.
    expect(existsSync(path)).toBe(true);
    const raw = new Database(path);
    expect(
      (raw.query('PRAGMA user_version').get() as { user_version: number })
        .user_version
    ).toBe(SCHEMA_VERSION + 1);
    raw.close();
  });

  test('kv round-trips and falls back', () => {
    const db = openStateDb(tempDbPath());
    expect(getKvValue('t', 'missing', 'fallback', db)).toBe('fallback');
    setKvValue('t', 'k', { a: 1 }, db);
    expect(getKvValue<{ a: number } | null>('t', 'k', null, db)).toEqual({
      a: 1,
    });
  });
});

describe('BOARD_STATE_DB basename validation', () => {
  test('a basename other than state.db fails fast instead of silently splitting the server and CLI dbs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-statedb-badname-'));
    const prevStateDb = process.env.BOARD_STATE_DB;
    process.env.BOARD_STATE_DB = join(dir, 'other.db');
    closeStateDb();
    try {
      expect(() => boardStateRoot()).toThrow(/state\.db/);
      expect(() => stateDbPath()).toThrow(/state\.db/);
      expect(() => getStateDb()).toThrow(/state\.db/);
    } finally {
      closeStateDb();
      if (prevStateDb === undefined) delete process.env.BOARD_STATE_DB;
      else process.env.BOARD_STATE_DB = prevStateDb;
    }
  });
});

describe('BOARD_FIXTURE skips the legacy import', () => {
  test('a legacy state/ tree under the fixture root is left untouched, not renamed or read', () => {
    const root = mkdtempSync(join(tmpdir(), 'board-statedb-fixture-'));
    mkdirSync(join(root, 'state', 'reviews'), { recursive: true });
    writeFileSync(
      join(root, 'state', 'reviews', 'mr-1.json'),
      JSON.stringify({
        mrUrl: 'https://x/mr/1',
        iid: 1,
        status: 'done',
        startedAt: 1,
        updatedAt: 1,
      })
    );

    const prevStateDb = process.env.BOARD_STATE_DB;
    const prevFixture = process.env.BOARD_FIXTURE;
    process.env.BOARD_STATE_DB = join(root, 'state.db');
    process.env.BOARD_FIXTURE = root;
    closeStateDb();
    try {
      const db = getStateDb();
      expect(db.query('SELECT * FROM agent_states').all().length).toBe(0);
      expect(existsSync(join(root, 'state', 'reviews', 'mr-1.json'))).toBe(
        true
      );
      expect(getKvValue('meta', 'legacy-import-done', false, db)).toBe(false);
    } finally {
      closeStateDb();
      if (prevStateDb === undefined) delete process.env.BOARD_STATE_DB;
      else process.env.BOARD_STATE_DB = prevStateDb;
      if (prevFixture === undefined) delete process.env.BOARD_FIXTURE;
      else process.env.BOARD_FIXTURE = prevFixture;
    }
  });
});
