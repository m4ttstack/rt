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
