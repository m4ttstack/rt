import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { computeSnapshot } from '../src/server/metrics/snapshot.js';
import type { IndexRow, StoredMetrics } from '../src/server/store/index.js';
import type { TimeWindow } from '../src/shared/types.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-query-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore } = await import('../src/server/store/index.js');
const { buildFetchResult, storedIdentities, hasDataFor } =
  await import('../src/server/store/query.js');

// getStore() is a singleton over one on-disk file, so __resetStore (which only closes and
// reopens the handle) does not clear rows between tests -- clear() does.
beforeEach(() => getStore().clear());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Same window fixture shape as test/fixtures/outcome.ts, kept local to this file since
 * the query layer must not depend on server/pipeline. */
const W_7D: TimeWindow = {
  start: '2026-07-08T00:00:00.000Z',
  end: '2026-07-15T00:00:00.000Z',
  key: '7d',
};
const W_7D_PRIOR: TimeWindow = {
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-07-08T00:00:00.000Z',
  key: '7d',
};

const row = (over: Partial<IndexRow> = {}): IndexRow => ({
  projectPath: 'acme/app',
  iid: 1,
  title: 't',
  state: 'merged',
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
  mergedAt: '2026-07-09T12:00:00.000Z',
  authorUsername: 'alice',
  sourceBranch: 'feat/x',
  labels: [],
  scannedAt: '2026-07-09T13:00:00.000Z',
  ...over,
});

const metrics = (
  over: Partial<StoredMetrics> & Pick<StoredMetrics, 'projectPath' | 'iid'>
): StoredMetrics => ({
  description: 'desc',
  diffStats: { additions: 50, deletions: 10, filesChanged: 2 },
  fileStats: [{ path: 'src/a.ts', additions: 50, deletions: 10 }],
  labels: ['bug'],
  approvedByUsernames: [],
  notes: [],
  ...over,
});

describe('buildFetchResult: window characterization (ported from test/slicing.test.ts)', () => {
  // Mirrors test/fixtures/outcome.ts's WIDE_OUTCOME, at store granularity: seven MRs,
  // each chosen to exercise one predicate when sliced to W_7D.
  function seedWideScenario() {
    const s = getStore();
    s.upsertIndexRows([
      row({ iid: 1 }), // in W_7D by every measure
      row({ iid: 2 }), // merged inside W_7D, reviewed by bob inside W_7D
      row({
        iid: 3,
        createdAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-03T00:00:00.000Z',
        mergedAt: '2026-05-03T00:00:00.000Z',
      }), // outside W_7D, inside a wider window; must vanish from a 7d slice
      row({ iid: 4, title: 'Add widget' }),
      row({ iid: 5, title: 'Revert "Add widget"' }),
      row({
        iid: 6,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        mergedAt: '2026-06-02T00:00:00.000Z',
        sourceBranch: 'feat/ENG-99-old',
      }), // out-of-window MR carrying a Linear ticket; the issue still surfaces here
      // since windowing on closedAt happens downstream in cohorts.ts, not by MR linkage
      row({
        iid: 7,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        mergedAt: '2026-07-02T12:00:00.000Z',
      }), // in W_7D_PRIOR only
    ]);
    s.upsertMrMetrics([
      metrics({
        projectPath: 'acme/app',
        iid: 2,
        notes: [
          {
            authorUsername: 'bob',
            createdAt: '2026-07-09T02:00:00.000Z',
            system: false,
            inline: true,
          },
          {
            authorUsername: 'bob',
            createdAt: '2026-07-09T03:00:00.000Z',
            system: false,
            inline: false,
          },
        ],
      }),
    ]);
    s.upsertPipelines([
      {
        id: 'gitlab:pipeline:1',
        projectPath: 'acme/app',
        username: 'alice',
        status: 'success',
        createdAt: '2026-07-09T01:00:00.000Z',
      },
      {
        id: 'gitlab:pipeline:2',
        projectPath: 'acme/app',
        username: 'alice',
        status: 'failed',
        createdAt: '2026-07-10T01:00:00.000Z',
      },
      {
        id: 'gitlab:pipeline:3',
        projectPath: 'acme/app',
        username: 'alice',
        status: 'success',
        createdAt: '2026-05-01T01:00:00.000Z',
      }, // outside W_7D
    ]);
    s.upsertPushEvents([
      {
        username: 'alice',
        createdAt: '2026-07-09T01:00:00.000Z',
        repositoryId: 'acme/app',
      },
      {
        username: 'alice',
        createdAt: '2026-07-07T12:00:00.000Z',
        repositoryId: 'acme/app',
      }, // inside the -1d pad of W_7D
      {
        username: 'alice',
        createdAt: '2026-05-01T01:00:00.000Z',
        repositoryId: 'acme/app',
      }, // outside even the pad
    ]);
    s.upsertLinearIssues([
      {
        id: '1',
        identifier: 'ENG-1',
        title: 'Closed in window',
        url: 'https://linear.app/x/ENG-1',
        creditedUser: 'alice',
        linkedMrs: [{ iid: 1, projectPath: 'acme/app', via: 'mention' }],
        closedAt: '2026-07-09T00:00:00.000Z',
        stateType: 'completed',
        stateName: 'Done',
      },
      {
        id: '2',
        identifier: 'ENG-99',
        title: 'Not closed',
        url: 'https://linear.app/x/ENG-99',
        creditedUser: 'alice',
        linkedMrs: [{ iid: 6, projectPath: 'acme/app', via: 'mention' }],
        closedAt: null,
        stateType: 'completed',
        stateName: 'Done',
      },
    ]);
    return s;
  }

  it('keeps MRs updated on/after the window start and drops older ones', () => {
    const s = seedWideScenario();
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.mrs.map(m => m.iid).sort()).toEqual([1, 2, 4, 5]);
  });

  it('keeps pipelines created inside the window', () => {
    const s = seedWideScenario();
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.pipelines).toHaveLength(2);
  });

  it("keeps push events inside the window's +/-1d pad, mirroring the fetch", () => {
    const s = seedWideScenario();
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.pushEvents.map(e => e.createdAt).sort()).toEqual([
      '2026-07-07T12:00:00.000Z',
      '2026-07-09T01:00:00.000Z',
    ]);
  });

  it('returns every stored Linear issue, unfiltered by MR window or linkage', () => {
    const s = seedWideScenario();
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.linearIssues.map(i => i.identifier).sort()).toEqual([
      'ENG-1',
      'ENG-99',
    ]);
  });

  it('slices the prior window to a disjoint, non-empty set', () => {
    const s = seedWideScenario();
    const prior = buildFetchResult(s, W_7D_PRIOR, ['alice', 'bob']);
    expect(prior.mrs.map(m => m.iid)).toContain(7);
    expect(prior.mrs.map(m => m.iid)).not.toEqual(
      expect.arrayContaining([1, 2, 4, 5])
    );
  });

  it('excludes an MR updated after the prior window ends', () => {
    const s = seedWideScenario();
    // iid 8 was updated 07-14, after W_7D_PRIOR ends (07-08). A prior-window query
    // must not see it, or its revert scan would reach into the current window.
    s.upsertIndexRows([
      row({
        iid: 8,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
        mergedAt: '2026-07-02T12:00:00.000Z',
      }),
    ]);
    const prior = buildFetchResult(s, W_7D_PRIOR, ['alice', 'bob']);
    expect(prior.mrs.map(m => m.iid)).not.toContain(8);
  });

  // Ported from test/slicing.test.ts's "slicing preserves metric output" block, which
  // Task 5 deletes: pins the same two numbers a native 7d query must still produce.
  const SNAPSHOT_OPTS = {
    users: ['alice', 'bob'],
    sizeBand: { tooSmall: 10, tooLarge: 400 },
    doneStates: [] as string[],
    extraBotPatterns: [] as string[],
    excludeFilePatterns: [] as string[],
    ignoredMrs: [] as string[],
  };

  it('a 7d query yields the same issuesCompleted the wide-outcome slice pinned', () => {
    const s = seedWideScenario();
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    const snap = computeSnapshot(fetched, { window: W_7D, ...SNAPSHOT_OPTS });
    expect(snap.byUser.alice!.issuesCompleted).toBe(1);
  });

  it('a 7d query keeps revertRate at the pinned value', () => {
    const s = seedWideScenario();
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    const snap = computeSnapshot(fetched, { window: W_7D, ...SNAPSHOT_OPTS });
    expect(snap.byUser.alice!.revertRate).toBe(0.25);
  });
});

describe('buildFetchResult: the metrics join', () => {
  it('joins an index row with its metrics: notes, diffStats, fileStats, labels, approvers, and derived counts', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 })]);
    s.upsertMrMetrics([
      metrics({
        projectPath: 'acme/app',
        iid: 1,
        description: 'does a thing',
        diffStats: { additions: 12, deletions: 4, filesChanged: 3 },
        fileStats: [{ path: 'src/a.ts', additions: 12, deletions: 4 }],
        labels: ['bug', 'ui'],
        approvedByUsernames: ['bob'],
        notes: [
          {
            authorUsername: 'bob',
            createdAt: '2026-07-09T02:00:00.000Z',
            system: false,
            inline: true,
          },
        ],
      }),
    ]);
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.mrs).toHaveLength(1);
    const m = fetched.mrs[0]!;
    expect(m.description).toBe('does a thing');
    expect(m.additions).toBe(12);
    expect(m.deletions).toBe(4);
    expect(m.fileCount).toBe(3);
    expect(m.diffStats).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 4 },
    ]);
    expect(m.labels).toEqual(['bug', 'ui']);
    expect(m.approvedByUsernames).toEqual(['bob']);
    expect(m.notes).toEqual([
      {
        authorUsername: 'bob',
        createdAt: '2026-07-09T02:00:00.000Z',
        system: false,
        inline: true,
      },
    ]);
  });

  it('an index row with no metrics row still appears, with empty notes, zero counts, and no approvers', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 })]);
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.mrs).toHaveLength(1);
    const m = fetched.mrs[0]!;
    expect(m.notes).toEqual([]);
    expect(m.additions).toBe(0);
    expect(m.deletions).toBe(0);
    expect(m.fileCount).toBe(0);
    expect(m.approvedByUsernames).toEqual([]);
    expect(m.diffStats).toEqual([]);
    expect(m.labels).toEqual([]);
    expect(m.description).toBeNull();
  });

  it("preparedAt is null on every row, the frozen behavior cohorts.ts's ?? createdAt fallback relies on", () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 }), row({ iid: 2 })]);
    s.upsertMrMetrics([metrics({ projectPath: 'acme/app', iid: 1 })]);
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    for (const m of fetched.mrs) expect(m.preparedAt).toBeNull();
  });
});

describe('buildFetchResult: roster scope', () => {
  it('filters pipelines and push events to usernames in the roster', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 })]);
    s.upsertPipelines([
      {
        id: 'gitlab:pipeline:1',
        projectPath: 'acme/app',
        username: 'alice',
        status: 'success',
        createdAt: '2026-07-09T01:00:00.000Z',
      },
      {
        id: 'gitlab:pipeline:2',
        projectPath: 'acme/app',
        username: 'carol',
        status: 'success',
        createdAt: '2026-07-09T01:00:00.000Z',
      },
    ]);
    s.upsertPushEvents([
      {
        username: 'alice',
        createdAt: '2026-07-09T01:00:00.000Z',
        repositoryId: null,
      },
      {
        username: 'carol',
        createdAt: '2026-07-09T01:00:00.000Z',
        repositoryId: null,
      },
    ]);
    const fetched = buildFetchResult(s, W_7D, ['alice', 'bob']);
    expect(fetched.pipelines.map(p => p.username)).toEqual(['alice']);
    expect(fetched.pushEvents.map(e => e.username)).toEqual(['alice']);
  });
});

describe('buildFetchResult: approvalsAvailable', () => {
  it('is the constant true even when every joined metrics row has no approvers, since it is a tier capability flag, not a window content check', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 }), row({ iid: 2 })]);
    s.upsertMrMetrics([
      metrics({ projectPath: 'acme/app', iid: 1, approvedByUsernames: [] }),
      metrics({ projectPath: 'acme/app', iid: 2, approvedByUsernames: [] }),
    ]);
    expect(buildFetchResult(s, W_7D, ['alice', 'bob']).approvalsAvailable).toBe(
      true
    );
  });

  it('is true when there is no metrics row at all', () => {
    const s = getStore();
    s.upsertIndexRows([row({ iid: 1 })]);
    expect(buildFetchResult(s, W_7D, ['alice', 'bob']).approvalsAvailable).toBe(
      true
    );
  });
});

describe('storedIdentities', () => {
  it('returns a Record keyed by username, including unresolved entries', () => {
    const s = getStore();
    s.upsertIdentities([
      {
        username: 'alice',
        name: 'Alice',
        resolved: true,
        userId: 7,
        fetchedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        username: 'bob',
        name: null,
        resolved: false,
        userId: null,
        fetchedAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    const out = storedIdentities(s, ['alice', 'bob', 'missing']);
    expect(out).toEqual({
      alice: { username: 'alice', name: 'Alice', resolved: true, userId: 7 },
      bob: { username: 'bob', name: null, resolved: false },
    });
  });
});

describe('hasDataFor', () => {
  it('is false when any configured project lacks a scan row', () => {
    const s = getStore();
    s.recordScan('acme/app', {
      from: '2026-06-01T00:00:00.000Z',
      at: '2026-07-01T00:00:00.000Z',
    });
    expect(hasDataFor(s, ['acme/app', 'acme/other'], W_7D)).toBe(false);
  });

  it("is true when every configured project's floor is at or before the window start", () => {
    const s = getStore();
    s.recordScan('acme/app', {
      from: '2026-06-01T00:00:00.000Z',
      at: '2026-07-01T00:00:00.000Z',
    });
    s.recordScan('acme/other', {
      from: W_7D.start,
      at: '2026-07-02T00:00:00.000Z',
    });
    expect(hasDataFor(s, ['acme/app', 'acme/other'], W_7D)).toBe(true);
  });

  it('is false when a project has scanned but its floor is later than the window start', () => {
    const s = getStore();
    s.recordScan('acme/app', {
      from: '2026-07-10T00:00:00.000Z',
      at: '2026-07-15T00:00:00.000Z',
    });
    expect(hasDataFor(s, ['acme/app'], W_7D)).toBe(false);
    expect(hasDataFor(s, ['acme/app'], W_7D_PRIOR)).toBe(false);
  });
});
