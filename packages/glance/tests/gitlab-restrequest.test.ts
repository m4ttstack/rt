#!/usr/bin/env bun
/**
 * `GitProvider.restRequest`'s docstring says implementations "translate the
 * path to the provider's API URL format". GitHubProvider does; GitLabProvider
 * used to concatenate `baseURL + path` verbatim, so a GitLab caller had to
 * pass `/api/v4/user` where a GitHub caller passes `/user` -- the one thing
 * this method exists to make portable, broken (MAT-130).
 *
 * These tests pin the fix: GitLabProvider now prefixes `/api/v4` itself, and
 * rejects a path that already carries that prefix rather than silently
 * stripping or doubling it. Silent tolerance would let the ambiguity survive
 * forever; a loud throw forces the one known caller (repo-tools'
 * `fetchProjectId`, which carries a comment documenting the very divergence
 * being fixed here) to update at the moment it upgrades, with an error that
 * names exactly what changed.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Installs a fetch stub that records every requested URL and answers 200 with an empty body. */
function stubFetch(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return urls;
}

describe('GitLabProvider.restRequest', () => {
  test('a provider-relative path is prefixed with /api/v4', async () => {
    const urls = stubFetch();
    const provider = new GitLabProvider('https://gitlab.example.com', 'token');

    await provider.restRequest('GET', '/user');

    expect(urls).toEqual(['https://gitlab.example.com/api/v4/user']);
  });

  test('a path already carrying /api/v4 is rejected rather than silently accepted', async () => {
    stubFetch();
    const provider = new GitLabProvider('https://gitlab.example.com', 'token');

    await expect(provider.restRequest('GET', '/api/v4/user')).rejects.toThrow(/api\/v4/);
  });

  test('the bare "/api/v4" path (no trailing segment) is also rejected', async () => {
    stubFetch();
    const provider = new GitLabProvider('https://gitlab.example.com', 'token');

    await expect(provider.restRequest('GET', '/api/v4')).rejects.toThrow(/api\/v4/);
  });

  test('a path that merely starts with the same characters ("/api/v40/foo") is not mistaken for the prefix', async () => {
    const urls = stubFetch();
    const provider = new GitLabProvider('https://gitlab.example.com', 'token');

    await provider.restRequest('GET', '/api/v40/foo');

    expect(urls).toEqual(['https://gitlab.example.com/api/v4/api/v40/foo']);
  });

  test('the rejection never reaches fetch', async () => {
    const urls = stubFetch();
    const provider = new GitLabProvider('https://gitlab.example.com', 'token');

    await expect(provider.restRequest('GET', '/api/v4/projects/1')).rejects.toThrow();

    expect(urls).toEqual([]);
  });
});
