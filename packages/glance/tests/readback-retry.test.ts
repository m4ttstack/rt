#!/usr/bin/env bun
/**
 * Post-write read-back on GitLab (MAT-169).
 *
 * `updatePullRequest` edits the MR and then reads it back to return it and to
 * confirm a requested draft transition landed. The edit is the write; the
 * read-back is verification. Two ways the verification used to fail a call
 * whose write had already succeeded:
 *
 *   - `fetchSingleMRWithRetry` only retried a null result, so a rejection from
 *     `fetchSingleMR` escaped on attempt 0 and the retry never covered it.
 *   - the draft check compared the first read with no allowance for GitLab
 *     serving an MR that had not caught up with the title just written.
 *
 * These tests drive the real `fetchSingleMRWithRetry`, unlike `draft.test.ts`,
 * which stubs it to keep its own subject in view.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import type { PullRequest } from '../src/types.ts';

/** A read-back outcome: an MR, a null miss, or a rejection. */
type Outcome = PullRequest | null | Error;

function mr(over: Partial<PullRequest> = {}): PullRequest {
  return { iid: 7, title: 'Current title', draft: false, ...over } as PullRequest;
}

interface Harness {
  provider: GitLabProvider;
  /** One entry per `fetchSingleMR` call, in order. */
  reads: number;
  editCount: number;
}

/**
 * A provider whose read-back replays `outcomes` in order, holding the last one
 * once they run out, so a test can say "fails once, then succeeds" without
 * pinning how many attempts the retry makes.
 */
function harness(outcomes: Outcome[], current = { title: 'Current title', draft: false }): Harness {
  const provider = new GitLabProvider('https://gitlab.example', 't');
  const h: Harness = { provider, reads: 0, editCount: 0 };

  // Backoff is real time; the assertions are about attempts, not duration.
  (provider as any).readBackRetryDelayMs = 1;

  (provider as any).gb = {
    MergeRequests: {
      show: async () => ({ ...current }),
      edit: async () => {
        h.editCount++;
        return {};
      },
    },
  };
  (provider as any).fetchSingleMR = async () => {
    const outcome = outcomes[Math.min(h.reads, outcomes.length - 1)];
    h.reads++;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return h;
}

describe('read-back retries a rejection, not just a null', () => {
  test('a read that throws once is retried rather than failing the call', async () => {
    const h = harness([new Error('GraphQL errors: Timeout on CiJob.stage'), mr()]);

    const updated = await h.provider.updatePullRequest('g/p', 7, { title: 'Renamed' });

    expect(updated.iid).toBe(7);
    expect(h.reads).toBe(2);
  });

  test('a read that throws every attempt fails the call and keeps the reason', async () => {
    const boom = new Error('GraphQL errors: Timeout on DiffStatsSummary.additions');
    const h = harness([boom]);

    // The edit landed; only the verification failed. The message has to carry
    // both halves -- which call gave up, and what the read actually said --
    // since a caller staring at "failed to fetch it back" alone cannot tell a
    // flaky read from a rejected write.
    const err = await h.provider.updatePullRequest('g/p', 7, { title: 'Renamed' }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('Updated MR but failed to fetch it back');
    expect(err.message).toContain('Timeout on DiffStatsSummary.additions');
    expect(err.cause).toBe(boom);
    expect(h.reads).toBe(3);
    expect(h.editCount).toBe(1);
  });

  test('a null read is still retried, as it always was', async () => {
    const h = harness([null, null, mr()]);

    await h.provider.updatePullRequest('g/p', 7, { title: 'Renamed' });

    expect(h.reads).toBe(3);
  });

  test('a read that never succeeds at all reports without a spurious cause', async () => {
    const h = harness([null]);

    const err = await h.provider.updatePullRequest('g/p', 7, { title: 'Renamed' }).catch((e) => e);

    expect(err.message).toBe('Updated MR but failed to fetch it back');
    expect(err.cause).toBeUndefined();
  });
});

describe('draft verification allows for read-after-write lag', () => {
  test('a draft state that has not caught up is re-read, not called a failure', async () => {
    // First read still shows the pre-edit state; the second has caught up.
    const h = harness([mr({ draft: false }), mr({ draft: true })]);

    const updated = await h.provider.updatePullRequest('g/p', 7, { draft: true });

    expect(updated.draft).toBe(true);
    expect(h.reads).toBe(2);
  });

  test('a draft state that never arrives still throws, after retrying', async () => {
    // The pre-14.0 `WIP:` case: GitLab keeps treating the MR as a draft, so
    // no amount of waiting changes the answer and the mismatch is real.
    const h = harness([mr({ draft: true, title: 'WIP: Current title' })], {
      title: 'WIP: Current title',
      draft: true,
    });

    await expect(h.provider.updatePullRequest('g/p', 7, { draft: false })).rejects.toThrow(
      /still a draft after requesting draft=false/,
    );
    expect(h.reads).toBe(3);
  });

  test('an update not touching draft accepts the first successful read', async () => {
    const h = harness([mr({ draft: true })]);

    const updated = await h.provider.updatePullRequest('g/p', 7, { description: 'notes' });

    expect(updated.draft).toBe(true);
    expect(h.reads).toBe(1);
  });

  test('a stale read followed by failed reads reports the mismatch, not the read failure', async () => {
    // Precedence: having read the MR and found it disagreeing is a more
    // specific answer than a later transport failure, so the draft message
    // wins over "failed to fetch it back".
    const h = harness([mr({ draft: false }), new Error('GraphQL errors: Timeout')]);

    await expect(h.provider.updatePullRequest('g/p', 7, { draft: true })).rejects.toThrow(
      /not a draft after requesting draft=true/,
    );
  });
});
