#!/usr/bin/env bun
/**
 * Branch protection read failures on GitHub (MAT-131).
 *
 * The success path already works and is exercised live. The failure path used
 * to invent a rule whose four fields were wrong in both directions at once:
 * allowForcePush and allowDeletion over-reported protection while
 * requiredApprovals and requireStatusChecks under-reported it, and nothing in
 * the returned shape told a caller which of those it was holding.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const API = 'https://api.github.com';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    headers: { get: () => null }
  } as unknown as Response;
}

/**
 * Adapts an `api()`-shaped stub (method, path) => Response into an
 * `octokit.request(route)` stub: `RequestError` on a non-ok status,
 * `{status, headers, data}` on success, matching the real client.
 * `fetchBranchProtectionRules` now calls `octokit.request` directly rather
 * than `api()`, so the interception point moves here.
 */
function toOctokitRequestStub(
  apiFn: (method: string, path: string) => Promise<Response>
) {
  return async (route: string) => {
    const spaceIdx = route.indexOf(' ');
    const method = route.slice(0, spaceIdx);
    const path = route.slice(spaceIdx + 1);
    const res = await apiFn(method, path);
    if (!res.ok) {
      throw new RequestError(await res.text(), res.status, {
        request: { method, url: `${API}${path}`, headers: {} },
        response: { status: res.status, url: '', headers: {}, data: await res.json() }
      });
    }
    return { status: res.status, headers: {}, data: await res.json() };
  };
}

/**
 * One protected branch in the listing, and a per-branch detail read whose
 * status the test chooses.
 */
function stubGitHub(provider: GitHubProvider, detailStatus: number): void {
  const apiFn = async (_method: string, path: string) => {
    if (path.includes('/protection')) {
      return detailStatus === 200
        ? response(200, {
            allow_force_pushes: { enabled: true },
            allow_deletions: { enabled: true },
            required_pull_request_reviews: { required_approving_review_count: 2 },
            required_status_checks: { strict: true, contexts: ['ci'] }
          })
        : response(detailStatus, { message: 'Not Found' });
    }
    return response(200, [{ name: 'main', protected: true }]);
  };
  (provider as any).octokit = { request: toOctokitRequestStub(apiFn) };
}

describe('fetchBranchProtectionRules (MAT-131)', () => {
  test('a failed per-branch read throws instead of inventing a rule', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 404);

    await expect(provider.fetchBranchProtectionRules('acme/repo')).rejects.toThrow(
      /protection for "main"/
    );
  });

  test('the thrown error names the status so a 403 is self-explanatory', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 403);

    await expect(provider.fetchBranchProtectionRules('acme/repo')).rejects.toThrow(
      /403/
    );
  });

  test('the success path is unchanged and still carries raw', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 200);

    const rules = await provider.fetchBranchProtectionRules('acme/repo');

    expect(rules).toHaveLength(1);
    expect(rules[0]?.pattern).toBe('main');
    expect(rules[0]?.allowForcePush).toBe(true);
    expect(rules[0]?.allowDeletion).toBe(true);
    expect(rules[0]?.requiredApprovals).toBe(2);
    expect(rules[0]?.requireStatusChecks).toBe(true);
    expect(rules[0]?.raw).toBeDefined();
  });
});
