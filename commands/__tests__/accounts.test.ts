import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach } from "bun:test";
import { formatAccountsJson } from "../accounts.ts";
import { writeCredentialHealth } from "../../lib/credential-health/db.ts";

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

describe("formatAccountsJson", () => {
  test("returns empty array when no rows", () => {
    const result = formatAccountsJson(db);
    expect(result).toEqual({ ok: true, accounts: [] });
  });

  test("returns all rows with correct shape", () => {
    writeCredentialHealth(db, {
      integration: "github", status: "ready", detail: "ok",
      expiresAt: "2026-12-01", checkedAt: 1000,
      lastNotifiedAt: null, lastNotifiedKind: null,
    });
    writeCredentialHealth(db, {
      integration: "gitlab", status: "invalid", detail: "401",
      expiresAt: null, checkedAt: 2000,
      lastNotifiedAt: 2000, lastNotifiedKind: "dead",
    });
    const result = formatAccountsJson(db);
    expect(result.ok).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({
      integration: "github",
      status: "ready",
      expiresAt: "2026-12-01",
    });
    expect(result.accounts[1]).toMatchObject({
      integration: "gitlab",
      status: "invalid",
    });
  });
});
