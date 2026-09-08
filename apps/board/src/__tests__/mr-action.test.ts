import { describe, expect, test } from 'bun:test';

import {
  isJsonMediaType,
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
});

describe('isJsonMediaType', () => {
  test('accepts application/json, with or without parameters or casing', () => {
    expect(isJsonMediaType('application/json')).toBe(true);
    expect(isJsonMediaType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonMediaType('Application/JSON')).toBe(true);
  });

  test('rejects a json-mentioning parameter on a simple-request type', () => {
    expect(isJsonMediaType('text/plain;foo=application/json')).toBe(false);
  });

  test('rejects the simple-request types and an absent header', () => {
    expect(isJsonMediaType('text/plain')).toBe(false);
    expect(isJsonMediaType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonMediaType(null)).toBe(false);
  });
});
