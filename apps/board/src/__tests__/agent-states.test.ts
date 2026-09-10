import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import {
  dropPrunedState,
  insertAgentState,
  mintHandle,
  pruneStates,
  readByHandle,
  readPrunedStates,
  readReport,
  readStates,
  reportPathForHandle,
  resurrectState,
  setReportByHandle,
  updateByHandle,
} from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

const URL = 'https://gitlab.example.com/g/p/-/merge_requests/7';

function db() {
  return openStateDb(
    join(mkdtempSync(join(tmpdir(), 'board-as-')), 'state.db')
  );
}

describe('agent states', () => {
  test('insert then update by handle merges fields', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'queued', startedAt: 1, updatedAt: 1 },
      h,
      d
    );
    const merged = updateByHandle(
      h,
      { status: 'done', outcome: 'comment' },
      2,
      d
    ) as { status: string; outcome: string; mrUrl: string };
    expect(merged.status).toBe('done');
    expect(merged.mrUrl).toBe(URL);
    expect(readStates('review', d).get(URL)).toMatchObject({
      status: 'done',
      outcome: 'comment',
      reportReady: false,
    });
  });

  test('update by unknown handle returns null, writes nothing', () => {
    const d = db();
    expect(
      updateByHandle('/nope/state/reviews/x.json', { status: 'done' }, 2, d)
    ).toBeNull();
    expect(readStates('review', d).size).toBe(0);
  });

  test('report ingestion flips reportReady', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'reviewing', startedAt: 1, updatedAt: 1 },
      h,
      d
    );
    expect(setReportByHandle(h, '# report', d)).toBe(true);
    expect(readStates('review', d).get(URL)).toMatchObject({
      reportReady: true,
    });
    expect(readReport('review', URL, d)).toBe('# report');
  });

  test('readByHandle returns the row with reportReady, or null when unknown', () => {
    const d = db();
    const h = mintHandle('review', URL, '/tmp/fake-root');
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'reviewing', startedAt: 1, updatedAt: 1 },
      h,
      d
    );
    expect(readByHandle(h, d)).toMatchObject({
      status: 'reviewing',
      mrUrl: URL,
      reportReady: false,
    });
    expect(readByHandle('/nope/state/reviews/x.json', d)).toBeNull();
  });

  test('prune keeps only listed urls', () => {
    const d = db();
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 },
      mintHandle('review', URL, '/r'),
      d
    );
    pruneStates('review', new Set<string>(), d);
    expect(readStates('review', d).size).toBe(0);
  });

  test('prune unlinks the removed row report scratch file', () => {
    const d = db();
    const handleRoot = mkdtempSync(join(tmpdir(), 'board-as-unlink-'));
    const h = mintHandle('review', URL, handleRoot);
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 },
      h,
      d
    );
    mkdirSync(join(handleRoot, 'state', 'reviews'), { recursive: true });
    writeFileSync(reportPathForHandle(h), '# scratch report');

    pruneStates('review', new Set<string>(), d);

    expect(readStates('review', d).size).toBe(0);
    expect(existsSync(reportPathForHandle(h))).toBe(false);
  });

  test('a relaunch that lands between the read and the delete survives the prune', () => {
    const d = db();
    const handleRoot = mkdtempSync(join(tmpdir(), 'board-as-handle-'));
    const h = mintHandle('review', URL, handleRoot);
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 },
      h,
      d
    );
    mkdirSync(join(handleRoot, 'state', 'reviews'), { recursive: true });
    writeFileSync(reportPathForHandle(h), '# stale cycle report');

    // A second connection to the same file stands in for the relaunch that
    // reinserts this row (same handle -- mintHandle is deterministic) right
    // before pruneStates' own tombstoning UPDATE runs. If the read and the
    // update were not one transaction, the relaunch's row (and its brand new
    // report file) would be swept away by this stale-looking prune.
    const other = openStateDb(d.filename);
    const originalQuery = d.query.bind(d);
    let injected = false;
    (d as unknown as { query: typeof d.query }).query = ((sql: string) => {
      if (!injected && sql.includes('SET pruned_at = ?')) {
        injected = true;
        other
          .query(
            `INSERT INTO agent_states (lane, mr_url, state, handle, report, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?)
             ON CONFLICT(lane, mr_url) DO UPDATE SET
               state = excluded.state, handle = excluded.handle, report = NULL,
               updated_at = excluded.updated_at`
          )
          .run(
            'review',
            URL,
            JSON.stringify({
              mrUrl: URL,
              iid: 7,
              status: 'queued',
              startedAt: 99,
              updatedAt: 99,
            }),
            h,
            99
          );
      }
      return originalQuery(sql);
    }) as typeof d.query;

    try {
      pruneStates('review', new Set<string>(), d);
    } finally {
      (d as unknown as { query: typeof d.query }).query = originalQuery;
      other.close();
    }

    expect(injected).toBe(true);
    // The relaunched row survives: the busy-aborted prune never committed
    // its delete.
    expect(readStates('review', d).get(URL)).toMatchObject({
      status: 'queued',
    });
    // ...and its report file, freshly written by the "new" cycle, was never
    // unlinked by the aborted prune.
    expect(existsSync(reportPathForHandle(h))).toBe(true);
  });
});

describe('tombstones', () => {
  function prunedRow() {
    const d = db();
    const h = mintHandle('review', URL, '/r');
    insertAgentState(
      'review',
      URL,
      7,
      {
        mrUrl: URL,
        iid: 7,
        status: 'done',
        outcome: 'comment',
        startedAt: 1,
        updatedAt: 1,
      },
      h,
      d
    );
    pruneStates('review', new Set<string>(), d);
    return { d, h };
  }

  test('prune tombstones the row instead of deleting it', () => {
    const { d } = prunedRow();
    expect(readStates('review', d).size).toBe(0);
    expect(readPrunedStates('review', d).get(URL)).toMatchObject({
      status: 'done',
      outcome: 'comment',
    });
  });

  test('prune nulls the ingested report of the tombstoned row', () => {
    const d = db();
    const h = mintHandle('review', URL, '/r');
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 },
      h,
      d
    );
    setReportByHandle(h, '# big report', d);
    pruneStates('review', new Set<string>(), d);
    expect(readReport('review', URL, d)).toBeNull();
  });

  test('a relaunch over a tombstone revives the row', () => {
    const { d, h } = prunedRow();
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'queued', startedAt: 9, updatedAt: 9 },
      h,
      d
    );
    expect(readStates('review', d).get(URL)).toMatchObject({
      status: 'queued',
    });
    expect(readPrunedStates('review', d).size).toBe(0);
  });

  test('updateByHandle revives a tombstoned row', () => {
    const { d, h } = prunedRow();
    expect(updateByHandle(h, { status: 'reviewing' }, 9, d)).toMatchObject({
      status: 'reviewing',
    });
    expect(readStates('review', d).get(URL)).toMatchObject({
      status: 'reviewing',
    });
    expect(readPrunedStates('review', d).size).toBe(0);
  });

  test('resurrectState restores the tombstoned row unchanged', () => {
    const { d } = prunedRow();
    resurrectState('review', URL, d);
    expect(readStates('review', d).get(URL)).toMatchObject({
      status: 'done',
      outcome: 'comment',
    });
    expect(readPrunedStates('review', d).size).toBe(0);
  });

  test('dropPrunedState removes a tombstone but never a live row', () => {
    const { d } = prunedRow();
    dropPrunedState('review', URL, d);
    expect(readPrunedStates('review', d).size).toBe(0);
    expect(readStates('review', d).size).toBe(0);

    const live = db();
    insertAgentState(
      'review',
      URL,
      7,
      { mrUrl: URL, iid: 7, status: 'done', startedAt: 1, updatedAt: 1 },
      mintHandle('review', URL, '/r'),
      live
    );
    dropPrunedState('review', URL, live);
    expect(readStates('review', live).get(URL)).toMatchObject({
      status: 'done',
    });
  });

  test('a second prune leaves an existing tombstone stamp untouched', () => {
    const { d } = prunedRow();
    const before = (
      d
        .query('SELECT pruned_at FROM agent_states WHERE mr_url = ?')
        .get(URL) as { pruned_at: number }
    ).pruned_at;
    pruneStates('review', new Set<string>(), d);
    const after = (
      d
        .query('SELECT pruned_at FROM agent_states WHERE mr_url = ?')
        .get(URL) as { pruned_at: number }
    ).pruned_at;
    expect(after).toBe(before);
  });

  test('a v1 db without the pruned_at column migrates on open', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'board-as-v1-')), 'state.db');
    const raw = new Database(path, { create: true });
    raw.run(`CREATE TABLE agent_states (
      lane TEXT NOT NULL, mr_url TEXT NOT NULL, state TEXT NOT NULL,
      handle TEXT NOT NULL, report TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY (lane, mr_url));`);
    raw.run(
      'CREATE UNIQUE INDEX idx_agent_states_handle ON agent_states(handle);'
    );
    raw
      .query(
        `INSERT INTO agent_states (lane, mr_url, state, handle, report, updated_at)
         VALUES ('review', ?, ?, ?, NULL, 1)`
      )
      .run(
        URL,
        JSON.stringify({ mrUrl: URL, iid: 7, status: 'done', updatedAt: 1 }),
        '/r/state/reviews/x.json'
      );
    raw.run('PRAGMA user_version = 1');
    raw.close();

    const d = openStateDb(path);
    expect(readStates('review', d).get(URL)).toMatchObject({ status: 'done' });
    pruneStates('review', new Set<string>(), d);
    expect(readPrunedStates('review', d).get(URL)).toMatchObject({
      status: 'done',
    });
  });
});
