import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { readByHandle } from '../state/agent-states.ts';
import {
  closeStateDb,
  dbPathForRoot,
  getStateDb,
  openStateDb,
} from '../state/db.ts';
import { getKvValue, setKvValue } from '../state/kv-blob.ts';
import { importLegacyState } from '../state/legacy-import.ts';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'board-legacy-import-'));
}

function writeLegacyFile(root: string, rel: string, content: string): void {
  const path = join(root, 'state', rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function writeLegacyJson(root: string, rel: string, obj: unknown): void {
  writeLegacyFile(root, rel, JSON.stringify(obj));
}

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/1';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/2';
const URL_C = 'https://gitlab.com/acme/webapp/-/merge_requests/3';

describe('importLegacyState', () => {
  test('every surface lands in its table/kv slot, and the review .md lands in report', () => {
    const root = tempRoot();
    const db = openStateDb(join(root, 'state.db'));

    writeLegacyJson(root, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      outcome: 'comment',
      startedAt: 50,
      updatedAt: 100,
    });
    writeLegacyFile(root, 'reviews/mr-1.md', '# report');

    writeLegacyJson(root, 'responds/mr-2.json', {
      mrUrl: URL_B,
      iid: 2,
      status: 'done',
      startedAt: 50,
      updatedAt: 100,
    });

    writeLegacyJson(root, 'doctors/mr-3.json', {
      mrUrl: URL_C,
      iid: 3,
      status: 'done',
      startedAt: 50,
      updatedAt: 100,
    });

    writeLegacyJson(root, 'drafts/mr-1-inherited-note.json', {
      mrUrl: URL_A,
      iid: 1,
      kind: 'inherited-note',
      body: 'hello',
      status: 'held',
      createdAt: 10,
      updatedAt: 20,
    });

    writeLegacyJson(root, 'nudges/nudge-1.json', {
      id: 'nudge-1',
      mrUrl: URL_A,
      iid: 1,
      from: 'alice',
      receivedAt: 30,
    });

    writeLegacyJson(root, 'nudges-sent/mr-1.json', {
      nudgeId: 'nudge-1',
      mrUrl: URL_A,
      iid: 1,
      reviewer: 'bob',
      sentAt: 40,
    });

    writeLegacyJson(root, 'outbox/env-1.json', {
      envelope: {
        id: 'env-1',
        to: 'bob',
        type: 'review-state',
        sentAt: 5,
        payload: {},
      },
      queuedAt: 5,
      attempts: 0,
    });

    writeLegacyJson(root, 'slack/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'found',
      channelId: 'C1',
      messageTs: '1.1',
      checkedAt: 60,
    });

    writeLegacyJson(root, 'auto-dispatch.json', {
      identity: { username: 'alice', fetchedAt: 1 },
      mrs: {},
    });

    writeLegacyFile(root, 'agent-status-cursor', '42');

    writeLegacyJson(root, 'slack-index-eng-review.json', {
      channelId: 'C1',
      teamDomain: 'acme.slack.com',
      lastTs: '1.1',
      messages: [],
    });

    const result = importLegacyState(db, [root]);

    expect(result.imported).toBe(11);
    expect(result.skipped).toBe(0);
    expect(result.renamed).toEqual([root]);

    const reviewRow = db
      .query(
        'SELECT state, report, handle FROM agent_states WHERE lane = ? AND mr_url = ?'
      )
      .get('review', URL_A) as {
      state: string;
      report: string | null;
      handle: string;
    };
    expect(JSON.parse(reviewRow.state).status).toBe('done');
    expect(reviewRow.report).toBe('# report');

    const respondRow = db
      .query('SELECT state FROM agent_states WHERE lane = ? AND mr_url = ?')
      .get('respond', URL_B) as { state: string };
    expect(JSON.parse(respondRow.state).status).toBe('done');

    const doctorRow = db
      .query('SELECT state FROM agent_states WHERE lane = ? AND mr_url = ?')
      .get('doctor', URL_C) as { state: string };
    expect(JSON.parse(doctorRow.state).status).toBe('done');

    const draftRow = db
      .query('SELECT draft FROM drafts WHERE mr_url = ? AND kind = ?')
      .get(URL_A, 'inherited-note') as { draft: string };
    expect(JSON.parse(draftRow.draft).body).toBe('hello');

    const nudgeRow = db
      .query('SELECT nudge FROM nudges WHERE id = ?')
      .get('nudge-1') as {
      nudge: string;
    };
    expect(JSON.parse(nudgeRow.nudge).from).toBe('alice');

    const sentRow = db
      .query('SELECT nudge FROM nudges_sent WHERE mr_url = ?')
      .get(URL_A) as { nudge: string };
    expect(JSON.parse(sentRow.nudge).reviewer).toBe('bob');

    const outboxRow = db
      .query('SELECT entry FROM outbox WHERE envelope_id = ?')
      .get('env-1') as { entry: string };
    expect(JSON.parse(outboxRow.entry).queuedAt).toBe(5);

    const slackRefRow = db
      .query('SELECT ref FROM slack_refs WHERE mr_url = ?')
      .get(URL_A) as { ref: string };
    expect(JSON.parse(slackRefRow.ref).channelId).toBe('C1');

    const memory = getKvValue<{ identity: { username: string } | null }>(
      'triage',
      'memory',
      { identity: null },
      db
    );
    expect(memory.identity?.username).toBe('alice');

    const cursor = getKvValue<number | null>(
      'agent-status',
      'cursor',
      null,
      db
    );
    expect(cursor).toBe(42);

    const index = getKvValue<{ channelId: string } | null>(
      'slack-index',
      'eng-review',
      null,
      db
    );
    expect(index?.channelId).toBe('C1');

    // legacy dir renamed, marker set
    expect(
      readdirSync(root).some(n => /^state\.imported-\d{4}-\d{2}-\d{2}$/.test(n))
    ).toBe(true);
    expect(readdirSync(root)).not.toContain('state');
    expect(getKvValue('meta', 'legacy-import-done', false, db)).toBe(true);
  });

  test('two roots offering the same key: newest updatedAt wins', () => {
    const rootOld = tempRoot();
    const rootNew = tempRoot();
    const db = openStateDb(join(rootOld, 'state.db'));

    writeLegacyJson(rootOld, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'reviewing',
      startedAt: 1,
      updatedAt: 100,
    });
    writeLegacyJson(rootNew, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 200,
    });

    const result = importLegacyState(db, [rootOld, rootNew]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.renamed.sort()).toEqual([rootNew, rootOld].sort());

    const row = db
      .query(
        'SELECT state, updated_at FROM agent_states WHERE lane = ? AND mr_url = ?'
      )
      .get('review', URL_A) as { state: string; updated_at: number };
    expect(JSON.parse(row.state).status).toBe('done');
    expect(row.updated_at).toBe(200);
  });

  test('identity-less legacy files are skipped and counted', () => {
    const root = tempRoot();
    const db = openStateDb(join(root, 'state.db'));

    writeLegacyJson(root, 'reviews/broken.json', {
      mrUrl: '',
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 1,
    });
    writeLegacyFile(root, 'reviews/corrupt.json', '{not json');

    const result = importLegacyState(db, [root]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);

    const rows = db.query('SELECT * FROM agent_states').all();
    expect(rows.length).toBe(0);
  });

  test('the imported state blob always carries the normalized identity, even without a legacy iid', () => {
    const root = tempRoot();
    const db = openStateDb(join(root, 'state.db'));

    // No `iid` field at all on the legacy record.
    writeLegacyJson(root, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      status: 'done',
      startedAt: 1,
      updatedAt: 1,
    });

    importLegacyState(db, [root]);

    const row = db
      .query('SELECT state FROM agent_states WHERE lane = ? AND mr_url = ?')
      .get('review', URL_A) as { state: string };
    const state = JSON.parse(row.state);
    expect(state.mrUrl).toBe(URL_A);
    expect(state.iid).toBe(0);
    expect(typeof state.iid).toBe('number');
  });

  test('handle rule: legacy path kept when the row came from the db being imported into', () => {
    const root = tempRoot();
    const dbPath = dbPathForRoot(root);
    const db = openStateDb(dbPath);

    writeLegacyJson(root, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 100,
    });

    importLegacyState(db, [root]);

    const row = db
      .query('SELECT handle FROM agent_states WHERE lane = ? AND mr_url = ?')
      .get('review', URL_A) as { handle: string };
    const expectedLegacyPath = join(root, 'state', 'reviews', 'mr-1.json');
    expect(row.handle).toBe(expectedLegacyPath);
    expect(readByHandle(row.handle, db)).not.toBeNull();
  });

  test('handle rule: fresh handle minted when the row came from a different root', () => {
    const otherRoot = tempRoot();
    const dbRoot = tempRoot();
    const db = openStateDb(dbPathForRoot(dbRoot));

    writeLegacyJson(otherRoot, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 100,
    });

    importLegacyState(db, [otherRoot]);

    const row = db
      .query('SELECT handle FROM agent_states WHERE lane = ? AND mr_url = ?')
      .get('review', URL_A) as { handle: string };
    const otherRootLegacyPath = join(
      otherRoot,
      'state',
      'reviews',
      'mr-1.json'
    );
    expect(row.handle).not.toBe(otherRootLegacyPath);
    expect(readByHandle(row.handle, db)).not.toBeNull();
  });

  test('a second importLegacyState call against the same db imports nothing', () => {
    const root = tempRoot();
    const db = openStateDb(join(root, 'state.db'));

    writeLegacyJson(root, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 100,
    });

    const first = importLegacyState(db, [root]);
    expect(first.imported).toBe(1);

    const second = importLegacyState(db, [root]);
    expect(second).toEqual({ imported: 0, skipped: 0, renamed: [] });

    const rows = db.query('SELECT * FROM agent_states').all();
    expect(rows.length).toBe(1);
  });

  test('pre-tabs single slack-index.json is not imported', () => {
    const root = tempRoot();
    const db = openStateDb(join(root, 'state.db'));

    writeLegacyJson(root, 'slack-index.json', {
      channelId: 'legacy',
      teamDomain: 'acme.slack.com',
      lastTs: '1.1',
      messages: [],
    });

    const result = importLegacyState(db, [root]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(getKvValue('slack-index', 'legacy', null, db)).toBeNull();
  });

  test('a crash-before-marker re-run never downgrades an already-committed newer row', () => {
    const rootA = tempRoot();
    const rootB = tempRoot();
    const dbPath = join(rootA, 'state.db');
    const db = openStateDb(dbPath);

    writeLegacyJson(rootA, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 200,
    });

    const first = importLegacyState(db, [rootA]);
    expect(first.imported).toBe(1);
    // rootA's legacy dir is already renamed away by the completed run above.
    expect(readdirSync(rootA)).not.toContain('state');

    // Simulate a crash between the import transaction committing and the
    // marker write landing: clear the marker directly, as a crash would
    // leave it, without redoing the (already-renamed) rootA directory.
    setKvValue('meta', 'legacy-import-done', false, db);

    // A second, unrelated root shows up with an OLDER copy of the same row.
    writeLegacyJson(rootB, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'reviewing',
      startedAt: 1,
      updatedAt: 100,
    });

    importLegacyState(db, [rootA, rootB]);

    const row = db
      .query(
        'SELECT state, updated_at FROM agent_states WHERE lane = ? AND mr_url = ?'
      )
      .get('review', URL_A) as { state: string; updated_at: number };
    expect(row.updated_at).toBe(200);
    expect(JSON.parse(row.state).status).toBe('done');
  });

  // chmod 000 does not block root from reading a directory, so the throw
  // this test depends on never happens under root.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  test.skipIf(isRoot)(
    'getStateDb rolls the singleton back on an import throw, and retries cleanly',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'board-legacy-retry-'));
      const reviewsDir = join(dir, 'state', 'reviews');
      mkdirSync(reviewsDir, { recursive: true });
      writeFileSync(
        join(reviewsDir, 'mr-1.json'),
        JSON.stringify({
          mrUrl: URL_A,
          iid: 1,
          status: 'done',
          startedAt: 1,
          updatedAt: 1,
        })
      );
      // Make the legacy reviews dir unreadable so importLane's readdirSync
      // throws uncaught, forcing a genuine importLegacyState failure.
      chmodSync(reviewsDir, 0o000);

      const prevStateDb = process.env.BOARD_STATE_DB;
      process.env.BOARD_STATE_DB = join(dir, 'state.db');
      closeStateDb();
      try {
        expect(() => getStateDb()).toThrow();

        // Fix the fault and retry: the failed call must not have poisoned the
        // singleton, so this call reopens and completes the import.
        chmodSync(reviewsDir, 0o755);
        const db = getStateDb();
        const row = db
          .query('SELECT state FROM agent_states WHERE lane = ? AND mr_url = ?')
          .get('review', URL_A) as { state: string } | null;
        expect(row).not.toBeNull();
        expect(getKvValue('meta', 'legacy-import-done', false, db)).toBe(true);
      } finally {
        // A successful retry already renamed the legacy dir away; only
        // restore permissions if the chmod-000 directory is still there.
        try {
          chmodSync(reviewsDir, 0o755);
        } catch {
          // already renamed away by a successful import
        }
        closeStateDb();
        if (prevStateDb === undefined) delete process.env.BOARD_STATE_DB;
        else process.env.BOARD_STATE_DB = prevStateDb;
      }
    }
  );

  test('a renameSync failure is non-fatal: data still lands and the marker still gets set', () => {
    const root = tempRoot();
    const db = openStateDb(join(root, 'state.db'));

    writeLegacyJson(root, 'reviews/mr-1.json', {
      mrUrl: URL_A,
      iid: 1,
      status: 'done',
      startedAt: 1,
      updatedAt: 1,
    });

    // Block the post-commit rename by pre-creating its target as a plain
    // file: renaming a directory onto an existing non-directory throws.
    const dateStamp = new Date().toISOString().slice(0, 10);
    writeFileSync(join(root, `state.imported-${dateStamp}`), 'blocked');

    const result = importLegacyState(db, [root]);
    expect(result.imported).toBe(1);
    expect(result.renamed).toEqual([]);

    const row = db
      .query('SELECT state FROM agent_states WHERE lane = ? AND mr_url = ?')
      .get('review', URL_A) as { state: string } | null;
    expect(row).not.toBeNull();
    expect(getKvValue('meta', 'legacy-import-done', false, db)).toBe(true);
  });
});
