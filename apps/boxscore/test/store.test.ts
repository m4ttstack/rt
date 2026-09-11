import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type {
  IndexRow,
  StoredLinearIssue,
  StoredMetrics,
  StoredPipeline,
} from '../src/server/store/index.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-store-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore, mrKey, __resetStore } =
  await import('../src/server/store/index.js');

afterEach(() => __resetStore());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const row = (over: Partial<IndexRow> = {}): IndexRow => ({
  projectPath: 'g/p',
  iid: 1,
  title: 't',
  state: 'merged',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-02T00:00:00Z',
  mergedAt: '2026-05-02T00:00:00Z',
  authorUsername: 'ada',
  sourceBranch: 'b',
  labels: [],
  scannedAt: '2026-05-03T00:00:00Z',
  ...over,
});

const metrics = (
  projectPath: string,
  iid: number,
  over: Partial<StoredMetrics> = {}
): StoredMetrics => ({
  projectPath,
  iid,
  description: 'desc',
  diffStats: { additions: 3, deletions: 1, filesChanged: 2 },
  fileStats: [{ path: 'a.ts', additions: 2, deletions: 1 }],
  labels: ['bug'],
  approvedByUsernames: ['bob'],
  notes: [
    {
      authorUsername: 'bob',
      createdAt: '2026-05-01T00:00:00Z',
      system: false,
      inline: true,
    },
  ],
  ...over,
});

const pipeline = (over: Partial<StoredPipeline> = {}): StoredPipeline => ({
  id: 'gitlab:pipeline:1',
  projectPath: 'g/p',
  username: 'ada',
  status: 'success',
  createdAt: '2026-05-01T00:00:00Z',
  ...over,
});

describe('index rows', () => {
  it('upserts by project:iid, last write wins, and round-trips labels', () => {
    const s = getStore();
    s.upsertIndexRows([row({ labels: ['bug'] })]);
    s.upsertIndexRows([row({ title: 'renamed', labels: ['bug', 'ui'] })]);
    const out = s.indexRowsByKeys([mrKey('g/p', 1)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('renamed');
    expect(out[0]!.labels).toEqual(['bug', 'ui']);
  });

  it('selects by updatedAt window, inclusive of both bounds', () => {
    const s = getStore();
    s.upsertIndexRows([
      row({ iid: 1, updatedAt: '2026-05-01T00:00:00Z' }),
      row({ iid: 2, updatedAt: '2026-05-15T00:00:00Z' }),
      row({ iid: 3, updatedAt: '2026-06-01T00:00:00Z' }),
    ]);
    const got = s.indexRowsUpdatedWithin(
      '2026-05-01T00:00:00Z',
      '2026-06-01T00:00:00Z'
    );
    expect(got.map(r => r.iid).sort()).toEqual([1, 2, 3]);
    expect(
      s
        .indexRowsUpdatedWithin('2026-05-02T00:00:00Z', '2026-05-20T00:00:00Z')
        .map(r => r.iid)
    ).toEqual([2]);
  });

  it('allIndexRows sweeps every stored row regardless of updatedAt', () => {
    const s = getStore();
    s.clear();
    s.upsertIndexRows([
      row({ iid: 1, updatedAt: '1999-01-01T00:00:00Z' }),
      row({ iid: 2, updatedAt: '2026-05-15T00:00:00Z' }),
    ]);
    expect(
      s
        .allIndexRows()
        .map(r => r.iid)
        .sort()
    ).toEqual([1, 2]);
  });
});

describe('scan meta', () => {
  it('the watermark and floor are per project and absent until a scan is recorded', () => {
    const s = getStore();
    expect(s.lastScan('g/p')).toBeNull();
    expect(s.scanFloor('g/p')).toBeNull();
    s.recordScan('g/p', {
      from: '2026-04-01T00:00:00Z',
      at: '2026-05-03T00:00:00Z',
    });
    expect(s.lastScan('g/p')).toBe('2026-05-03T00:00:00Z');
    expect(s.scanFloor('g/p')).toBe('2026-04-01T00:00:00Z');
    expect(s.lastScan('g/other')).toBeNull();
    expect(s.scanFloor('g/other')).toBeNull();
  });

  it('a later scan advances the watermark and keeps the floor; an earlier `from` lowers the floor', () => {
    const s = getStore();
    s.recordScan('g/p', {
      from: '2026-04-01T00:00:00Z',
      at: '2026-05-03T00:00:00Z',
    });
    s.recordScan('g/p', {
      from: '2026-05-03T00:00:00Z',
      at: '2026-05-10T00:00:00Z',
    });
    expect(s.lastScan('g/p')).toBe('2026-05-10T00:00:00Z');
    expect(s.scanFloor('g/p')).toBe('2026-04-01T00:00:00Z');

    s.recordScan('g/p', {
      from: '2026-01-01T00:00:00Z',
      at: '2026-05-11T00:00:00Z',
    });
    expect(s.lastScan('g/p')).toBe('2026-05-11T00:00:00Z');
    expect(s.scanFloor('g/p')).toBe('2026-01-01T00:00:00Z');
  });
});

describe('metrics rows', () => {
  it('freshMergedMetricsKeys returns merged rows whose stored metrics reflect the latest update', () => {
    const s = getStore();
    s.upsertIndexRows([
      row({ iid: 1, state: 'merged', updatedAt: '2026-05-02T00:00:00Z' }),
      row({ iid: 2, state: 'merged', updatedAt: '2026-05-09T00:00:00Z' }),
      row({ iid: 3, state: 'opened', mergedAt: null }),
    ]);
    s.upsertMrMetrics([
      { ...metrics('g/p', 1), updatedAt: '2026-05-02T00:00:00Z' },
      { ...metrics('g/p', 2), updatedAt: '2026-05-02T00:00:00Z' },
      { ...metrics('g/p', 3), updatedAt: '2026-05-02T00:00:00Z' },
    ]);
    const keys = s.freshMergedMetricsKeys([
      mrKey('g/p', 1),
      mrKey('g/p', 2),
      mrKey('g/p', 3),
    ]);
    // iid 1 merged and current -> skippable; iid 2 merged but its metrics predate the
    // latest update -> must re-fetch; iid 3 is not merged.
    expect([...keys]).toEqual([mrKey('g/p', 1)]);
  });

  it('freshMergedMetricsKeys treats a metrics row with no timestamp as stale', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1, state: 'merged' })]);
    // updatedAt omitted -> persisted as NULL, which cannot prove the snapshot is current.
    s.upsertMrMetrics([metrics('g/p', 1)]);
    expect([...s.freshMergedMetricsKeys([mrKey('g/p', 1)])]).toEqual([]);
  });

  it('round-trips notes, diffStats, fileStats, labels, and approvers', () => {
    const s = getStore();
    const m = metrics('g/p', 1);
    s.upsertMrMetrics([m]);
    expect(s.metricsByKeys([mrKey('g/p', 1)])[0]).toEqual(m);
  });
});

describe('time-ranged rows', () => {
  it('pipelines and push events select by createdAt window', () => {
    const s = getStore();
    s.upsertPipelines([
      {
        id: 'gitlab:pipeline:1',
        projectPath: 'g/p',
        username: 'ada',
        status: 'success',
        createdAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 'gitlab:pipeline:2',
        projectPath: 'g/p',
        username: 'ada',
        status: 'failed',
        createdAt: '2026-06-10T00:00:00Z',
      },
    ]);
    s.upsertPushEvents([
      {
        username: 'ada',
        createdAt: '2026-05-02T00:00:00Z',
        repositoryId: 'gitlab:42',
      },
      {
        username: 'ada',
        createdAt: '2026-06-10T00:00:00Z',
        repositoryId: 'gitlab:42',
      },
    ]);
    expect(
      s
        .pipelinesBetween('2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')
        .map(p => p.id)
    ).toEqual(['gitlab:pipeline:1']);
    expect(
      s.pushEventsBetween('2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')
    ).toHaveLength(1);
  });
});

describe('linear', () => {
  it('allLinearIssues round-trips every stored issue', () => {
    const s = getStore();
    s.upsertLinearIssues([
      {
        id: '1',
        identifier: 'ENG-1',
        title: 'a',
        url: 'u1',
        creditedUser: 'ada',
        linkedMrs: [{ projectPath: 'g/p', iid: 1, via: 'mention' }],
        closedAt: null,
        stateType: 'completed',
        stateName: 'Done',
      },
      {
        id: '2',
        identifier: 'ENG-2',
        title: 'b',
        url: 'u2',
        creditedUser: 'bob',
        linkedMrs: [{ projectPath: 'g/p', iid: 99, via: 'mention' }],
        closedAt: null,
        stateType: 'started',
        stateName: 'In Progress',
      },
    ]);
    const got = s.allLinearIssues();
    expect(got.map(i => i.identifier).sort()).toEqual(['ENG-1', 'ENG-2']);
    expect(got.find(i => i.identifier === 'ENG-1')!.linkedMrs).toEqual([
      { projectPath: 'g/p', iid: 1, via: 'mention' },
    ]);
  });
  it('id validity is tri-state and cached', () => {
    const s = getStore();
    expect(s.isValidLinearId('ENG-1')).toBeNull();
    s.putLinearIds([
      { id: 'ENG-1', valid: true },
      { id: 'ENG-2', valid: false },
    ]);
    expect(s.isValidLinearId('ENG-1')).toBe(true);
    expect(s.isValidLinearId('ENG-2')).toBe(false);
    expect(s.linearIdStats()).toEqual({ valid: 1, invalid: 1 });
  });
});

describe('identities', () => {
  it('round-trips identity rows by username', () => {
    const s = getStore();
    s.upsertIdentities([
      {
        username: 'ada',
        name: 'Ada L',
        resolved: true,
        userId: 7,
        fetchedAt: '2026-05-01T00:00:00Z',
      },
      {
        username: 'bob',
        name: null,
        resolved: false,
        userId: null,
        fetchedAt: '2026-05-01T00:00:00Z',
      },
    ]);
    const got = s.identities(['ada', 'bob', 'missing']);
    expect(got).toHaveLength(2);
    expect(got.find(i => i.username === 'ada')).toEqual({
      username: 'ada',
      name: 'Ada L',
      resolved: true,
      userId: 7,
      fetchedAt: '2026-05-01T00:00:00Z',
    });
    expect(got.find(i => i.username === 'bob')?.resolved).toBe(false);
  });
});

describe('lifecycle', () => {
  it('clear empties every table but keeps the store usable', () => {
    const s = getStore();
    s.upsertIndexRows([row()]);
    s.upsertPipelines([pipeline()]);
    s.clear();
    expect(s.counts()).toEqual({
      mrIndex: 0,
      mrMetrics: 0,
      pipelines: 0,
      pushEvents: 0,
      linearIssues: 0,
    });
    s.upsertIndexRows([row()]);
    expect(s.counts().mrIndex).toBe(1);
  });

  it('a schema version bump drops and recreates every table', async () => {
    const s = getStore();
    s.upsertIndexRows([row()]);
    expect(s.counts().mrIndex).toBe(1);
    s.close();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    const raw = new Database(process.env.BOXSCORE_DB!);
    raw.exec('PRAGMA user_version = 0');
    raw.close();
    __resetStore();
    const reopened = getStore();
    expect(reopened.counts().mrIndex).toBe(0);
  });

  it('a failing write in a batch leaves the table unchanged', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 })]);
    expect(() =>
      s.upsertIndexRows([row({ iid: 2 }), null as unknown as IndexRow])
    ).toThrow();
    expect(s.counts().mrIndex).toBe(1);
  });
});

describe('linear issue stickiness', () => {
  const closed = (over: Partial<StoredLinearIssue> = {}): StoredLinearIssue => ({
    id: 'uuid-CV-1',
    identifier: 'CV-1',
    title: 'Ticket CV-1',
    url: 'https://linear.app/acme/issue/CV-1',
    creditedUser: 'alice',
    linkedMrs: [{ iid: 10, projectPath: 'org/app', via: 'attachment' }],
    closedAt: '2026-05-10T00:00:00.000Z',
    stateType: 'completed',
    stateName: 'Done',
    ...over,
  });

  it('an incoming null closedAt preserves the stored closure', () => {
    getStore().upsertLinearIssues([closed()]);
    getStore().upsertLinearIssues([
      closed({ creditedUser: null, linkedMrs: [], closedAt: null, stateName: 'Ready for Release' }),
    ]);
    const row = getStore().allLinearIssues().find(i => i.identifier === 'CV-1')!;
    expect(row.closedAt).toBe('2026-05-10T00:00:00.000Z');
    expect(row.creditedUser).toBe('alice');
    expect(row.linkedMrs).toEqual([{ iid: 10, projectPath: 'org/app', via: 'attachment' }]);
    expect(row.stateName).toBe('Ready for Release');
  });

  it('an incoming non-null closedAt replaces the stored closure', () => {
    getStore().upsertLinearIssues([closed()]);
    getStore().upsertLinearIssues([
      closed({ creditedUser: 'bob', closedAt: '2026-05-20T00:00:00.000Z' }),
    ]);
    const row = getStore().allLinearIssues().find(i => i.identifier === 'CV-1')!;
    expect(row.closedAt).toBe('2026-05-20T00:00:00.000Z');
    expect(row.creditedUser).toBe('bob');
  });
});

describe('indexRowsByKeys', () => {
  it('returns only the requested rows', () => {
    getStore().upsertIndexRows([
      row({ projectPath: 'org/app', iid: 1 }),
      row({ projectPath: 'org/app', iid: 2 }),
    ]);
    const rows = getStore().indexRowsByKeys(['org/app:2']);
    expect(rows.map(r => r.iid)).toEqual([2]);
  });
});

describe('legacy row normalization', () => {
  it('reads pre-redesign rows with defaults for the new fields', () => {
    getStore().__rawInsertLinearIssue?.('CV-9', JSON.stringify({
      id: 'uuid-CV-9', identifier: 'CV-9', title: 'old', url: 'https://linear.app/acme/issue/CV-9',
      assignedUser: 'alice', linkedMrs: [{ iid: 7, projectPath: 'org/app' }],
      stateType: 'completed', stateName: 'Done',
    }));
    const row = getStore().allLinearIssues().find(i => i.identifier === 'CV-9')!;
    expect(row.closedAt).toBeNull();
    expect(row.creditedUser).toBe('alice');
    expect(row.linkedMrs).toEqual([{ iid: 7, projectPath: 'org/app', via: 'mention' }]);
  });
});
