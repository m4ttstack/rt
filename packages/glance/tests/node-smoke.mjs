#!/usr/bin/env node
/**
 * Does the SHIPPED build actually work under Node?
 *
 * The unit suite runs on Bun; the package ships a Node build. Bun accepts
 * things Node rejects, so a green `bun test` says nothing about what
 * consumers get. This project has already paid for that gap once, when
 * `new Response('', { status: 204 })` (valid under Bun, a TypeError under
 * Node) shipped invisibly to the suite.
 *
 * Two rules keep this honest:
 *  - Import `dist`, never `src`. Importing the TypeScript source would test
 *    the thing Bun already tests.
 *  - Reach `dist` through `import()`, not `require()`. `package.json` maps
 *    `exports["."].import` here, and `require()` of an ESM file only works
 *    on Node 22.12 and later, while this package supports Node >= 21. A
 *    check that passes only on the newest Node proves nothing about the
 *    floor it claims to support.
 *
 * Transports are stubbed. This asserts the code runs and behaves under
 * Node, not that GitHub is reachable.
 */
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = pathToFileURL(resolve(here, '../dist/index.js')).href;
const {
  ActionCableClient,
  GitHubProvider,
  GitLabProvider,
  TRANSITIONAL_MERGE_STATUSES,
  isTransitionalMergeStatus
} = await import(dist);

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}: ${err && err.message ? err.message : err}`);
  }
}

/** A provider whose Octokit is replaced wholesale. */
function provider(octokit) {
  const p = new GitHubProvider('https://github.com', 'tok');
  p.octokit = octokit;
  return p;
}

const USER = { id: 7, login: 'ada', name: 'Ada', avatar_url: 'https://x/a.png' };

/** One GraphQL review thread rooted at `rootId`. */
function thread(nodeId, rootId, isResolved) {
  return {
    id: nodeId,
    isResolved,
    comments: { nodes: [{ databaseId: rootId }] }
  };
}

function threadsPayload(nodes) {
  return {
    repository: {
      pullRequest: {
        reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes }
      }
    }
  };
}

await check('capabilities survive the bundler', () => {
  const caps = new GitHubProvider('https://github.com', 'tok').capabilities;
  assert.equal(caps.canResolveDiscussions, true);
  assert.equal(caps.canUnapprove, true);
  assert.equal(caps.canAutoMerge, true);
});

await check('restRequest constructs a real 204 Response (the historical Bun/Node bug)', async () => {
  // Stubbing octokit.request (not p.api) so this actually drives
  // restRequest -> api -> toResponse -> `new Response(...)`, the exact
  // chain that produced the Bun-passes/Node-throws bug this file exists to
  // catch. Octokit hands a 204 back as `data: ''`; toResponse is supposed
  // to null that out before it reaches the Response constructor.
  const p = provider({
    request: async route => {
      assert.ok(route.startsWith('GET '), `expected a GET route, got ${route}`);
      return { status: 204, headers: {}, data: '' };
    }
  });

  const res = await p.restRequest('GET', '/user');
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '', 'expected a 204 to read back as an empty body');
});

await check('restRequest round-trips a 200 JSON body', async () => {
  const p = provider({
    request: async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: { login: 'ada', id: 7 }
    })
  });

  const res = await p.restRequest('GET', '/user');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { login: 'ada', id: 7 });
});

await check('fetchMRDiscussions reports resolved state', async () => {
  const p = provider({
    paginate: async route =>
      route.includes('/pulls/')
        ? [
            {
              id: 100,
              body: 'b',
              user: USER,
              created_at: '2026-08-01T00:00:00Z',
              path: 'a.ts',
              line: 1,
              original_line: 1,
              in_reply_to_id: null
            }
          ]
        : [],
    graphql: async () => threadsPayload([thread('PRRT_a', 100, true)])
  });
  p.api = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ full_name: 'acme/repo' }),
    text: async () => '{}',
    headers: { get: () => null }
  });

  const detail = await p.fetchMRDiscussions('github:repo:1', 5);
  const d = detail.discussions.find(x => x.id === 'gh-review-thread-100');
  assert.equal(d.resolved, true, 'expected the thread to report resolved');
});

await check('resolveDiscussion maps the id and issues the mutation', async () => {
  const mutations = [];
  const p = provider({
    graphql: async (query, variables) => {
      if (query.includes('mutation')) {
        mutations.push(variables);
        return { resolveReviewThread: { thread: { id: variables.threadId, isResolved: true } } };
      }
      return threadsPayload([thread('PRRT_b', 200, false)]);
    }
  });

  await p.resolveDiscussion('acme/repo', 5, 'gh-review-thread-200');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].threadId, 'PRRT_b');
});

await check('a mutation that changed nothing throws', async () => {
  const p = provider({
    graphql: async query =>
      query.includes('mutation')
        ? { resolveReviewThread: { thread: { id: 'PRRT_c', isResolved: false } } }
        : threadsPayload([thread('PRRT_c', 300, false)])
  });

  await assert.rejects(
    () => p.resolveDiscussion('acme/repo', 5, 'gh-review-thread-300'),
    /did not become resolved/i
  );
});

await check('unapprovePullRequest dismisses the newest approval', async () => {
  const dismissals = [];
  const p = provider({
    request: async (route, params) => {
      if (route.startsWith('GET /user')) return { status: 200, headers: {}, data: USER };
      if (route.includes('/dismissals')) {
        dismissals.push(params);
        return { status: 200, headers: {}, data: {} };
      }
      throw new Error(`unexpected route ${route}`);
    },
    paginate: async () => [
      { id: 1, user: USER, state: 'APPROVED', submitted_at: '2026-08-01T00:00:00Z' }
    ]
  });

  await p.unapprovePullRequest('acme/repo', 5);
  assert.equal(dismissals.length, 1);
  assert.equal(dismissals[0].review_id, 1);
});

await check('setAutoMerge threads the node id', async () => {
  const mutations = [];
  const p = provider({
    request: async () => ({ status: 200, headers: {}, data: { number: 5, node_id: 'PR_kwABC' } }),
    graphql: async (query, variables) => {
      mutations.push(variables);
      return {
        enablePullRequestAutoMerge: {
          pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
        }
      };
    }
  });

  await p.setAutoMerge('acme/repo', 5);
  assert.equal(mutations[0].id, 'PR_kwABC');
});

await check('setAutoMerge throws when GitHub accepts the mutation but enables nothing', async () => {
  const p = provider({
    request: async () => ({ status: 200, headers: {}, data: { number: 5, node_id: 'PR_kwABC' } }),
    graphql: async () => ({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: null }
      }
    })
  });

  await assert.rejects(() => p.setAutoMerge('acme/repo', 5), /reported no auto-merge/i);
});

await check('cancelAutoMerge throws when auto-merge is still on', async () => {
  const p = provider({
    request: async () => ({ status: 200, headers: {}, data: { number: 5, node_id: 'PR_kwABC' } }),
    graphql: async () => ({
      disablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
      }
    })
  });

  await assert.rejects(() => p.cancelAutoMerge('acme/repo', 5), /still reports auto-merge/i);
});

// ── GitLab ───────────────────────────────────────────────────────────────────
// This file drove only GitHubProvider until now, so the GitLab half of the
// package shipped with no Node coverage at all. `restRequest`'s path contract
// is the release's one breaking change: a consumer that does not update its
// call sites gets a throw, and `prepublishOnly` is the last place that can
// notice the shipped build no longer behaves the way the CHANGELOG says.

/** Answers every fetch with 200 and records the URLs, so no network is touched. */
function stubFetch() {
  const urls = [];
  globalThis.fetch = async input => {
    urls.push(typeof input === 'string' ? input : String(input));
    return new Response('{}', { status: 200 });
  };
  return urls;
}

const realFetch = globalThis.fetch;

await check('GitLabProvider.restRequest prefixes /api/v4 itself (BREAKING, MAT-130)', async () => {
  const urls = stubFetch();
  try {
    const p = new GitLabProvider('https://gitlab.example.com', 'tok');
    const res = await p.restRequest('GET', '/user');
    assert.equal(res.status, 200);
    assert.deepEqual(urls, ['https://gitlab.example.com/api/v4/user']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await check('GitLabProvider.restRequest rejects a path that still carries /api/v4', async () => {
  const urls = stubFetch();
  try {
    const p = new GitLabProvider('https://gitlab.example.com', 'tok');
    await assert.rejects(() => p.restRequest('GET', '/api/v4/user'), /api\/v4/);
    assert.deepEqual(urls, [], 'the rejected path must never reach fetch');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await check('TRANSITIONAL_MERGE_STATUSES and isTransitionalMergeStatus survive the bundler', () => {
  assert.ok(Array.isArray(TRANSITIONAL_MERGE_STATUSES), 'expected an exported array');
  assert.ok(TRANSITIONAL_MERGE_STATUSES.includes('preparing'));
  assert.ok(TRANSITIONAL_MERGE_STATUSES.includes('checking'));
  assert.equal(typeof isTransitionalMergeStatus, 'function');
  assert.equal(isTransitionalMergeStatus('preparing'), true);
  assert.equal(isTransitionalMergeStatus('broken_status'), false);
  assert.equal(isTransitionalMergeStatus(null), false);
});

// ── ActionCable ──────────────────────────────────────────────────────────────
// This gate never constructed an ActionCableClient, which is how a client
// that could not work at all on Node 18/20 shipped for five phases while
// every check here stayed green (MAT-156). These two checks pin both halves
// of the fix: the runtime this gate runs on actually has the global the
// client needs, and a runtime without it gets a throw instead of a silent
// retry loop.

const noopCallbacks = {
  onConnected: () => {},
  onDisconnected: () => {},
  onMessage: () => {},
  onConfirm: () => {},
  onReject: () => {}
};

await check('this Node provides the global WebSocket that ActionCableClient needs', () => {
  assert.equal(typeof WebSocket, 'function', 'no global WebSocket: engines.node floor is wrong for this runtime');
});

await check('ActionCableClient.connect() runs under Node and disconnects cleanly', () => {
  // A stub constructor keeps this hermetic: the check is that the shipped
  // build's connect path executes under Node, not that GitLab is reachable.
  const realWS = globalThis.WebSocket;
  globalThis.WebSocket = class {
    onmessage = null;
    onclose = null;
    onerror = null;
    close() {}
  };
  try {
    const client = new ActionCableClient('https://gitlab.example.com', 'tok', noopCallbacks);
    client.connect();
    client.disconnect();
  } finally {
    globalThis.WebSocket = realWS;
  }
});

await check('ActionCableClient.connect() throws without a global WebSocket (MAT-156)', () => {
  const realWS = globalThis.WebSocket;
  delete globalThis.WebSocket;
  try {
    const client = new ActionCableClient('https://gitlab.example.com', 'tok', noopCallbacks);
    assert.throws(() => client.connect(), /Node 21/);
  } finally {
    globalThis.WebSocket = realWS;
  }
});

if (failures > 0) {
  console.error(`\n${failures} Node smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Node smoke checks passed.');
