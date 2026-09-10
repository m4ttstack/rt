import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Database } from 'bun:sqlite';

import { persistOrWarn, runCriticalWrite } from './busy.ts';
import { boardStateRoot, getStateDb } from './db.ts';

export type Lane = 'review' | 'respond' | 'doctor';
const LANE_DIR: Record<Lane, string> = {
  review: 'reviews',
  respond: 'responds',
  doctor: 'doctors',
};

function slug(mrUrl: string): string {
  return mrUrl
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/** Deterministic handle for an MR's lane row, so a repeat launch resolves
    the same row. The path shape is legacy (state/<lane>s/<slug>.json) --
    it is no longer where the state lives, only the row's identity and the
    sibling .md scratch handoff's location (see reportPathForHandle). */
export function mintHandle(
  lane: Lane,
  mrUrl: string,
  root: string = boardStateRoot()
): string {
  return join(root, 'state', LANE_DIR[lane], `${slug(mrUrl)}.json`);
}

/** Sibling markdown scratch file a pane writes its full report to, derived
    from the handle so board and pane resolve the same path without passing
    it around. */
export function reportPathForHandle(handle: string): string {
  return handle.replace(/\.json$/, '') + '.md';
}

function definedFields(patch: object): object {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );
}

export function insertAgentState(
  lane: Lane,
  mrUrl: string,
  iid: number,
  state: object,
  handle: string,
  db: Database = getStateDb()
): void {
  const full = { mrUrl, iid, ...state };
  runCriticalWrite('agent-state insert', () => {
    db.query(
      // The ON CONFLICT branch resets report to NULL, so this must only ever
      // run for a genuine new cycle: relaunching over an imported row hits
      // this branch too and would drop an already-ingested report. It also
      // clears pruned_at: a relaunch over a tombstoned row is a live cycle.
      `INSERT INTO agent_states (lane, mr_url, state, handle, report, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT(lane, mr_url) DO UPDATE SET
         state = excluded.state, handle = excluded.handle, report = NULL,
         updated_at = excluded.updated_at, pruned_at = NULL`
    ).run(lane, mrUrl, JSON.stringify(full), handle, Date.now());
  });
}

export function updateByHandle(
  handle: string,
  patch: object,
  now: number,
  db: Database = getStateDb()
): object | null {
  let result: object | null = null;
  runCriticalWrite('agent-state update', () => {
    const tx = db.transaction(() => {
      const row = db
        .query('SELECT lane, mr_url, state FROM agent_states WHERE handle = ?')
        .get(handle) as { lane: string; mr_url: string; state: string } | null;
      if (!row) return;
      const merged = {
        ...JSON.parse(row.state),
        ...definedFields(patch),
        updatedAt: now,
      };
      db.query(
        'UPDATE agent_states SET state = ?, updated_at = ?, pruned_at = NULL WHERE lane = ? AND mr_url = ?'
      ).run(JSON.stringify(merged), now, row.lane, row.mr_url);
      result = merged;
    });
    tx();
  });
  return result;
}

/** One row's state by handle, `reportReady` merged in the same shape
    `readStates` returns. Null when no row matches -- callers that need a
    row to exist (the status CLIs, the gate verbs) turn that into a loud
    failure themselves rather than this function guessing at one. */
export function readByHandle(
  handle: string,
  db: Database = getStateDb()
): object | null {
  const row = db
    .query('SELECT state, report FROM agent_states WHERE handle = ?')
    .get(handle) as { state: string; report: string | null } | null;
  if (!row) return null;
  return { ...JSON.parse(row.state), reportReady: row.report !== null };
}

export function updateByMr(
  lane: Lane,
  mrUrl: string,
  patch: object,
  now: number,
  db: Database = getStateDb()
): object | null {
  let result: object | null = null;
  runCriticalWrite('agent-state update', () => {
    const tx = db.transaction(() => {
      const row = db
        .query('SELECT state FROM agent_states WHERE lane = ? AND mr_url = ?')
        .get(lane, mrUrl) as { state: string } | null;
      if (!row) return;
      const merged = {
        ...JSON.parse(row.state),
        ...definedFields(patch),
        updatedAt: now,
      };
      db.query(
        'UPDATE agent_states SET state = ?, updated_at = ?, pruned_at = NULL WHERE lane = ? AND mr_url = ?'
      ).run(JSON.stringify(merged), now, lane, mrUrl);
      result = merged;
    });
    tx();
  });
  return result;
}

/** Every live lane row keyed by mrUrl. `reportReady` is computed at read time
    from the report column, never persisted to the state JSON blob. Tombstoned
    rows (see pruneStates) are invisible here; readPrunedStates serves those. */
export function readStates(
  lane: Lane,
  db: Database = getStateDb()
): Map<string, object> {
  return readRows(lane, 'pruned_at IS NULL', db);
}

/** Every tombstoned lane row keyed by mrUrl, in readStates' shape. The latch
    pass reads these to spot an MR that left the board with review state and
    came back without it. */
export function readPrunedStates(
  lane: Lane,
  db: Database = getStateDb()
): Map<string, object> {
  return readRows(lane, 'pruned_at IS NOT NULL', db);
}

function readRows(
  lane: Lane,
  prunedClause: string,
  db: Database
): Map<string, object> {
  const out = new Map<string, object>();
  const rows = db
    .query(
      `SELECT mr_url, state, report FROM agent_states WHERE lane = ? AND ${prunedClause}`
    )
    .all(lane) as { mr_url: string; state: string; report: string | null }[];
  for (const row of rows) {
    out.set(row.mr_url, {
      ...JSON.parse(row.state),
      reportReady: row.report !== null,
    });
  }
  return out;
}

/** Bring a tombstoned row back to life, state untouched. A no-op on live or
    absent rows. */
export function resurrectState(
  lane: Lane,
  mrUrl: string,
  db: Database = getStateDb()
): void {
  runCriticalWrite('agent-state resurrect', () => {
    db.query(
      'UPDATE agent_states SET pruned_at = NULL WHERE lane = ? AND mr_url = ? AND pruned_at IS NOT NULL'
    ).run(lane, mrUrl);
  });
}

/** Hard-delete a tombstone whose revival turned out to have nothing to act
    on. Never touches a live row. */
export function dropPrunedState(
  lane: Lane,
  mrUrl: string,
  db: Database = getStateDb()
): void {
  persistOrWarn('agent-state tombstone drop', () => {
    db.query(
      'DELETE FROM agent_states WHERE lane = ? AND mr_url = ? AND pruned_at IS NOT NULL'
    ).run(lane, mrUrl);
  });
}

export function readReport(
  lane: Lane,
  mrUrl: string,
  db: Database = getStateDb()
): string | null {
  const row = db
    .query('SELECT report FROM agent_states WHERE lane = ? AND mr_url = ?')
    .get(lane, mrUrl) as { report: string | null } | null;
  return row?.report ?? null;
}

export function setReportByHandle(
  handle: string,
  text: string,
  db: Database = getStateDb()
): boolean {
  let ok = false;
  runCriticalWrite('agent-state report', () => {
    const tx = db.transaction(() => {
      const row = db
        .query('SELECT 1 FROM agent_states WHERE handle = ?')
        .get(handle);
      if (!row) return;
      db.query(
        'UPDATE agent_states SET report = ?, updated_at = ? WHERE handle = ?'
      ).run(text, Date.now(), handle);
      ok = true;
    });
    tx();
  });
  return ok;
}

/** Ingests the handle's sibling .md report into its row, if the file exists
    yet. Called on every review/respond status write and at gate open, not
    gated on `done`: the skill writes the report BEFORE parking at a gate, so
    the board must be able to serve it while the pane still holds there (a
    `done` write is just the final catch-up, for a report written only at the
    very end). Only the file read is caught here -- a db error out of
    setReportByHandle propagates, it is never swallowed alongside a routine
    "no report yet" ENOENT. */
export function ingestReport(
  handle: string,
  db: Database = getStateDb()
): void {
  let text: string;
  try {
    text = readFileSync(reportPathForHandle(handle), 'utf8');
  } catch {
    return;
  }
  if (!setReportByHandle(handle, text, db)) {
    console.error(`report ingestion: no state row for handle ${handle}`);
  }
}

/** Tombstone rows whose MR has left the board (kept live while the MR is
    shown): stamp pruned_at and null the ingested report rather than delete,
    so a review row can be resurrected if its MR returns to the board still
    carrying an armed latch. Best-effort unlink each tombstoned row's
    handle-sibling .md scratch file so pane report handoffs never accumulate
    once their row goes dark. */
export function pruneStates(
  lane: Lane,
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  // The SELECT and the UPDATEs share one transaction snapshot: a row a
  // concurrent insertAgentState changes between them invalidates that
  // snapshot, so the UPDATE raises a busy error instead of silently
  // tombstoning a row the caller can no longer prove is stale. `committed`
  // gates the unlink loop on the transaction actually finishing -- a
  // busy-aborted prune must not unlink a handle's report file for a
  // tombstone that never landed (the handle path is reused by the next
  // cycle's relaunch). Already-tombstoned rows are excluded up front so a
  // repeat prune never restamps them or re-runs their unlink.
  let stale: { mr_url: string; handle: string }[] = [];
  let committed = false;
  persistOrWarn('agent-state prune', () => {
    const tx = db.transaction(() => {
      const rows = db
        .query(
          'SELECT mr_url, handle FROM agent_states WHERE lane = ? AND pruned_at IS NULL'
        )
        .all(lane) as { mr_url: string; handle: string }[];
      stale = rows.filter(row => !keepUrls.has(row.mr_url));
      for (const row of stale) {
        db.query(
          'UPDATE agent_states SET pruned_at = ?, report = NULL WHERE lane = ? AND mr_url = ?'
        ).run(Date.now(), lane, row.mr_url);
      }
    });
    tx();
    committed = true;
  });
  if (!committed) return;
  for (const row of stale) {
    try {
      unlinkSync(reportPathForHandle(row.handle));
    } catch {
      // no sibling report to remove
    }
  }
}
