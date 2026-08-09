import type { Database } from "bun:sqlite";
import { canonicalUsername, type DraftEnvelope, type Envelope } from "../src/peer/envelope.ts";

export const ENVELOPE_TTL_MS = 7 * 24 * 60 * 60_000;

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

function mintToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

/** The relay's entire persistence. It stores envelopes it never inspects:
    payload stays an opaque JSON string end to end. Per-recipient rows make
    broadcast, ack, and TTL prune single statements. */
export class SwitchboardStore {
  constructor(private db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS boards (
      username TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS envelopes (
      id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      from_user TEXT NOT NULL,
      to_field TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (id, recipient)
    )`);
  }

  registerBoard(username: string): { username: string; token: string } {
    const canonical = canonicalUsername(username);
    const token = mintToken();
    this.db.run(
      `INSERT INTO boards (username, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET token_hash = excluded.token_hash`,
      [canonical, hashToken(token), Date.now()],
    );
    return { username: canonical, token };
  }

  authBoard(token: string): string | null {
    const row = this.db
      .query<{ username: string }, [string]>(`SELECT username FROM boards WHERE token_hash = ?`)
      .get(hashToken(token));
    return row?.username ?? null;
  }

  publish(from: string, draft: DraftEnvelope, now: number): { ok: true; delivered: number } | { ok: false; error: "unknown-recipient" } {
    const recipients =
      draft.to === "*"
        ? this.db.query<{ username: string }, [string]>(`SELECT username FROM boards WHERE username != ?`).all(from).map((r) => r.username)
        : this.db.query<{ username: string }, [string]>(`SELECT username FROM boards WHERE username = ?`).all(draft.to).map((r) => r.username);
    if (draft.to !== "*" && recipients.length === 0) return { ok: false, error: "unknown-recipient" };
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO envelopes (id, recipient, from_user, to_field, type, sent_at, received_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let delivered = 0;
    for (const r of recipients) {
      insert.run(draft.id, r, from, draft.to, draft.type, draft.sentAt, now, JSON.stringify(draft.payload));
      delivered++;
    }
    return { ok: true, delivered };
  }

  inbox(username: string, limit: number = 100): Envelope[] {
    return this.db
      .query<{ id: string; from_user: string; to_field: string; type: string; sent_at: number; received_at: number; payload: string }, [string, number]>(
        `SELECT id, from_user, to_field, type, sent_at, received_at, payload
         FROM envelopes WHERE recipient = ? ORDER BY received_at ASC, id ASC LIMIT ?`,
      )
      .all(username, limit)
      .map((r) => ({
        id: r.id, from: r.from_user, to: r.to_field, type: r.type,
        sentAt: r.sent_at, receivedAt: r.received_at, payload: JSON.parse(r.payload) as unknown,
      }));
  }

  ack(username: string, ids: string[]): number {
    const del = this.db.prepare(`DELETE FROM envelopes WHERE recipient = ? AND id = ?`);
    let n = 0;
    for (const id of ids) n += del.run(username, id).changes;
    return n;
  }

  prune(now: number, ttlMs: number = ENVELOPE_TTL_MS): number {
    return this.db.run(`DELETE FROM envelopes WHERE received_at < ?`, [now - ttlMs]).changes;
  }
}
