#!/usr/bin/env bun
/**
 * Reviewers and assignees actually reach both providers (MAT-24).
 *
 * Two independent defects on the same pair of fields, both silent (a caller
 * gets back a PullRequest that looks like the call worked either way):
 *
 * - GitLabProvider forwarded usernames straight into assignee_ids/reviewer_ids,
 *   fields GitLab documents as taking numeric ids, through a cast
 *   (`asUserIds`) that erased the mismatch instead of fixing it.
 * - GitHubProvider's update path only ever POSTed to
 *   requested_reviewers/assignees, which GitHub documents as additive-only.
 *   UpdatePullRequestInput documents both fields as "replaces the current
 *   set," which was true on GitLab and false on GitHub: a caller shrinking
 *   the list got back a PR whose reviewer/assignee was never removed.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

// ── GitLab ───────────────────────────────────────────────────────────────────

function stubGitLabUsers(provider: GitLabProvider, usersByUsername: Record<string, Array<{ id: number }>>) {
  (provider as any).gb.Users.all = async ({ username }: { username: string }) =>
    usersByUsername[username] ?? [];
}

function createInput(over: Record<string, unknown> = {}) {
  return {
    projectPath: 'g/p',
    title: 'My feature',
    sourceBranch: 'feat',
    targetBranch: 'main',
    ...over,
  } as Parameters<GitLabProvider['createPullRequest']>[0];
}

describe('GitLabProvider reviewers/assignees resolve to numeric ids', () => {
  test('createPullRequest resolves reviewer and assignee usernames to the ids GitLab requires', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let createOpts: any;
    (provider as any).gb.MergeRequests.create = async (...args: unknown[]) => {
      createOpts = args[4];
      return { iid: 1 };
    };
    stubGitLabUsers(provider, { ada: [{ id: 42 }], bob: [{ id: 7 }] });
    (provider as any).fetchSingleMRWithRetry = async () => ({ iid: 1 });

    await provider.createPullRequest(createInput({ reviewers: ['ada'], assignees: ['bob'] }));

    // A cast (`usernames as unknown as number[]`) would send the literal
    // strings 'ada'/'bob' here instead of the resolved numeric ids.
    expect(createOpts.reviewerIds).toEqual([42]);
    expect(createOpts.assigneeIds).toEqual([7]);
  });

  test('createPullRequest throws, naming the username, when a reviewer does not resolve', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    (provider as any).gb.MergeRequests.create = async () => ({ iid: 1 });
    stubGitLabUsers(provider, {});

    await expect(provider.createPullRequest(createInput({ reviewers: ['ghost'] }))).rejects.toThrow(/ghost/);
  });

  test('updatePullRequest sends the resolved ids as the full reviewer set, so dropping a name removes it', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let editOpts: any;
    (provider as any).gb.MergeRequests.edit = async (_p: string, _iid: number, opts: unknown) => {
      editOpts = opts;
      return {};
    };
    stubGitLabUsers(provider, { ada: [{ id: 42 }] });
    (provider as any).fetchSingleMRWithRetry = async () => ({ iid: 1, draft: false });

    // The caller wants only "ada" reviewing now; whoever else GitLab currently
    // has does not matter, because GitLab's reviewer_ids is replace-semantics
    // by nature -- the id list sent IS the new set.
    await provider.updatePullRequest('g/p', 1, { reviewers: ['ada'] });

    expect(editOpts.reviewerIds).toEqual([42]);
  });

  test('updatePullRequest resolves assignee usernames too, since the same cast covered both fields', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let editOpts: any;
    (provider as any).gb.MergeRequests.edit = async (_p: string, _iid: number, opts: unknown) => {
      editOpts = opts;
      return {};
    };
    stubGitLabUsers(provider, { carol: [{ id: 99 }] });
    (provider as any).fetchSingleMRWithRetry = async () => ({ iid: 1, draft: false });

    await provider.updatePullRequest('g/p', 1, { assignees: ['carol'] });

    expect(editOpts.assigneeIds).toEqual([99]);
  });

  test('updatePullRequest throws, naming the username, when an assignee does not resolve', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    (provider as any).gb.MergeRequests.edit = async () => ({});
    stubGitLabUsers(provider, {});

    await expect(provider.updatePullRequest('g/p', 1, { assignees: ['ghost'] })).rejects.toThrow(/ghost/);
  });
});

// ── GitHub ───────────────────────────────────────────────────────────────────

function ghUser(login: string) {
  return { id: login.length, login, avatar_url: null };
}

function basePR(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    node_id: 'PR_node_1',
    number: 1,
    title: 'PR 1',
    body: null,
    state: 'open',
    draft: false,
    merged_at: null,
    html_url: 'https://github.com/acme/repo/pull/1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
    head: { sha: 'sha1', ref: 'feat' },
    base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo' } },
    user: { id: 999, login: 'octocat', avatar_url: null },
    assignees: [],
    requested_reviewers: [],
    labels: [],
    ...overrides,
  };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Stubs octokit so the PATCH that opens `updatePullRequest` returns `patched`
 * (carrying whatever current reviewers/assignees the test wants), and every
 * other request is recorded rather than sent, so POST/DELETE calls the
 * replace logic issues can be inspected directly.
 */
function stubGitHubUpdate(provider: GitHubProvider, patched: ReturnType<typeof basePR>): Call[] {
  const calls: Call[] = [];
  (provider as any).octokit = {
    request: async (route: string, params?: { data?: unknown }) => {
      const spaceIdx = route.indexOf(' ');
      const method = route.slice(0, spaceIdx);
      const path = route.slice(spaceIdx + 1);
      if (method === 'PATCH') {
        return { status: 200, headers: {}, data: patched };
      }
      calls.push({ method, path, body: params?.data });
      return { status: 200, headers: {}, data: {} };
    },
  };
  (provider as any).fetchSingleMR = async () => ({ iid: patched.number });
  return calls;
}

describe('GitHubProvider.updatePullRequest replaces reviewers/assignees', () => {
  test('adds a new reviewer and removes a dropped one in the same call', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const patched = basePR({ requested_reviewers: [ghUser('alice'), ghUser('bob')] });
    const calls = stubGitHubUpdate(provider, patched);

    await provider.updatePullRequest('acme/repo', 1, { reviewers: ['alice', 'carol'] });

    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/requested_reviewers'));
    const del = calls.find((c) => c.method === 'DELETE' && c.path.endsWith('/requested_reviewers'));
    expect(post?.body).toEqual({ reviewers: ['carol'] });
    expect(del?.body).toEqual({ reviewers: ['bob'] });
  });

  test('an empty reviewers array removes everyone currently requested and adds no one', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const patched = basePR({ requested_reviewers: [ghUser('alice')] });
    const calls = stubGitHubUpdate(provider, patched);

    // This is the case an append-only implementation gets wrong: it issues
    // no call at all for an empty array, leaving alice still requested.
    await provider.updatePullRequest('acme/repo', 1, { reviewers: [] });

    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/requested_reviewers'));
    const del = calls.find((c) => c.method === 'DELETE' && c.path.endsWith('/requested_reviewers'));
    expect(post).toBeUndefined();
    expect(del?.body).toEqual({ reviewers: ['alice'] });
  });

  test('a reviewer set that already matches issues neither a POST nor a DELETE', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const patched = basePR({ requested_reviewers: [ghUser('alice')] });
    const calls = stubGitHubUpdate(provider, patched);

    await provider.updatePullRequest('acme/repo', 1, { reviewers: ['alice'] });

    expect(calls.filter((c) => c.path.endsWith('/requested_reviewers'))).toEqual([]);
  });

  test('adds and removes assignees via the separate issues endpoint', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const patched = basePR({ assignees: [ghUser('alice'), ghUser('bob')] });
    const calls = stubGitHubUpdate(provider, patched);

    await provider.updatePullRequest('acme/repo', 1, { assignees: ['bob', 'carol'] });

    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/assignees'));
    const del = calls.find((c) => c.method === 'DELETE' && c.path.endsWith('/assignees'));
    expect(post?.body).toEqual({ assignees: ['carol'] });
    expect(del?.body).toEqual({ assignees: ['alice'] });
  });

  test('an empty assignees array removes every current assignee', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const patched = basePR({ assignees: [ghUser('alice'), ghUser('bob')] });
    const calls = stubGitHubUpdate(provider, patched);

    await provider.updatePullRequest('acme/repo', 1, { assignees: [] });

    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/assignees'));
    const del = calls.find((c) => c.method === 'DELETE' && c.path.endsWith('/assignees'));
    expect(post).toBeUndefined();
    expect(del?.body).toEqual({ assignees: ['alice', 'bob'] });
  });

  test('reviewers and assignees are independent: updating one leaves the other alone', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const patched = basePR({
      requested_reviewers: [ghUser('alice')],
      assignees: [ghUser('dave')],
    });
    const calls = stubGitHubUpdate(provider, patched);

    await provider.updatePullRequest('acme/repo', 1, { reviewers: ['erin'] });

    expect(calls.some((c) => c.path.endsWith('/assignees'))).toBe(false);
  });
});
