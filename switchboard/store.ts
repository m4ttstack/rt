import type { Database } from "bun:sqlite";
import { canonicalUsername, type DraftEnvelope, type Envelope } from "../src/peer/envelope.ts";

export const ENVELOPE_TTL_MS = 7 * 24 * 60 * 60_000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

function mintToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

function mintCode(): string {
  return crypto.randomUUID().replaceAll("-", "");
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
    db.run(`CREATE TABLE IF NOT EXISTS invites (
      code_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_at INTEGER
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

  /** One outstanding invite per handle (UNIQUE(username) backstops it): creating
      again replaces the old code atomically, which is also the rotation story. */
  createInvite(username: string, now: number = Date.now()): { code: string; username: string; expiresAt: number } {
    const canonical = canonicalUsername(username);
    const code = mintCode();
    const expiresAt = now + INVITE_TTL_MS;
    this.db.transaction(() => {
      this.db.run(`DELETE FROM invites WHERE username = ?`, [canonical]);
      this.db.run(
        `INSERT INTO invites (code_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)`,
        [hashToken(code), canonical, now, expiresAt],
      );
    })();
    return { code, username: canonical, expiresAt };
  }

  /** The identity guard lives here (spec ruling 5): a mismatch consumes nothing
      and rotates nothing, so a wrong paste can never burn someone else's invite.
      Consumption is one atomic check-and-set; registerBoard runs only when it hits. */
  redeemInvite(
    code: string,
    username: string,
    now: number = Date.now(),
  ): { ok: true; username: string; token: string } | { ok: false; error: "unknown" | "expired" | "spent" | "mismatch" } {
    const row = this.db
      .query<{ username: string; expires_at: number; redeemed_at: number | null }, [string]>(
        `SELECT username, expires_at, redeemed_at FROM invites WHERE code_hash = ?`,
      )
      .get(hashToken(code));
    if (!row) return { ok: false, error: "unknown" };
    if (row.redeemed_at !== null) return { ok: false, error: "spent" };
    if (row.expires_at <= now) return { ok: false, error: "expired" };
    if (row.username !== canonicalUsername(username)) return { ok: false, error: "mismatch" };
    const consumed = this.db.run(
      `UPDATE invites SET redeemed_at = ? WHERE code_hash = ? AND redeemed_at IS NULL AND expires_at > ?`,
      [now, hashToken(code), now],
    ).changes;
    if (consumed === 0) return { ok: false, error: "spent" };
    const board = this.registerBoard(row.username);
    return { ok: true, ...board };
  }

  listBoards(): Array<{ username: string; createdAt: number }> {
    return this.db
      .query<{ username: string; created_at: number }, []>(`SELECT username, created_at FROM boards ORDER BY username`)
      .all()
      .map((r) => ({ username: r.username, createdAt: r.created_at }));
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
    this.db.run(`DELETE FROM invites WHERE expires_at < ?`, [now]);
    return this.db.run(`DELETE FROM envelopes WHERE received_at < ?`, [now - ttlMs]).changes;
  }
}
