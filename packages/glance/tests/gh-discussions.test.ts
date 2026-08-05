#!/usr/bin/env bun
/**
 * MAT-27: GitHub review threads have a resolved state.
 *
 * `fetchMRDiscussions` used to return `resolved: null` for every thread with
 * a comment claiming GitHub had no such concept. It does: GraphQL
 * `reviewThreads { isResolved }`, which the same file already reads for
 * `unresolvedThreadCount`. These tests join the REST grouping to the GraphQL
 * thread list on the root comment's databaseId and assert the state lands on
 * the right discussion.
 *
 * REST and GraphQL transports are both stubbed; nothing here touches a
 * network.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const USER = { id: 7, login: 'ada', name: 'Ada', avatar_url: 'https://x/a.png' };

/** One REST review comment. `replyTo` makes it a reply rather than a root. */
function comment(id: number, replyTo: number | null = null) {
  return {
    id,
    body: `comment ${id}`,
    user: USER,
    created_at: '2026-08-01T00:00:00Z',
    path: 'src/a.ts',
    line: 1,
    original_line: 1,
    in_reply_to_id: replyTo
  };
}

/** One GraphQL review thread node, rooted at `rootCommentId`. */
function thread(nodeId: string, rootCommentId: number, isResolved: boolean, isResolvable = true) {
  return {
    id: nodeId,
    isResolved,
    isResolvable,
    comments: { nodes: [{ databaseId: rootCommentId }] }
  };
}

/** One page of the `reviewThreads` connection, for multi-page tests. */
interface ThreadPage {
  nodes: unknown[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * A provider wired to fixed review comments, issue comments, and threads.
 * `fetchMRDiscussions` looks the repo up through `api()`, paginates both
 * comment endpoints, and reads threads through `octokit.graphql`.
 *
 * `pages`, when given, overrides `threads` and answers one page per call in
 * order, holding on the last page for any call past the end of the array --
 * that repetition is what lets a single short array stand in for "GitHub
 * keeps saying there's more" in the page-bound test.
 */
function providerWith(opts: {
  reviewComments: unknown[];
  issueComments?: unknown[];
  threads?: unknown[] | 'fail';
  pages?: ThreadPage[];
}): {
  provider: GitHubProvider;
  graphqlCalls: Array<Record<string, unknown>>;
  warnings: Array<{ message: string; payload?: unknown }>;
} {
  const graphqlCalls: Array<Record<string, unknown>> = [];
  const warnings: Array<{ message: string; payload?: unknown }> = [];
  let pageIndex = 0;

  const provider = new GitHubProvider('https://github.com', 'tok', {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (message: string, payload?: unknown) => warnings.push({ message, payload }),
      error: () => {}
    }
  });

  (provider as any).api = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ full_name: 'acme/repo' }),
    text: async () => '{}',
    headers: { get: () => null }
  });

  (provider as any).octokit = {
    paginate: async (route: string) =>
      route.includes('/pulls/') ? opts.reviewComments : (opts.issueComments ?? []),
    graphql: async (_query: string, variables: Record<string, unknown>) => {
      graphqlCalls.push(variables);
      if (opts.threads === 'fail') throw new Error('GraphQL is down');

      if (opts.pages) {
        const page = opts.pages[Math.min(pageIndex, opts.pages.length - 1)]!;
        pageIndex++;
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
                nodes: page.nodes
              }
            }
          }
        };
      }

      return {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: opts.threads ?? []
            }
          }
        }
      };
    }
  };

  return { provider, graphqlCalls, warnings };
}

describe('fetchMRDiscussions: resolved state', () => {
  test('a resolved thread reports resolved: true', async () => {
    const { provider } = providerWith({
      reviewComments: [comment(100), comment(101, 100)],
      threads: [thread('PRRT_a', 100, true)]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const d = detail.discussions.find(x => x.id === 'gh-review-thread-100');

    expect(d?.resolved).toBe(true);
    expect(d?.resolvable).toBe(true);
    expect(d?.notes.length).toBe(2);
  });

  test('an unresolved thread reports resolved: false, not null', async () => {
    const { provider } = providerWith({
      reviewComments: [comment(200)],
      threads: [thread('PRRT_b', 200, false)]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);

    expect(detail.discussions.find(x => x.id === 'gh-review-thread-200')?.resolved).toBe(false);
  });

  test('a mix keeps each thread on its own state', async () => {
    const { provider } = providerWith({
      reviewComments: [comment(300), comment(301), comment(302)],
      threads: [
        thread('PRRT_c', 300, true),
        thread('PRRT_d', 301, false),
        thread('PRRT_e', 302, true)
      ]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const state = Object.fromEntries(detail.discussions.map(d => [d.id, d.resolved]));

    expect(state['gh-review-thread-300']).toBe(true);
    expect(state['gh-review-thread-301']).toBe(false);
    expect(state['gh-review-thread-302']).toBe(true);
  });

  test('isResolvable: false is reported rather than assumed true', async () => {
    const { provider } = providerWith({
      reviewComments: [comment(400)],
      threads: [thread('PRRT_f', 400, false, false)]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);

    expect(detail.discussions.find(x => x.id === 'gh-review-thread-400')?.resolvable).toBe(false);
  });

  test('a thread with no GraphQL match keeps the old honest unknown', async () => {
    const { provider } = providerWith({
      reviewComments: [comment(500)],
      threads: []
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const d = detail.discussions.find(x => x.id === 'gh-review-thread-500');

    expect(d?.resolved).toBe(null);
    expect(d?.resolvable).toBe(true);
  });

  test('a GraphQL failure degrades the read rather than failing it', async () => {
    // The whole call throwing would be a regression: the notes are readable
    // from REST alone and were returned before this feature existed.
    const { provider } = providerWith({
      reviewComments: [comment(600)],
      threads: 'fail'
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const d = detail.discussions.find(x => x.id === 'gh-review-thread-600');

    expect(d?.notes.length).toBe(1);
    expect(d?.resolved).toBe(null);
  });

  test('issue comments stay non-resolvable', async () => {
    // PR-level comments genuinely have no thread and no resolved state on
    // GitHub, so null is the correct answer rather than a gap.
    const { provider } = providerWith({
      reviewComments: [],
      issueComments: [{ ...comment(700), path: null, line: null }],
      threads: []
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const d = detail.discussions.find(x => x.id === 'gh-issue-comment-700');

    expect(d?.resolvable).toBe(null);
    expect(d?.resolved).toBe(null);
  });

  test('notes in a resolved thread carry the thread state', async () => {
    const { provider } = providerWith({
      reviewComments: [comment(800), comment(801, 800)],
      threads: [thread('PRRT_g', 800, true)]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const d = detail.discussions.find(x => x.id === 'gh-review-thread-800');

    expect(d?.notes.every(n => n.resolved === true)).toBe(true);
  });

  test('cursor threading: the second page request carries the first page\'s endCursor', async () => {
    // Two threads split across two pages. Getting both threads right proves
    // the loop ran twice; the graphqlCalls assertion below is the one that
    // actually proves the cursor from page one reached page two, since a
    // bug that dropped the cursor and re-requested page one would still
    // produce two calls and could still get both threads right by accident.
    const { provider, graphqlCalls } = providerWith({
      reviewComments: [comment(900), comment(901)],
      pages: [
        { nodes: [thread('PRRT_h', 900, true)], hasNextPage: true, endCursor: 'cursor-1' },
        { nodes: [thread('PRRT_i', 901, false)], hasNextPage: false, endCursor: null }
      ]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const state = Object.fromEntries(detail.discussions.map(d => [d.id, d.resolved]));

    expect(state['gh-review-thread-900']).toBe(true);
    expect(state['gh-review-thread-901']).toBe(false);
    expect(graphqlCalls[0]?.cursor).toBe(null);
    expect(graphqlCalls[1]?.cursor).toBe('cursor-1');
  });

  test('hitting the page bound warns and leaves unmatched threads on the old unknown', async () => {
    // GitHub keeps claiming there's another page, forever. The walk has to
    // give up at THREAD_MAX_PAGES rather than spin, and the comment it never
    // got to join should read exactly like a thread GraphQL never mentioned.
    const { provider, warnings } = providerWith({
      reviewComments: [comment(1000)],
      pages: [{ nodes: [], hasNextPage: true, endCursor: 'always-more' }]
    });

    const detail = await provider.fetchMRDiscussions('github:repo:1', 5);
    const d = detail.discussions.find(x => x.id === 'gh-review-thread-1000');

    expect(d?.resolvable).toBe(true);
    expect(d?.resolved).toBe(null);
    expect(
      warnings.some(w => w.message.includes('review-thread page bound'))
    ).toBe(true);
  });
});

describe('resolveDiscussion / unresolveDiscussion', () => {
  /** Records the mutations a provider issues against a fixed thread list. */
  function mutatingProvider(threads: unknown[]) {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const mutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
    (provider as any).octokit = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        if (query.includes('mutation')) {
          mutations.push({ query, variables });
          return query.includes('unresolveReviewThread')
            ? { unresolveReviewThread: { thread: { id: variables.threadId, isResolved: false } } }
            : { resolveReviewThread: { thread: { id: variables.threadId, isResolved: true } } };
        }
        return {
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: threads }
            }
          }
        };
      }
    };
    return { provider, mutations };
  }

  test('the capability flag is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canResolveDiscussions).toBe(
      true
    );
  });

  test('a discussion id resolves to the thread node id', async () => {
    const { provider, mutations } = mutatingProvider([thread('PRRT_x', 900, false)]);

    await provider.resolveDiscussion('acme/repo', 5, 'gh-review-thread-900');

    expect(mutations.length).toBe(1);
    expect(mutations[0]?.query).toContain('resolveReviewThread');
    expect(mutations[0]?.variables.threadId).toBe('PRRT_x');
  });

  test('unresolve issues the unresolve mutation', async () => {
    const { provider, mutations } = mutatingProvider([thread('PRRT_y', 901, true)]);

    await provider.unresolveDiscussion('acme/repo', 5, 'gh-review-thread-901');

    expect(mutations[0]?.query).toContain('unresolveReviewThread');
    expect(mutations[0]?.variables.threadId).toBe('PRRT_y');
  });

  test('an unknown thread throws rather than silently doing nothing', async () => {
    const { provider, mutations } = mutatingProvider([]);

    await expect(
      provider.resolveDiscussion('acme/repo', 5, 'gh-review-thread-999')
    ).rejects.toThrow(/no review thread/i);
    expect(mutations.length).toBe(0);
  });

  test('an issue-comment id is rejected with a reason, not attempted', async () => {
    // PR-level comments are not threads. Sending one to resolveReviewThread
    // would fail with a GitHub-side type error that says nothing useful.
    const { provider, mutations } = mutatingProvider([]);

    await expect(
      provider.resolveDiscussion('acme/repo', 5, 'gh-issue-comment-700')
    ).rejects.toThrow(/not a resolvable review thread/i);
    expect(mutations.length).toBe(0);
  });

  test('a mutation that reports the wrong end state throws', async () => {
    // The MAT-15 shape: GitHub accepts the call, changes nothing, and the
    // caller is told it worked.
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      graphql: async (query: string) =>
        query.includes('mutation')
          ? { resolveReviewThread: { thread: { id: 'PRRT_z', isResolved: false } } }
          : {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [thread('PRRT_z', 902, false)]
                  }
                }
              }
            }
    };

    await expect(
      provider.resolveDiscussion('acme/repo', 5, 'gh-review-thread-902')
    ).rejects.toThrow(/did not become resolved/i);
  });
});
