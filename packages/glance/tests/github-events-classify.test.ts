// packages/glance/tests/github-events-classify.test.ts
import { describe, expect, test } from 'bun:test';
import { classifyGitHubEvent, normalizeBranchRef, type GitHubEvent } from '../src/GitHubEventsPoller.ts';
import prSample from './fixtures/github-events/sample-PullRequestEvent.json';
import reviewSample from './fixtures/github-events/sample-PullRequestReviewEvent.json';
import pushSample from './fixtures/github-events/sample-PushEvent.json';
import deleteSample from './fixtures/github-events/sample-DeleteEvent.json';
// IssueCommentEvent and CreateEvent have no captured fixture (absent from the
// recapture; Task 1 report documents it) -- both are covered synthetically below.

const ev = (over: Partial<GitHubEvent>): GitHubEvent => ({
  id: '12860960092',
  type: 'PullRequestEvent',
  created_at: '2026-08-06T00:00:00Z',
  ...over,
});

describe('normalizeBranchRef', () => {
  test('full ref spelling from PushEvent', () => {
    expect(normalizeBranchRef('refs/heads/probe-x', undefined)).toBe('probe-x');
  });
  test('bare ref spelling from Create/DeleteEvent', () => {
    expect(normalizeBranchRef('probe-x', 'branch')).toBe('probe-x');
  });
  test('tags are not branches', () => {
    expect(normalizeBranchRef('v1.0', 'tag')).toBeNull();
    expect(normalizeBranchRef('refs/tags/v1.0', undefined)).toBeNull();
  });
  test('absent ref is null', () => {
    expect(normalizeBranchRef(undefined, undefined)).toBeNull();
  });
});

describe('classifyGitHubEvent on captured fixtures', () => {
  test('PullRequestEvent invalidates the mr', () => {
    const keys = classifyGitHubEvent(prSample as GitHubEvent);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.kind).toBe('mr');
    expect(keys[0]?.ref).toBe(String((prSample as GitHubEvent).payload?.pull_request?.number));
  });
  test('PullRequestReviewEvent invalidates the mr (A32 inference)', () => {
    const keys = classifyGitHubEvent(reviewSample as GitHubEvent);
    expect(keys.map(k => k.kind)).toEqual(['mr']);
  });
  test('IssueCommentEvent on a PR invalidates notes and mr (synthetic: no captured fixture)', () => {
    const keys = classifyGitHubEvent(ev({
      type: 'IssueCommentEvent',
      payload: { action: 'created', issue: { number: 4, pull_request: { url: 'x' } } },
    }));
    expect(keys.map(k => k.kind).sort()).toEqual(['mr', 'notes']);
    expect(keys.every(k => k.ref === '4')).toBe(true);
  });
  test('PushEvent invalidates the branch with the normalized ref, never pipelines', () => {
    const keys = classifyGitHubEvent(pushSample as GitHubEvent);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.kind).toBe('branch');
    expect(keys[0]?.ref.startsWith('refs/')).toBe(false);
    expect(keys.some(k => k.kind === 'pipelines')).toBe(false);
  });
  test('DeleteEvent on a branch invalidates it', () => {
    const keys = classifyGitHubEvent(deleteSample as GitHubEvent);
    expect(keys.map(k => k.kind)).toEqual(
      (deleteSample as GitHubEvent).payload?.ref_type === 'branch' ? ['branch'] : []
    );
  });
});

describe('classifyGitHubEvent synthetic edges', () => {
  test('the undocumented action "merged" classifies like any PR action (A24)', () => {
    const keys = classifyGitHubEvent(ev({
      payload: { action: 'merged', pull_request: { number: 7 } },
    }));
    expect(keys).toEqual([{ kind: 'mr', ref: '7', cause: 'merged' }]);
  });
  test('IssueCommentEvent on a plain issue classifies to nothing', () => {
    const keys = classifyGitHubEvent(ev({
      type: 'IssueCommentEvent',
      payload: { action: 'created', issue: { number: 9 } },
    }));
    expect(keys).toEqual([]);
  });
  test('CreateEvent for a branch, bare ref spelling (A28)', () => {
    const keys = classifyGitHubEvent(ev({
      type: 'CreateEvent',
      payload: { ref: 'feature-1', ref_type: 'branch' },
    }));
    expect(keys).toEqual([{ kind: 'branch', ref: 'feature-1', cause: 'created' }]);
  });
  test('tag create and unknown types classify to nothing', () => {
    expect(classifyGitHubEvent(ev({ type: 'CreateEvent', payload: { ref: 'v1', ref_type: 'tag' } }))).toEqual([]);
    expect(classifyGitHubEvent(ev({ type: 'WatchEvent', payload: {} }))).toEqual([]);
  });
});
