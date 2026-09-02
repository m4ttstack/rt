#!/usr/bin/env bun
/**
 * The metric-grade reads are optional interface methods, each behind a
 * capability flag. A consumer feature-detects on the flag, never on the
 * method's presence, so both providers must declare every flag.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const FLAGS = [
  'canFetchMergeRequestIndex',
  'canFetchMergeRequestMetrics',
  'canFetchGroupProjects',
  'canFetchProject',
  'canFetchProjectPipelines',
  'canFetchUserEvents',
] as const;

describe('metric-grade read capability flags', () => {
  test('both providers declare every flag as a boolean', () => {
    const gl = new GitLabProvider('https://gitlab.example', 't');
    const gh = new GitHubProvider('https://github.com', 't');
    for (const flag of FLAGS) {
      expect(typeof gl.capabilities[flag], flag).toBe('boolean');
      expect(typeof gh.capabilities[flag], flag).toBe('boolean');
    }
  });

  test('GitHub implements none of the reads', () => {
    const gh = new GitHubProvider('https://github.com', 't');
    for (const flag of FLAGS) expect(gh.capabilities[flag], flag).toBe(false);
    expect((gh as any).fetchMergeRequestIndex).toBeUndefined();
    expect((gh as any).fetchUserEvents).toBeUndefined();
  });
});
