import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "bun:sqlite";
import { DDL, SCHEMA_VERSION, TABLES } from "./schema.js";

function dbPath(): string {
  return process.env.BOXSCORE_DB ?? join(process.env.HOME ?? homedir(), ".mattstack", "boxscore", "boxscore.sqlite");
}

/**
 * bun:sqlite is required; unlike server/cache/mr-store.ts there is no in-memory fallback
 * here, so a broken store throws instead of silently masquerading as an empty one.
 */
function loadSqlite(): typeof import("bun:sqlite") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("bun:sqlite") as typeof import("bun:sqlite");
  } catch {
    throw new Error("server/store requires the Bun runtime (bun:sqlite unavailable)");
  }
}

let db: DatabaseType | null = null;

export function getDb(): DatabaseType {
  if (db) return db;

  const { Database } = loadSqlite();
  const path = dbPath();
  mkdirSync(join(path, ".."), { recursive: true });
  const instance = new Database(path);
  instance.exec("PRAGMA journal_mode = WAL");
  instance.exec("PRAGMA synchronous = NORMAL");

  const versionRow = instance.query("PRAGMA user_version").get() as { user_version: number } | null;
  if ((versionRow?.user_version ?? 0) !== SCHEMA_VERSION) {
    for (const table of TABLES) instance.exec(`DROP TABLE IF EXISTS ${table}`);
    instance.exec(DDL);
    instance.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } else {
    instance.exec(DDL);
  }

  db = instance;
  return db;
}

/**
 * For tests: closes the handle so the next getDb() reopens the same file fresh, re-running
 * the PRAGMA user_version check. Does not delete the file -- tests that need an empty table
 * call Store.clear(); this exists so a version-mismatch reopen can be exercised directly.
 */
export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
