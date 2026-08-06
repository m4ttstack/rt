#!/usr/bin/env bun
/**
 * MAT-132. GitLab answers every refused merge with a bare HTTP 405 whose body
 * is the constant "405 Method Not Allowed", so the status alone cannot tell a
 * merge request that is not ready yet from one a check has actually blocked.
 * These tests pin the follow-up read that names the difference, and the three
 * ways it is not allowed to make things worse: it must not fire on other
 * statuses, must not replace a real merge failure with a read failure, and
 * must not invent a status when the read has none.
 */
import { describe, expect, test } from 'bun:test';
import { GitbeakerRequestError } from '@gitbeaker/rest';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import type { PullRequest } from '../src/types.ts';

function requestError(status: number, statusText: string, description: string): GitbeakerRequestError {
  return new GitbeakerRequestError(`${status} ${statusText}`, {
    cause: {
      description,
      request: new Request('https://gitlab.example.com/api/v4/projects/g%2Fp/merge_requests/1/merge', {
        method: 'PUT',
      }),
      response: new Response(JSON.stringify({ message: description }), { status, statusText }),
    },
  });
}

/** Only the field under test matters; the rest is never read on this path. */
function prWithStatus(detailedMergeStatus: string | null): PullRequest {
  return { iid: 1, detailedMergeStatus } as unknown as PullRequest;
}

function providerRefusing(
  err: unknown,
  read: () => Promise<PullRequest | null>
): { provider: GitLabProvider; reads: () => number } {
  const provider = new GitLabProvider('https://gitlab.example.com', 'x');
  let reads = 0;
  (provider as any).gb.MergeRequests.merge = async () => {
    throw err;
  };
  (provider as any).fetchSingleMR = async () => {
    reads++;
    return read();
  };
  return { provider, reads: () => reads };
}

const refusal = () => requestError(405, 'Method Not Allowed', '405 Method Not Allowed');

describe('mergePullRequest names the merge status behind a 405', () => {
  test('a transitional status is named and marked retryable', async () => {
    const { provider } = providerRefusing(refusal(), async () => prWithStatus('checking'));

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).toContain('detailedMergeStatus="checking"');
    expect(err.message).toContain('may succeed once it settles');
    // The live harness matches on this exact prefix; appending must not move it.
    expect(/\bmergePullRequest failed: 405\b/.test(err.message)).toBe(true);
  });

  test('a blocking status is named without a retry hint', async () => {
    const { provider } = providerRefusing(refusal(), async () => prWithStatus('discussions_not_resolved'));

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).toContain('detailedMergeStatus="discussions_not_resolved"');
    expect(err.message).not.toContain('may succeed once it settles');
  });

  test('preparing counts as transitional, not as a blocker', async () => {
    const { provider } = providerRefusing(refusal(), async () => prWithStatus('preparing'));

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).toContain('may succeed once it settles');
  });

  test('a failing follow-up read leaves the original 405 untouched', async () => {
    const { provider } = providerRefusing(refusal(), async () => {
      throw new Error('GraphQL request failed: 502 Bad Gateway');
    });

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).toContain('mergePullRequest failed: 405');
    expect(err.message).not.toContain('502 Bad Gateway');
    expect(err.message).not.toContain('detailedMergeStatus');
  });

  test('no status to report means nothing is appended', async () => {
    const { provider } = providerRefusing(refusal(), async () => prWithStatus(null));

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).not.toContain('detailedMergeStatus');
  });

  test('a missing merge request means nothing is appended', async () => {
    const { provider } = providerRefusing(refusal(), async () => null);

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).not.toContain('detailedMergeStatus');
  });

  test('a non-405 failure is not enriched and costs no extra request', async () => {
    const { provider, reads } = providerRefusing(
      requestError(401, 'Unauthorized', '401 Unauthorized'),
      async () => prWithStatus('checking')
    );

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message.startsWith('mergePullRequest failed: 401 Unauthorized')).toBe(true);
    expect(err.message).not.toContain('detailedMergeStatus');
    expect(reads()).toBe(0);
  });

  test('a non-gitbeaker failure still passes through unchanged', async () => {
    const { provider, reads } = providerRefusing(new Error('boom'), async () => prWithStatus('checking'));

    const err = await provider.mergePullRequest('g/p', 1).catch((e: unknown) => e as Error);

    expect(err.message).toBe('boom');
    expect(reads()).toBe(0);
  });
});
