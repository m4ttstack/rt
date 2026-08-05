#!/usr/bin/env bun
/**
 * Octokit client construction and error translation.
 *
 * The error messages are not cosmetic: the live conformance harness matches
 * them by pattern to tell a transient failure from a permanent one, so a
 * reworded message silently disables a check rather than failing it.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import {
  createGitHubClient,
  ghError,
  resolveGitHubUrls
} from '../src/githubClient.ts';
import { noopLogger } from '../src/logger.ts';
import type { RequestInfo } from '../src/instrumentation.ts';

describe('resolveGitHubUrls', () => {
  test('github.com maps to the api subdomain', () => {
    expect(resolveGitHubUrls('https://github.com')).toEqual({
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    });
  });

  test('the www host is treated as github.com', () => {
    expect(resolveGitHubUrls('https://www.github.com').apiBase).toBe(
      'https://api.github.com'
    );
  });

  test('an enterprise host serves REST under /api/v3 and GraphQL under /api/graphql', () => {
    expect(resolveGitHubUrls('https://ghe.corp.example')).toEqual({
      apiBase: 'https://ghe.corp.example/api/v3',
      graphqlURL: 'https://ghe.corp.example/api/graphql'
    });
  });
});

function fakeRequestError(status: number, body: unknown): RequestError {
  return new RequestError('Oops', status, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
    response: {
      status,
      url: 'https://api.github.com/x',
      headers: {},
      data: body
    }
  });
}

describe('ghError', () => {
  test('plain style reproduces the shape most methods use today', () => {
    const err = ghError(
      'mergePullRequest',
      fakeRequestError(405, { message: 'Pull Request is not mergeable' })
    );
    expect(err.message).toMatch(/^mergePullRequest failed: 405 /);
    expect(err.message).toContain('Pull Request is not mergeable');
  });

  test('the harness pattern for a merge precondition still matches', () => {
    const err = ghError('mergePullRequest', fakeRequestError(405, {}));
    expect(/\bmergePullRequest failed: 405\b/.test(err.message)).toBe(true);
  });

  test('the harness pattern for self-approval rejection still matches', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(422, { message: 'Unprocessable Entity' }),
      'statusText'
    );
    expect(/approvePullRequest failed: 422\b/.test(err.message)).toBe(true);
  });

  test('a non-RequestError is preserved rather than relabelled as an HTTP failure', () => {
    const err = ghError('fetchJobTrace', new TypeError('network down'));
    expect(err.message).toContain('network down');
    expect(err.message).not.toMatch(/failed: \d/);
  });

  test('statusText style reconstructs the reason phrase for a 403, since Octokit never carries it on the response', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(403, {}),
      'statusText'
    );
    expect(err.message).toContain('403 Forbidden');
  });

  test('statusText style reconstructs the reason phrase for a 422', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(422, {}),
      'statusText'
    );
    expect(err.message).toContain('422 Unprocessable Entity');
  });

  test('an unmapped status in statusText style degrades to no phantom reason phrase', () => {
    const err = ghError('approvePullRequest', fakeRequestError(418, {}), 'statusText');
    expect(/\bapprovePullRequest failed: 418\b/.test(err.message)).toBe(true);
    expect(err.message).not.toMatch(/418 [A-Za-z]/);
  });

  test('a RequestError with no response falls back to err.message so the diagnostic survives', () => {
    const networkErr = new RequestError('network down', 500, {
      request: { method: 'GET', url: 'https://api.github.com/x', headers: {} }
    });
    const err = ghError('fetchJobTrace', networkErr);
    expect(err.message).toContain('network down');
  });
});

describe('createGitHubClient instrumentation', () => {
  test('emits one RequestInfo per request, with the op label and real status', async () => {
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    await octokit.request('GET /user', {
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ login: 'octocat' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.transport).toBe('rest');
    expect(seen[0]?.status).toBe(200);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.path).toContain('/user');
    expect(seen[0]?.op).toContain('GET');
    expect(seen[0]?.op).toContain('/user');
    expect(typeof seen[0]?.durationMs).toBe('number');
    expect(seen[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('emits for a failed request too, carrying the real status', async () => {
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    await octokit
      .request('GET /user', {
        request: {
          // Retries would turn one logical operation into several events, and
          // the SDK counts logical operations, so they stay off here.
          retries: 0,
          fetch: async () =>
            new Response(JSON.stringify({ message: 'Bad credentials' }), {
              status: 401,
              headers: { 'content-type': 'application/json' }
            })
        }
      })
      .catch(() => undefined);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe(401);
  });

  test('a throwing onRequest hook cannot break the request', async () => {
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: () => {
        throw new Error('observer is broken');
      }
    });

    const res = await octokit.request('GET /user', {
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ login: 'octocat' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    });

    expect(res.status).toBe(200);
  });
});
