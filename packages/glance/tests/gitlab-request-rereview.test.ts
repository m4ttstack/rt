#!/usr/bin/env bun
/**
 * GitLab `requestReReview` used to ignore its `reviewerUsernames` argument
 * entirely (the parameter was even named `_reviewerUsernames`) and returned
 * successfully having done nothing when the MR had no reviewers. Between
 * those two defects, no caller-observable state distinguished success from
 * silence, which is why an earlier conformance-harness task had to record a
 * skip instead of a real check.
 *
 * These tests pin the fixed semantics: usernames resolve to ids and union
 * with the existing reviewer set; with no usernames the current set is
 * re-sent (unchanged, GitLab-side no-op); and the shapes with nothing to
 * act on throw instead of resolving.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function providerWith(opts: {
  reviewers?: Array<{ id: number }>;
  usersByUsername?: Record<string, Array<{ id: number; username: string }>>;
  onEdit?: (id: string | number, iid: number, options: unknown) => void;
}): GitLabProvider {
  const provider = new GitLabProvider('https://gitlab.example.com', 'x');
  (provider as any).gb.MergeRequests.show = async () => ({
    reviewers: opts.reviewers ?? [],
  });
  (provider as any).gb.MergeRequests.edit = async (
    id: string | number,
    iid: number,
    options: unknown
  ) => {
    opts.onEdit?.(id, iid, options);
    return {};
  };
  (provider as any).gb.Users.all = async ({ username }: { username: string }) =>
    opts.usersByUsername?.[username] ?? [];
  return provider;
}

describe('GitLabProvider.requestReReview', () => {
  test('resolves usernames to ids and sends them to edit', async () => {
    let sentIds: number[] | undefined;
    const provider = providerWith({
      reviewers: [],
      usersByUsername: { ada: [{ id: 42, username: 'ada' }] },
      onEdit: (_id, _iid, options) => {
        sentIds = (options as { reviewerIds: number[] }).reviewerIds;
      },
    });

    await provider.requestReReview('g/p', 7, ['ada']);

    expect(sentIds).toEqual([42]);
  });

  test('a call naming one existing reviewer and one new one unions all three ids', async () => {
    // One name (bob) is already a reviewer, one (dave) is not, and id 1
    // belongs to neither named username. This is deliberately the one call
    // that a broken implementation of either kind gets wrong: ignoring the
    // argument sends back [1, 2] (dave never gets added), and replacing the
    // set wholesale sends [2, 77] (id 1 gets dropped). Only a genuine union
    // of "existing" with "resolved" sends all three.
    let sentIds: number[] | undefined;
    const provider = providerWith({
      reviewers: [{ id: 1 }, { id: 2 }],
      usersByUsername: {
        bob: [{ id: 2, username: 'bob' }],
        dave: [{ id: 77, username: 'dave' }],
      },
      onEdit: (_id, _iid, options) => {
        sentIds = (options as { reviewerIds: number[] }).reviewerIds;
      },
    });

    await provider.requestReReview('g/p', 7, ['bob', 'dave']);

    expect(sentIds?.sort()).toEqual([1, 2, 77]);
  });

  test('a username not already a reviewer is unioned in alongside the rest', async () => {
    let sentIds: number[] | undefined;
    const provider = providerWith({
      reviewers: [{ id: 1 }],
      usersByUsername: { carol: [{ id: 99, username: 'carol' }] },
      onEdit: (_id, _iid, options) => {
        sentIds = (options as { reviewerIds: number[] }).reviewerIds;
      },
    });

    await provider.requestReReview('g/p', 7, ['carol']);

    expect(sentIds?.sort()).toEqual([1, 99]);
  });

  test('no usernames and existing reviewers re-sends the current ids', async () => {
    let sentIds: number[] | undefined;
    const provider = providerWith({
      reviewers: [{ id: 5 }, { id: 6 }],
      onEdit: (_id, _iid, options) => {
        sentIds = (options as { reviewerIds: number[] }).reviewerIds;
      },
    });

    await provider.requestReReview('g/p', 7);

    expect(sentIds?.sort()).toEqual([5, 6]);
  });

  test('no usernames and no reviewers throws, explaining there is nothing to re-request', async () => {
    const provider = providerWith({ reviewers: [] });

    await expect(provider.requestReReview('g/p', 7)).rejects.toThrow(/nothing to re-request/i);
  });

  test('a username that resolves to no user throws, naming that username', async () => {
    const provider = providerWith({
      reviewers: [{ id: 1 }],
      usersByUsername: {},
    });

    await expect(provider.requestReReview('g/p', 7, ['ghost'])).rejects.toThrow(/ghost/);
  });

  test('a lookup failure surfaces rather than being swallowed', async () => {
    const provider = providerWith({ reviewers: [] });
    (provider as any).gb.Users.all = async () => {
      throw new Error('lookup boom');
    };

    await expect(provider.requestReReview('g/p', 7, ['ada'])).rejects.toThrow(/lookup boom/);
  });

  test('an edit failure surfaces rather than being swallowed', async () => {
    const provider = providerWith({
      reviewers: [{ id: 1 }],
    });
    (provider as any).gb.MergeRequests.edit = async () => {
      throw new Error('edit boom');
    };

    await expect(provider.requestReReview('g/p', 7)).rejects.toThrow(/edit boom/);
  });
});
