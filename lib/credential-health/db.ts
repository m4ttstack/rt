import type { Database } from "bun:sqlite";

export interface CredentialHealthRow {
  integration: string;
  status: "ready" | "invalid" | "error";
  detail: string;
  expiresAt: string | null;
  checkedAt: number;
  lastNotifiedAt: number | null;
  lastNotifiedKind: "dead" | "expiring" | null;
}

export function readCredentialHealth(
  db: Database,
  integration: string,
): CredentialHealthRow | null {
  const raw = db
    .query("SELECT * FROM credential_health WHERE integration = ?")
    .get(integration) as Record<string, unknown> | null;
  if (!raw) return null;
  return mapRow(raw);
}

export function readAllCredentialHealth(db: Database): CredentialHealthRow[] {
  const rows = db
    .query("SELECT * FROM credential_health ORDER BY integration")
    .all() as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function writeCredentialHealth(
  db: Database,
  row: CredentialHealthRow,
): void {
  db.query(`
    INSERT OR REPLACE INTO credential_health
      (integration, status, detail, expires_at, checked_at, last_notified_at, last_notified_kind)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).run(
    row.integration,
    row.status,
    row.detail,
    row.expiresAt,
    row.checkedAt,
    row.lastNotifiedAt,
    row.lastNotifiedKind,
  );
}

function mapRow(raw: Record<string, unknown>): CredentialHealthRow {
  return {
    integration: raw.integration as string,
    status: raw.status as CredentialHealthRow["status"],
    detail: (raw.detail as string) ?? "",
    expiresAt: (raw.expires_at as string) ?? null,
    checkedAt: raw.checked_at as number,
    lastNotifiedAt: (raw.last_notified_at as number) ?? null,
    lastNotifiedKind: (raw.last_notified_kind as CredentialHealthRow["lastNotifiedKind"]) ?? null,
  };
}
