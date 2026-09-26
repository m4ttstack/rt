#!/usr/bin/env bun
/**
 * GitHub `fetchUser` (MAT-159): GET /users/{username} to a normalized
 * UserRef, null on 404, `ghError` shape on anything else. Stubs the fetch
 * global rather than provider internals so Octokit's own error translation
 * is what the 404 branch actually sees.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let seenUrl: string | undefined;

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seenUrl = typeof input === 'string' ? input : input.toString();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('GitHubProvider.fetchUser', () => {
  test('maps the response to a UserRef', async () => {
    stubFetch(200, { id: 583231, login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.example.com/u/583231' });
    const provider = new GitHubProvider('https://github.com', 'tok');
    expect(await provider.fetchUser('octocat')).toEqual({
      id: 'github:user:583231',
      username: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.example.com/u/583231',
    });
    expect(seenUrl?.endsWith('/users/octocat')).toBe(true);
  });

  test('a null display name falls back to the login', async () => {
    stubFetch(200, { id: 1, login: 'ghost', name: null, avatar_url: 'https://avatars.example.com/u/1' });
    const provider = new GitHubProvider('https://github.com', 'tok');
    expect((await provider.fetchUser('ghost'))?.name).toBe('ghost');
  });

  test('returns null on 404', async () => {
    stubFetch(404, { message: 'Not Found' });
    const provider = new GitHubProvider('https://github.com', 'tok');
    expect(await provider.fetchUser('no-such-user')).toBeNull();
  });

  test('non-404 failures throw the ghError shape', async () => {
    stubFetch(401, { message: 'Bad credentials' });
    const provider = new GitHubProvider('https://github.com', 'tok');
    await expect(provider.fetchUser('octocat')).rejects.toThrow(/fetchUser failed/);
  });
});
