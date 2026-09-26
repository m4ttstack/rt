import { describe, expect, test } from 'vitest';

import { doing } from './doing';

const base = {
  handle: 'max',
  status: 'live' as const,
  branch: 'main',
  cwd: '/Users/matt/Documents/GitHub/repo-tools',
};

describe('doing', () => {
  test('away message wins over everything', () => {
    expect(
      doing({ ...base, statusText: 'rebasing #67', paneTitle: 'Audit pass' })
    ).toEqual({ text: 'rebasing #67', kind: 'away' });
  });
  test('pane title when it is not the handle', () => {
    expect(doing({ ...base, paneTitle: 'Audit corrections' })).toEqual({
      text: 'Audit corrections',
      kind: 'title',
    });
  });
  test('title equal to handle falls through to branch/path', () => {
    expect(doing({ ...base, paneTitle: 'max' })).toEqual({
      text: 'repo-tools · main',
      kind: 'path',
    });
  });
  test('branch when not main, ticket prefix stripped', () => {
    expect(
      doing({ ...base, branch: 'goodwinmattheweric/rt-96-provision-blocks' })
    ).toEqual({ text: 'rt-96-provision-blocks', kind: 'branch' });
  });
  test('worktree folder fallback on main', () => {
    expect(doing(base)).toEqual({ text: 'repo-tools · main', kind: 'path' });
  });
  test('offline shows sign-out age only', () => {
    const line = doing({
      ...base,
      status: 'offline',
      signedOutAt: Date.now() - 3 * 60_000,
    });
    expect(line).toEqual({ text: 'signed out 3m ago', kind: 'signed-out' });
  });
  test('offline with no signedOutAt gives null', () => {
    expect(doing({ ...base, status: 'offline' })).toBeNull();
  });
  test('a pinned now yields a fixed sign-out age, not one derived from wall time', () => {
    const pinned = 1_700_000_000_000;
    const line = doing(
      { ...base, status: 'offline', signedOutAt: pinned - 5 * 60_000 },
      pinned
    );
    expect(line).toEqual({ text: 'signed out 5m ago', kind: 'signed-out' });
  });
});
