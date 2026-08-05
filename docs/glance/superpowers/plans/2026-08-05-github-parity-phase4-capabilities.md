# GitHub Parity Phase 4: New Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip `canResolveDiscussions`, `canUnapprove`, and `canAutoMerge` from `false` to `true` on `GitHubProvider` with real implementations behind them, on top of a GraphQL helper that throws instead of swallowing, and close the harness coverage gaps phase 1 recorded.

**Architecture:** Every mutation this phase adds goes through a new `graphqlOrThrow()` sibling of the existing `graphql()`, so a failed mutation can never be misread as a no-op success. `graphql()`'s swallow-to-null stays exactly as it is for the two read paths that depend on it. Discussion ids on GitHub stay `gh-review-thread-<rootCommentId>`, and the mutations resolve those to GraphQL thread node ids at call time, so no consumer-persisted value changes meaning. `watchEvents` is deliberately not in this phase (see Out of scope).

**Tech Stack:** TypeScript, Bun test runner, `@octokit/core` 7 with the paginate/retry/throttling plugins, `@octokit/graphql`, GitHub GraphQL v4.

## Global Constraints

- **The live harness mutates real repositories, including merging into their default branches.** Read the safety section in `packages/glance/tests/live/runner.ts` before running it. Do not run it against `m4ttheweric/gitq-test-sandbox`.
- `packages/glance/tests/live/harness_credentials.json` is gitignored, holds real tokens, and the repo is public. Never stage it, never print it. Stage files by explicit path. Never `git add -A`.
- No em dashes or en dashes in anything authored by this plan (code, comments, commit messages, docs). Use `--`, an ellipsis, or rephrase. Existing occurrences in the codebase are not in scope to change.
- Comments explain WHY, never WHAT.
- Commit at the end of every task. One task, one commit.
- `bun test` must pass and `bun run check-types` must be clean before every commit. Both run from `packages/glance`.
- The unit suite runs on Bun; the package ships a Node build. Anything touching the transport needs a Node check (`node -e` against `dist`), because Bun accepts things Node rejects. Phase 3 lost a day to exactly this.
- The four methods this phase implements are currently asserted by the harness to **throw**. Flipping a capability flag without updating `packages/glance/tests/live/expectations.ts` in the same commit will fail the harness. That is the guard working, not a regression.

## File Structure

| File | Responsibility this phase gives it |
| --- | --- |
| `packages/glance/src/GitHubProvider.ts` | `graphqlOrThrow`, the review-thread index, the four mutations, three flag flips |
| `packages/glance/tests/gh-graphql-throw.test.ts` | New. Every failure category `graphqlOrThrow` must turn into a throw |
| `packages/glance/tests/gh-discussions.test.ts` | New. `fetchMRDiscussions` resolved state, and the id-to-node-id mapping |
| `packages/glance/tests/gh-unapprove.test.ts` | New. Review selection and dismissal request shape |
| `packages/glance/tests/gh-automerge.test.ts` | New. Auto-merge mutation shape and the no-op-success guard |
| `packages/glance/tests/live/expectations.ts` | Modify. Four entries move off `unsupported` |
| `packages/glance/tests/live/conformance.ts` | Modify. Supported-path checks replace the throw probes; job selection fixes; new assertions |
| `packages/glance/tests/smoke.test.ts` | Modify. Three capability assertions flip |
| `packages/glance/tests/integration.live.ts` | Modify. Same three assertions |
| `docs/superpowers/specs/2026-08-04-github-parity-design.md` | Modify. Correct the phase 4 section |
| `docs/superpowers/specs/2026-08-05-github-parity-phase4-results.md` | New. The live verification record |

## Out of scope

- **`canWatchEvents` / `watchEvents`.** Deferred to phase 5 by decision, on evidence gathered in the phase 4 survey: GitHub's repository events feed serves `X-Poll-Interval: 60` and `Cache-Control: private, max-age=300`, has no `since`/`after` request parameter, returns string ids, and orders by id in a way that does not agree with `created_at`. `EventsPoller` assumes the opposite of that last point. Implementing it means generalizing `EventsPoller`/`EventsWatcher` off `GitLabEvent`, changing the publicly exported `EventCursor.lastEventId` away from `number`, and adding ETag and server-directed cadence support. `canWatchEvents` stays `false` and `watchEvents` stays `absent` in the expectations table through this phase.
- `canRebase` and `watchMR`, permanently. GitHub's `update-branch` merges base into head rather than rebasing, and there is no push channel equivalent to ActionCable.
- Replacing the hand-written `GHPullRequest` and friends with `@octokit/openapi-types`. Deferred out of phase 3 for the same reason it stays out here: a type-shape regression would be indistinguishable from a behavior regression.

---

### Task 1: Correct the phase 4 design doc and the stale grouping comment

The design doc has been wrong about its own next phase in every prior phase, and phase 2 and 3 both opened by fixing it before building on it. Two of its phase 4 claims are false and one is a material understatement. Fixing them first means the later tasks are not justified by wrong statements.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-github-parity-design.md:257-280`
- Modify: `packages/glance/src/GitHubProvider.ts:675`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing in code. Later tasks quote the corrected text.

- [ ] **Step 1: Read the current phase 4 section**

Run: `sed -n '255,282p' docs/superpowers/specs/2026-08-04-github-parity-design.md`

- [ ] **Step 2: Replace the `canResolveDiscussions` bullet**

The current text says the thread ids are unavailable "since it groups by `pull_request_review_id`". That field is never read. `fetchMRDiscussions` groups by `in_reply_to_id ?? id` at `GitHubProvider.ts:691`. The distinction matters: the reply-root is exactly a GraphQL review thread's first comment, so the two id schemes are convertible, which is what makes the non-breaking approach below possible.

Replace the bullet with:

```markdown
- **`canResolveDiscussions` (MAT-27).** GraphQL `resolveReviewThread` and
  `unresolveReviewThread`. The largest single item: it needs thread node IDs,
  which the current REST-only `fetchMRDiscussions` never obtains. It groups
  review comments by `in_reply_to_id ?? id` (`GitHubProvider.ts:691`), not by
  `pull_request_review_id` as an earlier draft of this document claimed. That
  reply-root is the same comment GraphQL reports as a review thread's first
  comment, so the REST grouping and the GraphQL thread list are joinable on
  `comments(first: 1) { nodes { databaseId } }`.

  **Decision, made in the phase 4 survey:** `Discussion.id` keeps its current
  `gh-review-thread-<rootCommentId>` form and the mutations resolve it to a
  node ID at call time. MAT-27's acceptance criteria contemplated changing
  `Discussion.id` to the node ID instead; that is a change of a value
  consumers may have persisted, on a package still at 0.13.2 with unbumped
  consumer-visible changes already in main. The cost of the chosen route is
  one extra GraphQL read per mutation.
```

- [ ] **Step 3: Replace the `canUnapprove` bullet**

The current text is one line and omits three divergences from GitLab that change the implementation.

```markdown
- **`canUnapprove`.** The review dismissal endpoint
  (`PUT /repos/{owner}/{repo}/pulls/{n}/reviews/{review_id}/dismissals`),
  after locating the current user's review ID. Three divergences from
  GitLab's `unapprove` that the implementation has to answer:
  - GitHub requires a `message` on every dismissal and posts it to the PR
    timeline. `unapprovePullRequest(projectPath, mrIid)` has nowhere to get
    one from, so the provider sends a fixed, plainly-attributed string.
  - Dismissal leaves a `DISMISSED` review in the list rather than removing
    the approval record. `toPullRequest` (`GitHubProvider.ts:2024-2040`)
    keeps only the newest review per user, so the approval does drop out.
    That is read-verified, not live-verified.
  - GitHub keeps every review ever submitted, so the newest review per user
    is the only one worth dismissing. Dismissing the first `APPROVED` one
    found would revive a stale approval.
```

- [ ] **Step 4: Replace the `canAutoMerge` bullet**

```markdown
- **`canAutoMerge`.** GraphQL `enablePullRequestAutoMerge` and
  `disablePullRequestAutoMerge`, both needing the PR node ID (REST returns it
  as `node_id`). The fixture is already provisioned for this: a read-only
  check during the phase 4 survey confirmed `allow_auto_merge: true` on
  `m4ttheweric/glance-conformance` and a required `always-passes` status
  check on `main`. The open risk is a race rather than a missing setting:
  GitHub rejects enabling auto-merge on a pull request that is already
  mergeable, so the harness has to land the call before the required check
  reports. Phase 4 resolves that with a live spike rather than a guess.
```

- [ ] **Step 5: Replace the `canWatchEvents` bullet**

```markdown
- **`canWatchEvents`.** Deferred to phase 5. The one-line claim this document
  used to make -- poll `/repos/{owner}/{repo}/events` and translate into the
  same `InvalidationBatch` contract -- understated it. Measured against the
  live fixture feed during the phase 4 survey:
  - `X-Poll-Interval: 60` and `Cache-Control: private, max-age=300`. GitHub
    asks for a 60s cadence over a feed cached for five minutes, against a
    watcher whose default is 15s. GitHub freshness is minutes, not seconds.
  - Event ids do not order with `created_at`. Observed ids descended
    (`16777788402`, `16777332085`, `16777142192`) while timestamps ran
    `07:17:11`, `07:17:23`, `07:17:17`. `EventsPoller` derives `since` as
    `max(created_at)` over fresh events and has a timestamp-fallback filter
    that assumes the two agree (`EventsPoller.ts:174-192`).
  - No `since`/`after` request parameter exists; the `Link` header carries
    only `page`. The day-exclusive cursor strategy `FetchEvents` is typed
    around has no GitHub analog, so filtering is entirely client-side over a
    feed capped at 300 events.
  - Ids are strings. `EventCursor.lastEventId` is `number | null` and is
    publicly exported (`index.ts:54`) for consumers to persist.
  - `EventsPoller` is typed on `GitLabEvent` and `classifyEvent` is pure
    GitLab `action_name` semantics. Workflow and check-run events are absent
    from the feed, so `pipelines` invalidation can only be inferred from
    pushes.
```

- [ ] **Step 6: Fix the stale grouping comment in the provider**

`GitHubProvider.ts:675` currently reads:

```ts
    // Group review comments into threads (by pull_request_review_id and in_reply_to_id)
```

`pull_request_review_id` is never read. This comment is where the design doc's false claim came from. Replace it with:

```ts
    // Group review comments into threads by their reply root. GitHub does not
    // return a thread id on REST review comments, so the root comment stands
    // in for one: every reply carries `in_reply_to_id` pointing at it, and
    // GraphQL reports that same comment as the thread's first comment, which
    // is what lets Task 3 join the two.
```

- [ ] **Step 7: Verify nothing else asserts the false claim**

Run: `grep -rn "pull_request_review_id" packages/glance/src packages/glance/tests docs/superpowers`
Expected: only the `GHComment` interface field declaration at `GitHubProvider.ts:180` and any findings-doc quotes of the original defect. If a *forward-looking* statement elsewhere repeats the false grouping claim, fix it too. Do not rewrite the historical findings and results docs: they are records of what was believed at the time.

- [ ] **Step 8: Type-check and commit**

Run: `cd packages/glance && bun run check-types && bun test`
Expected: clean, 253 tests pass.

```bash
git add docs/superpowers/specs/2026-08-04-github-parity-design.md packages/glance/src/GitHubProvider.ts
git commit -m "docs: correct the phase 4 design section and the stale thread-grouping comment"
```

---

### Task 2: MAT-133, a GraphQL path that throws

`graphql()` turns transport errors, HTTP errors, and GraphQL errors alike into a warn and a `null`. That is defensible for the two read paths that use it and its docstring argues exactly that. It is dangerous for the four mutations tasks 4 through 6 add: an `enablePullRequestAutoMerge` returning `null` is indistinguishable from "auto-merge is off". This is the same bug class as MAT-15, where a silent no-op meant gitq had never actually published a draft MR.

The fix is a sibling, not a change to `graphql()`. Changing `graphql()` itself would alter two live-passing read paths with no failing assertion driving it, which phase 2 and phase 3 both declined to do.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (add `graphqlOrThrow` next to `graphql` at 1569-1600; migrate `setDraft` at 1609-1633)
- Test: `packages/glance/tests/gh-graphql-throw.test.ts` (create)

**Interfaces:**
- Consumes: `graphqlErrorMessages(err)` (`GitHubProvider.ts:2217`), `ghError(op, err, style)` and `RequestError` from `./githubClient.ts` and `@octokit/request-error`, `GraphqlResponseError` from `@octokit/graphql` (all already imported).
- Produces: `private async graphqlOrThrow<T>(op: string, query: string, variables: Record<string, unknown>): Promise<T>`. Resolves to non-null `T` or throws. Tasks 4, 5, and 6 call it.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/gh-graphql-throw.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * MAT-133: every way a GraphQL call can fail must reach the caller.
 *
 * `graphql()` swallows all of these into a warn and a null, which is fine for
 * reads that report "unknown". `graphqlOrThrow()` is what mutations use, and a
 * mutation that returns null is indistinguishable from one that did nothing.
 * These tests drive it through `setDraft`, the one existing caller, because
 * `graphqlOrThrow` is private.
 *
 * No network: `octokit.graphql` is replaced outright.
 */
import { describe, expect, test } from 'bun:test';
import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

/** A provider whose GraphQL transport does whatever `impl` does. */
function providerWithGraphql(impl: () => Promise<unknown>): GitHubProvider {
  const provider = new GitHubProvider('https://github.com', 'tok');
  (provider as any).octokit = { graphql: impl };
  return provider;
}

/** The `GraphqlResponseError` shape `@octokit/graphql` throws. */
function graphqlResponseError(
  errors: Array<{ message: string }>,
  data: unknown = null
): GraphqlResponseError<unknown> {
  return new GraphqlResponseError(
    { method: 'POST', url: 'https://api.github.com/graphql' } as never,
    {} as never,
    { data, errors } as never
  );
}

/** `setDraft` is reached through `updatePullRequest`'s `draft` toggle. */
function setDraft(provider: GitHubProvider): Promise<unknown> {
  return (provider as any).setDraft('PR_node_id', true);
}

describe('graphqlOrThrow: failure categories reach the caller', () => {
  test('GraphQL errors surface their messages', async () => {
    const provider = providerWithGraphql(async () => {
      throw graphqlResponseError([{ message: 'Resource not accessible' }]);
    });

    await expect(setDraft(provider)).rejects.toThrow(/Resource not accessible/);
  });

  test('an HTTP failure surfaces its status', async () => {
    const provider = providerWithGraphql(async () => {
      throw new RequestError('Bad credentials', 401, {
        request: { method: 'POST', url: 'https://api.github.com/graphql', headers: {} },
        response: { status: 401, url: '', headers: {}, data: {} }
      });
    });

    await expect(setDraft(provider)).rejects.toThrow(/401/);
  });

  test('a transport throw is not swallowed', async () => {
    const provider = providerWithGraphql(async () => {
      throw new Error('socket hang up');
    });

    await expect(setDraft(provider)).rejects.toThrow(/socket hang up/);
  });

  test('a null payload throws rather than resolving', async () => {
    const provider = providerWithGraphql(async () => null);

    await expect(setDraft(provider)).rejects.toThrow(/no data/);
  });

  test('an empty `errors` array is success, matching graphql()', async () => {
    // `@octokit/graphql` throws whenever the response body has an `errors`
    // key at all, and `[]` is truthy. The pre-Octokit code tested
    // `payload.errors?.length`, so an empty array read as success. Both
    // helpers have to keep reading it that way.
    const provider = providerWithGraphql(async () => {
      throw graphqlResponseError([], {
        convertPullRequestToDraft: { pullRequest: { isDraft: true } }
      });
    });

    await expect(setDraft(provider)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gh-graphql-throw.test.ts`
Expected: the first four tests FAIL. `setDraft` currently goes through `graphql()`, which swallows every one of those into `null`, so it throws its own generic "could not set draft=true" message rather than the specific one asserted. The last test may already pass.

- [ ] **Step 3: Add `graphqlOrThrow` beside `graphql`**

Insert immediately after `graphql()` ends at `GitHubProvider.ts:1600`:

```ts
  /**
   * Issue a GraphQL (v4) request that must succeed. The mutation counterpart
   * to `graphql()`.
   *
   * MAT-133. `graphql()` reports every failure as `null` so read callers can
   * say "unknown" instead of substituting a value. A mutation has no such
   * answer available: a `null` from `enablePullRequestAutoMerge` is
   * indistinguishable from "auto-merge is off", which is the MAT-15 bug class
   * where a silent no-op meant a draft MR was never actually published.
   *
   * `graphql()` is deliberately left alone rather than harmonized with this.
   * Two live-passing read paths depend on its swallow and no failing
   * assertion drives changing them.
   */
  private async graphqlOrThrow<T>(
    op: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    let data: T | null | undefined;
    try {
      data = await this.octokit.graphql<T>(query, variables);
    } catch (err) {
      const messages = graphqlErrorMessages(err);
      if (messages) {
        throw new Error(`${op} failed: GitHub GraphQL returned ${messages.join('; ')}`);
      }
      if (err instanceof GraphqlResponseError) {
        // Empty `errors` array. `@octokit/graphql` throws on the key's mere
        // presence and `[]` is truthy, but an empty array carries no error.
        // `graphql()` reads that as success by falling through to the
        // response's data, and so does this.
        data = err.data as T | undefined;
      } else if (err instanceof RequestError && err.response) {
        throw ghError(op, err, 'statusText');
      } else {
        throw err;
      }
    }
    if (data == null) {
      throw new Error(`${op} failed: GitHub GraphQL returned no data`);
    }
    return data;
  }
```

- [ ] **Step 4: Migrate `setDraft` onto it**

At `GitHubProvider.ts:1624-1632`, replace:

```ts
    const data = await this.graphql<
      Record<string, { pullRequest?: { isDraft: boolean } } | undefined>
    >(mutation, { id: pullRequestId });

    if (data?.[field]?.pullRequest?.isDraft !== draft) {
```

with:

```ts
    const data = await this.graphqlOrThrow<
      Record<string, { pullRequest?: { isDraft: boolean } } | undefined>
    >('updatePullRequest', mutation, { id: pullRequestId });

    // Kept after the throwing call: `graphqlOrThrow` proves the request
    // succeeded and returned data, not that GitHub landed the flag we asked
    // for. Reporting success on a draft flag that never took is the bug this
    // check exists for.
    if (data[field]?.pullRequest?.isDraft !== draft) {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/gh-graphql-throw.test.ts tests/draft.test.ts`
Expected: PASS. `draft.test.ts` covers the existing `setDraft` behavior and must not regress. If it fails on a changed error message, read it: the generic "could not set draft" message still fires for a mismatched result, only for a failed request has it changed.

- [ ] **Step 6: Run the whole suite and type-check**

Run: `cd packages/glance && bun test && bun run check-types`
Expected: all pass, clean.

- [ ] **Step 7: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-graphql-throw.test.ts
git commit -m "feat: add a throwing GraphQL path for mutations (MAT-133)"
```

---

### Task 3: MAT-27 read side, real resolved state on GitHub discussions

`fetchMRDiscussions` returns every review thread with `resolved: null` and a comment claiming GitHub has no native resolved state. GitHub has had resolvable review threads for years, and `fetchUnresolvedThreadCounts` in the same file already reads `reviewThreads { isResolved }` to populate `unresolvedThreadCount`. The same query, on the same PR, from the same file, already answers the question `fetchMRDiscussions` says is unanswerable.

This task adds the read side only. The mutations are Task 4.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (add the response type near `GHReviewThreadsResponse` at 152-160; add `THREAD_MAX_PAGES` near 208; add `fetchReviewThreadIndex`; rewrite `fetchMRDiscussions` 676-710; change `toNote` at 2121-2143)
- Test: `packages/glance/tests/gh-discussions.test.ts` (create)

**Interfaces:**
- Consumes: `graphqlOrThrow(op, query, variables)` from Task 2. `splitOwnerRepo(repoPath)` (`GitHubProvider.ts:1997`). `THREAD_PAGE_SIZE = 100` (`:208`).
- Produces:
  - `interface GHReviewThread { nodeId: string; isResolved: boolean; isResolvable: boolean; rootCommentId: number }`
  - `private async fetchReviewThreadIndex(op: string, owner: string, repo: string, prNumber: number): Promise<Map<number, GHReviewThread>>` -- keyed by root comment `databaseId`. Throws on any failure. Task 4 calls it.
  - `toNote(c: GHComment, resolved?: boolean | null): Note` -- the second parameter is new and defaults to `null`.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/gh-discussions.test.ts`:

```ts
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

/**
 * A provider wired to fixed review comments, issue comments, and threads.
 * `fetchMRDiscussions` looks the repo up through `api()`, paginates both
 * comment endpoints, and reads threads through `octokit.graphql`.
 */
function providerWith(opts: {
  reviewComments: unknown[];
  issueComments?: unknown[];
  threads?: unknown[] | 'fail';
}): { provider: GitHubProvider; graphqlCalls: Array<Record<string, unknown>> } {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const graphqlCalls: Array<Record<string, unknown>> = [];

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

  return { provider, graphqlCalls };
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gh-discussions.test.ts`
Expected: FAIL. Every `resolved` assertion gets `null`, and the `isResolvable: false` case gets `true`.

- [ ] **Step 3: Add the response type and the page bound**

Insert after `GHReviewThreadsResponse` ends at `GitHubProvider.ts:160`:

```ts
/** One review thread, joined to REST review comments by its root comment. */
interface GHReviewThread {
  nodeId: string;
  isResolved: boolean;
  isResolvable: boolean;
  rootCommentId: number;
}

/** `repository.pullRequest.reviewThreads` projection, one PR at a time. */
interface GHPullRequestThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          isResolvable: boolean;
          comments?: { nodes: Array<{ databaseId: number | null }> };
        } | null>;
      };
    } | null;
  } | null;
}
```

Insert after `THREAD_PAGE_SIZE` at `:208`:

```ts
/**
 * Thread pages to walk for one PR before giving up. At THREAD_PAGE_SIZE per
 * page this is 1000 threads, far past any real review. The bound exists so a
 * pathological PR cannot spin this loop, not because 1000 is a meaningful
 * limit.
 */
const THREAD_MAX_PAGES = 10;
```

- [ ] **Step 4: Add `fetchReviewThreadIndex`**

Insert immediately after `fetchUnresolvedThreadCounts` ends at `GitHubProvider.ts:1689`:

```ts
  /**
   * Review threads for one PR, keyed by the databaseId of the comment that
   * roots each thread.
   *
   * That key is what makes the join work. REST review comments carry no
   * thread id, so `fetchMRDiscussions` groups them by `in_reply_to_id ?? id`
   * and the resulting root is the same comment GraphQL reports as the
   * thread's first. Fetching `comments(first: 1)` is therefore enough to
   * match a whole thread.
   *
   * Distinct from `fetchUnresolvedThreadCounts`, which batches many PRs and
   * only needs a count. This one needs per-thread identity, so it is per-PR
   * and paginates rather than reporting unknown on truncation.
   *
   * Throws on any failure. Read callers that can degrade wrap the call;
   * mutation callers must not.
   */
  private async fetchReviewThreadIndex(
    op: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Map<number, GHReviewThread>> {
    const query = `
      query GlancePullRequestThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: ${THREAD_PAGE_SIZE}, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                isResolvable
                comments(first: 1) { nodes { databaseId } }
              }
            }
          }
        }
      }
    `;

    const index = new Map<number, GHReviewThread>();
    let cursor: string | null = null;

    for (let page = 0; page < THREAD_MAX_PAGES; page++) {
      const data = await this.graphqlOrThrow<GHPullRequestThreadsResponse>(op, query, {
        owner,
        repo,
        number: prNumber,
        cursor
      });

      const threads = data.repository?.pullRequest?.reviewThreads;
      if (!threads) {
        throw new Error(
          `${op} failed: GitHub reported no pull request ${owner}/${repo}!${prNumber}`
        );
      }

      for (const node of threads.nodes) {
        const rootCommentId = node?.comments?.nodes[0]?.databaseId;
        // A thread whose first comment carries no databaseId cannot be joined
        // to anything REST returned, so indexing it would be indexing nothing.
        if (!node || rootCommentId == null) continue;
        index.set(rootCommentId, {
          nodeId: node.id,
          isResolved: node.isResolved,
          isResolvable: node.isResolvable,
          rootCommentId
        });
      }

      if (!threads.pageInfo?.hasNextPage) break;
      cursor = threads.pageInfo.endCursor;
    }

    return index;
  }
```

- [ ] **Step 5: Rewrite the discussion assembly**

Replace `GitHubProvider.ts:676-710` (from `// Group review comments into threads...` through `return { mrIid, repositoryId, discussions };`) with:

```ts
    // Resolution state lives only in GraphQL. A failure here degrades the
    // answer to the pre-MAT-27 "unknown" rather than failing the call: the
    // notes themselves came from REST and were returned long before resolved
    // state was available.
    let threads: Map<number, GHReviewThread> = new Map();
    try {
      threads = await this.fetchReviewThreadIndex(
        'fetchMRDiscussions',
        owner,
        repoName,
        mrIid
      );
    } catch (err) {
      this.log.warn('fetchMRDiscussions: could not read review thread state', {
        message: err instanceof Error ? err.message : String(err),
        projectPath: `${owner}/${repoName}`,
        mrIid
      });
    }

    const discussions: Discussion[] = [];

    // PR-level comments have no thread and no resolved state on GitHub, so
    // null is the correct answer here rather than a gap.
    for (const c of issueComments) {
      discussions.push({
        id: `gh-issue-comment-${c.id}`,
        resolvable: null,
        resolved: null,
        notes: [toNote(c)]
      });
    }

    // Group review comments into threads by their reply root. GitHub does not
    // return a thread id on REST review comments, so the root comment stands
    // in for one: every reply carries `in_reply_to_id` pointing at it, and
    // GraphQL reports that same comment as the thread's first comment, which
    // is what lets `fetchReviewThreadIndex` join the two.
    const threadMap = new Map<number, GHComment[]>();
    for (const c of reviewComments) {
      const rootId = c.in_reply_to_id ?? c.id;
      const thread = threadMap.get(rootId) ?? [];
      thread.push(c);
      threadMap.set(rootId, thread);
    }

    for (const [rootId, comments] of threadMap) {
      comments.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      // No match means the GraphQL read failed or the thread arrived after
      // it. `resolvable: true` with `resolved: null` is exactly what this
      // method reported before MAT-27, so an unmatched thread degrades to the
      // old answer instead of to a wrong one.
      const thread = threads.get(rootId);
      discussions.push({
        id: `gh-review-thread-${rootId}`,
        resolvable: thread ? thread.isResolvable : true,
        resolved: thread ? thread.isResolved : null,
        notes: comments.map(c => toNote(c, thread ? thread.isResolved : null))
      });
    }

    return { mrIid, repositoryId, discussions };
```

- [ ] **Step 6: Let `toNote` carry the thread's state**

At `GitHubProvider.ts:2121`, change the signature and the `resolved` field:

```ts
function toNote(c: GHComment, resolved: boolean | null = null): Note {
```

and replace `resolved: null,` in the returned object with:

```ts
    // Resolution is a property of the thread, not of an individual comment,
    // so it is passed in. GitLab reports the same value on every note of a
    // resolved discussion and this matches that.
    resolved: c.path ? resolved : null,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/gh-discussions.test.ts`
Expected: PASS, all eight.

- [ ] **Step 8: Run the whole suite and type-check**

Run: `cd packages/glance && bun test && bun run check-types`
Expected: all pass, clean. `gh-review-threads.test.ts` covers `fetchUnresolvedThreadCounts`, which this task does not touch; if it fails, the new GraphQL stub has been wired into the wrong method.

- [ ] **Step 9: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-discussions.test.ts
git commit -m "feat: report real resolved state on GitHub review threads (MAT-27)"
```

---

### Task 4: MAT-27 mutations, resolve and unresolve review threads

`resolveDiscussion` and `unresolveDiscussion` throw. The GraphQL mutations they name in their TODOs are real and now reachable. Discussion ids stay `gh-review-thread-<rootCommentId>` by decision, so the mutations resolve that id to a thread node id through Task 3's index.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (replace the stubs at 1295-1321; flip `canResolveDiscussions` at 444)
- Modify: `packages/glance/tests/live/expectations.ts:76-85`
- Modify: `packages/glance/tests/smoke.test.ts:173-176`
- Modify: `packages/glance/tests/integration.live.ts:283-286`
- Test: `packages/glance/tests/gh-discussions.test.ts` (extend)

**Interfaces:**
- Consumes: `fetchReviewThreadIndex(op, owner, repo, prNumber)` and `graphqlOrThrow(op, query, variables)`.
- Produces: `resolveDiscussion(projectPath, mrIid, discussionId)` and `unresolveDiscussion(projectPath, mrIid, discussionId)` resolving on success, throwing otherwise. `capabilities.canResolveDiscussions === true`.

- [ ] **Step 1: Write the failing test**

Append to `packages/glance/tests/gh-discussions.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gh-discussions.test.ts`
Expected: FAIL. The methods throw "not supported by the GitHub REST API" and the flag is `false`.

- [ ] **Step 3: Replace both stubs**

Replace `GitHubProvider.ts:1295-1321` with:

```ts
  async resolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void> {
    await this.setThreadResolved('resolveDiscussion', projectPath, mrIid, discussionId, true);
  }

  async unresolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void> {
    await this.setThreadResolved('unresolveDiscussion', projectPath, mrIid, discussionId, false);
  }

  /**
   * Move one review thread between resolved and unresolved.
   *
   * `discussionId` is the `gh-review-thread-<rootCommentId>` form
   * `fetchMRDiscussions` emits, not a GraphQL node id. Keeping it that way is
   * deliberate: the id is a value consumers may have persisted, and changing
   * what it means would be a breaking change on a package with unbumped
   * consumer-visible changes already shipped. The cost is this lookup.
   */
  private async setThreadResolved(
    op: string,
    projectPath: string,
    mrIid: number,
    discussionId: string,
    resolved: boolean
  ): Promise<void> {
    const rootCommentId = parseReviewThreadDiscussionId(discussionId);
    if (rootCommentId == null) {
      throw new Error(
        `${op} failed: "${discussionId}" is not a resolvable review thread. ` +
          'Only ids of the form gh-review-thread-<id> can be resolved; ' +
          'GitHub pull request level comments have no thread.'
      );
    }

    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const threads = await this.fetchReviewThreadIndex(op, owner, repo, mrIid);
    const thread = threads.get(rootCommentId);
    if (!thread) {
      throw new Error(
        `${op} failed: no review thread rooted at comment ${rootCommentId} on ${projectPath}!${mrIid}`
      );
    }

    const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
    const mutation = `
      mutation GlanceSetThreadResolved($threadId: ID!) {
        ${field}(input: { threadId: $threadId }) {
          thread { id isResolved }
        }
      }
    `;

    const data = await this.graphqlOrThrow<
      Record<string, { thread?: { id: string; isResolved: boolean } } | undefined>
    >(op, mutation, { threadId: thread.nodeId });

    // GitHub accepting the mutation is not the same as GitHub applying it.
    // Reporting success on a thread that never changed is the MAT-15 shape.
    const isResolved = data[field]?.thread?.isResolved;
    if (isResolved !== resolved) {
      throw new Error(
        `${op} failed: thread ${thread.nodeId} did not become ${resolved ? 'resolved' : 'unresolved'} ` +
          `(GitHub reported isResolved=${String(isResolved)})`
      );
    }
  }
```

- [ ] **Step 4: Add the id parser**

Insert next to `toNote` in the module-level helpers, after `toNoteAuthor` ends at `GitHubProvider.ts:2152`:

```ts
/**
 * The root comment id inside a `gh-review-thread-<id>` discussion id, or null
 * for any other shape.
 *
 * Null for `gh-issue-comment-<id>` is the useful case: those are PR-level
 * comments with no thread behind them, and the caller turns the null into an
 * explanation rather than sending a comment id to a mutation that wants a
 * thread.
 */
function parseReviewThreadDiscussionId(discussionId: string): number | null {
  const match = /^gh-review-thread-(\d+)$/.exec(discussionId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}
```

- [ ] **Step 5: Flip the capability flag**

At `GitHubProvider.ts:444`, change `canResolveDiscussions: false,` to `canResolveDiscussions: true,`.

- [ ] **Step 6: Update the expectations table**

In `packages/glance/tests/live/expectations.ts`, replace the two entries at lines 76-85 with:

```ts
  resolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  unresolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
```

- [ ] **Step 7: Update the two capability assertion lists**

In `packages/glance/tests/smoke.test.ts:173-176`, change the assertion to expect `true`:

```ts
assert(
  gh.capabilities.canResolveDiscussions === true,
  'GitHub: canResolveDiscussions'
);
```

In `packages/glance/tests/integration.live.ts:283-286`, make the same change:

```ts
assert(
  github.capabilities.canResolveDiscussions === true,
  'canResolveDiscussions'
);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd packages/glance && bun test`
Expected: all pass. `live-expectations.test.ts` asserts the two tables share a key set and that notes exist wherever support is not plainly `supported`; both entries are now plainly supported, so no note is needed.

- [ ] **Step 9: Type-check and commit**

Run: `cd packages/glance && bun run check-types`

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-discussions.test.ts packages/glance/tests/live/expectations.ts packages/glance/tests/smoke.test.ts packages/glance/tests/integration.live.ts
git commit -m "feat: implement resolveDiscussion and unresolveDiscussion on GitHub (MAT-27)"
```

---

### Task 5: MAT-134, canUnapprove via review dismissal

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (replace the stub at 1244-1257; add `DISMISSAL_MESSAGE`; flip `canUnapprove` at 441)
- Modify: `packages/glance/tests/live/expectations.ts:56-60`
- Modify: `packages/glance/tests/smoke.test.ts:170`
- Modify: `packages/glance/tests/integration.live.ts:280`
- Test: `packages/glance/tests/gh-unapprove.test.ts` (create)

**Interfaces:**
- Consumes: `validateToken()` (`:452`), `splitOwnerRepo` (`:1997`), `ghError` and `RequestError`, the `GHReview` interface (`:129`).
- Produces: `unapprovePullRequest(projectPath, mrIid)` resolving on success, throwing otherwise. `capabilities.canUnapprove === true`.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/gh-unapprove.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * MAT-134: unapprove on GitHub is a review dismissal.
 *
 * The subtlety is which review to dismiss. GitHub keeps every review ever
 * submitted, and only the newest per user counts toward `approved` (see
 * `toPullRequest`). Dismissing the first APPROVED one found would revive an
 * approval the user already replaced.
 *
 * The transport is stubbed; nothing here touches a network.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const ADA = { id: 7, login: 'ada', name: 'Ada', avatar_url: 'https://x/a.png' };
const BOB = { id: 8, login: 'bob', name: 'Bob', avatar_url: 'https://x/b.png' };

function review(id: number, user: typeof ADA, state: string, submitted_at: string) {
  return { id, user, state, submitted_at };
}

/** A provider whose token belongs to `ada`, wired to a fixed review list. */
function providerWith(reviews: unknown[], onDismiss?: () => never) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const dismissals: Array<Record<string, unknown>> = [];
  (provider as any).octokit = {
    request: async (route: string, params?: Record<string, unknown>) => {
      if (route.startsWith('GET /user')) {
        return { status: 200, headers: {}, data: ADA };
      }
      if (route.includes('/dismissals')) {
        if (onDismiss) onDismiss();
        dismissals.push(params ?? {});
        return { status: 200, headers: {}, data: {} };
      }
      throw new Error(`unexpected route ${route}`);
    },
    paginate: async () => reviews
  };
  return { provider, dismissals };
}

describe('unapprovePullRequest', () => {
  test('the capability flag is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canUnapprove).toBe(true);
  });

  test('dismisses the token user\'s own approval', async () => {
    const { provider, dismissals } = providerWith([
      review(1, BOB, 'APPROVED', '2026-08-01T00:00:00Z'),
      review(2, ADA, 'APPROVED', '2026-08-02T00:00:00Z')
    ]);

    await provider.unapprovePullRequest('acme/repo', 5);

    expect(dismissals.length).toBe(1);
    expect(dismissals[0]?.review_id).toBe(2);
    expect(dismissals[0]?.event).toBe('DISMISS');
    expect(typeof dismissals[0]?.message).toBe('string');
  });

  test('dismisses the newest review, not the first approval found', async () => {
    // Ada approved, then requested changes. Her approval no longer counts, so
    // dismissing it would resurrect nothing and hide the real state.
    const { provider } = providerWith([
      review(1, ADA, 'APPROVED', '2026-08-01T00:00:00Z'),
      review(2, ADA, 'CHANGES_REQUESTED', '2026-08-02T00:00:00Z')
    ]);

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /no current approval/i
    );
  });

  test('ordering comes from submitted_at, not list order', async () => {
    const { provider, dismissals } = providerWith([
      review(2, ADA, 'APPROVED', '2026-08-03T00:00:00Z'),
      review(1, ADA, 'COMMENTED', '2026-08-01T00:00:00Z')
    ]);

    await provider.unapprovePullRequest('acme/repo', 5);

    expect(dismissals[0]?.review_id).toBe(2);
  });

  test('another user\'s approval is never dismissed', async () => {
    const { provider, dismissals } = providerWith([
      review(1, BOB, 'APPROVED', '2026-08-01T00:00:00Z')
    ]);

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /no current approval/i
    );
    expect(dismissals.length).toBe(0);
  });

  test('no reviews at all throws rather than resolving', async () => {
    // Resolving here would be the silent no-op shape: the caller believes an
    // approval was revoked when none existed.
    const { provider } = providerWith([]);

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /no current approval/i
    );
  });

  test('an HTTP failure on the dismissal surfaces its status', async () => {
    const { provider } = providerWith(
      [review(1, ADA, 'APPROVED', '2026-08-01T00:00:00Z')],
      () => {
        throw new RequestError('Forbidden', 403, {
          request: { method: 'PUT', url: 'https://api.github.com/x', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} }
        });
      }
    );

    await expect(provider.unapprovePullRequest('acme/repo', 5)).rejects.toThrow(
      /unapprovePullRequest failed: 403/
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gh-unapprove.test.ts`
Expected: FAIL. The method throws "not supported by GitHub" and the flag is `false`.

- [ ] **Step 3: Add the dismissal message constant**

Insert after `THREAD_MAX_PAGES` in the constants block:

```ts
/**
 * GitHub requires a reason on every review dismissal and posts it to the pull
 * request timeline. GitLab's unapprove takes no message, so
 * `unapprovePullRequest` has none to pass along and sends this instead of
 * inventing a reason that would read as if a person wrote it.
 */
const DISMISSAL_MESSAGE = 'Approval withdrawn via the Glance SDK.';
```

- [ ] **Step 4: Replace the stub**

Replace `GitHubProvider.ts:1244-1257` with:

```ts
  /**
   * Withdraw the token user's approval by dismissing their review.
   *
   * Not identical to GitLab's unapprove, and the difference is caller-visible:
   * GitLab removes the approval record, GitHub leaves a `DISMISSED` review in
   * the list. `toPullRequest` keeps only the newest review per user, so the
   * approval does drop out of `approved` and `approvedBy` either way.
   *
   * Throws when there is nothing to dismiss. Resolving would be the silent
   * no-op shape: the caller would believe an approval was revoked when none
   * existed. GitLab's own unapprove answers a non-approved MR with a 404,
   * which its SDK also turns into a throw.
   */
  async unapprovePullRequest(
    projectPath: string,
    mrIid: number
  ): Promise<void> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const me = (await this.validateToken()).username;

    let reviews: GHReview[];
    try {
      reviews = await this.octokit.paginate<GHReview>(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        { owner, repo, pull_number: mrIid, per_page: 100 }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('unapprovePullRequest', err, 'statusText');
      }
      throw err;
    }

    // Newest review per user is the only one that counts toward `approved`,
    // so it is the only one worth dismissing. Sorting rather than trusting
    // list order for the same reason `toPullRequest` does.
    const mine = reviews
      .filter(r => r.user?.login === me)
      .sort(
        (a, b) =>
          new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
      );
    const latest = mine[mine.length - 1];

    if (!latest || latest.state !== 'APPROVED') {
      throw new Error(
        `unapprovePullRequest failed: ${me} has no current approval on ${projectPath}!${mrIid} to dismiss`
      );
    }

    try {
      await this.octokit.request(
        'PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals',
        {
          owner,
          repo,
          pull_number: mrIid,
          review_id: latest.id,
          message: DISMISSAL_MESSAGE,
          event: 'DISMISS'
        }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('unapprovePullRequest', err, 'statusText');
      }
      throw err;
    }
  }
```

- [ ] **Step 5: Flip the capability flag**

At `GitHubProvider.ts:441`, change `canUnapprove: false,` to `canUnapprove: true,`.

- [ ] **Step 6: Update the expectations table**

Replace the `unapprovePullRequest` entry at `expectations.ts:56-60` with:

```ts
  unapprovePullRequest: {
    support: 'approximate',
    capability: 'canUnapprove',
    note: 'Implemented as a review dismissal, which leaves a DISMISSED review in the list rather than removing the approval record as GitLab does. The harness cannot reach the success path with one GitHub identity: dismissal needs an approval, and GitHub rejects self-approval with 422. `fixture.approver` is hardcoded null for GitHub in fixture.ts, so wiring a second identity is a credentials change rather than a harness change.'
  },
```

- [ ] **Step 7: Update the two capability assertion lists**

`packages/glance/tests/smoke.test.ts:170`:

```ts
assert(gh.capabilities.canUnapprove === true, 'GitHub: canUnapprove');
```

`packages/glance/tests/integration.live.ts:280`:

```ts
assert(github.capabilities.canUnapprove === true, 'canUnapprove');
```

- [ ] **Step 8: Run the tests and type-check**

Run: `cd packages/glance && bun test && bun run check-types`
Expected: all pass, clean.

- [ ] **Step 9: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-unapprove.test.ts packages/glance/tests/live/expectations.ts packages/glance/tests/smoke.test.ts packages/glance/tests/integration.live.ts
git commit -m "feat: implement unapprovePullRequest via review dismissal on GitHub (MAT-134)"
```

---

### Task 6: MAT-134, canAutoMerge via GraphQL

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (replace the stubs at 1272-1291; add `pullRequestNodeId`; flip `canAutoMerge` at 443)
- Modify: `packages/glance/tests/live/expectations.ts:66-75`
- Modify: `packages/glance/tests/smoke.test.ts:172`
- Modify: `packages/glance/tests/integration.live.ts:282`
- Test: `packages/glance/tests/gh-automerge.test.ts` (create)

**Interfaces:**
- Consumes: `graphqlOrThrow(op, query, variables)`, `splitOwnerRepo`, `ghError`, `RequestError`, `GHPullRequest.node_id` (`:86`).
- Produces: `private async pullRequestNodeId(op: string, projectPath: string, mrIid: number): Promise<string>`. `setAutoMerge(projectPath, mrIid)` and `cancelAutoMerge(projectPath, mrIid)`. `capabilities.canAutoMerge === true`.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/gh-automerge.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * MAT-134: auto-merge on GitHub is a pair of GraphQL mutations.
 *
 * The load-bearing assertions here are the end-state checks. Both mutations
 * can be accepted by GitHub and change nothing, and a resolved promise would
 * then read as "auto-merge is on" when it is off. That is the MAT-15 shape
 * and the reason `graphqlOrThrow` exists.
 *
 * The transport is stubbed; nothing here touches a network.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

/**
 * A provider whose PR lookup returns a fixed node id and whose GraphQL
 * transport answers mutations with `payload`.
 */
function providerWith(payload: unknown) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const mutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
  (provider as any).octokit = {
    request: async () => ({
      status: 200,
      headers: {},
      data: { number: 5, node_id: 'PR_kwABC' }
    }),
    graphql: async (query: string, variables: Record<string, unknown>) => {
      mutations.push({ query, variables });
      return payload;
    }
  };
  return { provider, mutations };
}

describe('setAutoMerge', () => {
  test('the capability flag is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canAutoMerge).toBe(true);
  });

  test('enables auto-merge against the PR node id', async () => {
    const { provider, mutations } = providerWith({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
      }
    });

    await provider.setAutoMerge('acme/repo', 5);

    expect(mutations.length).toBe(1);
    expect(mutations[0]?.query).toContain('enablePullRequestAutoMerge');
    expect(mutations[0]?.variables.id).toBe('PR_kwABC');
  });

  test('an accepted mutation that enabled nothing throws', async () => {
    const { provider } = providerWith({
      enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } }
    });

    await expect(provider.setAutoMerge('acme/repo', 5)).rejects.toThrow(/reported no auto-merge/i);
  });
});

describe('cancelAutoMerge', () => {
  test('disables auto-merge against the PR node id', async () => {
    const { provider, mutations } = providerWith({
      disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } }
    });

    await provider.cancelAutoMerge('acme/repo', 5);

    expect(mutations[0]?.query).toContain('disablePullRequestAutoMerge');
    expect(mutations[0]?.variables.id).toBe('PR_kwABC');
  });

  test('an accepted mutation that left auto-merge on throws', async () => {
    const { provider } = providerWith({
      disablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
      }
    });

    await expect(provider.cancelAutoMerge('acme/repo', 5)).rejects.toThrow(
      /still reports auto-merge/i
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gh-automerge.test.ts`
Expected: FAIL. Both methods throw "not supported by the GitHub REST API" and the flag is `false`.

- [ ] **Step 3: Add the node id lookup**

Insert immediately before `setAutoMerge` at `GitHubProvider.ts:1272`:

```ts
  /**
   * The GraphQL node id for a pull request the caller named by number.
   *
   * Both auto-merge mutations address a PR by node id and `GitProvider` only
   * hands this provider `projectPath` and `mrIid`, so every call pays one
   * REST read for the translation.
   */
  private async pullRequestNodeId(
    op: string,
    projectPath: string,
    mrIid: number
  ): Promise<string> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    let pr: GHPullRequest;
    try {
      const res = await this.octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { owner, repo, pull_number: mrIid }
      );
      pr = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError(op, err, 'statusText');
      }
      throw err;
    }
    if (!pr.node_id) {
      throw new Error(`${op} failed: ${projectPath}!${mrIid} carries no GraphQL node id`);
    }
    return pr.node_id;
  }
```

- [ ] **Step 4: Replace both stubs**

Replace `GitHubProvider.ts:1272-1291` (the two stub bodies, now following the helper you just inserted) with:

```ts
  /**
   * Merge this pull request once its required checks pass.
   *
   * REST has no auto-merge endpoint, so this is GraphQL only. Two repository
   * preconditions are GitHub's, not this SDK's: `allow_auto_merge` must be on,
   * and GitHub rejects the mutation on a pull request that is already
   * mergeable, since there would be nothing to wait for.
   */
  async setAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    const nodeId = await this.pullRequestNodeId('setAutoMerge', projectPath, mrIid);
    const mutation = `
      mutation GlanceEnableAutoMerge($id: ID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $id }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      enablePullRequestAutoMerge?: {
        pullRequest?: { autoMergeRequest?: { enabledAt?: string | null } | null } | null;
      };
    }>('setAutoMerge', mutation, { id: nodeId });

    // Reading the end state back, not just the absence of an error: an
    // accepted mutation that enabled nothing is indistinguishable from a
    // successful one at the call site otherwise.
    if (!data.enablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt) {
      throw new Error(
        `setAutoMerge failed: GitHub accepted the mutation but reported no auto-merge on ${projectPath}!${mrIid}`
      );
    }
  }

  async cancelAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    const nodeId = await this.pullRequestNodeId('cancelAutoMerge', projectPath, mrIid);
    const mutation = `
      mutation GlanceDisableAutoMerge($id: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      disablePullRequestAutoMerge?: {
        pullRequest?: { autoMergeRequest?: { enabledAt?: string | null } | null } | null;
      };
    }>('cancelAutoMerge', mutation, { id: nodeId });

    if (data.disablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt) {
      throw new Error(
        `cancelAutoMerge failed: GitHub accepted the mutation but still reports auto-merge on ${projectPath}!${mrIid}`
      );
    }
  }
```

- [ ] **Step 5: Flip the capability flag**

At `GitHubProvider.ts:443`, change `canAutoMerge: false,` to `canAutoMerge: true,`.

- [ ] **Step 6: Update the expectations table**

Replace the two entries at `expectations.ts:66-75` with:

```ts
  setAutoMerge: {
    support: 'supported',
    capability: 'canAutoMerge'
  },
  cancelAutoMerge: {
    support: 'supported',
    capability: 'canAutoMerge'
  },
```

- [ ] **Step 7: Update the two capability assertion lists**

`packages/glance/tests/smoke.test.ts:172`:

```ts
assert(gh.capabilities.canAutoMerge === true, 'GitHub: canAutoMerge');
```

`packages/glance/tests/integration.live.ts:282`:

```ts
assert(github.capabilities.canAutoMerge === true, 'canAutoMerge');
```

- [ ] **Step 8: Run the tests and type-check**

Run: `cd packages/glance && bun test && bun run check-types`
Expected: all pass, clean.

- [ ] **Step 9: Check the Node build**

The package ships a Node build and the Bun suite cannot see Node-only failures. Phase 3 shipped a 204-handling bug that was invisible to `bun test` for exactly this reason.

Run:

```bash
cd packages/glance && bun run build && node -e "
const { GitHubProvider } = require('./dist/index.js');
const p = new GitHubProvider('https://github.com', 'tok');
console.log(JSON.stringify(p.capabilities));
"
```

Expected: prints capabilities with `canUnapprove`, `canAutoMerge`, and `canResolveDiscussions` all `true`. If `dist/index.js` is ESM-only, use `node --input-type=module -e "import(...)"` instead.

- [ ] **Step 10: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-automerge.test.ts packages/glance/tests/live/expectations.ts packages/glance/tests/smoke.test.ts packages/glance/tests/integration.live.ts
git commit -m "feat: implement setAutoMerge and cancelAutoMerge on GitHub (MAT-134)"
```

---

### Task 7: Move the four methods onto supported-path harness checks

`runUnsupportedConformance` probes each of these by calling it and asserting it throws. With the flags flipped, `expectationFor` no longer returns `unsupported` for four of the six probes, so they take the `report.skip` branch and nothing measures them. Skipping is the honest interim state, but a flipped flag with no assertion behind it is exactly the class of claim phases 1 through 3 refused to make.

The discussion checks below are gated on the expectation table rather than on `fixture.name`, so they run against GitLab too. That closes the gap MAT-145 called the one that matters most: GitLab's own `resolveDiscussion` and `unresolveDiscussion` are declared supported and have never been verified live, which means MAT-27's GitHub work has been written to match behavior nobody has measured. Do not branch these on `fixture.name === 'github'`.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts` (the probe list at 306-336; add supported-path checks)

**Interfaces:**
- Consumes: `check(report, fixture, method, label, fn)` (`conformance.ts:24`), the `Inconclusive` skip sentinel (`:22`), `pollUntil` (`./poll.ts`), `expectationFor` (`./expectations.ts`), `scopedRepoId(fixture)` (used at `:581`), `ProviderFixture` (`./fixture.ts`).
- Produces: new conformance checks under the method names `resolveDiscussion`, `unresolveDiscussion`, `setAutoMerge`, `cancelAutoMerge`, `unapprovePullRequest`.

- [ ] **Step 1: Read the write-cycle helper this hangs off**

Run: `sed -n '520,660p' packages/glance/tests/live/conformance.ts`

The approval checks already create a PR, run assertions, and delete the branch in a `finally`. New checks that need a live PR belong in the same cycle rather than creating another one: every extra PR is another permanent pair of commits on the fixture's default branch.

- [ ] **Step 2: Add the discussion resolution round trip**

Inside the write-cycle's `try` block, after the existing approval checks and before the `finally`, add:

```ts
    if (expectationFor(fixture.name, 'resolveDiscussion').support === 'supported') {
      await check(
        report,
        fixture,
        'resolveDiscussion',
        'resolves a thread and the read side reports it',
        async () => {
          // `repoId` is local to runReadConformance; the write cycle has to
          // derive its own. `fetchMRDiscussions` takes the scoped
          // `<provider>:<numericId>` form, not `owner/repo`.
          const repoId = await scopedRepoId(fixture);
          const detail = await provider.fetchMRDiscussions(repoId, iid);
          const target = detail.discussions.find(d => d.resolvable === true);
          if (!target) throw new Inconclusive('no resolvable discussion on the fixture PR');

          await provider.resolveDiscussion(projectPath, iid, target.id);

          // Re-reading is the assertion. "Did not throw" also passes for a
          // provider that accepts the call and changes nothing, which is the
          // shape MAT-25 and shouldRemoveSourceBranch were built to catch.
          const after = await pollUntil(`resolved state of ${target.id}`, async () => {
            const fresh = await provider.fetchMRDiscussions(repoId, iid);
            const d = fresh.discussions.find(x => x.id === target.id);
            return d?.resolved === true ? d : null;
          });
          assert(after.resolved === true, `expected resolved true, got ${after.resolved}`);
        }
      );

      await check(
        report,
        fixture,
        'unresolveDiscussion',
        'unresolves the same thread',
        async () => {
          const repoId = await scopedRepoId(fixture);
          const detail = await provider.fetchMRDiscussions(repoId, iid);
          const target = detail.discussions.find(d => d.resolved === true);
          if (!target) throw new Inconclusive('no resolved discussion to unresolve');

          await provider.unresolveDiscussion(projectPath, iid, target.id);

          const after = await pollUntil(`unresolved state of ${target.id}`, async () => {
            const fresh = await provider.fetchMRDiscussions(repoId, iid);
            const d = fresh.discussions.find(x => x.id === target.id);
            return d?.resolved === false ? d : null;
          });
          assert(after.resolved === false, `expected resolved false, got ${after.resolved}`);
        }
      );
    }
```

`Inconclusive` is the sentinel `check()` catches to record a skip rather than a failure (`conformance.ts:22`). It is module-private and already in scope in this file. Do not add a second mechanism for the same thing.

The fixture PR needs a review thread for this to assert anything. If the write cycle does not already post one, add a step before these checks that posts a diff comment through `provider.restRequest('POST', ...)` on the PR's changed file, and note in the check's label that the thread is harness-created.

- [ ] **Step 3: Run the auto-merge spike**

Before writing the auto-merge check, measure what GitHub actually does. Do not guess: GitHub rejects `enablePullRequestAutoMerge` on a pull request that is already mergeable, and whether the harness can win that race against the fixture's `always-passes` check is unknown.

This creates a real branch and pull request on `m4ttheweric/glance-conformance` and deletes the branch in a `finally`, which also closes the PR. It never merges. Write it to the scratchpad directory, not the repo.

```ts
#!/usr/bin/env bun
/**
 * Phase 4 spike: can the harness enable auto-merge before the required check
 * reports, and what does GitHub say when it cannot?
 *
 * Creates one branch and one PR on the conformance fixture and deletes the
 * branch in a finally. Never merges anything.
 */
import { GitHubProvider } from '../../packages/glance/src/GitHubProvider.ts';

const REPO = 'm4ttheweric/glance-conformance';
const token = (await Bun.$`gh auth token`.text()).trim();
const provider = new GitHubProvider('https://github.com', token);
const branch = `conformance/automerge-spike-${Date.now()}`;

async function describe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`${label}: OK`);
  } catch (err) {
    console.log(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

try {
  const headSha = (
    (await (await provider.restRequest('GET', `/repos/${REPO}/git/ref/heads/main`)).json()) as {
      object: { sha: string };
    }
  ).object.sha;
  await provider.restRequest('POST', `/repos/${REPO}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: headSha
  });
  await provider.restRequest('PUT', `/repos/${REPO}/contents/automerge-spike.md`, {
    message: 'spike: auto-merge probe',
    content: Buffer.from(`spike ${branch}\n`).toString('base64'),
    branch
  });

  const pr = await provider.createPullRequest({
    projectPath: REPO,
    title: 'conformance: auto-merge spike',
    description: 'Opened by a phase 4 spike. Safe to close.',
    sourceBranch: branch,
    targetBranch: 'main'
  });

  // Question 1: immediately after creation, before the check reports.
  await describe('enable immediately after creation', () =>
    provider.setAutoMerge(REPO, pr.iid)
  );

  // Question 2: after the required check has settled.
  console.log('waiting 90s for always-passes to report...');
  await new Promise(r => setTimeout(r, 90_000));
  await describe('enable after the check passed', () => provider.setAutoMerge(REPO, pr.iid));

  // Question 3: does cancel work, and does a read show it off?
  await describe('cancel', () => provider.cancelAutoMerge(REPO, pr.iid));
  const after = (await (
    await provider.restRequest('GET', `/repos/${REPO}/pulls/${pr.iid}`)
  ).json()) as { auto_merge: unknown };
  console.log(`auto_merge after cancel: ${JSON.stringify(after.auto_merge)}`);
} finally {
  await provider.deleteBranch(REPO, branch).catch(err => console.error(`cleanup: ${err}`));
}
```

Adjust the `createPullRequest` argument names and the returned PR's number field to match this repo's actual `CreatePullRequestInput` and `PullRequest` types before running. Check them with `grep -n "CreatePullRequestInput" -A 15 packages/glance/src/types.ts`.

Record the three answers verbatim in the task's commit message. They decide Step 4.

- [ ] **Step 4: Add the auto-merge check, shaped by the spike**

Write the check to match what the spike observed. If auto-merge can be enabled reliably in the window, assert the round trip. If it cannot, the honest encoding is a `report.skip` with the measured reason, plus an expectations-table note recording it, and `setAutoMerge` stays `supported` in the table with the harness declaring why it cannot exercise it. Do not assert a round trip the spike did not demonstrate.

Whatever the shape, `cancelAutoMerge` must run in a `finally` so a fixture PR is never left with auto-merge armed.

- [ ] **Step 5: Handle unapprove's missing second identity**

`fixture.approver` is `null` for GitHub (`fixture.ts:89`), so the existing `unapprovePullRequest` check at `conformance.ts:641-661` already lives behind `if (fixture.approver)` and will keep skipping on GitHub. Confirm that the skip message names the reason rather than reading as a pass:

Run: `grep -n "no second identity" packages/glance/tests/live/conformance.ts`

If the GitHub skip does not exist as its own line, add one so the report shows `unapprovePullRequest` as explicitly skipped-for-credentials on GitHub rather than absent:

```ts
    } else {
      report.skip(fixture.name, 'approvePullRequest', 'approval', 'no second identity');
      report.skip(
        fixture.name,
        'unapprovePullRequest',
        'dismissal',
        'no second identity: dismissal needs an approval, and GitHub rejects self-approval with 422'
      );
    }
```

- [ ] **Step 6: Type-check**

Run: `cd packages/glance && bun run check-types && bun test`
Expected: clean, all unit tests pass. The harness itself is not run by `bun test`.

- [ ] **Step 7: Commit**

```bash
git add packages/glance/tests/live/conformance.ts packages/glance/tests/live/expectations.ts
git commit -m "test: assert the four newly supported GitHub methods in the live harness"
```

---

### Task 8: MAT-128, instrument retryJob

MAT-128 has been open across three phases with an unproven root cause. Phase 1 hypothesized the 403 comes from calling `retryJob` inside the gap between the job reporting `completed` and the run reporting `completed`. Phase 3's throttling plugin incidentally added seconds of delay and the assertion flipped to passing, which corroborates the hypothesis without proving it. What has been missing every time is the same thing: the harness does not record when the call happened relative to those two timestamps.

This task adds only the instrumentation. It does not fix anything.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts:1139-1141`

**Interfaces:**
- Consumes: `check`, `report`, `provider`, and the `failed` job descriptor already in scope at that call site.
- Produces: console output on the `retryJob` check recording the run and job completion times against the call time.

- [ ] **Step 1: Read the CI probe that produces `failed`**

Run: `sed -n '1000,1145p' packages/glance/tests/live/conformance.ts`

Note which fields the `failed` descriptor carries. The instrumentation needs the run id and the job id; if the run id is not already on it, thread it through from wherever the probe selected the run.

- [ ] **Step 2: Replace the bare check with an instrumented one**

Replace `conformance.ts:1139-1141`:

```ts
      await check(report, fixture, 'retryJob', 'accepts a retry of the failed job', async () => {
        await provider.retryJob(projectPath, failed.jobId);
      });
```

with:

```ts
      await check(report, fixture, 'retryJob', 'accepts a retry of the failed job', async () => {
        // MAT-128 has been open across three phases on an unproven hypothesis:
        // the 403 comes from calling this inside the gap between the job
        // reporting completed and the run reporting completed. Phase 3's
        // throttling delay made it pass without proving why. These three
        // timestamps are what nobody has had, printed whether the call
        // succeeds or fails so a passing run is evidence too.
        const timings = await retryJobTimings(fixture, failed);
        const calledAt = new Date().toISOString();
        console.log(
          `  retryJob timing: job completed ${timings.jobCompletedAt ?? 'unknown'}, ` +
            `run status "${timings.runStatus ?? 'unknown'}" completed ${timings.runCompletedAt ?? 'unknown'}, ` +
            `called at ${calledAt}`
        );
        await provider.retryJob(projectPath, failed.jobId);
      });
```

- [ ] **Step 3: Add the timing reader**

GitHub is the only provider where MAT-128 was observed, and the two endpoints are GitHub-specific. Add near the other CI helpers in the same file:

```ts
/**
 * Job and run completion times for the job `retryJob` is about to retry.
 *
 * GitHub-only: MAT-128's hypothesis is about the gap between a job finishing
 * and its workflow run finishing, and GitLab has no equivalent two-level
 * completion. Returns nulls rather than throwing, because failing to read a
 * diagnostic must never fail the check it is diagnosing.
 */
async function retryJobTimings(
  fixture: ProviderFixture,
  failed: { jobId: number; runId?: number }
): Promise<{ jobCompletedAt: string | null; runCompletedAt: string | null; runStatus: string | null }> {
  const empty = { jobCompletedAt: null, runCompletedAt: null, runStatus: null };
  if (fixture.name !== 'github') return empty;
  const { provider, projectPath } = fixture;
  try {
    const jobRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/jobs/${failed.jobId}`
    );
    const job = jobRes.ok
      ? ((await jobRes.json()) as { completed_at?: string | null; run_id?: number })
      : null;
    const runId = failed.runId ?? job?.run_id;
    if (!runId) {
      return { ...empty, jobCompletedAt: job?.completed_at ?? null };
    }
    const runRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/runs/${runId}`
    );
    const run = runRes.ok
      ? ((await runRes.json()) as { status?: string; updated_at?: string | null })
      : null;
    return {
      jobCompletedAt: job?.completed_at ?? null,
      runCompletedAt: run?.updated_at ?? null,
      runStatus: run?.status ?? null
    };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 4: Type-check**

Run: `cd packages/glance && bun run check-types && bun test`
Expected: clean, all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/tests/live/conformance.ts
git commit -m "test: record retryJob call timing against job and run completion (MAT-128)"
```

---

### Task 9: MAT-145, fix the CI pipeline and job selection

Phase 1 root-caused GitLab's `fetchJobTrace` failure to the harness rather than the provider: `latestPipelineAndJob` takes `jobs[0]` with no status filter and lands on a skipped job, which genuinely has no trace. The fixture's `install` job fails on every pipeline by design, so this fails on every run until the selection is fixed. A second selection bug rides along: GitLab's pipeline choice is also unfiltered by status, unlike GitHub's run choice, so an in-flight pipeline in that slot has no completed jobs at all.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts:963-1007`

**Interfaces:**
- Consumes: `provider.restRequest`, `apiPath(fixture, path)`, the `PipelineProbe` interface at `:963`.
- Produces: `latestPipelineAndJob(fixture)` with an unchanged signature and return shape, selecting a completed pipeline and a job that actually ran.

- [ ] **Step 1: Read the current selection**

Run: `sed -n '963,1007p' packages/glance/tests/live/conformance.ts`

Note two things. The GitHub branch already filters its run with `status=completed` but then takes `jobs.jobs[0]` unfiltered, so the job half of the bug exists on both providers and is merely latent on GitHub. The GitLab branch filters neither.

- [ ] **Step 2: Replace the helper**

Replace `conformance.ts:968-1007` with:

```ts
/**
 * Statuses that mean a job produced output worth asserting on.
 *
 * `skipped` and `manual` jobs genuinely have no trace, so selecting one turns
 * a working `fetchJobTrace` into a failing assertion and reports a harness
 * defect as a provider defect. That is exactly what phase 1 root-caused on
 * GitLab, where `jobs[0]` landed on a skipped job. GitHub uses `conclusion`
 * for the same idea, so the two are checked separately below.
 */
const RAN_GITLAB_JOB_STATUSES = new Set(['success', 'failed']);
const RAN_GITHUB_JOB_CONCLUSIONS = new Set(['success', 'failure']);

/**
 * Pipeline statuses that mean every job in it has settled.
 *
 * An in-flight pipeline has no completed jobs at all, so a probe that lands
 * on one has nothing to assert against and fails for a reason that has
 * nothing to do with the provider.
 */
const TERMINAL_GITLAB_PIPELINE_STATUSES = new Set(['success', 'failed', 'canceled']);

/** How many recent pipelines to consider before giving up on finding a settled one. */
const PIPELINE_SCAN_LIMIT = 20;

async function latestPipelineAndJob(fixture: ProviderFixture): Promise<PipelineProbe | null> {
  const { provider, projectPath } = fixture;

  if (fixture.name === 'github') {
    const runsRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/runs?per_page=1&status=completed`
    );
    if (!runsRes.ok) return null;
    const runs = (await runsRes.json()) as { workflow_runs: Array<{ id: number }> };
    const run = runs.workflow_runs[0];
    if (!run) return null;
    const jobsRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/runs/${run.id}/jobs`
    );
    if (!jobsRes.ok) return null;
    const { jobs } = (await jobsRes.json()) as {
      jobs: Array<{ id: number; status: string; conclusion: string | null }>;
    };
    const job = jobs.find(
      j => j.status === 'completed' && RAN_GITHUB_JOB_CONCLUSIONS.has(j.conclusion ?? '')
    );
    return job ? { pipelineId: run.id, jobId: job.id } : null;
  }

  const encoded = encodeURIComponent(projectPath);
  // Scanning several rather than filtering server-side: GitLab's `status`
  // parameter takes one value, and the terminal set has three.
  const pipeRes = await provider.restRequest(
    'GET',
    apiPath(fixture, `/projects/${encoded}/pipelines?per_page=${PIPELINE_SCAN_LIMIT}`)
  );
  if (!pipeRes.ok) return null;
  const pipes = (await pipeRes.json()) as Array<{ id: number; status: string }>;

  for (const pipe of pipes) {
    if (!TERMINAL_GITLAB_PIPELINE_STATUSES.has(pipe.status)) continue;
    const jobsRes = await provider.restRequest(
      'GET',
      apiPath(fixture, `/projects/${encoded}/pipelines/${pipe.id}/jobs`)
    );
    if (!jobsRes.ok) continue;
    const jobs = (await jobsRes.json()) as Array<{ id: number; status: string }>;
    const job = jobs.find(j => RAN_GITLAB_JOB_STATUSES.has(j.status));
    if (job) return { pipelineId: pipe.id, jobId: job.id };
  }

  return null;
}
```

- [ ] **Step 3: Verify the selection against the live fixture**

This is a read-only path: it lists pipelines and jobs and reads a trace, mutating nothing. Write a short scratchpad script that constructs a `GitLabProvider` from the harness credentials, calls the rewritten selection logic, and prints the chosen pipeline id, job id, and job status.

Expected: a job whose status is `success` or `failed`, never `skipped` or `manual`. Then read that job's trace and confirm it is non-empty. Phase 1's failure was an empty trace from a skipped job, so a non-empty trace from a job that ran is the thing being proven.

If the credentials are not available in this environment, say so plainly in the commit message and let Task 11's full run be the verification. Do not claim it was verified.

- [ ] **Step 4: Type-check and commit**

Run: `cd packages/glance && bun run check-types && bun test`

```bash
git add packages/glance/tests/live/conformance.ts
git commit -m "test: select a settled pipeline and a job that ran on both providers (MAT-145)"
```

---

### Task 10: MAT-145, assert the three never-measured methods

Three methods are declared `supported` and never asserted on anywhere, across five provider-method pairs: `deleteBranch` and `requestReReview` on both providers, and `retryJob` on GitLab. `deleteBranch` is the starkest: it is called in every `finally` block in the harness, so it is exercised constantly and contributes nothing to the pass counts. The runner exits non-zero because of these gaps, which is deliberate and must not be weakened; closing them is what makes the exit code mean something again.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`

**Interfaces:**
- Consumes: `check`, `branchExists(fixture, branch)` (`conformance.ts:1172`), `pollUntil`, the write cycle's branch and PR.
- Produces: pass/fail lines for `deleteBranch` on both providers, `requestReReview` on both, and `retryJob` on GitLab.

- [ ] **Step 1: Assert `deleteBranch` where it already runs**

The write cycle's `finally` already deletes the branch and swallows errors so cleanup cannot fail a run. Do not turn that into an assertion: a cleanup that throws must stay non-fatal. Instead add a dedicated check that creates a throwaway branch, deletes it, and asserts it is gone, using the existing `branchExists` helper:

```ts
  await check(report, fixture, 'deleteBranch', 'the branch is gone afterwards', async () => {
    // Deliberately not asserting on the cleanup deletions in the write
    // cycle's finally blocks: those must stay non-fatal, and an assertion
    // there would make a cleanup failure fail the run it was cleaning up
    // after.
    const branch = `conformance/delete-${Date.now()}`;
    await createBranch(fixture, branch);
    assert(await branchExists(fixture, branch), 'setup failed: branch was not created');

    await provider.deleteBranch(projectPath, branch);

    const gone = await pollUntil(`absence of ${branch}`, async () =>
      (await branchExists(fixture, branch)) ? null : true
    );
    assert(gone === true, 'branch still exists after deleteBranch');
  });
```

Use whatever branch-creation helper the write cycle already uses rather than adding a second one. Find it with:

Run: `grep -n "createBranch\|git/refs\|repository/branches" packages/glance/tests/live/conformance.ts | head`

- [ ] **Step 2: Assert `requestReReview`**

`requestReReview(projectPath, mrIid, reviewerUsernames?)` needs a reviewer who is not the PR author, since GitHub rejects a review request from the author. That is the same single-identity limit `approvePullRequest` hit, so this rides the same `fixture.approver` gate. `PullRequest.reviewers` is the field to read back (`types.ts:139`).

Add inside the write cycle's `try`, next to the approval checks:

```ts
    if (fixture.approver) {
      await check(
        report,
        fixture,
        'requestReReview',
        're-requested reviewer appears on the PR',
        async () => {
          const reviewer = (await fixture.approver!.validateToken()).username;
          await provider.requestReReview(projectPath, iid, [reviewer]);

          // Re-reading rather than trusting the absence of a throw. A
          // provider that accepts the call and assigns nobody would pass a
          // did-not-throw assertion, which is the shape MAT-25 and
          // shouldRemoveSourceBranch were built to catch.
          const after = await pollUntil(`reviewer ${reviewer} on ${iid}`, async () => {
            const fresh = await provider.fetchSingleMR(projectPath, iid, null);
            return fresh?.reviewers.some(r => r.username === reviewer) ? fresh : null;
          });
          assert(
            after.reviewers.some(r => r.username === reviewer),
            `expected reviewers to include "${reviewer}", got ${JSON.stringify(after.reviewers.map(r => r.username))}`
          );
        }
      );
    } else {
      report.skip(
        fixture.name,
        'requestReReview',
        're-request',
        'no second identity: GitHub rejects a review request from the PR author'
      );
    }
```

Confirm `Reviewer` exposes `username` before writing this. Run: `grep -n "interface Reviewer" -A 8 packages/glance/src/types.ts`

- [ ] **Step 3: Assert `retryJob` on GitLab**

The GitHub side already has this check (`conformance.ts:1139`), gated on the CI probe finding a genuinely failed job. Task 9 fixed GitLab's job selection, so the same gate now works there. Confirm the probe is not GitHub-only; if it is, extend it rather than duplicating it.

- [ ] **Step 4: Confirm the coverage assertion sees the change**

`report.ts` carries a coverage assertion over `ALL_METHODS`. Run:

Run: `sed -n '1,75p' packages/glance/tests/live/report.ts`

Confirm that a method with at least one pass no longer counts as uncovered, and that the runner's non-zero exit is driven by remaining uncovered methods rather than a hardcoded list.

- [ ] **Step 5: Type-check and commit**

Run: `cd packages/glance && bun run check-types && bun test`

```bash
git add packages/glance/tests/live/conformance.ts
git commit -m "test: assert deleteBranch, requestReReview, and GitLab retryJob (MAT-145)"
```

---

### Task 11: Live verification and the results record

**Files:**
- Create: `docs/superpowers/specs/2026-08-05-github-parity-phase4-results.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the phase 4 record, in the same shape as `2026-08-05-github-parity-phase3-results.md`.

- [ ] **Step 1: Read the harness safety section**

Run: `sed -n '1,60p' packages/glance/tests/live/runner.ts`

Confirm the fixture targets are `m4ttheweric/glance-conformance` and the GitLab conformance project, and specifically that no target is `m4ttheweric/gitq-test-sandbox`. Do not proceed otherwise.

- [ ] **Step 2: Capture a before-run baseline**

The harness merges into default branches and each merge cycle permanently adds a file and two commits. Record the starting state so the run's effect is measurable rather than assumed:

```bash
gh api repos/m4ttheweric/glance-conformance/commits --jq 'length'
gh api repos/m4ttheweric/glance-conformance/branches --jq '[.[].name]'
```

- [ ] **Step 3: Run the harness**

Run it exactly as phases 1 through 3 did. Capture the full output to the scratchpad, not to the repo.

- [ ] **Step 4: Compare against the phase 3 run**

Diff this run's pass/fail/skip lines against the phase 3 results doc. Every difference needs an explanation before it goes in the record. A newly passing assertion is as much in need of one as a newly failing assertion: phase 3's `retryJob` flip looked like a fix and was a side effect.

- [ ] **Step 5: Verify the fixture is clean**

```bash
gh api repos/m4ttheweric/glance-conformance/branches --jq '[.[].name] | map(select(startswith("conformance/")))'
```

Expected: empty. Anything left behind is a `finally` that did not run, which is a harness defect worth recording even if every assertion passed.

Also confirm no PR was left with auto-merge armed:

```bash
gh api repos/m4ttheweric/glance-conformance/pulls --jq '[.[] | {number, auto_merge}]'
```

- [ ] **Step 6: Write the results document**

Follow `docs/superpowers/specs/2026-08-05-github-parity-phase3-results.md`'s structure. Required sections:

- The diff against the phase 3 run, with every changed line explained.
- What the `retryJob` timing instrumentation actually recorded, and whether it confirms, refutes, or leaves open phase 1's hypothesis. Say which, plainly. If the run passed, the timestamps still say something.
- What the auto-merge spike found, and whether the harness ended up asserting the round trip or skipping with a measured reason.
- What remains unverified. At minimum: `unapprovePullRequest`'s success path, which needs a second GitHub identity, and every capability now flagged `true` whose live evidence is weaker than its flag suggests.
- Independent checks from outside the harness, in the phase 3 style. A green assertion is the harness making a claim about itself.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-github-parity-phase4-results.md
git commit -m "docs: record the phase 4 live verification run"
```

---

### Task 12: A Node smoke test for the shipped build

Added mid-plan by decision, after Task 6's review found the per-task Node check was theater: it read `capabilities`, a static object literal, so it never ran any of the code the task added and would have passed whether or not a Node-only defect existed. Two further facts turned up while scoping this task:

- `dist/index.js` is **ESM** (it ends in `export { ... }`), and `package.json` maps `exports["."].import` to it. Task 6's check reached it with `require()`, which only works on Node 22.12 and later. This package declares `engines.node >= 18`, so that check exercised an entry path most of its supported Node versions cannot use.
- The unit suite runs on Bun and the package ships a Node build. That divergence has already cost this project once: `new Response('', { status: 204 })` is accepted by Bun and throws under Node, and the resulting bug was invisible to `bun test`.

This task replaces the one-off check with a committed script that every future phase inherits.

**Files:**
- Create: `packages/glance/tests/node-smoke.mjs`
- Modify: `packages/glance/package.json` (one script entry)

**Interfaces:**
- Consumes: the built `dist/index.js` through the same `import` path a consumer uses. It must NOT import from `src/`; importing the TypeScript source would defeat the entire purpose.
- Produces: `bun run check:node`, exiting non-zero on any failure.

- [ ] **Step 1: Confirm the build output's shape before writing against it**

```bash
cd packages/glance && bun run build && tail -3 dist/index.js && node --version
```

Expected: the file ends with an `export { ... }` list, confirming ESM. Note the Node version you are on; record it in your report, because `require()` of ESM succeeding is version-dependent and `import()` is not.

- [ ] **Step 2: Write the smoke test**

Create `packages/glance/tests/node-smoke.mjs`. It runs under plain Node, not Bun, so it uses `node:assert` rather than `bun:test`.

```js
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
 *    on Node 22.12 and later, while this package supports Node >= 18. A
 *    check that passes only on the newest Node proves nothing about the
 *    floor it claims to support.
 *
 * Transports are stubbed. This asserts the code runs and behaves under
 * Node, not that GitHub is reachable.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dist = pathToFileURL(resolve(import.meta.dirname, '../dist/index.js')).href;
const { GitHubProvider } = await import(dist);

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
    isResolvable: true,
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

if (failures > 0) {
  console.error(`\n${failures} Node smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Node smoke checks passed.');
```

- [ ] **Step 3: Add the script entry**

In `packages/glance/package.json`, add to `scripts`:

```json
"check:node": "bun run build && node tests/node-smoke.mjs"
```

Building first is deliberate: a smoke test run against a stale `dist` is worse than no smoke test, because it reports green for code that is not the code under review.

- [ ] **Step 4: Prove the test can fail**

A smoke test that cannot fail is the defect it exists to catch. Temporarily break one thing in `src/` (for example, make `setAutoMerge`'s end-state check always pass), run `bun run check:node`, and confirm it exits non-zero and names the failing check. Then revert the break and confirm it passes.

Record both outputs in your report. This step is the evidence that the task worked; without it the rest is unverified.

- [ ] **Step 5: Run it clean**

```bash
cd packages/glance && bun run check:node && echo "exit=$?"
```

Expected: every check prints `ok`, and the exit code is 0.

- [ ] **Step 6: Confirm the unit suite still passes and types are clean**

```bash
cd packages/glance && bun test && bun run check-types
```

`node-smoke.mjs` must NOT be picked up by `bun test`. If it is, adjust its location or the test glob so the two runners stay separate, and say what you changed.

- [ ] **Step 7: Commit**

```bash
git add packages/glance/tests/node-smoke.mjs packages/glance/package.json
git commit -m "test: exercise the shipped Node build, not just its capability literal"
```

Do not stage `dist/`.

---

### Task 13: GitLab discussions report their real resolution state

Added mid-plan by decision, after Task 7's implementer found it while reading. `MRDetailFetcher.fetchDetail` (`src/MRDetailFetcher.ts:95-100`) hardcodes discussion-level `resolvable: null, resolved: null` for every GitLab discussion, unconditionally. Only note-level fields carry real values.

This is the third instance of this bug class in this codebase: MAT-14 hardcoded `unresolvedThreadCount: 0` on GitHub, MAT-27 hardcoded `resolved: null` on GitHub review threads (Task 3 of this plan fixed it), and this one has been sitting on the GitLab side the whole time. The irony is pointed: MAT-27's acceptance criteria said the GitHub work should match GitLab's existing behavior, and GitLab's existing behavior was to report nothing.

It also blocks Task 7. Those discussion checks gate on `Discussion.resolvable === true` to pick a thread to resolve, so on GitLab they would find no candidate and skip deterministically on every run, defeating the point of running them cross-provider.

The data is already there. `RESTNote` declares `resolvable?: boolean | null` and `resolved?: boolean | null` (`MRDetailFetcher.ts:38-47`), and `toNote` already maps `resolvable: n.resolvable ?? null` (`:124`). Only the rollup to the discussion is missing.

**Files:**
- Modify: `packages/glance/src/MRDetailFetcher.ts` (the `discussions` map at 95-100)
- Test: `packages/glance/tests/gitlab-discussions.test.ts` (create)

**Interfaces:**
- Consumes: the existing `RESTDiscussion` and `RESTNote` shapes, unchanged.
- Produces: no signature change. `Discussion.resolvable` and `Discussion.resolved` stop being constants.

**The rollup rule, which matches how GitLab itself presents a thread:**
- A discussion is `resolvable` when at least one of its notes is resolvable. GitLab marks individual notes resolvable, and a thread containing any resolvable note is a resolvable thread.
- A resolvable discussion is `resolved` when every one of its resolvable notes is resolved. One outstanding note keeps the thread open.
- A discussion with no resolvable notes reports `resolvable: false, resolved: null`. That covers plain comment threads and system notes, which have no resolution state to report. `null` rather than `false` for `resolved` is deliberate: "this thread cannot be resolved" is not the same claim as "this thread is unresolved", and conflating them is how the original hardcoding became invisible.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/gitlab-discussions.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * GitLab discussions carry a real resolution state.
 *
 * `MRDetailFetcher` used to hardcode discussion-level `resolvable` and
 * `resolved` to null while mapping the per-note values correctly, so every
 * GitLab thread read as indeterminate. That is the same hardcoded-constant
 * shape as MAT-14 and MAT-27, and it meant the provider GitHub's behavior was
 * supposed to match reported nothing to match against.
 *
 * The transport is stubbed; nothing here touches a network.
 */
import { describe, expect, test } from 'bun:test';
import { MRDetailFetcher } from '../src/MRDetailFetcher.ts';

const AUTHOR = { id: 1, username: 'ada', name: 'Ada', avatar_url: null };

/** One GitLab REST note. `resolvable` undefined means a non-resolvable note. */
function note(
  id: number,
  resolvable?: boolean,
  resolved?: boolean
): Record<string, unknown> {
  return {
    id,
    type: resolvable ? 'DiffNote' : 'DiscussionNote',
    body: `note ${id}`,
    author: AUTHOR,
    created_at: '2026-08-01T00:00:00Z',
    system: false,
    resolvable,
    resolved
  };
}

/** A fetcher whose one REST call returns `discussions`. */
function fetcherWith(discussions: unknown[]): MRDetailFetcher {
  const fetcher = new MRDetailFetcher('https://gitlab.com', 'tok');
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify(discussions), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  return fetcher;
}

describe('MRDetailFetcher: discussion resolution state', () => {
  test('a fully resolved thread reports resolved: true', async () => {
    const f = fetcherWith([
      { id: 'd1', notes: [note(1, true, true), note(2, true, true)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(true);
    expect(detail.discussions[0]?.resolved).toBe(true);
  });

  test('one outstanding note keeps the thread unresolved', async () => {
    const f = fetcherWith([
      { id: 'd2', notes: [note(1, true, true), note(2, true, false)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(true);
    expect(detail.discussions[0]?.resolved).toBe(false);
  });

  test('a thread with no resolvable notes is not resolvable', async () => {
    // A plain comment thread. Reporting `resolved: false` here would claim it
    // is outstanding, when in fact it has nothing to resolve.
    const f = fetcherWith([{ id: 'd3', notes: [note(1), note(2)] }]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(false);
    expect(detail.discussions[0]?.resolved).toBe(null);
  });

  test('a mixed thread rolls up only its resolvable notes', async () => {
    const f = fetcherWith([
      { id: 'd4', notes: [note(1), note(2, true, true), note(3)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(true);
    expect(detail.discussions[0]?.resolved).toBe(true);
  });

  test('an empty thread is not resolvable', async () => {
    const f = fetcherWith([{ id: 'd5', notes: [] }]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(false);
    expect(detail.discussions[0]?.resolved).toBe(null);
  });

  test('per-note state is still mapped, not replaced by the rollup', async () => {
    // The note-level fields were always correct. The rollup must not clobber
    // them or derive them from itself.
    const f = fetcherWith([
      { id: 'd6', notes: [note(1, true, true), note(2, true, false)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.notes[0]?.resolved).toBe(true);
    expect(detail.discussions[0]?.notes[1]?.resolved).toBe(false);
  });

  test('discussions are independent of one another', async () => {
    const f = fetcherWith([
      { id: 'd7', notes: [note(1, true, true)] },
      { id: 'd8', notes: [note(2, true, false)] },
      { id: 'd9', notes: [note(3)] }
    ]);

    const detail = await f.fetchDetail(42, 7);
    const byId = Object.fromEntries(
      detail.discussions.map(d => [d.id, [d.resolvable, d.resolved]])
    );

    expect(byId.d7).toEqual([true, true]);
    expect(byId.d8).toEqual([true, false]);
    expect(byId.d9).toEqual([false, null]);
  });
});
```

Check `MRDetailFetcher`'s real constructor signature before writing `fetcherWith`; if it takes an options object or a different argument order, adapt and say so. Also check how the existing tests in this package stub `fetch`, and follow that pattern rather than inventing one, including restoring the original `fetch` in an `afterEach` if that is what they do.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gitlab-discussions.test.ts`
Expected: FAIL. Every `resolvable` assertion gets `null` rather than `true` or `false`, and every non-null `resolved` assertion gets `null`. The per-note test and the empty-thread `resolved: null` case may already pass.

- [ ] **Step 3: Replace the hardcoded map**

At `MRDetailFetcher.ts:95-100`, replace:

```ts
    const discussions: Discussion[] = raw.map((d) => ({
      id: d.id,
      resolvable: null,
      resolved: null,
      notes: d.notes.map(toNote),
    }));
```

with:

```ts
    const discussions: Discussion[] = raw.map((d) => ({
      id: d.id,
      ...rollUpResolution(d.notes),
      notes: d.notes.map(toNote),
    }));
```

- [ ] **Step 4: Add the rollup**

Add near `toNote` in the same file:

```ts
/**
 * A thread's resolution state, derived from the notes inside it.
 *
 * GitLab marks resolution per note, not per discussion, so the thread-level
 * answer has to be rolled up. These fields used to be hardcoded to null here
 * while the per-note values were mapped correctly, which meant every GitLab
 * thread read as indeterminate to callers.
 *
 * `resolved` stays null for a thread with nothing resolvable in it. Reporting
 * `false` there would claim the thread is outstanding, when the truth is that
 * it has no resolution state at all, and collapsing those two into one value
 * is what let the original hardcoding go unnoticed.
 */
function rollUpResolution(notes: RESTNote[]): {
  resolvable: boolean;
  resolved: boolean | null;
} {
  const resolvable = notes.filter((n) => n.resolvable === true);
  if (resolvable.length === 0) return { resolvable: false, resolved: null };
  return {
    resolvable: true,
    resolved: resolvable.every((n) => n.resolved === true),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/gitlab-discussions.test.ts`
Expected: PASS, all seven.

- [ ] **Step 6: Check what else read these fields**

This changes a value consumers see. Run:

```bash
grep -rn "resolvable\|\.resolved" packages/glance/src packages/glance/tests --include=*.ts | grep -v GitHubProvider
```

`getReviewerSummaries` (`types.ts`) consumes discussions and is the likeliest downstream reader. Confirm nothing depended on the fields being constant, and report what you found. If an existing test asserted `resolved === null` for GitLab as though it were correct behavior, that assertion was encoding the bug: update it and say so explicitly in your report, with what it asserted before.

- [ ] **Step 7: Run the whole suite, type-check, and the Node smoke test**

```bash
cd packages/glance && bun test && bun run check-types && bun run check:node
```

Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/glance/src/MRDetailFetcher.ts packages/glance/tests/gitlab-discussions.test.ts
git commit -m "fix: report real resolution state on GitLab discussions"
```

---

### Task 14: GitLab `requestReReview` honors its argument and stops reporting false success

Added mid-plan by decision. Task 10 found this and it was originally deferred to a ticket; Matthew's instruction is to fix what this phase finds rather than accumulate follow-ups.

`GitLabProvider.requestReReview(projectPath, mrIid, _reviewerUsernames)` (`src/GitLabProvider.ts:1483-1501`) has two defects:

1. It declares `_reviewerUsernames` with a leading underscore and **ignores it entirely**. `GitHubProvider.requestReReview` honors the same argument. So an identical call against the shared `GitProvider` interface does something on one provider and nothing on the other, with no error and no warning.
2. It contains `if (reviewerIds.length === 0) return;`. Called on a merge request with no reviewers, it resolves successfully having done nothing at all.

Between them the method has no state in which a caller can tell success from silence, which is why Task 10 could not write a non-vacuous check for it and had to record a skip instead.

**Files:**
- Modify: `packages/glance/src/GitLabProvider.ts:1483-1501`
- Modify: `packages/glance/tests/live/expectations.ts` (the `GITLAB_EXPECTATIONS.requestReReview` entry Task 10 set to `approximate`)
- Modify: `packages/glance/tests/live/conformance.ts` (replace Task 10's skip with a real check)
- Test: `packages/glance/tests/gitlab-request-rereview.test.ts` (create)

**Interfaces:**
- Consumes: the gitbeaker client at `this.gb`, `this.legacyError(op, err)`.
- Produces: no signature change. `requestReReview` gains real behavior for its third argument and throws instead of silently returning.

**The intended semantics, which the implementation must make true:**
- **With `reviewerUsernames`:** resolve each username to a GitLab user id and set the merge request's reviewers to include them. This genuinely changes state when they were not already reviewers, which is both the useful behavior and the observable one.
- **Without `reviewerUsernames`:** re-assign the current reviewer set, which is what the method does today. Keep it, and keep the existing comment's explanation that GitLab has no dedicated re-request endpoint. Its effect is a notification rather than a state change, so it stays unobservable through this interface; say so in the docstring rather than pretending otherwise.
- **With neither:** no usernames given and no current reviewers. Throw. There is nothing to re-request from, and resolving would be the silent-success shape that made this undetectable.
- **A username that does not resolve to a user:** throw, naming the username. Silently dropping it is the same defect in miniature.

- [ ] **Step 1: Find the gitbeaker calls you need**

Do not guess method names. Confirm against the installed package and the existing call sites in this file:

```bash
cd packages/glance && grep -n "this.gb\.[A-Za-z]*\." src/GitLabProvider.ts | sed 's/.*this\.gb\.//' | cut -d'(' -f1 | sort -u
```

You need a username-to-id lookup. Check what the installed gitbeaker exposes for `Users` and report the exact call you settled on. If no clean lookup exists, `restRequest('GET', '/users?username=...')` through the provider's own pass-through is acceptable; say which you used and why.

- [ ] **Step 2: Write the failing test**

Create `packages/glance/tests/gitlab-request-rereview.test.ts`. Stub `this.gb` on the provider the way the other GitLab unit tests in this package do; check one first and follow its pattern. Cover exactly these cases:

- Given usernames, the resolved ids reach the edit call. Assert on the ids actually sent, not merely that edit was called.
- Given usernames for users who are already reviewers, the call still succeeds and does not drop the existing reviewers.
- Given no usernames and existing reviewers, the current ids are re-sent (today's behavior, preserved).
- Given no usernames and no reviewers, it throws. Assert the message explains there is nothing to re-request.
- Given a username that resolves to nothing, it throws naming that username.
- A failure from the lookup or the edit surfaces rather than being swallowed.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gitlab-request-rereview.test.ts`
Expected: the username cases fail because the argument is ignored today, and the empty case fails because it resolves rather than throwing.

- [ ] **Step 4: Implement**

Rewrite the method. Requirements, not literal code: keep the existing `legacyError` wrapping for both the fetch and the edit, keep the union of existing reviewers with newly named ones rather than replacing the set wholesale, and write the docstring to state plainly which of the two paths is observable and which is not. Comments explain WHY.

- [ ] **Step 5: Restore the harness check Task 10 removed**

Task 10 replaced the GitLab `requestReReview` check with a `report.skip` because nothing observable distinguished success from a no-op. The usernames path is now observable. Replace the skip with a real check that:
- calls `requestReReview(projectPath, iid, [approverUsername])` on a merge request where that user is **not** already a reviewer,
- re-reads the merge request and asserts the reviewer is now present.

Assert on the re-read, never on the absence of a throw.

Leave the GitHub branch's skip alone: it still cannot run, because GitHub rejects a review request from the pull request's author and the fixture has one identity.

- [ ] **Step 6: Restore the expectation entry**

`GITLAB_EXPECTATIONS.requestReReview` was set to `approximate` with a note describing the defects. The defects are fixed, so set it back to plain `supported` and delete the note. Check `tests/live-expectations.test.ts` for what a `supported` entry requires.

- [ ] **Step 7: Verify**

```bash
cd packages/glance && bun test && bun run check-types && bun run check:node
```

- [ ] **Step 8: Commit**

```bash
git add packages/glance/src/GitLabProvider.ts packages/glance/tests/gitlab-request-rereview.test.ts packages/glance/tests/live/expectations.ts packages/glance/tests/live/conformance.ts
git commit -m "fix: honor reviewerUsernames and stop silently succeeding in GitLab requestReReview"
```

---

### Task 15: GitLab branch protection reports measured values, not constants

Added mid-plan by the same decision. `GitLabProvider.fetchBranchProtectionRules` (`src/GitLabProvider.ts:929-936`) returns three fields as unconditional constants for every rule:

```ts
allowDeletion: false,
requiredApprovals: 0,
requireStatusChecks: false,
```

Anyone reading `requiredApprovals` from GitLab today is reading the number zero, not a measurement. GitHub's implementation reports all three from the branch protection detail (`GitHubProvider.ts:847-852`). This is the fourth instance of the hardcoded-constant bug class in this codebase, after `unresolvedThreadCount: 0`, GitHub review threads' `resolved: null`, and the GitLab discussion rollup fixed in Task 13.

**One of the three is not a fabrication and must not be "fixed".** GitLab protected branches cannot be deleted while protected; there is no per-branch deletion toggle to read. `allowDeletion: false` is therefore the correct answer, and it needs a comment saying why rather than a change. Removing a correct constant because it looks like the others would be a regression.

**The other two are measurable, at project scope rather than branch scope.** GitLab models both as project settings rather than per-branch protection:
- `requireStatusChecks` corresponds to the project's `only_allow_merge_if_pipeline_succeeds`.
- `requiredApprovals` corresponds to the project's approval rules.

That scope mismatch is real and must be documented rather than hidden: every rule this method returns will carry the same project-level value. Reporting the project's value on each rule is accurate as far as it goes and is strictly better than zero; pretending it was measured per branch would be a new distortion replacing an old one.

**Files:**
- Modify: `packages/glance/src/GitLabProvider.ts:913-937`
- Test: `packages/glance/tests/gitlab-branch-protection.test.ts` (create)

**Interfaces:**
- Consumes: `this.gb`, `this.legacyError`.
- Produces: no signature change.

- [ ] **Step 1: Confirm the endpoints and the gitbeaker surface**

Verify, do not assume:
- Which project field carries the pipeline-must-succeed setting.
- What the approval rules endpoint returns, and whether rules can be scoped to specific protected branches. If they can, prefer the rule that applies to the branch and fall back to the project default; if that is more than this method can cleanly determine, use the project default for every rule and say so explicitly in both the docstring and your report.

Report the exact calls you settled on.

- [ ] **Step 2: Write the failing test**

Create `packages/glance/tests/gitlab-branch-protection.test.ts`, stubbing `this.gb` following the existing GitLab unit tests' pattern. Cover:
- A project requiring pipeline success reports `requireStatusChecks: true`.
- A project not requiring it reports `false`.
- A project with an approval rule requiring two approvals reports `requiredApprovals: 2`.
- A project with no approval rules reports `0`, and that zero is now a measurement rather than a constant.
- `allowDeletion` stays `false` and `allowForcePush` still comes from the branch.
- **A failure reading the project settings or approval rules must not fabricate a value.** Decide the behavior deliberately and test it: either the whole call throws, or the affected field degrades in a way a caller can detect. Do not let a failed read silently produce `0`/`false`, which would recreate exactly the bug being fixed. State your choice and its reasoning in the report.

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd packages/glance && bun test tests/gitlab-branch-protection.test.ts`

- [ ] **Step 4: Implement**

Keep `legacyError` wrapping. Add the extra reads once per call, not once per branch: the project settings and approval rules do not vary by branch, so fetching them inside the `map` would issue N identical requests.

- [ ] **Step 5: Check the live harness's expectations**

`tests/live/conformance.ts` asserts on branch protection rules. Confirm nothing there asserted the constants as correct behavior. If it did, that assertion encoded the bug: update it and report exactly what it asserted before.

- [ ] **Step 6: Verify and commit**

```bash
cd packages/glance && bun test && bun run check-types && bun run check:node
git add packages/glance/src/GitLabProvider.ts packages/glance/tests/gitlab-branch-protection.test.ts
git commit -m "fix: measure requiredApprovals and requireStatusChecks on GitLab branch protection"
```

---

### Task 16: Close the review findings this plan deferred

Added mid-plan by the same decision. Each item below is a Minor a task reviewer raised and the controller ledgered rather than fixed. They are gathered here because they are individually small and collectively the difference between checks that measure and checks that look like they measure.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`
- Modify: `packages/glance/src/GitHubProvider.ts` (one doc comment)
- Modify: `packages/glance/tests/gh-automerge.test.ts`
- Modify: `packages/glance/tests/gh-unapprove.test.ts`

- [ ] **Step 1: `retryJob` asserts an effect, on both providers**

Both providers' `retryJob` checks assert only that the call did not throw. A provider that accepted the call and did nothing would pass. That is the same shape this plan has now caught three separate times.

Add a re-read. A retry produces observable change: on GitHub the workflow run leaves the completed state, on GitLab the job or pipeline does. Poll for that transition with the harness's existing `pollUntil` rather than sleeping, and keep the bound tight enough that a genuinely broken retry fails rather than hangs. If after investigating you conclude no observable signal is reachable within a sane bound on a given provider, say so and leave that provider's check as-is with a comment explaining why, rather than inventing a weak assertion.

- [ ] **Step 2: Make the `deleteBranch` failure path reachable**

`assert(gone === true, 'branch still exists after deleteBranch')` sits after a `pollUntil` that throws on timeout, so the assert can never fire and its message never reaches a reader. Restructure so a branch that fails to disappear produces that diagnostic message rather than a generic poll timeout. Check whether the same shape appears in nearby checks and fix the ones in code this plan touched; leave older ones alone and note them.

- [ ] **Step 3: Justify or change `PIPELINE_SCAN_LIMIT`**

It is `20` with no stated rationale. Either give the comment a reason tied to something real, or change it to a value you can justify. An unexplained bound reads as arbitrary to whoever next debugs a skipped CI probe.

- [ ] **Step 4: Make the GitHub run scan symmetric with GitLab's**

`latestPipelineAndJob` now scans up to `PIPELINE_SCAN_LIMIT` GitLab pipelines for a settled one, but still requests a single GitHub run (`per_page=1`). If that one run's jobs are all skipped or cancelled, the GitHub probe returns null and the CI checks skip, where GitLab would keep looking. Make GitHub scan too.

- [ ] **Step 5: Assert the auto-merge REST lookup's arguments**

`gh-automerge.test.ts`'s `octokit.request` stub ignores its arguments entirely, so nothing verifies `owner`, `repo`, and `pull_number` are derived correctly from `projectPath` and `mrIid`. Capture the arguments and assert them. Add tests for `pullRequestNodeId`'s own failure paths: an HTTP error, and a pull request whose payload carries no `node_id`.

- [ ] **Step 6: Make the unapprove ordering test discriminate**

`gh-unapprove.test.ts`'s "ordering comes from submitted_at, not list order" case would still pass under a "take the first APPROVED review encountered" implementation, because in its fixture the newest review is also first in list order. Change the fixture so list order and timestamp order genuinely disagree in a way that fails a take-first implementation, keeping the sibling test's coverage intact.

- [ ] **Step 7: Give `cancelAutoMerge` its own doc comment**

It currently inherits context from the comment above `setAutoMerge`. One sentence naming the same repository preconditions makes it readable at its own call site.

- [ ] **Step 8: Verify and commit**

```bash
cd packages/glance && bun test && bun run check-types && bun run check:node
```

```bash
git add packages/glance/tests/live/conformance.ts packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-automerge.test.ts packages/glance/tests/gh-unapprove.test.ts
git commit -m "test: close the deferred review findings from this plan"
```

---

### Task 17: The review-thread query asks for a field GitHub does not have

Found by the first live run. `fetchReviewThreadIndex`'s GraphQL query requests `isResolvable` on `PullRequestReviewThread`. That field does not exist. Live GitHub answers:

```
resolveDiscussion failed: GitHub GraphQL returned Field 'isResolvable' doesn't exist on type 'PullRequestReviewThread'
```

Introspection confirms the real field set: `comments diffSide id isCollapsed isOutdated isResolved line originalLine originalStartLine path pullRequest repository resolvedBy startDiffSide startLine subjectType viewerCanReply viewerCanResolve viewerCanUnresolve`. There is no `isResolvable`. It was invented in this plan's Task 3 text and transcribed faithfully.

**Why ten green unit tests missed it.** Every test in `gh-discussions.test.ts` stubs `octokit.graphql` and returns a literal shaped like the query's expected response. A stub cannot reject a field the real schema lacks, so the query was never validated by anything until a live call was made. This is the same failure the Node smoke test was added for, one layer up: the tests agreed with each other and none of them agreed with reality.

**Why the live `fetchMRDiscussions` check still passed, which is the more dangerous half.** Task 3 deliberately made a GraphQL failure degrade the read rather than fail it: the catch warns and falls back to `resolved: null`. So against live GitHub, `fetchMRDiscussions` silently returns exactly what it returned before MAT-27, and its harness check (`returns a detail object`) passes because it does not assert resolution state. The degradation design that a reviewer praised is what hid a total feature failure. Only the mutation path, which cannot degrade, surfaced it.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (the `GHReviewThread` interface at ~166, the `GHPullRequestThreadsResponse` projection at ~179, the query at ~2030, the mapping at ~2071, the consumer at ~779)
- Modify: `packages/glance/tests/gh-discussions.test.ts`
- Modify: `packages/glance/tests/live/conformance.ts` (add an assertion that would have caught this)

- [ ] **Step 1: Decide what `resolvable` means on GitHub, and get it right this time**

GitHub has no per-thread resolvability flag because every review thread is resolvable. `viewerCanResolve` exists but answers a different question, whether the *calling user* has permission, and mapping it onto `Discussion.resolvable` would replace an invented field with a wrong meaning.

So: drop `isResolvable` entirely. A thread matched from GraphQL reports `resolvable: true`, which is what this method reported before MAT-27 and is correct. Keep `isResolved` driving `resolved`, which is the real fix MAT-27 asked for and which does exist.

Remove the field from the query, from `GHReviewThread`, from the response projection, and from the mapping. At the consumer, `resolvable` becomes `true` for a matched thread, unchanged for an unmatched one. Add a comment stating that GitHub has no per-thread resolvability flag and that `viewerCanResolve` was considered and rejected because it is a permission rather than a property of the thread.

- [ ] **Step 2: Delete the test that asserted the invented field**

`gh-discussions.test.ts` has a test named `isResolvable: false is reported rather than assumed true`. It asserts behavior that cannot occur. Delete it and the `isResolvable` parameter from the `thread` helper. Do not replace it with a test of `viewerCanResolve`.

- [ ] **Step 3: Add the check that would have caught this**

A unit test cannot validate a query against a schema. The live harness can, and did, but only through the mutation path.

Add a harness assertion that `fetchMRDiscussions` reports real resolution state, not merely that it returns an object. Resolve a thread, then assert the READ side reports `resolved: true` for it. The existing `resolveDiscussion` check already resolves a thread and re-reads; extend it, or add a sibling that reads through `fetchMRDiscussions` specifically. The point is that the degrade-to-null path must not be able to pass this check.

- [ ] **Step 4: Verify against the live API before trusting the fix**

Run the corrected query directly, read-only, against a real pull request:

```bash
gh api graphql -f query='
  query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$number){
        reviewThreads(first:10){
          pageInfo{hasNextPage endCursor}
          nodes{ id isResolved comments(first:1){nodes{databaseId}} }
        }
      }
    }
  }' -F owner=m4ttheweric -F repo=glance-conformance -F number=1
```

Expected: a valid response, not a field error. A 404 on the pull request number is fine and still proves the query parses; a field error is not. Paste the real output into your report.

- [ ] **Step 5: Verify and commit**

```bash
cd packages/glance && bun test && bun run check-types && bun run check:node
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-discussions.test.ts packages/glance/tests/live/conformance.ts
git commit -m "fix: stop querying a review-thread field GitHub does not have"
```

---

### Task 18: GitLab `retryJob` retries a job the harness already superseded

Found by the first live run, on the very first occasion GitLab's `retryJob` has ever been asserted:

```
retryJob failed: 403 Forbidden -- 403 Forbidden - Job is not retryable
```

**This is a harness ordering defect, not a provider defect.** `runCiConformance` calls `retryPipeline` and then `retryJob`, both against the same `probe` selected once at the start. Retrying the pipeline creates fresh job instances, which makes the originally-selected job a superseded attempt, and GitLab refuses to retry a superseded job. GitHub is unaffected because its `retryJob` check runs against a job provisioned separately by `withFailedGitHubJob`.

So the harness broke its own precondition, then reported the provider as failing. That is the same class as the skipped-job selection bug fixed earlier in this plan: a harness defect wearing a provider's name.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts` (`runCiConformance`)

- [ ] **Step 1: Confirm the mechanism before fixing it**

Read `runCiConformance` and confirm the ordering described above: one `probe`, `retryPipeline` before `retryJob`, no re-selection between them. Report what you found. If the mechanism is different from the diagnosis, say so and stop rather than fixing the wrong thing.

- [ ] **Step 2: Fix it**

Preferred: re-select the job immediately before the `retryJob` check rather than reusing a probe taken before `retryPipeline` ran. That keeps both checks and makes the precondition explicit.

Acceptable alternative if re-selection proves unreliable: run `retryJob` before `retryPipeline`. Note the trade-off in a comment either way, because the next person will wonder why the order matters.

Whichever you choose, add a comment stating that retrying a pipeline supersedes its jobs, since that is the non-obvious fact that makes the ordering load-bearing.

- [ ] **Step 3: Consider whether selection should require retryability**

`RAN_GITLAB_JOB_STATUSES` selects jobs that produced output. Retryability is a different property. Investigate whether GitLab's job payload exposes something usable, and if it does, prefer selecting on it for this check specifically. If it does not, say so and rely on the ordering fix alone.

- [ ] **Step 4: Verify and commit**

The live harness is the only thing that can verify this, and running it is a separate step. Type-check, and state plainly in your report that live verification is deferred.

```bash
cd packages/glance && bun run check-types && bun test
git add packages/glance/tests/live/conformance.ts
git commit -m "test: re-select the GitLab job after retryPipeline supersedes it"
```

---

### Task 19: Separate fixture conditions from provider defects, and instrument the merge stall

Two live runs produced five distinct failures. Tasks 17 and 18 fixed the two deterministic ones, confirmed passing in run 2. The three that remain split cleanly into two kinds, and conflating them is what this task prevents.

**Run 1 versus run 2, same code except tasks 17 and 18:**

| Check | Run 1 | Run 2 |
| --- | --- | --- |
| github `resolveDiscussion` / `unresolveDiscussion` | FAIL, invented field | pass |
| gitlab `retryJob` | FAIL, superseded job | pass |
| github `setAutoMerge` | pass | FAIL, "Pull request is in unstable status" |
| gitlab `retryPipeline` | pass | FAIL, 409 "Error updating stale job" |
| gitlab `mergePullRequest` | FAIL, 20s timeout | FAIL, 20s timeout |

A check that flips between runs without a code change is reporting the fixture's state, not the provider's behavior. This harness already has the right convention for that, documented at `mergePullRequest`'s HTTP-405 handling: reporting it as a hard fail "would misattribute a fixture precondition to the provider, so it is Inconclusive instead."

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`

- [ ] **Step 1: `setAutoMerge`, distinguish the precondition from the defect**

GitHub answered `enablePullRequestAutoMerge` with `Pull request is in unstable status`. That is GitHub refusing on a mergeability state, not this SDK sending a bad request: run 1 armed auto-merge successfully with identical code.

Catch that specific condition and report `Inconclusive` naming it, so the reason reads as a statement about the pull request's state rather than about `setAutoMerge`. Match on the message GitHub actually returned; do not broaden the catch to every GraphQL error, or a genuine `setAutoMerge` defect would start reporting as a skip and this task would have created the bug it exists to prevent.

**Then read the surrounding check again with fresh eyes.** In run 2, `setAutoMerge` failed and `cancelAutoMerge` reported `disarms auto-merge and a re-read confirms it` as a pass. Work out whether that pass is real. If auto-merge was never armed, a re-read asserting it is off is satisfied by a pull request that never had it, which would be a vacuous pass of exactly the kind this plan has caught repeatedly. If it is vacuous, fix it: the cancel assertion must only count when there was something to cancel. Report your finding either way.

- [ ] **Step 2: `retryPipeline`, decide whether the selection or the reporting is wrong**

GitLab answered with 409 `Error updating stale job`. The probe selects the newest *settled* pipeline by scanning back up to `PIPELINE_SCAN_LIMIT`; a settled pipeline can be old enough that GitLab refuses to retry it.

Investigate which is true and say which you concluded:
- If the selection can prefer a more recent pipeline without weakening the settled-status filter that an earlier task added for good reason, prefer that. Do not undo that filter.
- If a settled-but-stale pipeline is unavoidable on this fixture, treat the 409 as a fixture condition and report `Inconclusive` naming it.

Do not do both. A fix plus a catch that hides the same condition means the catch is never exercised and nobody learns whether the fix worked.

- [ ] **Step 3: Instrument the merge stall rather than guessing at it**

`waitForMergeReadiness` polls until `detailedMergeStatus` leaves `{checking, unchecked, preparing, approvals_syncing}` and timed out at 20s on two consecutive runs, on different merge requests. Two consecutive failures is not a flake.

Nobody knows which status it is stuck in, because the poll discards every observation and reports only that it timed out. That is the same evidentiary hole MAT-128 sat in for three phases, and it was closed by recording what actually happened rather than reasoning about it.

Record the observed `detailedMergeStatus` values across the poll and print them when it times out, so the next run says which state it is stuck in. Also record when `fetchSingleMR` returns null, because the current predicate treats "merge request not found" and "still computing" identically, and those are very different problems.

**Do not raise the timeout to make it pass.** A longer timeout on an unexplained stall converts a visible failure into a slow one and destroys the evidence. If the instrumentation later shows the transitional window is genuinely longer than 20s on this fixture, raising it becomes a justified change; deciding that now would be a guess.

- [ ] **Step 4: Verify and commit**

The live harness is the only thing that verifies any of this and running it is a separate step. Type-check, run the unit suite, and state plainly in your report that live verification is deferred.

```bash
cd packages/glance && bun run check-types && bun test
git add packages/glance/tests/live/conformance.ts
git commit -m "test: report fixture conditions as inconclusive and instrument the merge stall"
```

---

### Task 20: Act on what the instrumentation proved

Two changes, each unblocked by evidence the previous tasks deliberately refused to act without.

**MAT-128 is now root-caused, not hypothesized.** Three runs, with the timing instrumentation an earlier task added:

| Run | Run status when `retryJob` was called | Result |
| --- | --- | --- |
| 1 | `completed`, called 1.9s later | pass |
| 2 | `completed`, called 1.4s later | pass |
| 3 | `in_progress` | 403 `The workflow run containing this job is already running` |

The *job* had completed in all three. The *workflow run* had not, in the one that failed, and GitHub's error says so literally. Phase 1 proposed this and could not prove it; phase 2 reproduced the failure without explaining it; phase 3 made it pass by accident and drew no conclusion. It is now measured.

**The GitLab merge stall is now characterised.** The instrumentation recorded `preparing x1 -> unchecked x1 -> checking x12`: `detailedMergeStatus` reaches `checking` and stays there past the 20 second bound. Phase 1 measured that transitional window at roughly one second. It is genuinely far longer on this fixture now, which is exactly the condition under which Task 19's brief said raising the bound stops being a guess.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`

- [ ] **Step 1: Wait for the workflow run, not just the job, before retrying**

An earlier task forbade adding any wait before the `retryJob` call, because it would have corrupted the measurement that produced the table above. That measurement is complete, so the prohibition is lifted for this specific change and no other.

Before calling `retryJob` on GitHub, poll until the workflow run itself reports `completed`, not merely until the job does. Use the harness's existing `pollUntil`. Keep the timing instrumentation exactly as it is: it should still print, and its recorded run status should now read `completed` on every run, which is how a future reader confirms this fix is still working.

If the run does not reach `completed` within a sane bound, that is a fixture condition rather than a `retryJob` defect. Report `Inconclusive` naming it, following the convention this file already uses. A 403 from `retryJob` after the run has genuinely completed must still be a hard failure: that would be a new and real defect, and it is the whole reason the check exists.

- [ ] **Step 2: Raise the merge-readiness bound, with the evidence in the comment**

Raise `waitForMergeReadiness`'s timeout from 20 seconds. Choose a value you can justify against the observed data rather than a round number chosen for comfort, and say in the comment what was observed (`preparing`, then `unchecked`, then `checking` for the remainder of 20 seconds) and that phase 1 measured this window at about a second, so the bound tracks a fixture that has changed rather than an arbitrary patience level.

Keep the instrumentation. If a future run stalls past the new bound, the next reader needs the same observation trail this one produced, and losing it to a passing run would waste what it cost to get.

Do not silence the failure any other way. Raising a bound because measurement justified it is legitimate; catching the timeout, or treating a stuck merge as inconclusive, would hide a genuine merge defect and is not.

- [ ] **Step 3: Verify and commit**

The live harness verifies this and running it is a separate step. Type-check and run the unit suite.

```bash
cd packages/glance && bun run check-types && bun test
git add packages/glance/tests/live/conformance.ts
git commit -m "test: wait for the workflow run to finish, and widen merge readiness to the measured window"
```

---

### Task 21: Auto-merge is refused at both ends of the mergeability range

Four live runs have now characterised `setAutoMerge` completely:

| Run | Pull request state at the call | Result |
| --- | --- | --- |
| 1 | armable window | pass, armed and confirmed by re-read |
| 2 | `unstable` | refused: `Pull request is in unstable status` |
| 3 | `unstable` | refused, reported inconclusive by Task 19 |
| 4 | `clean` | refused: `Pull request is in clean status`, hard failure |

GitHub refuses `enablePullRequestAutoMerge` at **both** ends. `clean` means every required check has passed and the pull request could merge right now, so there is nothing to wait for. `unstable` means checks are failing or pending in a way GitHub will not queue behind. Auto-merge is armable only in the window between, which is what run 1 hit.

The `clean` refusal is the one the design doc predicted from the start (`GitHub rejects the mutation on a pull request that is already mergeable`). Task 19 caught `unstable` because that is the message run 2 produced, and had no way to know about `clean`. Both are the same class: GitHub declining on the pull request's mergeability state, not a defect in this SDK.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`
- Modify: `packages/glance/tests/live/expectations.ts`

- [ ] **Step 1: Treat both refusals as one class, and keep the class narrow**

Extend the existing inconclusive handling to cover the `clean status` refusal alongside `unstable status`. Match both explicitly rather than loosening to any GraphQL error: a mutation rejected for a bad node id, a permissions problem, or an accepted-but-ineffective arming must all still hard-fail. Say in the comment that the two messages are the two ends of the same range, and that arming is only possible between them, so a future reader does not assume the list of refusal messages is arbitrary.

Do not attempt to widen the window by restructuring when the check runs. That would trade a truthful skip for a flakier pass, and the four runs above already show the behaviour is understood rather than mysterious.

- [ ] **Step 2: Record what the harness can and cannot prove about auto-merge**

`GITHUB_EXPECTATIONS.setAutoMerge` is currently plain `supported`. That is now known to overstate what the harness verifies: the round trip is provable only when a run happens to catch the armable window, and three of four runs did not.

Change it to `approximate` with a note stating that `setAutoMerge` works (run 1 armed it and a re-read confirmed), that GitHub refuses it on both `clean` and `unstable` pull requests, and that the harness therefore reports inconclusive rather than passing whenever a run does not land in the window. Check `tests/live-expectations.test.ts` for what a non-`supported` entry requires.

Leave `cancelAutoMerge` as it is. It is gated on whether arming succeeded and already reports honestly.

- [ ] **Step 3: Verify and commit**

```bash
cd packages/glance && bun run check-types && bun test
git add packages/glance/tests/live/conformance.ts packages/glance/tests/live/expectations.ts
git commit -m "test: auto-merge is refused on both clean and unstable pull requests"
```

---

## Follow-ups this phase does not close

Record these rather than doing them:

- **Phase 5: `canWatchEvents`.** See Out of scope. MAT-129 needs splitting first: its `fetchPullRequestsByBranches` half is unrelated phase 2a work.
- **A second GitHub identity.** `fixture.approver` is hardcoded `null` at `fixture.ts:89` while the GitLab side reads approver tokens from `harness_credentials.json`. Wiring a GitHub approver would close `approvePullRequest`'s and `unapprovePullRequest`'s success paths at once. It is a credentials and fixture-wiring change, not a harness redesign.
- **The version bump.** `package.json` is still `0.13.2` with consumer-visible changes already in main, and this phase adds three capability flags flipping `false` to `true`. Consumers gate behavior on those flags.
- **MAT-130, MAT-24, MAT-131/MAT-146.** All still open with reasoning recorded in the phase 2 handoff.
- **Three MAT-145 items this phase leaves open.** Say so when closing MAT-145 partially rather than closing it outright:
  - `fetchDownstreamPipeline` and `fetchJobDetail`'s `bridge` branch. Neither fixture has a real downstream pipeline relationship, so the branch has never been produced by either provider and remains type-checked rather than behavior-checked. Closing it means building a parent/child pipeline into the GitLab fixture, which is fixture work rather than harness work.
  - GitLab's own `rebasePullRequest`, `setAutoMerge`, and `cancelAutoMerge`, all declared supported and all still skipped. Task 7 closes the two discussion methods and Task 10 closes GitLab `retryJob`; these three stay open.
  - `watchMR` on GitLab, declared supported and never exercised. It needs a live ActionCable connection, which is a different kind of harness than the request/response one this suite is.
