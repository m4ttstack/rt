#!/usr/bin/env bun
/**
 * MAT-143: `MRDashboard`'s batched multi-MR fetch must lose one row, not the
 * whole refresh, when one PR in the group fails to fetch -- AND a consumer
 * built on `DashboardGroup` must learn about it even when the row does not
 * get dropped.
 *
 * `createDashboardGroup.batchFetch` used to wrap `provider.fetchPullRequests`
 * in a blanket try/catch that turned ANY rejection into `null`. Once
 * `GitHubProvider`'s reviews fetch stopped silently truncating and started
 * rejecting instead (an earlier phase), one PR's rate-limited reviews page
 * rejected the whole `fetchPullRequests` call -- and this `catch { return
 * null }` turned that into "nothing updates, nothing said why" for every MR
 * in the group, not just the one that actually had a problem.
 *
 * `fetchDashboardBatch` is the fix's unit of testability: it is what
 * `batchFetch` now delegates to, split out so the row-vs-batch behavior can
 * be pinned without driving `createRealtimeWatcher`'s timers.
 *
 * A second round of review caught the same defect one layer up: the first
 * fix computed `degraded` only for iids missing from `prs`, which matched
 * `reviews`/`detail` (both drop the PR) but not `checks`/`threads` (both
 * keep the PR present with one field degraded). `fakeProviderWithPresent-
 * DegradedPR` and the tests built on it exercise exactly that case, which
 * `fakeProvider` (drops PR 2 entirely) cannot.
 */
import { describe, expect, test } from 'bun:test';
import { createDashboard, fetchDashboardBatch, type DashboardGroup } from '../src/MRDashboard.ts';
import type { FetchPullRequestsOptions, FetchPullRequestsWarning, GitProvider } from '../src/GitProvider.ts';
import { warningTarget } from '../src/GitProvider.ts';
import type { PullRequest, ProviderCapabilities, UserRef } from '../src/types.ts';
import type { WatcherStatus } from '../src/RealtimeWatcher.ts';

const user = (id: number, username: string): UserRef => ({
  id: `github:user:${id}`,
  username,
  name: username,
  avatarUrl: null,
});

/** Minimal PullRequest stub with safe defaults, mirroring approval-semantics.test.ts's stubPR. */
function stubPR(iid: number, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: `github:pr:${iid}`,
    iid,
    repositoryId: 'github:1',
    title: `PR ${iid}`,
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: null,
    sourceBranch: `feat/${iid}`,
    targetBranch: 'main',
    createdAt: null,
    updatedAt: null,
    sha: null,
    author: user(1, 'author'),
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 0,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
    ...overrides,
  };
}

// `target` on every fixture below is built with `warningTarget`, the same
// function `GitHubProvider` and `fetchDashboardBatch` both use, rather than
// a hand-written `${projectPath}#${iid}` string. A `checks` fixture here
// once hardcoded that shape while the real `fetchCheckRuns` emitted
// `owner/repo@sha` -- the fixture and the lookup agreed with each other, so
// the test this file exists to write passed, while the actual production
// path stayed exactly as broken as before the ticket started. Reading the
// target from the one function every real producer reads it from is what
// makes that specific failure mode impossible here going forward.

function reviewsWarning(projectPath: string, iid: number): FetchPullRequestsWarning {
  return {
    kind: 'request-failed',
    source: 'reviews',
    status: 403,
    target: warningTarget(projectPath, iid),
    message: `GitHub returned HTTP 403 fetching reviews for ${projectPath}#${iid}; its approval count could not be verified, so it is missing from this result.`
  };
}

function checksWarning(projectPath: string, iid: number): FetchPullRequestsWarning {
  return {
    kind: 'request-failed',
    source: 'checks',
    status: 403,
    target: warningTarget(projectPath, iid),
    message: `GitHub check runs for ${projectPath}#${iid} (commit sha${iid}) could not be fetched (API rate limit exceeded); this PR's pipeline reads as "no checks" but that could not be verified.`
  };
}

function threadsWarning(projectPath: string, iid: number): FetchPullRequestsWarning {
  return {
    kind: 'request-failed',
    source: 'threads',
    target: warningTarget(projectPath, iid),
    message: `GitHub thread-count query failed for ${projectPath}#${iid} (GraphQL: something went wrong); its unresolved-discussion count is unknown, not zero.`
  };
}

/**
 * A provider whose `fetchPullRequests({ iids })` answers PR 1 and reports
 * PR 2 through `onWarning`, exactly like the real `GitHubProvider` now does
 * for a rate-limited reviews page (see gh-fetch-prs.test.ts). Only
 * `fetchPullRequests` and `watchMR` are exercised by the code under test;
 * the rest of `GitProvider` is cast away rather than implemented, since
 * `createDashboardGroup` never calls it in this scenario.
 */
function fakeProvider(projectPath: string): GitProvider {
  return {
    providerName: 'github',
    baseURL: 'https://github.com',
    capabilities: {} as ProviderCapabilities,
    async fetchPullRequests(options?: FetchPullRequestsOptions) {
      const iids = options?.iids ?? [];
      if (iids.includes(2)) {
        options?.onWarning?.(reviewsWarning(projectPath, 2));
      }
      return iids.filter(iid => iid !== 2).map(iid => stubPR(iid));
    },
    watchMR() {
      return () => {};
    }
  } as unknown as GitProvider;
}

/**
 * A provider whose `fetchPullRequests({ iids })` answers every requested PR
 * -- unlike `fakeProvider` above, none are dropped -- but reports `warning`
 * for PR 2 anyway. This is what the real `GitHubProvider` does for a failed
 * `checks` or `threads` fetch: that PR stays in the result with one field
 * degraded to its existing "unknown" value, rather than being excluded like
 * a `reviews` failure. `fetchDashboardBatch`'s round-2 fix skipped exactly
 * this case (`if (prs.has(iid)) continue;` before ever checking for a
 * warning), so this fake is what a round-3 test needs that `fakeProvider`
 * above cannot exercise.
 */
function fakeProviderWithPresentDegradedPR(
  projectPath: string,
  warning: FetchPullRequestsWarning
): GitProvider {
  return {
    providerName: 'github',
    baseURL: 'https://github.com',
    capabilities: {} as ProviderCapabilities,
    async fetchPullRequests(options?: FetchPullRequestsOptions) {
      const iids = options?.iids ?? [];
      if (iids.includes(2)) options?.onWarning?.(warning);
      return iids.map(iid => stubPR(iid));
    },
    watchMR() {
      return () => {};
    }
  } as unknown as GitProvider;
}

/**
 * A provider whose `fetchPullRequests` rejects outright -- a total failure,
 * distinct from every other fake here, which reports a per-PR problem
 * through `onWarning` while still resolving. This is what a transport
 * failure (not an HTTP response GitHub returned) looks like once it
 * escapes `GitHubProvider`'s own per-leg handling.
 */
function throwingProvider(): GitProvider {
  return {
    providerName: 'github',
    baseURL: 'https://github.com',
    capabilities: {} as ProviderCapabilities,
    async fetchPullRequests(): Promise<PullRequest[]> {
      throw new Error('socket hang up');
    },
    watchMR() {
      return () => {};
    }
  } as unknown as GitProvider;
}

describe('fetchDashboardBatch: splits a batched fetch into "got it" and "missing, and why"', () => {
  test('one failing PR is reported, not thrown, and does not remove the other PR', async () => {
    const provider = fakeProvider('acme/repo');

    const { prs, degraded } = await fetchDashboardBatch(provider, 'acme/repo', [1, 2]);

    expect(prs.size).toBe(1);
    expect(prs.get(1)?.iid).toBe(1);
    expect(prs.has(2)).toBe(false);

    expect(degraded.size).toBe(1);
    expect(degraded.get(2)).toMatchObject({ source: 'reviews', status: 403 });
  });

  test('a quiet fetch reports no degradation at all', async () => {
    const provider = fakeProvider('acme/repo');

    const { prs, degraded } = await fetchDashboardBatch(provider, 'acme/repo', [1]);

    expect(prs.size).toBe(1);
    expect(degraded.size).toBe(0);
  });

  test('a checks failure keeps the PR in `prs` AND still reaches `degraded`', async () => {
    // The bug a prior review round missed: `degraded` used to be computed
    // only for iids missing from `prs` (`if (prs.has(iid)) continue;`). A
    // `checks` failure never drops the PR, so that early return skipped the
    // warning lookup for it every time, making the warning unreachable no
    // matter what `GitHubProvider` reported.
    const warning = checksWarning('acme/repo', 2);
    const provider = fakeProviderWithPresentDegradedPR('acme/repo', warning);

    const { prs, degraded } = await fetchDashboardBatch(provider, 'acme/repo', [1, 2]);

    expect(prs.has(2)).toBe(true);
    expect(degraded.get(2)).toEqual(warning);
  });

  test('a threads failure keeps the PR in `prs` AND still reaches `degraded`', async () => {
    const warning = threadsWarning('acme/repo', 2);
    const provider = fakeProviderWithPresentDegradedPR('acme/repo', warning);

    const { prs, degraded } = await fetchDashboardBatch(provider, 'acme/repo', [1, 2]);

    expect(prs.has(2)).toBe(true);
    expect(degraded.get(2)).toEqual(warning);
  });
});

describe('DashboardGroup: one failing MR degrades its own row, not the whole refresh', () => {
  test('subscribe still receives PR 1 and onWarning names PR 2, from one batch fetch', async () => {
    const provider = fakeProvider('acme/repo');
    const group = createDashboard({
      provider,
      projectPath: 'acme/repo',
      mrIid: [1, 2],
      userId: null
    }) as DashboardGroup;

    const updates: Map<number, unknown>[] = [];
    const rowWarnings: Array<{ iid: number; warning: FetchPullRequestsWarning }> = [];
    group.onWarning?.((iid, warning) => rowWarnings.push({ iid, warning }));
    group.subscribe(mrs => updates.push(new Map(mrs)));

    // The initial fetch runs inside an un-awaited IIFE in
    // createRealtimeWatcher's bootstrap; flushing the microtask queue a few
    // times over real timers (rather than a fixed sleep) is what lets it
    // resolve without guessing at a duration.
    for (let i = 0; i < 5 && updates.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    try {
      expect(updates.length).toBeGreaterThan(0);
      const last = updates.at(-1)!;
      expect(last.has(1)).toBe(true);
      expect(last.has(2)).toBe(false);

      expect(rowWarnings.length).toBe(1);
      expect(rowWarnings[0]?.iid).toBe(2);
      expect(rowWarnings[0]?.warning.source).toBe('reviews');
    } finally {
      group.dispose();
    }
  });

  test('a warning listener that throws is ignored, not turned into a total failure', async () => {
    // The rest of this file proves a degraded row no longer sinks the batch
    // on the provider side. This pins the other end of the same channel: the
    // listener is consumer code, and an unguarded call would have made a bug
    // in it reject `batchFetch`, so `runFetch` would record a total failure
    // and deliver no rows at all -- one row's problem becoming the whole
    // batch's, by the very callback that reports it.
    const provider = fakeProvider('acme/repo');
    const group = createDashboard({
      provider,
      projectPath: 'acme/repo',
      mrIid: [1, 2],
      userId: null
    }) as DashboardGroup;

    const updates: Map<number, unknown>[] = [];
    const statuses: WatcherStatus[] = [];
    group.onStatusChange(s => statuses.push(s));
    group.onWarning?.(() => {
      throw new Error('consumer listener blew up');
    });
    group.subscribe(mrs => updates.push(new Map(mrs)));

    for (let i = 0; i < 5 && updates.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    try {
      expect(updates.length).toBeGreaterThan(0);
      expect(updates.at(-1)!.has(1)).toBe(true);
      expect(statuses.every(s => s.consecutiveErrors === 0)).toBe(true);
      expect(statuses.some(s => s.lastError != null)).toBe(false);
    } finally {
      group.dispose();
    }
  });

  test('onWarning fires for a checks-sourced warning even though the row stays present', async () => {
    // The dashboard-facing assertion for the same bug the two
    // `fetchDashboardBatch` tests above pin at the lower level: a consumer
    // built only on `DashboardGroup` (the actual public surface, not the
    // internal helper) must still learn about a checks failure. Before the
    // fix this test would see PR 2 in `subscribe`'s map -- correctly, since
    // a checks failure never drops the PR -- and nothing at all from
    // `onWarning`, which is indistinguishable from "PR 2 genuinely has no
    // checks configured."
    const warning = checksWarning('acme/repo', 2);
    const provider = fakeProviderWithPresentDegradedPR('acme/repo', warning);
    const group = createDashboard({
      provider,
      projectPath: 'acme/repo',
      mrIid: [1, 2],
      userId: null
    }) as DashboardGroup;

    const updates: Map<number, unknown>[] = [];
    const rowWarnings: Array<{ iid: number; warning: FetchPullRequestsWarning }> = [];
    group.onWarning?.((iid, w) => rowWarnings.push({ iid, warning: w }));
    group.subscribe(mrs => updates.push(new Map(mrs)));

    for (let i = 0; i < 5 && updates.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    try {
      expect(updates.length).toBeGreaterThan(0);
      const last = updates.at(-1)!;
      // Present, unlike the reviews case above: this is the whole point of
      // a `checks` failure -- it degrades one field, it does not drop the row.
      expect(last.has(2)).toBe(true);

      expect(rowWarnings.length).toBe(1);
      expect(rowWarnings[0]?.iid).toBe(2);
      expect(rowWarnings[0]?.warning.source).toBe('checks');
    } finally {
      group.dispose();
    }
  });

  test('onWarning fires for a threads-sourced warning even though the row stays present', async () => {
    const warning = threadsWarning('acme/repo', 2);
    const provider = fakeProviderWithPresentDegradedPR('acme/repo', warning);
    const group = createDashboard({
      provider,
      projectPath: 'acme/repo',
      mrIid: [1, 2],
      userId: null
    }) as DashboardGroup;

    const updates: Map<number, unknown>[] = [];
    const rowWarnings: Array<{ iid: number; warning: FetchPullRequestsWarning }> = [];
    group.onWarning?.((iid, w) => rowWarnings.push({ iid, warning: w }));
    group.subscribe(mrs => updates.push(new Map(mrs)));

    for (let i = 0; i < 5 && updates.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    try {
      expect(updates.length).toBeGreaterThan(0);
      const last = updates.at(-1)!;
      expect(last.has(2)).toBe(true);

      expect(rowWarnings.length).toBe(1);
      expect(rowWarnings[0]?.iid).toBe(2);
      expect(rowWarnings[0]?.warning.source).toBe('threads');
    } finally {
      group.dispose();
    }
  });

  test('a total fetch failure reaches onStatusChange instead of being swallowed to nothing', async () => {
    // The claim this pins: removing `batchFetch`'s blanket `try/catch` did
    // not just stop hiding the one-PR-fails-the-batch case (covered above,
    // and no longer even reaches an exception for that case) -- it also
    // means a *genuine* rejection (this provider throws outright, nothing
    // `fetchDashboardBatch` can attribute to a specific iid) now reaches
    // `createRealtimeWatcher.runFetch`'s own catch, which is what populates
    // `onStatusChange`'s `lastError`/`consecutiveErrors`. The previous
    // `catch { return null }` in `batchFetch` swallowed exactly this before
    // it ever reached that far -- a fake provider that only ever reports
    // through `onWarning` and still resolves (every other fake in this
    // file) can never exercise that path, which is why this test throws
    // instead.
    const provider = throwingProvider();
    const group = createDashboard({
      provider,
      projectPath: 'acme/repo',
      mrIid: [1],
      userId: null
    }) as DashboardGroup;

    const statuses: WatcherStatus[] = [];
    group.onStatusChange(s => statuses.push(s));
    group.subscribe(() => {
      throw new Error('onUpdate must not fire: the fetch never succeeded');
    });

    for (let i = 0; i < 5 && statuses.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    try {
      expect(statuses.length).toBeGreaterThan(0);
      const last = statuses.at(-1)!;
      expect(last.consecutiveErrors).toBeGreaterThan(0);
      expect(last.lastError?.message).toBe('socket hang up');
    } finally {
      group.dispose();
    }
  });
});
