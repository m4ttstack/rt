#!/usr/bin/env bun
/**
 * MAT-134: unapprove on GitHub is a review dismissal.
 *
 * The subtlety is which review to dismiss. GitHub keeps every review ever
 * submitted, and only the newest per user counts toward `approved` (see
 * `toPullRequest`). Dismissing the first APPROVED one found would revive an
 * approval the user already replaced.
 *
 * The transport is stubbed; nothing here touches a network.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const ADA = { id: 7, login: 'ada', name: 'Ada', avatar_url: 'https://x/a.png' };
const BOB = { id: 8, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png' };

function review(id: number, user: typeof ADA, state: string, submitted_at: string) {
  return { id, user, state, submitted_at };
}

/** A provider whose token belongs to `ada`, wired to a fixed review list. */
function providerWith(reviews: unknown[], onDismiss?: () => never) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const dismissals: Array<Record<string, unknown>> = [];
  (provider as any).octokit = {
    request: async (route: string, params?: Record<string, unknown>) => {
      if (route.startsWith('GET /user')) {
        return { status: 200, headers: {}, data: ADA };
      }
      if (route.includes('/dismissals')) {
        if (onDismiss) onDismiss();
        dismissals.push(params ?? {});
        return { status: 200, headers: {}, data: {} };
      }
      throw new Error(`unexpected route ${route}`);
    },
    paginate: async () => reviews
  };
  return { provider, dismissals };
}

describe('unapprovePullRequest', () => {
  test('the capability flag is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canUnapprove).toBe(true);
  });

  test('dismisses the token user\'s own approval', async () => {
    const { provider, dismissals } = providerWith([
      review(1, BOB, 'APPROVED', '2026-08-01T00:00:00Z'),
      review(2, ADA, 'APPROVED', '2026-08-02T00:00:00Z')
    ]);

    await provider.unapprovePullRequest('acme/repo', 5);

    expect(dismissals.length).toBe(1);
    expect(dismissals[0]?.review_id).toBe(2);
    expect(dismissals[0]?.event).toBe('DISMISS');
    expect(typeof dismissals[0]?.message).toBe('string');
  });

  test('dismisses the newest review, not the first approval found', async () => {
    // Ada approved, then requested changes. Her approval no longer counts, so
    // dismissing it would resurrect nothing and hide the real state.
    const { provider } = providerWith([
      review(1, ADA, 'APPROVED', '2026-08-01T00:00:00Z'),
      review(2, ADA, 'CHANGES_REQUESTED', '2026-08-02T00:00:00Z')
    ]);

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /no current approval/i
    );
  });

  test('ordering comes from submitted_at, not list order', async () => {
    const { provider, dismissals } = providerWith([
      review(2, ADA, 'APPROVED', '2026-08-03T00:00:00Z'),
      review(1, ADA, 'COMMENTED', '2026-08-01T00:00:00Z')
    ]);

    await provider.unapprovePullRequest('acme/repo', 5);

    expect(dismissals[0]?.review_id).toBe(2);
  });

  test('another user\'s approval is never dismissed', async () => {
    const { provider, dismissals } = providerWith([
      review(1, BOB, 'APPROVED', '2026-08-01T00:00:00Z')
    ]);

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /no current approval/i
    );
    expect(dismissals.length).toBe(0);
  });

  test('no reviews at all throws rather than resolving', async () => {
    // Resolving here would be the silent no-op shape: the caller believes an
    // approval was revoked when none existed.
    const { provider } = providerWith([]);

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /no current approval/i
    );
  });

  test('an HTTP failure on the dismissal surfaces its status', async () => {
    const { provider } = providerWith(
      [review(1, ADA, 'APPROVED', '2026-08-01T00:00:00Z')],
      () => {
        throw new RequestError('Forbidden', 403, {
          request: { method: 'PUT', url: 'https://api.github.com/x', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} }
        });
      }
    );

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /unapprovePullRequest failed: 403/
    );
  });
});
