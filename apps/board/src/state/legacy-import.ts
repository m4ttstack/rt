import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { Database } from 'bun:sqlite';

import { mintHandle, type Lane } from './agent-states.ts';
import { dbPathForRoot } from './db.ts';
import { getKvValue, setKvValue } from './kv-blob.ts';

export interface LegacyImportResult {
  imported: number;
  skipped: number;
  /** Legacy roots whose `state/` dir was successfully renamed aside this run. */
  renamed: string[];
}

const LANE_DIR: Record<Lane, string> = {
  review: 'reviews',
  respond: 'responds',
  doctor: 'doctors',
};
/** Only review and respond rows have a sibling .md report; doctor never did. */
const LANE_HAS_REPORT: Record<Lane, boolean> = {
  review: true,
  respond: true,
  doctor: false,
};

/** Tally shared by every surface importer, threaded through by mutation
    rather than returned, so per-surface helpers can stay simple void
    functions instead of each composing partial results. */
interface Tally {
  imported: number;
  skipped: number;
}

function readJson(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** kv rows carry their own updated_at (the wall-clock time they were last
    written). A re-run's file mtime is compared against it directly -- a
    prior committed import always stamps "now", which already exceeds any
    legacy file's mtime, so a re-run only ever overwrites when it truly has
    something the committed row does not. */
function kvUpdatedAt(db: Database, ns: string, key: string): number | null {
  const row = db
    .query('SELECT updated_at FROM kv WHERE ns = ? AND k = ?')
    .get(ns, key) as { updated_at: number } | null;
  return row ? row.updated_at : null;
}

/** An in-flight pane holds the LEGACY file path as its --state handle. That
    resolution only lands on this row if the row's origin root is the one
    this db was opened for -- otherwise the legacy path belongs to some
    OTHER board's tree and must never collide with this db's handle index. */
function resolveHandle(
  db: Database,
  lane: Lane,
  mrUrl: string,
  root: string,
  legacyPath: string
): string {
  if (resolve(dbPathForRoot(root)) === resolve(db.filename)) return legacyPath;
  return mintHandle(lane, mrUrl);
}

interface LaneWinner {
  mrUrl: string;
  iid: number;
  raw: Record<string, unknown>;
  updatedAt: number;
  root: string;
  filePath: string;
  report: string | null;
}

function importLane(db: Database, roots: string[], lane: Lane, t: Tally): void {
  const dirName = LANE_DIR[lane];
  const winners = new Map<string, LaneWinner>();
  for (const root of roots) {
    const dir = join(root, 'state', dirName);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const filePath = join(dir, name);
      const parsed = readJson(filePath);
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      const raw = parsed as Record<string, unknown>;
      const mrUrl = typeof raw.mrUrl === 'string' ? raw.mrUrl : '';
      if (!mrUrl) {
        t.skipped++;
        continue;
      }
      t.imported++;
      const iid = typeof raw.iid === 'number' ? raw.iid : 0;
      const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
      let report: string | null = null;
      if (LANE_HAS_REPORT[lane]) {
        const mdPath = filePath.replace(/\.json$/, '') + '.md';
        if (existsSync(mdPath)) {
          try {
            report = readFileSync(mdPath, 'utf8');
          } catch {
            report = null;
          }
        }
      }
      const existing = winners.get(mrUrl);
      if (!existing || updatedAt > existing.updatedAt) {
        winners.set(mrUrl, {
          mrUrl,
          iid,
          raw,
          updatedAt,
          root,
          filePath,
          report,
        });
      }
    }
  }
  for (const w of winners.values()) {
    const handle = resolveHandle(db, lane, w.mrUrl, w.root, w.filePath);
    db.query(
      `INSERT INTO agent_states (lane, mr_url, state, handle, report, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(lane, mr_url) DO UPDATE SET
         state = excluded.state, handle = excluded.handle, report = excluded.report, updated_at = excluded.updated_at
       WHERE excluded.updated_at > agent_states.updated_at`
    ).run(lane, w.mrUrl, JSON.stringify(w.raw), handle, w.report, w.updatedAt);
  }
}

interface DraftWinner {
  mrUrl: string;
  kind: string;
  raw: Record<string, unknown>;
  updatedAt: number;
}

function importDrafts(db: Database, roots: string[], t: Tally): void {
  const winners = new Map<string, DraftWinner>();
  for (const root of roots) {
    const dir = join(root, 'state', 'drafts');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const parsed = readJson(join(dir, name));
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      const raw = parsed as Record<string, unknown>;
      const mrUrl = typeof raw.mrUrl === 'string' ? raw.mrUrl : '';
      const kind = typeof raw.kind === 'string' ? raw.kind : '';
      if (!mrUrl || !kind) {
        t.skipped++;
        continue;
      }
      t.imported++;
      const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
      const key = `${mrUrl}\0${kind}`;
      const existing = winners.get(key);
      if (!existing || updatedAt > existing.updatedAt) {
        winners.set(key, { mrUrl, kind, raw, updatedAt });
      }
    }
  }
  for (const w of winners.values()) {
    db.query(
      `INSERT INTO drafts (mr_url, kind, draft, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(mr_url, kind) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at
       WHERE excluded.updated_at > drafts.updated_at`
    ).run(w.mrUrl, w.kind, JSON.stringify(w.raw), w.updatedAt);
  }
}

interface NudgeWinner {
  id: string;
  raw: Record<string, unknown>;
  receivedAt: number;
}

function importNudges(db: Database, roots: string[], t: Tally): void {
  const winners = new Map<string, NudgeWinner>();
  for (const root of roots) {
    const dir = join(root, 'state', 'nudges');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const parsed = readJson(join(dir, name));
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      const raw = parsed as Record<string, unknown>;
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) {
        t.skipped++;
        continue;
      }
      t.imported++;
      const receivedAt =
        typeof raw.receivedAt === 'number' ? raw.receivedAt : 0;
      const existing = winners.get(id);
      if (!existing || receivedAt > existing.receivedAt) {
        winners.set(id, { id, raw, receivedAt });
      }
    }
  }
  for (const w of winners.values()) {
    db.query(
      `INSERT INTO nudges (id, nudge, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET nudge = excluded.nudge, updated_at = excluded.updated_at
       WHERE excluded.updated_at > nudges.updated_at`
    ).run(w.id, JSON.stringify(w.raw), w.receivedAt);
  }
}

interface SentNudgeWinner {
  mrUrl: string;
  raw: Record<string, unknown>;
  sentAt: number;
}

function importNudgesSent(db: Database, roots: string[], t: Tally): void {
  const winners = new Map<string, SentNudgeWinner>();
  for (const root of roots) {
    const dir = join(root, 'state', 'nudges-sent');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const parsed = readJson(join(dir, name));
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      const raw = parsed as Record<string, unknown>;
      const mrUrl = typeof raw.mrUrl === 'string' ? raw.mrUrl : '';
      if (!mrUrl) {
        t.skipped++;
        continue;
      }
      t.imported++;
      const sentAt = typeof raw.sentAt === 'number' ? raw.sentAt : 0;
      const existing = winners.get(mrUrl);
      if (!existing || sentAt > existing.sentAt) {
        winners.set(mrUrl, { mrUrl, raw, sentAt });
      }
    }
  }
  for (const w of winners.values()) {
    db.query(
      `INSERT INTO nudges_sent (mr_url, nudge, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(mr_url) DO UPDATE SET nudge = excluded.nudge, updated_at = excluded.updated_at
       WHERE excluded.updated_at > nudges_sent.updated_at`
    ).run(w.mrUrl, JSON.stringify(w.raw), w.sentAt);
  }
}

interface OutboxWinner {
  envelopeId: string;
  raw: Record<string, unknown>;
  queuedAt: number;
}

function importOutbox(db: Database, roots: string[], t: Tally): void {
  const winners = new Map<string, OutboxWinner>();
  for (const root of roots) {
    const dir = join(root, 'state', 'outbox');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const parsed = readJson(join(dir, name));
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      const raw = parsed as Record<string, unknown>;
      const envelope = raw.envelope;
      const envelopeId =
        envelope && typeof envelope === 'object'
          ? (envelope as Record<string, unknown>).id
          : undefined;
      if (typeof envelopeId !== 'string' || !envelopeId) {
        t.skipped++;
        continue;
      }
      t.imported++;
      const queuedAt = typeof raw.queuedAt === 'number' ? raw.queuedAt : 0;
      const existing = winners.get(envelopeId);
      if (!existing || queuedAt > existing.queuedAt) {
        winners.set(envelopeId, { envelopeId, raw, queuedAt });
      }
    }
  }
  for (const w of winners.values()) {
    // outbox has no updated_at column, so the re-run guard reads the
    // committed entry's own queuedAt back out of its JSON blob instead of
    // an ON CONFLICT ... WHERE clause.
    const existing = db
      .query('SELECT entry FROM outbox WHERE envelope_id = ?')
      .get(w.envelopeId) as { entry: string } | null;
    if (existing) {
      let existingQueuedAt = -Infinity;
      try {
        const prev = JSON.parse(existing.entry) as { queuedAt?: number };
        if (typeof prev.queuedAt === 'number') existingQueuedAt = prev.queuedAt;
      } catch {
        // unreadable committed row: treat as always-replaceable
      }
      if (w.queuedAt <= existingQueuedAt) continue;
      db.query('UPDATE outbox SET entry = ? WHERE envelope_id = ?').run(
        JSON.stringify(w.raw),
        w.envelopeId
      );
    } else {
      db.query('INSERT INTO outbox (envelope_id, entry) VALUES (?, ?)').run(
        w.envelopeId,
        JSON.stringify(w.raw)
      );
    }
  }
}

interface SlackRefWinner {
  mrUrl: string;
  raw: Record<string, unknown>;
  checkedAt: number;
}

function importSlackRefs(db: Database, roots: string[], t: Tally): void {
  const winners = new Map<string, SlackRefWinner>();
  for (const root of roots) {
    const dir = join(root, 'state', 'slack');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const parsed = readJson(join(dir, name));
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      const raw = parsed as Record<string, unknown>;
      const mrUrl = typeof raw.mrUrl === 'string' ? raw.mrUrl : '';
      if (!mrUrl) {
        t.skipped++;
        continue;
      }
      t.imported++;
      const checkedAt = typeof raw.checkedAt === 'number' ? raw.checkedAt : 0;
      const existing = winners.get(mrUrl);
      if (!existing || checkedAt > existing.checkedAt) {
        winners.set(mrUrl, { mrUrl, raw, checkedAt });
      }
    }
  }
  for (const w of winners.values()) {
    db.query(
      `INSERT INTO slack_refs (mr_url, ref, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(mr_url) DO UPDATE SET ref = excluded.ref, updated_at = excluded.updated_at
       WHERE excluded.updated_at > slack_refs.updated_at`
    ).run(w.mrUrl, JSON.stringify(w.raw), w.checkedAt);
  }
}

/** auto-dispatch.json and agent-status-cursor carry no timestamp of their
    own -- file mtime is the only freshness signal two roots' copies offer. */
function importAutoDispatch(db: Database, roots: string[], t: Tally): void {
  let winner: { raw: unknown; mtime: number } | undefined;
  for (const root of roots) {
    const path = join(root, 'state', 'auto-dispatch.json');
    if (!existsSync(path)) continue;
    const parsed = readJson(path);
    if (!parsed || typeof parsed !== 'object') {
      t.skipped++;
      continue;
    }
    t.imported++;
    const mtime = mtimeOf(path);
    if (!winner || mtime > winner.mtime) winner = { raw: parsed, mtime };
  }
  if (winner) {
    const existing = kvUpdatedAt(db, 'triage', 'memory');
    if (existing === null || winner.mtime > existing) {
      setKvValue('triage', 'memory', winner.raw, db);
    }
  }
}

function importAgentStatusCursor(
  db: Database,
  roots: string[],
  t: Tally
): void {
  let winner: { cursor: number; mtime: number } | undefined;
  for (const root of roots) {
    const path = join(root, 'state', 'agent-status-cursor');
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8').trim();
    } catch {
      t.skipped++;
      continue;
    }
    const cursor = Number(raw);
    if (!raw || !Number.isInteger(cursor) || cursor < 0) {
      t.skipped++;
      continue;
    }
    t.imported++;
    const mtime = mtimeOf(path);
    if (!winner || mtime > winner.mtime) winner = { cursor, mtime };
  }
  if (winner) {
    const existing = kvUpdatedAt(db, 'agent-status', 'cursor');
    if (existing === null || winner.mtime > existing) {
      setKvValue('agent-status', 'cursor', winner.cursor, db);
    }
  }
}

const SLACK_INDEX_FILE_RE = /^slack-index-(.+)\.json$/;

function importSlackIndexes(db: Database, roots: string[], t: Tally): void {
  const winners = new Map<string, { raw: unknown; mtime: number }>();
  for (const root of roots) {
    const dir = join(root, 'state');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const m = SLACK_INDEX_FILE_RE.exec(name);
      if (!m) continue;
      const slug = m[1] as string;
      const path = join(dir, name);
      const parsed = readJson(path);
      if (!parsed || typeof parsed !== 'object') {
        t.skipped++;
        continue;
      }
      t.imported++;
      const mtime = mtimeOf(path);
      const existing = winners.get(slug);
      if (!existing || mtime > existing.mtime)
        winners.set(slug, { raw: parsed, mtime });
    }
  }
  for (const [slug, w] of winners) {
    const existing = kvUpdatedAt(db, 'slack-index', slug);
    if (existing === null || w.mtime > existing) {
      setKvValue('slack-index', slug, w.raw, db);
    }
  }
}

/** Roots that carry a legacy state/ dir, so the caller can rename each one
    once the import transaction below has committed. Detected up front: an
    empty legacy dir still counts as "processed" so it never gets rescanned. */
function legacyRootsOf(roots: string[]): string[] {
  return roots.filter(root => existsSync(join(root, 'state')));
}

/**
 * One-shot migration of the pre-db legacy JSON tree(s) into state.db. Must
 * run exactly once: the meta/legacy-import-done kv marker gates it, checked
 * here too (not only by the caller) so a direct second call is inert even
 * before the state/ dirs are renamed away.
 */
export function importLegacyState(
  db: Database,
  roots: string[]
): LegacyImportResult {
  if (getKvValue('meta', 'legacy-import-done', false, db)) {
    return { imported: 0, skipped: 0, renamed: [] };
  }

  const legacyRoots = legacyRootsOf(roots);
  const tally: Tally = { imported: 0, skipped: 0 };

  const tx = db.transaction(() => {
    importLane(db, roots, 'review', tally);
    importLane(db, roots, 'respond', tally);
    importLane(db, roots, 'doctor', tally);
    importDrafts(db, roots, tally);
    importNudges(db, roots, tally);
    importNudgesSent(db, roots, tally);
    importOutbox(db, roots, tally);
    importSlackRefs(db, roots, tally);
    importAutoDispatch(db, roots, tally);
    importAgentStatusCursor(db, roots, tally);
    importSlackIndexes(db, roots, tally);
  });
  // Immediate, not deferred: this can race another process's first-ever open
  // of the same fresh db (see getStateDb's raised busy_timeout around this
  // call), and a deferred transaction only takes its write lock on the first
  // write inside it, well after the race could already have been lost.
  tx.immediate();

  // Best-effort quarantine: the transaction above already committed the
  // imported data durably, so a rename failure (e.g. a file busy on the
  // legacy tree) must never undo or block that success -- it only means
  // the old directory sticks around for next time, harmlessly re-scanned
  // and re-superseded by the guarded upserts above.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const renamed: string[] = [];
  for (const root of legacyRoots) {
    const legacyDir = join(root, 'state');
    if (!existsSync(legacyDir)) continue;
    try {
      renameSync(legacyDir, join(root, `state.imported-${dateStamp}`));
      renamed.push(root);
    } catch (err) {
      console.error(
        `legacy import: could not rename ${legacyDir}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  setKvValue('meta', 'legacy-import-done', true, db);
  return { ...tally, renamed };
}
