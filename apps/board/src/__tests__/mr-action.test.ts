import { describe, expect, test } from 'bun:test';

import { ReadBackFailedError } from '@mattstack/glance';
import {
  mergeRefusalReason,
  parseMrActionBody,
  runMrAction,
  type MrActionProvider,
} from '../mr-action.ts';

describe('parseMrActionBody', () => {
  const base = {
    mrUrl: 'https://gitlab.com/org/repo/-/merge_requests/7',
    iid: 7,
  };

  test.each(['merge', 'rebase', 'setAutoMerge', 'cancelAutoMerge'] as const)(
    'accepts action %s',
    action => {
      expect(parseMrActionBody({ ...base, action })).toEqual({
        ...base,
        action,
      });
    }
  );

  test('rejects an unknown action', () => {
    expect(parseMrActionBody({ ...base, action: 'close' })).toBeNull();
  });

  test('rejects a missing mrUrl or iid', () => {
    expect(parseMrActionBody({ iid: 7, action: 'merge' })).toBeNull();
    expect(
      parseMrActionBody({ mrUrl: base.mrUrl, action: 'merge' })
    ).toBeNull();
  });

  test('rejects a non-object body', () => {
    expect(parseMrActionBody('merge')).toBeNull();
    expect(parseMrActionBody(null)).toBeNull();
  });
});

describe('runMrAction', () => {
  function fakeProvider(calls: string[]): MrActionProvider {
    return {
      mergePullRequest: async (path, iid) => {
        calls.push(`merge ${path} !${iid}`);
        return {} as never;
      },
      rebasePullRequest: async (path, iid) => {
        calls.push(`rebase ${path} !${iid}`);
      },
      setAutoMerge: async (path, iid) => {
        calls.push(`setAutoMerge ${path} !${iid}`);
      },
      cancelAutoMerge: async (path, iid) => {
        calls.push(`cancelAutoMerge ${path} !${iid}`);
      },
    };
  }

  test.each([
    ['merge', 'merge org/repo !7'],
    ['rebase', 'rebase org/repo !7'],
    ['setAutoMerge', 'setAutoMerge org/repo !7'],
    ['cancelAutoMerge', 'cancelAutoMerge org/repo !7'],
  ] as const)(
    '%s dispatches to the matching provider call',
    async (action, expected) => {
      const calls: string[] = [];
      await runMrAction(fakeProvider(calls), 'org/repo', 7, action);
      expect(calls).toEqual([expected]);
    }
  );

  test('a provider failure propagates to the caller', async () => {
    const provider = fakeProvider([]);
    provider.rebasePullRequest = async () => {
      throw new Error('rebase in progress');
    };
    await expect(
      runMrAction(provider, 'org/repo', 7, 'rebase')
    ).rejects.toThrow('rebase in progress');
  });

  const readBackFailed = (writeApplied: boolean) =>
    new ReadBackFailedError('Merged MR but failed to fetch it back', {
      operation: 'mergePullRequest',
      projectPath: 'org/repo',
      iid: 7,
      writeApplied,
    });

  test('a merge that landed but could not be read back counts as merged', async () => {
    const provider = fakeProvider([]);
    provider.mergePullRequest = async () => {
      throw readBackFailed(true);
    };
    await expect(
      runMrAction(provider, 'org/repo', 7, 'merge')
    ).resolves.toBeUndefined();
  });

  test('a read-back failure with no write applied still fails', async () => {
    const provider = fakeProvider([]);
    provider.mergePullRequest = async () => {
      throw readBackFailed(false);
    };
    await expect(runMrAction(provider, 'org/repo', 7, 'merge')).rejects.toThrow(
      'failed to fetch it back'
    );
  });
});

describe('mergeRefusalReason', () => {
  const refusal = (status: string, hint = '') =>
    `mergePullRequest failed: 405 Method Not Allowed — 405 Method Not Allowed. Read back after the refusal, GitLab reported detailedMergeStatus="${status}".${hint}`;

  test.each([
    ['conflict', 'merge conflicts'],
    ['not_approved', 'not approved yet'],
    ['need_rebase', 'needs a rebase'],
    ['checking', 'GitLab is still checking, try again'],
  ])('%s reads as "%s"', (status, reason) => {
    expect(mergeRefusalReason(refusal(status))).toBe(reason);
  });

  test('an unlisted status still reads in words', () => {
    expect(mergeRefusalReason(refusal('security_policy_violations'))).toBe(
      'security policy violations'
    );
  });

  test('mergeable is not a refusal reason', () => {
    expect(mergeRefusalReason(refusal('mergeable'))).toBeNull();
  });

  test('a failure with no read-back status has no reason', () => {
    expect(
      mergeRefusalReason('mergePullRequest failed: 500 Internal Server Error')
    ).toBeNull();
  });
});
