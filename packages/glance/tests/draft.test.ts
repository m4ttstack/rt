#!/usr/bin/env bun
/**
 * Draft handling on create and update (MAT-15).
 *
 * GitLab has no `draft` parameter on either endpoint -- gitbeaker's
 * CreateMergeRequestOptions and EditMergeRequestOptions have no such field, and
 * the flag the old code forwarded behind an `as never` cast never reached
 * anything. Draft is the `Draft:` title prefix, applied at the wire boundary
 * and stripped again on read.
 *
 * GitHub has `draft` on create only; the update endpoint ignores it, so the
 * transition goes through a GraphQL mutation.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider, stripDraftPrefix } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── GitLab ───────────────────────────────────────────────────────────────────

interface GitLabCalls {
  create: unknown[] | null;
  edit: unknown[] | null;
  showCount: number;
}

/**
 * GitLab's own draft rule, which is broader than the prefixes `draftTitle`
 * writes: self-hosted instances still honour the pre-14.0 `WIP:`.
 */
const GITLAB_DRAFT_TITLE = /^\s*(?:\[draft\]|\(draft\)|draft:|wip:)\s*/i;

/**
 * A GitLab that behaves like the real one on this point: draft state is read
 * back off the title it was given, never off what the SDK meant to write.
 */
function stubGitLab(
  provider: GitLabProvider,
  current: { title: string; draft: boolean } = { title: 'Current title', draft: false },
): GitLabCalls {
  const calls: GitLabCalls = { create: null, edit: null, showCount: 0 };
  let title = current.title;
  (provider as any).gb = {
    MergeRequests: {
      create: async (...args: unknown[]) => {
        calls.create = args;
        title = String(args[3]);
        return { iid: 7 };
      },
      edit: async (...args: unknown[]) => {
        calls.edit = args;
        const opts = args[2] as { title?: string } | undefined;
        if (opts?.title != null) title = opts.title;
        return {};
      },
      show: async () => {
        calls.showCount++;
        return { title, draft: GITLAB_DRAFT_TITLE.test(title) };
      },
    },
  };
  (provider as any).fetchSingleMRWithRetry = async () => ({
    iid: 7,
    title: title.replace(GITLAB_DRAFT_TITLE, ''),
    draft: GITLAB_DRAFT_TITLE.test(title),
  });
  return calls;
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

describe('GitLabProvider.createPullRequest draft', () => {
  test('draft: true prefixes the wire title and sends no draft field', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    await provider.createPullRequest(createInput({ draft: true }));

    expect(calls.create?.[3]).toBe('Draft: My feature');
    expect(calls.create?.[4]).not.toHaveProperty('draft');
  });

  test('draft omitted leaves the title alone', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    await provider.createPullRequest(createInput());

    expect(calls.create?.[3]).toBe('My feature');
    expect(calls.create?.[4]).not.toHaveProperty('draft');
  });

  test('draft omitted does not strip a prefix the caller wrote deliberately', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    // No `draft` field at all: the caller has no opinion, and GitLab would
    // read this title as a draft. Treating the absence as `draft: false`
    // published it instead, under a title the caller never asked for.
    const created = await provider.createPullRequest(createInput({ title: 'Draft: notes' }));

    expect(calls.create?.[3]).toBe('Draft: notes');
    expect(created.draft).toBe(true);
  });

  test('draft: false strips a prefix the caller already wrote', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    await provider.createPullRequest(createInput({ title: 'Draft: My feature', draft: false }));

    expect(calls.create?.[3]).toBe('My feature');
  });

  test('a title that is already prefixed is not prefixed twice', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    await provider.createPullRequest(createInput({ title: 'Draft: My feature', draft: true }));

    expect(calls.create?.[3]).toBe('Draft: My feature');
  });
});

describe('GitLabProvider.updatePullRequest draft', () => {
  test('draft: true reads the current title and prefixes it', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider, { title: 'Current title', draft: false });

    await provider.updatePullRequest('g/p', 7, { draft: true });

    expect(calls.showCount).toBe(1);
    expect(calls.edit?.[2]).toMatchObject({ title: 'Draft: Current title' });
    expect(calls.edit?.[2]).not.toHaveProperty('draft');
  });

  test('draft: false publishes by stripping the prefix', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider, { title: 'Draft: Current title', draft: true });

    await provider.updatePullRequest('g/p', 7, { draft: false });

    expect(calls.edit?.[2]).toMatchObject({ title: 'Current title' });
  });

  test('retitling a draft MR keeps it a draft', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider, { title: 'Draft: Current title', draft: true });

    await provider.updatePullRequest('g/p', 7, { title: 'Renamed' });

    expect(calls.edit?.[2]).toMatchObject({ title: 'Draft: Renamed' });
  });

  test('title plus draft needs no extra read', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    await provider.updatePullRequest('g/p', 7, { title: 'Renamed', draft: true });

    expect(calls.showCount).toBe(0);
    expect(calls.edit?.[2]).toMatchObject({ title: 'Draft: Renamed' });
  });

  test('an update touching neither field reads nothing and sets no title', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubGitLab(provider);

    await provider.updatePullRequest('g/p', 7, { targetBranch: 'develop' });

    expect(calls.showCount).toBe(0);
    expect(calls.edit?.[2]).toEqual({ targetBranch: 'develop' });
  });

  test('a transition that landed returns the MR in the requested state', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    stubGitLab(provider, { title: 'Current title', draft: false });

    const updated = await provider.updatePullRequest('g/p', 7, { draft: true });

    expect(updated.draft).toBe(true);
    expect(updated.title).toBe('Current title');
  });

  test('a draft marker the SDK does not write throws instead of reporting success', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    // Pre-14.0 self-hosted form: `draftTitle` leaves `WIP:` in place, so the
    // edit succeeds and GitLab keeps the MR a draft.
    const calls = stubGitLab(provider, { title: 'WIP: Current title', draft: true });

    await expect(provider.updatePullRequest('g/p', 7, { draft: false })).rejects.toThrow(
      /still a draft after requesting draft=false/,
    );
    expect(calls.edit).not.toBeNull();
  });
});

describe('GitLab draft prefix on read', () => {
  test('stripDraftPrefix handles the forms GitLab accepts', () => {
    expect(stripDraftPrefix('Draft: Feature')).toBe('Feature');
    expect(stripDraftPrefix('draft: Feature')).toBe('Feature');
    expect(stripDraftPrefix('[Draft] Feature')).toBe('Feature');
    expect(stripDraftPrefix('(Draft) Feature')).toBe('Feature');
    expect(stripDraftPrefix('Feature')).toBe('Feature');
    expect(stripDraftPrefix('Redraft: the RFC')).toBe('Redraft: the RFC');
  });

  test('a draft MR comes back with the prefix removed and draft set', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            project: {
              mergeRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'gid://gitlab/MergeRequest/1',
                    iid: '1',
                    projectId: 42,
                    title: 'Draft: My feature',
                    description: null,
                    state: 'opened',
                    draft: true,
                    conflicts: false,
                    detailedMergeStatus: 'DRAFT_STATUS',
                    webUrl: 'https://gitlab.example/g/p/-/merge_requests/1',
                    sourceBranch: 'feat',
                    targetBranch: 'main',
                    createdAt: '2026-07-01T00:00:00Z',
                    updatedAt: '2026-07-01T00:00:00Z',
                    diffHeadSha: 'abc',
                    author: { id: 'gid://gitlab/User/1', username: 'u1', name: 'u1', avatarUrl: null },
                    assignees: { nodes: [] },
                    reviewers: { nodes: [] },
                    approvedBy: { nodes: [] },
                    headPipeline: null,
                    mergeabilityChecks: [],
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const provider = new GitLabProvider('https://gitlab.example', 't');
    const prs = await provider.fetchPullRequests({ projectPath: 'g/p' });

    expect(prs[0]?.title).toBe('My feature');
    expect(prs[0]?.draft).toBe(true);
  });
});

// ── GitHub ───────────────────────────────────────────────────────────────────

function ghPR(draft: boolean) {
  return {
    id: 10,
    node_id: 'PR_node_1',
    number: 1,
    title: 'PR 1',
    body: null,
    state: 'open',
    draft,
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
  };
}

interface GitHubCalls {
  bodies: Array<{ path: string; body: unknown }>;
  mutations: string[];
}

function stubGitHub(
  provider: GitHubProvider,
  patched: ReturnType<typeof ghPR>,
  mutationSucceeds = true,
): GitHubCalls {
  const calls: GitHubCalls = { bodies: [], mutations: [] };
  (provider as any).octokit = {
    request: async (route: string, params?: { data?: unknown }) => {
      const path = route.slice(route.indexOf(' ') + 1);
      calls.bodies.push({ path, body: params?.data });
      return { status: 200, headers: {}, data: patched };
    },
    // `setDraft` now goes through `graphqlOrThrow`, which reaches
    // `octokit.graphql` directly rather than the provider's own `graphql`
    // method (MAT-133), so the mock moves to the transport boundary. A
    // failed mutation returns a body with no matching field rather than
    // null: `graphqlOrThrow` treats null as "no data" and throws before the
    // isDraft check below ever runs, which would change the message this
    // test asserts on.
    graphql: async (mutation: string) => {
      calls.mutations.push(mutation);
      const draft = mutation.includes('convertPullRequestToDraft');
      if (!mutationSucceeds) return {};
      return {
        [draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview']: {
          pullRequest: { isDraft: draft },
        },
      };
    },
  };
  (provider as any).fetchSingleMR = async () => ({ iid: 1 });
  return calls;
}

describe('GitHubProvider draft', () => {
  test('create sends draft in the REST body, which GitHub documents there', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, ghPR(true));

    await provider.createPullRequest({
      projectPath: 'acme/repo',
      title: 'My feature',
      sourceBranch: 'feat',
      targetBranch: 'main',
      draft: true,
    });

    expect(calls.bodies[0]?.body).toMatchObject({ draft: true, title: 'My feature' });
  });

  test('update converts to draft with a GraphQL mutation, not the PATCH body', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, ghPR(false));

    await provider.updatePullRequest('acme/repo', 1, { draft: true });

    expect(calls.bodies[0]?.body).not.toHaveProperty('draft');
    expect(calls.mutations.length).toBe(1);
    expect(calls.mutations[0]).toContain('convertPullRequestToDraft');
  });

  test('update marks a draft PR ready for review', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, ghPR(true));

    await provider.updatePullRequest('acme/repo', 1, { draft: false });

    expect(calls.mutations[0]).toContain('markPullRequestReadyForReview');
  });

  test('a PR already in the requested state needs no mutation', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, ghPR(true));

    await provider.updatePullRequest('acme/repo', 1, { draft: true });

    expect(calls.mutations).toEqual([]);
  });

  test('a failed transition throws instead of reporting success', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, ghPR(false), false);

    await expect(provider.updatePullRequest('acme/repo', 1, { draft: true })).rejects.toThrow(
      /could not set draft=true/,
    );
  });
});
