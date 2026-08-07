#!/usr/bin/env bun
/**
 * GitLab `fetchUser` (MAT-159): username to normalized UserRef, null on a
 * miss. mr-board was hand-rolling GET /users?username= with glance's own
 * token because nothing on the interface answered this.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

type GLUser = { id: number; username: string; name: string; avatar_url: string | null };

function providerWith(matches: GLUser[]): GitLabProvider {
  const provider = new GitLabProvider('https://gitlab.example.com', 'tok');
  (provider as any).gb.Users.all = async () => matches;
  return provider;
}

describe('GitLabProvider.fetchUser', () => {
  test('maps the first match to a UserRef', async () => {
    const provider = providerWith([
      { id: 42, username: 'ada', name: 'Ada Lovelace', avatar_url: 'https://cdn.example.com/a.png' },
    ]);
    const user = await provider.fetchUser('ada');
    expect(user).toEqual({
      id: 'gitlab:user:42',
      username: 'ada',
      name: 'Ada Lovelace',
      avatarUrl: 'https://cdn.example.com/a.png?private_token=tok',
    });
  });

  test('returns null when no user matches', async () => {
    const provider = providerWith([]);
    expect(await provider.fetchUser('nobody')).toBeNull();
  });

  test('prefixes a relative avatar path with the instance baseURL', async () => {
    const provider = providerWith([
      { id: 7, username: 'grace', name: 'Grace Hopper', avatar_url: '/uploads/g.png' },
    ]);
    const user = await provider.fetchUser('grace');
    expect(user?.avatarUrl).toBe('https://gitlab.example.com/uploads/g.png?private_token=tok');
  });

  test('a null avatar stays null', async () => {
    const provider = providerWith([{ id: 9, username: 'bob', name: 'Bob', avatar_url: null }]);
    expect((await provider.fetchUser('bob'))?.avatarUrl).toBeNull();
  });
});
