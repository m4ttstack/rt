/**
 * Unit tests for the live harness credentials loader.
 *
 * Pure parsing only. No file reads and no network: a malformed credentials
 * file must fail with a message naming the problem, because the alternative
 * is a live run dying halfway through with a cleanup step already skipped.
 */
import { describe, expect, test } from 'bun:test';
import {
  approverUsers,
  githubRepo,
  gitlabRepo,
  ownerUser,
  parseCredentials
} from './live/credentials.ts';

const VALID = {
  users: [
    { username: 'owner.person', name: 'Owner', role: 'owner', token: 'glpat-a' },
    { username: 'dev.one', name: 'Dev One', role: 'approver', token: 'glpat-b' },
    { username: 'dev.two', name: 'Dev Two', role: 'approver', token: 'glpat-c' }
  ],
  repos: [
    {
      provider: 'gitlab',
      name: 'glance-test-repo',
      web_url: 'https://gitlab.com/g/glance-test-repo',
      owner: 'owner.person',
      project_id: 1,
      path_with_namespace: 'g/glance-test-repo'
    },
    {
      provider: 'github',
      name: 'glance-conformance',
      web_url: 'https://github.com/u/glance-conformance',
      owner: 'u'
    }
  ]
};

describe('parseCredentials', () => {
  test('accepts a well-formed document', () => {
    const creds = parseCredentials(VALID);
    expect(creds.users).toHaveLength(3);
    expect(creds.repos).toHaveLength(2);
  });

  test('rejects a non-object', () => {
    expect(() => parseCredentials('nope')).toThrow(/must be a JSON object/);
  });

  test('rejects a missing users array', () => {
    expect(() => parseCredentials({ repos: [] })).toThrow(/users/);
  });

  test('names the offending user index on a missing token', () => {
    const bad = { ...VALID, users: [{ username: 'x', name: 'X', role: 'owner' }] };
    expect(() => parseCredentials(bad)).toThrow(/users\[0\].*token/);
  });

  test('rejects an unknown role', () => {
    const bad = {
      ...VALID,
      users: [{ username: 'x', name: 'X', role: 'wizard', token: 't' }]
    };
    expect(() => parseCredentials(bad)).toThrow(/role/);
  });
});

describe('selectors', () => {
  test('ownerUser returns the single owner', () => {
    expect(ownerUser(parseCredentials(VALID)).username).toBe('owner.person');
  });

  test('approverUsers returns every approver', () => {
    expect(approverUsers(parseCredentials(VALID)).map(u => u.username)).toEqual([
      'dev.one',
      'dev.two'
    ]);
  });

  test('gitlabRepo and githubRepo select by provider', () => {
    const creds = parseCredentials(VALID);
    expect(gitlabRepo(creds).name).toBe('glance-test-repo');
    expect(githubRepo(creds).name).toBe('glance-conformance');
  });

  test('ownerUser throws when no owner is declared', () => {
    const noOwner = {
      ...VALID,
      users: [{ username: 'x', name: 'X', role: 'approver', token: 't' }]
    };
    expect(() => ownerUser(parseCredentials(noOwner))).toThrow(/no user with role "owner"/);
  });
});

describe('repo optional field validation', () => {
  test('rejects a non-numeric project_id', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], project_id: 'not-a-number' }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.project_id.*number/);
  });

  test('rejects a non-string path_with_namespace', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], path_with_namespace: 12345 }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.path_with_namespace.*string/);
  });

  test('rejects an empty path_with_namespace', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], path_with_namespace: '' }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.path_with_namespace.*string/);
  });

  test('accepts a repo with no optional fields', () => {
    const minimal = {
      ...VALID,
      repos: [{ provider: 'github', name: 'test', web_url: 'https://example.com', owner: 'user' }]
    };
    const creds = parseCredentials(minimal);
    expect(creds.repos[0].project_id).toBeUndefined();
    expect(creds.repos[0].path_with_namespace).toBeUndefined();
  });
});
