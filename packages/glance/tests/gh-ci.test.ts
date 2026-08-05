#!/usr/bin/env bun
/**
 * Unit coverage for GitHub's CI-retry path: `fetchJobTrace`, `retryJob`, and
 * `retryPipeline`.
 *
 * Before this file, none of the three had any unit coverage. In particular,
 * nothing pinned `fetchJobTrace`'s handling of Octokit's `data` shape, which
 * varies with the redirect target's content type (a string, an ArrayBuffer,
 * or a JSON object), nor the exact `statusText`-shaped error message
 * `retryJob` and `retryPipeline` throw on failure. `(provider as
 * any).octokit` is stubbed directly rather than going through the real
 * transport, since these methods call `octokit.request` and none of the
 * three needs a live fetch to prove its own logic.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

function stubOctokitRequest(
  handler: (route: string) => { data: unknown } | Promise<{ data: unknown }>
) {
  return async (route: string) => handler(route);
}

function stubOctokitThrows(err: unknown) {
  return async () => {
    throw err;
  };
}

function fakeRequestError(status: number, data: unknown): RequestError {
  return new RequestError('failed', status, {
    request: { method: 'POST', url: 'https://api.github.com/x', headers: {} },
    response: { status, url: '', headers: {}, data }
  });
}

describe('fetchJobTrace', () => {
  test('an ArrayBuffer body decodes to its text', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({
        data: new TextEncoder().encode('fail-marker present\n').buffer
      }))
    };

    const trace = await provider.fetchJobTrace('acme/repo', 1);
    expect(trace).toBe('fail-marker present\n');
  });

  test('a string body passes through untouched', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({ data: 'plain log text' }))
    };

    const trace = await provider.fetchJobTrace('acme/repo', 1);
    expect(trace).toBe('plain log text');
  });

  test('a JSON object body returns a string instead of throwing', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({ data: { message: 'unexpected' } }))
    };

    const trace = await provider.fetchJobTrace('acme/repo', 1);
    expect(typeof trace).toBe('string');
    expect(trace).toBe('{"message":"unexpected"}');
  });

  test('a 403 surfaces the statusText-shaped message', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(fakeRequestError(403, { message: 'Forbidden' }))
    };

    const err = await provider.fetchJobTrace('acme/repo', 1).catch((e) => e as Error);
    expect(err.message).toBe(
      'fetchJobTrace failed: 403 Forbidden — {"message":"Forbidden"}'
    );
  });
});

describe('retryPipeline', () => {
  test('a 403 surfaces the statusText-shaped message', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(fakeRequestError(403, { message: 'Forbidden' }))
    };

    const err = await provider.retryPipeline('acme/repo', 1).catch((e) => e as Error);
    expect(err.message).toBe(
      'retryPipeline failed: 403 Forbidden — {"message":"Forbidden"}'
    );
  });
});

describe('retryJob', () => {
  test('a successful retry resolves with no error', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitRequest(() => ({ data: {} }))
    };

    await expect(provider.retryJob('acme/repo', 1)).resolves.toBeUndefined();
  });

  test('a 403 pins the exact message quoted as evidence in two specs documents', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: stubOctokitThrows(
        fakeRequestError(403, {
          message: 'The workflow run containing this job is already running',
          documentation_url:
            'https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run',
          status: '403'
        })
      )
    };

    const err = await provider.retryJob('acme/repo', 1).catch((e) => e as Error);
    expect(err.message).toBe(
      'retryJob failed: 403 Forbidden — {"message":"The workflow run containing this job is already running","documentation_url":"https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run","status":"403"}'
    );
  });
});
