/** The team-invite relay (`/v1/invites/*`): store-and-forward for sealed team
    pointers, unauthenticated by design because an invite id *is* the secret.

    No column here is ever plaintext employer data (MAT-379 ruling 4). The team
    remote, slug, and invitee handle all live inside `ciphertext`, sealed
    client-side with a key that travels in the invite code and never reaches the
    server. A full dump yields opaque ids, ciphertext, a secret hash, and
    timestamps. `__tests__/team-invites.test.ts` asserts the column list so a
    later plaintext field fails a test instead of a review.

    Named `team_invites` rather than the spec's `invites`: `store.ts` already
    owns an `invites` table for peer-board handles in the same sqlite file. */
import type { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";

export const INVITE_ID_RE = /^[0-9a-f]{32}$/;
export const MAX_BLOB_BYTES = 64 * 1024;

function hashSecret(secret: string): string {
  return new Bun.CryptoHasher("sha256").update(secret).digest("hex");
}

function mintSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function secretMatches(secret: string, expectedHash: string): boolean {
  const got = Buffer.from(hashSecret(secret));
  const want = Buffer.from(expectedHash);
  return got.length === want.length && timingSafeEqual(got, want);
}

type Row = {
  id: string;
  ciphertext: string;
  creator_secret_hash: string;
  expires_at: number;
  redeemed_at: number | null;
  reply_blob: string | null;
};

export class TeamInviteStore {
  constructor(private db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      creator_secret_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      redeemed_at INTEGER,
      reply_blob TEXT,
      reply_at INTEGER
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS team_invites_expires_at ON team_invites (expires_at)`);
  }

  private row(id: string): Row | null {
    return this.db
      .query<Row, [string]>(
        `SELECT id, ciphertext, creator_secret_hash, expires_at, redeemed_at, reply_blob
         FROM team_invites WHERE id = ?`,
      )
      .get(id) ?? null;
  }

  /** Never overwrites: the id is the sealed blob's AAD, so a collision means the
      caller must mint a fresh id rather than retry. */
  create(id: string, ciphertext: string, expiresAt: number, now: number): { ok: true; creatorSecret: string } | { ok: false; error: "conflict" } {
    const secret = mintSecret();
    const changes = this.db.run(
      `INSERT INTO team_invites (id, ciphertext, creator_secret_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [id, ciphertext, hashSecret(secret), expiresAt, now],
    ).changes;
    if (changes === 0) return { ok: false, error: "conflict" };
    return { ok: true, creatorSecret: secret };
  }

  /** Returns the ciphertext and nothing else: an unauthenticated GET must not
      confirm *why* an id is gone, only that it is. */
  fetch(id: string, now: number): { ok: true; ciphertext: string } | { ok: false; error: "unknown" | "gone" } {
    const row = this.row(id);
    if (!row) return { ok: false, error: "unknown" };
    if (row.expires_at <= now || row.redeemed_at !== null) return { ok: false, error: "gone" };
    return { ok: true, ciphertext: row.ciphertext };
  }

  /** One statement decides the winner. A read-then-write here is a race two
      simultaneous redeemers can both win, handing one invite to two machines;
      the follow-up read only labels a loss that already happened. */
  redeem(id: string, now: number): { ok: true } | { ok: false; error: "unknown" | "gone" | "redeemed" } {
    const won = this.db.run(
      `UPDATE team_invites SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL AND expires_at > ?`,
      [now, id, now],
    ).changes;
    if (won === 1) return { ok: true };
    const row = this.row(id);
    if (!row) return { ok: false, error: "unknown" };
    if (row.expires_at <= now) return { ok: false, error: "gone" };
    return { ok: false, error: "redeemed" };
  }

  /** Write-once, by the same CAS reasoning as redeem: the joiner is
      unauthenticated here, so first-write-wins is what stops anyone who learns
      the id from overwriting the real joiner's key. */
  putReply(id: string, blob: string, now: number): { ok: true } | { ok: false; error: "unknown" | "gone" | "exists" } {
    const stored = this.db.run(
      `UPDATE team_invites SET reply_blob = ?, reply_at = ?
       WHERE id = ? AND reply_blob IS NULL AND expires_at > ?`,
      [blob, now, id, now],
    ).changes;
    if (stored === 1) return { ok: true };
    const row = this.row(id);
    if (!row) return { ok: false, error: "unknown" };
    if (row.expires_at <= now) return { ok: false, error: "gone" };
    return { ok: false, error: "exists" };
  }

  /** Revoking expires the row rather than deleting it, so the reaper is still
      the only thing that removes rows and a revoked id reads as 410 rather than
      404. Adding a `revoked_at` column would widen the schema the security
      argument rests on. */
  revoke(id: string, secret: string, now: number): { ok: true } | { ok: false; error: "unknown" | "unauthorized" | "gone" } {
    const row = this.row(id);
    if (!row) return { ok: false, error: "unknown" };
    if (!secretMatches(secret, row.creator_secret_hash)) return { ok: false, error: "unauthorized" };
    if (row.expires_at <= now) return { ok: false, error: "gone" };
    this.db.run(`UPDATE team_invites SET expires_at = 0 WHERE id = ?`, [id]);
    return { ok: true };
  }

  hasReply(id: string, secret: string): { ok: true; blob: string | null } | { ok: false; error: "unauthorized" | "unknown" } {
    const row = this.row(id);
    if (!row) return { ok: false, error: "unknown" };
    if (!secretMatches(secret, row.creator_secret_hash)) return { ok: false, error: "unauthorized" };
    return { ok: true, blob: row.reply_blob };
  }

  /** Redeemed and revoked invites go out on this same pass rather than
      immediately, which is what keeps 410 distinguishable from 404 for a while. */
  prune(now: number): number {
    return this.db.run(`DELETE FROM team_invites WHERE expires_at < ?`, [now]).changes;
  }
}

/** Fixed-window counter, keyed by source address or invite id. Keys arrive from
    the open internet, so a stale-window sweep is what stops the map from
    growing with every address that ever touched the relay. */
class RateLimiter {
  private hits = new Map<string, { window: number; count: number }>();
  constructor(private limit: number, private windowMs: number = 60_000, private maxKeys: number = 10_000) {}

  /** Counts this attempt and reports whether the key is now over its limit. */
  exceeded(key: string, now: number): boolean {
    const window = Math.floor(now / this.windowMs);
    const seen = this.hits.get(key);
    if (seen && seen.window === window) {
      seen.count++;
      return seen.count > this.limit;
    }
    if (this.hits.size >= this.maxKeys) {
      for (const [k, v] of this.hits) if (v.window !== window) this.hits.delete(k);
    }
    this.hits.set(key, { window, count: 1 });
    return false;
  }
}

/** Railway terminates TLS in front of the service, so the client address only
    exists in this header; it is an abuse signal, never an authorization one. */
function sourceIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function text(status: number, body: string): Response {
  return new Response(body, { status });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const MINTS_PER_MINUTE = 10;
export const AUTH_FAILURES_PER_MINUTE = 10;

/** The returned handler answers null for a path this surface does not own, so
    the caller falls through to the peer-boards routes. */
export function makeTeamInviteHandler(store: TeamInviteStore, now: () => number) {
  const mints = new RateLimiter(MINTS_PER_MINUTE);
  const authFailures = new RateLimiter(AUTH_FAILURES_PER_MINUTE);
  return (req: Request, pathname: string) => handleTeamInvites(req, pathname, store, now, mints, authFailures);
}

async function handleTeamInvites(
  req: Request,
  pathname: string,
  store: TeamInviteStore,
  now: () => number,
  mints: RateLimiter,
  authFailures: RateLimiter,
): Promise<Response | null> {
  if (pathname !== "/v1/invites" && !pathname.startsWith("/v1/invites/")) return null;
  const rest = pathname === "/v1/invites" ? "" : pathname.slice("/v1/invites/".length);

  if (rest === "") {
    if (req.method !== "POST") return text(405, "method not allowed");
    if (mints.exceeded(sourceIp(req), now())) return text(429, "too many invites; try again in a minute");
    const oversize = tooLarge(req);
    if (oversize) return oversize;
    let body: unknown;
    try { body = await req.json(); } catch { return text(400, "invalid json"); }
    const { id, ciphertext, expiresAt } = (body ?? {}) as { id?: unknown; ciphertext?: unknown; expiresAt?: unknown };
    if (typeof id !== "string" || !INVITE_ID_RE.test(id)) return text(400, "id must be 32 lowercase hex characters");
    if (typeof ciphertext !== "string" || !ciphertext) return text(400, "expected { ciphertext }");
    if (Buffer.byteLength(ciphertext) > MAX_BLOB_BYTES) return text(413, "ciphertext too large");
    if (typeof expiresAt !== "string") return text(400, "expected { expiresAt } as an ISO-8601 string");
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry) || expiry <= now()) return text(400, "expiresAt must be a future ISO-8601 timestamp");
    const created = store.create(id, ciphertext, expiry, now());
    if (!created.ok) return text(409, "that invite id is already taken; mint a fresh one");
    return json(201, { id, creatorSecret: created.creatorSecret });
  }

  const [id, tail, ...extra] = rest.split("/");
  if (!id || extra.length) return text(404, "not found");
  if (!INVITE_ID_RE.test(id)) return text(400, "id must be 32 lowercase hex characters");

  if (!tail) {
    if (req.method === "GET") {
      const got = store.fetch(id, now());
      if (got.ok) return json(200, { ciphertext: got.ciphertext });
      return text(got.error === "unknown" ? 404 : 410, "gone");
    }
    if (req.method === "DELETE") {
      const secret = bearer(req);
      if (!secret) return text(401, "unauthorized");
      const r = store.revoke(id, secret, now());
      if (r.ok) return new Response(null, { status: 204 });
      if (r.error === "unauthorized") return refuse(id, authFailures, now());
      return text(404, "gone");
    }
    return text(405, "method not allowed");
  }

  if (tail === "redeem") {
    if (req.method !== "POST") return text(405, "method not allowed");
    const r = store.redeem(id, now());
    if (r.ok) return json(200, { ok: true });
    if (r.error === "unknown") return text(404, "gone");
    if (r.error === "gone") return text(410, "gone");
    return text(409, "that invite has already been redeemed");
  }

  if (tail === "reply") {
    if (req.method === "POST") {
      const oversize = tooLarge(req);
      if (oversize) return oversize;
      let body: unknown;
      try { body = await req.json(); } catch { return text(400, "invalid json"); }
      const blob = (body as { blob?: unknown })?.blob;
      if (typeof blob !== "string" || !blob) return text(400, "expected { blob }");
      if (Buffer.byteLength(blob) > MAX_BLOB_BYTES) return text(413, "blob too large");
      const r = store.putReply(id, blob, now());
      if (r.ok) return json(200, { ok: true });
      if (r.error === "unknown") return text(404, "gone");
      if (r.error === "gone") return text(410, "gone");
      return text(409, "a reply is already recorded for that invite");
    }
    if (req.method === "GET") {
      const secret = bearer(req);
      if (!secret) return text(401, "unauthorized");
      const r = store.hasReply(id, secret);
      if (!r.ok) return r.error === "unknown" ? text(404, "gone") : refuse(id, authFailures, now());
      if (r.blob === null) return text(404, "no reply yet");
      return json(200, { blob: r.blob });
    }
    return text(405, "method not allowed");
  }

  return text(404, "not found");
}

/** Counted only on a wrong secret, and only after the real one has had its
    chance, so brute force is pointless without stalling the legitimate poller. */
function refuse(id: string, authFailures: RateLimiter, now: number): Response {
  return authFailures.exceeded(id, now)
    ? text(429, "too many failed attempts for that invite")
    : text(401, "unauthorized");
}

function tooLarge(req: Request): Response | null {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BLOB_BYTES + 4096) return text(413, "body too large");
  return null;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
