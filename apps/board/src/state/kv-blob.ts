import { Database } from 'bun:sqlite';

import { getStateDb } from './db.ts';

export function getKvValue<T>(
  ns: string,
  key: string,
  fallback: T,
  db: Database = getStateDb()
): T {
  const row = db
    .query('SELECT v FROM kv WHERE ns = ? AND k = ?')
    .get(ns, key) as { v: string } | null;
  if (!row) return fallback;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return fallback;
  }
}

export function setKvValue(
  ns: string,
  key: string,
  value: unknown,
  db: Database = getStateDb()
): void {
  db.query(
    `INSERT INTO kv (ns, k, v, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ns, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
  ).run(ns, key, JSON.stringify(value), Date.now());
}

export function deleteKvValue(
  ns: string,
  key: string,
  db: Database = getStateDb()
): void {
  db.query('DELETE FROM kv WHERE ns = ? AND k = ?').run(ns, key);
}

/** Every value in one namespace, keyed by its key, for a store that holds a
    row per subject (see row-note.ts) rather than one blob per key. */
export function listKvValues(
  ns: string,
  db: Database = getStateDb()
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const rows = db.query('SELECT k, v FROM kv WHERE ns = ?').all(ns) as {
    k: string;
    v: string;
  }[];
  for (const row of rows) {
    try {
      out.set(row.k, JSON.parse(row.v));
    } catch {
      // skip unreadable value
    }
  }
  return out;
}
