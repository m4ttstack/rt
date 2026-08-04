/**
 * The expectation tables are the anti-drift mechanism: every GitProvider
 * method must be declared supported, unsupported, or approximate on each
 * provider. Exhaustiveness is enforced by `Record<ProviderMethod, ...>` at
 * compile time; these tests cover the runtime invariants that types cannot
 * express, such as an `unsupported` method naming a capability flag that is
 * actually false.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import {
  GITHUB_EXPECTATIONS,
  GITLAB_EXPECTATIONS,
  expectationFor,
  type ProviderMethod
} from './live/expectations.ts';

const github = new GitHubProvider('https://github.com', 'token-not-used');
const gitlab = new GitLabProvider('https://gitlab.com', 'token-not-used');

describe('expectation tables', () => {
  test('both tables declare the same method set', () => {
    expect(Object.keys(GITHUB_EXPECTATIONS).sort()).toEqual(
      Object.keys(GITLAB_EXPECTATIONS).sort()
    );
  });

  test('a method is a function unless declared absent, and undefined when it is', () => {
    const cases: Array<[string, typeof GITHUB_EXPECTATIONS, object]> = [
      ['github', GITHUB_EXPECTATIONS, github],
      ['gitlab', GITLAB_EXPECTATIONS, gitlab]
    ];
    for (const [name, table, instance] of cases) {
      for (const [method, exp] of Object.entries(table)) {
        const actual = typeof (instance as Record<string, unknown>)[method];
        const wanted = exp.support === 'absent' ? 'undefined' : 'function';
        expect(`${name}.${method}:${actual}`).toBe(`${name}.${method}:${wanted}`);
      }
    }
  });

  test('only optional interface methods may be declared absent', () => {
    const OPTIONAL: string[] = ['fetchPullRequestsByBranches', 'watchEvents'];
    for (const table of [GITHUB_EXPECTATIONS, GITLAB_EXPECTATIONS]) {
      for (const [method, exp] of Object.entries(table)) {
        if (exp.support !== 'absent') continue;
        expect(`${method}:${OPTIONAL.includes(method)}`).toBe(`${method}:true`);
      }
    }
  });

  test('an unsupported or absent method names a capability flag that is false', () => {
    for (const [method, exp] of Object.entries(GITHUB_EXPECTATIONS)) {
      const gated = exp.support === 'unsupported' || exp.support === 'absent';
      if (!gated || !exp.capability) continue;
      expect(`${method}:${github.capabilities[exp.capability]}`).toBe(`${method}:false`);
    }
  });

  test('a supported method names a capability flag that is true', () => {
    for (const [method, exp] of Object.entries(GITHUB_EXPECTATIONS)) {
      if (exp.support !== 'supported' || !exp.capability) continue;
      expect(`${method}:${github.capabilities[exp.capability]}`).toBe(`${method}:true`);
    }
  });

  test('GitLab declares nothing unsupported', () => {
    const unsupported = Object.entries(GITLAB_EXPECTATIONS)
      .filter(([, e]) => e.support === 'unsupported')
      .map(([m]) => m);
    expect(unsupported).toEqual([]);
  });

  test('every entry that is not plainly supported carries a note', () => {
    for (const table of [GITHUB_EXPECTATIONS, GITLAB_EXPECTATIONS]) {
      for (const [method, exp] of Object.entries(table)) {
        if (exp.support === 'supported') continue;
        expect(`${method}:${Boolean(exp.note)}`).toBe(`${method}:true`);
      }
    }
  });

  test('expectationFor selects the right table', () => {
    expect(expectationFor('github', 'rebasePullRequest').support).toBe('unsupported');
    expect(expectationFor('gitlab', 'rebasePullRequest').support).toBe('supported');
  });
});
