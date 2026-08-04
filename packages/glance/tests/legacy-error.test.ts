#!/usr/bin/env bun
/**
 * Unit tests for GitLabProvider's private `legacyError` helper, exercised
 * through the public `approvePullRequest` method with a stubbed gitbeaker
 * call. Covers the GitbeakerRetryError branch (sustained rate-limit after
 * gitbeaker's internal 429/502 retries are exhausted) and the plain-Error
 * passthrough branch.
 */
import { describe, expect, test } from 'bun:test';
import { GitbeakerRetryError } from '@gitbeaker/rest';
import { GitLabProvider } from '../src/GitLabProvider.ts';

describe('legacyError via approvePullRequest', () => {
  test('GitbeakerRetryError gets the stable "<label> failed: <status>" prefix', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'x');
    const retryError = new GitbeakerRetryError(
      'Could not successfully complete this request after 10 retries, last status code: 429. Check the applicable rate limits for this endpoint.',
    );
    (provider as any).gb.MergeRequestApprovals.approve = async () => {
      throw retryError;
    };

    await expect(provider.approvePullRequest('g/p', 1)).rejects.toThrow(/^approvePullRequest failed: 429/);
  });

  test('plain Error passes through unchanged', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'x');
    (provider as any).gb.MergeRequestApprovals.approve = async () => {
      throw new Error('boom');
    };

    await expect(provider.approvePullRequest('g/p', 1)).rejects.toThrow(new Error('boom'));
  });
});
