import { describe, expect, it } from 'vitest';

import {
  buildRevertedTitleSet,
  revertTarget,
} from '../src/server/metrics/reverts.js';
import { computeSnapshot } from '../src/server/metrics/snapshot.js';
import {
  isBotUsername,
  median,
  percentile,
  streaks,
} from '../src/server/metrics/stats.js';
import {
  buildResponse,
  type BuildContext,
} from '../src/server/metrics/trend.js';
import { priorWindow } from '../src/server/util/window.js';
import { isRevertTitle } from '../src/shared/reverts.js';
import { FETCH, USERS, WINDOW } from './fixtures.js';

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

function snapshot() {
  return computeSnapshot(FETCH, {
    window: WINDOW,
    users: USERS,
    sizeBand: SIZE_BAND,
  });
}

describe('stats', () => {
  it('median interpolates', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5])).toBe(5);
    expect(median([])).toBeNull();
  });

  it('percentile p90 of a single sample is that sample', () => {
    expect(percentile([24], 0.9)).toBe(24);
  });

  it('detects GitLab bot / service accounts', () => {
    expect(isBotUsername('group_6451920_bot_0d309eed7eb87bfd')).toBe(true);
    expect(isBotUsername('project_123_bot_abc')).toBe(true);
    expect(isBotUsername('some_ci_bot')).toBe(true);
    expect(isBotUsername('ghost')).toBe(true);
    expect(isBotUsername('alexrivera')).toBe(false);
    expect(isBotUsername('abbott')).toBe(false); // not a bot despite containing "bot"
    expect(isBotUsername(null)).toBe(false);
  });

  it('streaks finds distinct days, longest run, and trailing current streak', () => {
    const s = streaks([
      '2026-05-08T09:00:00Z',
      '2026-05-09T09:00:00Z',
      '2026-05-10T09:00:00Z',
      '2026-05-10T15:00:00Z',
      '2026-05-20T09:00:00Z',
    ]);
    expect(s).toEqual({ distinct: 4, longest: 3, current: 1 });
  });
});

describe('revert detection', () => {
  it('extracts the original title from a Revert MR', () => {
    expect(revertTarget(FETCH.mrs[3]!)).toBe('add feature x');
    expect(revertTarget(FETCH.mrs[0]!)).toBeNull();
  });

  it('builds the reverted-title set from the corpus', () => {
    expect(buildRevertedTitleSet(FETCH.mrs).has('add feature x')).toBe(true);
  });

  it('isRevertTitle is the dependency-free title test the fetcher uses', () => {
    expect(isRevertTitle('Revert "Add feature X"')).toBe(true);
    expect(isRevertTitle('Add feature X')).toBe(false);
  });
});

describe('computeSnapshot', () => {
  const snap = snapshot();
  const alice = snap.byUser.alice!;
  const bob = snap.byUser.bob!;

  it('volume metrics (4.1, 4.2)', () => {
    expect(alice.additions).toBe(105);
    expect(alice.deletions).toBe(22);
    expect(alice.mrsMerged).toBe(2);
    expect(bob.additions).toBe(70);
    expect(bob.deletions).toBe(150);
    expect(bob.mrsMerged).toBe(2);
  });

  it('MR size health (4.8): two-sided band share', () => {
    expect(alice.sizeHealthPct).toBe(0.5); // MR1 healthy, MR2 too small
    expect(bob.sizeHealthPct).toBe(1); // both in band
  });

  it('revert rate (4.7): attributed to original author', () => {
    expect(alice.revertedCount).toBe(1);
    expect(alice.revertRate).toBe(0.5);
    expect(bob.revertedCount).toBe(0);
    expect(bob.revertRate).toBe(0);
  });

  it('pipelines (4.4): in-window count + status breakdown', () => {
    expect(alice.pipelines).toBe(2);
    expect(alice.pipelineStatus).toEqual({
      success: 1,
      failed: 1,
      canceled: 0,
      other: 0,
    });
    expect(bob.pipelines).toBe(1);
  });

  it('reviewed + depth (4.3, 4.5)', () => {
    expect(alice.mrsReviewed).toBe(1); // MR3
    expect(alice.reviewDepth).toBe(2); // two inline notes on MR3
    expect(bob.mrsReviewed).toBe(1); // MR1
    expect(bob.reviewDepth).toBe(1); // one inline note on MR1
  });

  it('review latency (4.6): author-side and reviewer-side', () => {
    expect(alice.reviewLatencyHours.p50).toBe(26); // MR1 first touch 26h after open
    expect(alice.responseLatencyHours.p50).toBe(24); // alice first response on MR3
    expect(bob.reviewLatencyHours.p50).toBe(24); // MR3 first touch 24h
    expect(bob.responseLatencyHours.p50).toBe(26); // bob first response on MR1
  });

  it('reciprocity (4.10): given / received', () => {
    expect(alice.reciprocity).toBe(1);
    expect(bob.reciprocity).toBe(1);
  });

  it('coding days are push-based; streak is MERGE-based (4.9)', () => {
    // Coding days = distinct push-active days (unchanged).
    expect(alice.codingDays).toBe(4);
    expect(bob.codingDays).toBe(4);
    // Streak counts consecutive days with a MERGED MR, not pushes. alice merged on
    // 05-10 and 05-11 (consecutive) → merge streak 2, even though her push streak is 3.
    expect(alice.longestStreak).toBe(2);
    expect(alice.currentStreak).toBe(2);
    expect(bob.longestStreak).toBe(1); // bob merged 05-15 and 05-25 → not consecutive
    expect(bob.currentStreak).toBe(1);
  });
});

describe('buildResponse trend deltas (4.11)', () => {
  const ctx = (
    priorW: ReturnType<typeof priorWindow> | null
  ): BuildContext => ({
    scope: { type: 'group', groupPath: 'org' },
    window: WINDOW,
    priorWindow: priorW,
    baseUrl: 'https://gitlab.com',
    currentUser: 'alice',
    generatedAt: '2026-05-31T00:00:00.000Z',
    fromCache: false,
    identities: {
      alice: { username: 'alice', name: 'Alice', resolved: true },
      bob: { username: 'bob', name: 'Bob', resolved: true },
    },
    warnings: [],
  });

  it('no prior snapshot => null deltas, hasTrend false', () => {
    const res = buildResponse(snapshot(), null, ctx(null));
    expect(res.hasTrend).toBe(false);
    const alice = res.users.find(u => u.username === 'alice')!;
    expect(alice.metrics.additions.value).toBe(105);
    expect(alice.metrics.additions.delta).toBeNull();
    expect(alice.isCurrentUser).toBe(true);
    expect(alice.name).toBe('Alice');
  });

  it('with prior snapshot => deltas computed, hasTrend true', () => {
    const current = snapshot();
    // Synthetic prior: alice had 100 additions, bob had 80.
    const prior = snapshot();
    prior.byUser.alice!.additions = 100;
    prior.byUser.bob!.additions = 80;
    const res = buildResponse(current, prior, ctx(priorWindow(WINDOW)));
    expect(res.hasTrend).toBe(true);
    const alice = res.users.find(u => u.username === 'alice')!;
    expect(alice.metrics.additions.delta).toBe(5);
    const bob = res.users.find(u => u.username === 'bob')!;
    expect(bob.metrics.additions.delta).toBe(-10);
  });

  it('flags the tier-fallback note when approvals are unavailable', () => {
    const noApprovals = { ...FETCH, approvalsAvailable: false };
    const snap = computeSnapshot(noApprovals, {
      window: WINDOW,
      users: USERS,
      sizeBand: SIZE_BAND,
    });
    const res = buildResponse(snap, null, ctx(null));
    expect(res.metricNotes.mrsReviewed).toContain('note authors only');
    expect(res.metricNotes.revertRate).toContain('Detected reverts only');
  });
});
