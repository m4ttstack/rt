import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach } from "bun:test";
import {
  readCredentialHealth,
  readAllCredentialHealth,
  writeCredentialHealth,
  type CredentialHealthRow,
} from "../db.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credential_health (
  integration        TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  expires_at         TEXT,
  checked_at         INTEGER NOT NULL,
  last_notified_at   INTEGER,
  last_notified_kind TEXT
);
`;

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
});

describe("readCredentialHealth", () => {
  test("returns null when no row exists", () => {
    expect(readCredentialHealth(db, "github")).toBeNull();
  });

  test("returns the row after a write", () => {
    const row: CredentialHealthRow = {
      integration: "github",
      status: "ready",
      detail: "ok",
      expiresAt: "2026-12-01",
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    };
    writeCredentialHealth(db, row);
    expect(readCredentialHealth(db, "github")).toEqual(row);
  });

  test("upserts on same integration", () => {
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "ok",
      expiresAt: null,
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "invalid",
      detail: "401 Unauthorized",
      expiresAt: null,
      checkedAt: 2000,
      lastNotifiedAt: 2000,
      lastNotifiedKind: "dead",
    });
    const row = readCredentialHealth(db, "gitlab");
    expect(row?.status).toBe("invalid");
    expect(row?.checkedAt).toBe(2000);
  });
});

describe("readAllCredentialHealth", () => {
  test("returns empty array on empty table", () => {
    expect(readAllCredentialHealth(db)).toEqual([]);
  });

  test("returns all rows ordered by integration", () => {
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "ok",
      expiresAt: null,
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "github",
      status: "invalid",
      detail: "expired",
      expiresAt: null,
      checkedAt: 1000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
    const rows = readAllCredentialHealth(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].integration).toBe("github");
    expect(rows[1].integration).toBe("gitlab");
  });
});
