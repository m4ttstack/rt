import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { NormMr } from "../pipeline/model.js";
import type { RawMrListNode } from "../gitlab/raw-types.js";

const DB_PATH = ".cache/mr-details.sqlite";
const SCHEMA_VERSION = 3;

interface Store {
  // MR details (enriched, permanent)
  has(key: string): boolean;
  get(key: string): NormMr | null;
  put(mrs: readonly NormMr[]): void;
  count(): number;
  // Linear ID validity cache
  isValidLinearId(id: string): boolean | null;
  putLinearIds(entries: readonly { id: string; valid: boolean }[]): void;
  linearIdStats(): { valid: number; invalid: number };
  // MR list cache (lightweight nodes, incremental)
  getMrList(scope: string): RawMrListNode[];
  putMrList(scope: string, nodes: readonly RawMrListNode[]): void;
  getLastScan(scope: string): string | null;
  setLastScan(scope: string, timestamp: string): void;
  mrListCount(): number;
  close(): void;
}

/** Store key for one MR. Exported so callers test membership with the same identity. */
export function mrKey(projectPath: string, iid: number): string {
  return `${projectPath}:${iid}`;
}

function listKey(node: RawMrListNode): string {
  return `${node.project?.fullPath ?? ""}:${node.iid}`;
}

let store: Store | null = null;

function createSqliteStore(): Store {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  mkdirSync(".cache", { recursive: true });
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  const vRow = db.query("PRAGMA user_version").get() as { user_version: number } | null;
  if ((vRow?.user_version ?? 0) !== SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS mr_details");
    db.exec("DROP TABLE IF EXISTS linear_ids");
    db.exec("DROP TABLE IF EXISTS mr_list");
    db.exec("DROP TABLE IF EXISTS mr_list_meta");
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  db.exec("CREATE TABLE IF NOT EXISTS mr_details (key TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS linear_ids (id TEXT PRIMARY KEY, valid INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS mr_list (key TEXT PRIMARY KEY, scope TEXT NOT NULL, data TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS mr_list_meta (scope TEXT PRIMARY KEY, last_scan TEXT NOT NULL)");

  const stmtHas = db.query("SELECT 1 FROM mr_details WHERE key = ?");
  const stmtGet = db.query("SELECT data FROM mr_details WHERE key = ?");
  const stmtPut = db.query("INSERT OR REPLACE INTO mr_details (key, data) VALUES (?, ?)");
  const stmtCount = db.query("SELECT COUNT(*) as c FROM mr_details");

  const stmtLinearGet = db.query("SELECT valid FROM linear_ids WHERE id = ?");
  const stmtLinearPut = db.query("INSERT OR REPLACE INTO linear_ids (id, valid) VALUES (?, ?)");
  const stmtLinearStats = db.query("SELECT valid, COUNT(*) as c FROM linear_ids GROUP BY valid");

  const stmtListGet = db.query("SELECT data FROM mr_list WHERE scope = ?");
  const stmtListPut = db.query("INSERT OR REPLACE INTO mr_list (key, scope, data) VALUES (?, ?, ?)");
  const stmtListCount = db.query("SELECT COUNT(*) as c FROM mr_list");
  const stmtMetaGet = db.query("SELECT last_scan FROM mr_list_meta WHERE scope = ?");
  const stmtMetaPut = db.query("INSERT OR REPLACE INTO mr_list_meta (scope, last_scan) VALUES (?, ?)");

  return {
    has(key) { return !!stmtHas.get(key); },
    get(key) {
      const row = stmtGet.get(key) as { data: string } | null;
      return row ? JSON.parse(row.data) as NormMr : null;
    },
    put(mrs) {
      const tx = db.transaction(() => {
        for (const mr of mrs) stmtPut.run(mrKey(mr.projectPath, mr.iid), JSON.stringify(mr));
      });
      tx();
    },
    count() { return (stmtCount.get() as { c: number }).c; },

    isValidLinearId(id) {
      const row = stmtLinearGet.get(id) as { valid: number } | null;
      return row === null ? null : row.valid === 1;
    },
    putLinearIds(entries) {
      const tx = db.transaction(() => {
        for (const e of entries) stmtLinearPut.run(e.id, e.valid ? 1 : 0);
      });
      tx();
    },
    linearIdStats() {
      const rows = stmtLinearStats.all() as { valid: number; c: number }[];
      let valid = 0, invalid = 0;
      for (const r of rows) { if (r.valid) valid = r.c; else invalid = r.c; }
      return { valid, invalid };
    },

    getMrList(scope) {
      const rows = stmtListGet.all(scope) as { data: string }[];
      return rows.map((r) => JSON.parse(r.data) as RawMrListNode);
    },
    putMrList(scope, nodes) {
      const tx = db.transaction(() => {
        for (const n of nodes) stmtListPut.run(listKey(n), scope, JSON.stringify(n));
      });
      tx();
    },
    getLastScan(scope) {
      const row = stmtMetaGet.get(scope) as { last_scan: string } | null;
      return row?.last_scan ?? null;
    },
    setLastScan(scope, timestamp) { stmtMetaPut.run(scope, timestamp); },
    mrListCount() { return (stmtListCount.get() as { c: number }).c; },

    close() { db.close(); },
  };
}

function createMemoryStore(): Store {
  const map = new Map<string, NormMr>();
  const linearMap = new Map<string, boolean>();
  const listMap = new Map<string, RawMrListNode>();
  const metaMap = new Map<string, string>();
  return {
    has(key) { return map.has(key); },
    get(key) { return map.get(key) ?? null; },
    put(mrs) { for (const mr of mrs) map.set(mrKey(mr.projectPath, mr.iid), mr); },
    count() { return map.size; },
    isValidLinearId(id) { return linearMap.get(id) ?? null; },
    putLinearIds(entries) { for (const e of entries) linearMap.set(e.id, e.valid); },
    linearIdStats() {
      let valid = 0, invalid = 0;
      for (const v of linearMap.values()) { if (v) valid++; else invalid++; }
      return { valid, invalid };
    },
    getMrList() { return [...listMap.values()]; },
    putMrList(_scope, nodes) { for (const n of nodes) listMap.set(listKey(n), n); },
    getLastScan(scope) { return metaMap.get(scope) ?? null; },
    setLastScan(scope, ts) { metaMap.set(scope, ts); },
    mrListCount() { return listMap.size; },
    close() { map.clear(); linearMap.clear(); listMap.clear(); metaMap.clear(); },
  };
}

function getStore(): Store {
  if (store) return store;
  try {
    store = createSqliteStore();
  } catch {
    store = createMemoryStore();
  }
  return store;
}

// --- MR details ---
export async function getCachedMrKeys(mrs: readonly { projectPath: string; iid: number }[]): Promise<Set<string>> {
  const s = getStore();
  const found = new Set<string>();
  for (const mr of mrs) {
    const key = mrKey(mr.projectPath, mr.iid);
    if (s.has(key)) found.add(key);
  }
  return found;
}

export async function getMrByKey(key: string): Promise<NormMr | null> {
  return getStore().get(key);
}

export async function putMrDetails(mrs: readonly NormMr[]): Promise<void> {
  getStore().put(mrs);
}

export async function clearMrStore(): Promise<void> {
  if (store) {
    store.close();
    store = null;
  }
  try {
    await unlink(DB_PATH);
    await unlink(DB_PATH + "-wal").catch(() => {});
    await unlink(DB_PATH + "-shm").catch(() => {});
  } catch {
    // Files didn't exist.
  }
}

export async function mrStoreSize(): Promise<number> {
  return getStore().count();
}

// --- Linear ID validity ---
export function isValidLinearId(id: string): boolean | null {
  return getStore().isValidLinearId(id);
}

export function putLinearIds(entries: readonly { id: string; valid: boolean }[]): void {
  getStore().putLinearIds(entries);
}

export async function linearIdStats(): Promise<{ valid: number; invalid: number }> {
  return getStore().linearIdStats();
}

// --- MR list cache ---
export function getCachedMrList(scope: string): RawMrListNode[] {
  return getStore().getMrList(scope);
}

export function putMrListNodes(scope: string, nodes: readonly RawMrListNode[]): void {
  getStore().putMrList(scope, nodes);
}

export function getLastListScan(scope: string): string | null {
  return getStore().getLastScan(scope);
}

export function setLastListScan(scope: string, timestamp: string): void {
  getStore().setLastScan(scope, timestamp);
}

export async function mrListCacheSize(): Promise<number> {
  return getStore().mrListCount();
}
