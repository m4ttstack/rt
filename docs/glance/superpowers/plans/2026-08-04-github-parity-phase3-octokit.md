# GitHub Parity Phase 3: Octokit Transport Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GitHubProvider`'s hand-rolled `fetch` transport with Octokit, gaining retry, throttling, non-truncating pagination, and the request instrumentation GitHub has never emitted, without changing any behavior a caller or the live harness can observe.

**Architecture:** A new `githubClient.ts` owns Octokit construction (plugins, GitHub Enterprise base URLs, instrumentation hooks) and one error-translation helper that preserves the exact error message strings callers and the harness match on today. `GitHubProvider` then migrates off its private `api()` in groups, deleting the `if (!res.ok)` boilerplate at 31 call sites as it goes. The transport is swapped underneath `api()` first, while every existing test still passes unchanged, so the suite proves the swap is behavior-preserving before any call site moves.

**Tech Stack:** TypeScript, Bun, `@octokit/core@7`, `@octokit/plugin-paginate-rest@15`, `@octokit/plugin-retry@8`, `@octokit/plugin-throttling@11`, `@octokit/request-error@7`.

## Global Constraints

- **No em dashes or en dashes** in anything authored: code, comments, commit messages, docs. Use an ellipsis or rephrase. Pre-existing dashes in `src/` predate the rule; leave them, do not sweep them, do not add more. Two verbatim GitHub error strings quoted as evidence in the specs docs are exempt and must not be touched.
- **Comments explain why, never what.**
- **Commit after each completed task.** Never finish with one commit.
- **`harness_credentials.json` is gitignored and holds three real GitLab tokens. This repo is public.** Never stage it, never print it. Stage files by explicit path, never `git add -A`.
- **Baseline before starting:** `bun test tests/` from `packages/glance` reports **199 pass, 0 fail**. `bun run check-types` is clean and covers `tests/live/` as well as `src/`. Neither may regress at any task boundary.
- **The live runner mutates real repositories** and permanently adds a file and two commits to each fixture's default branch per run. This plan budgets exactly one run, in the final task. Do not run it to check intermediate progress.
- **Never point the harness at `m4ttheweric/gitq-test-sandbox`.** The fixtures are `m4ttheweric/glance-conformance` and `m4tthew-dev/glance-test-repo`.
- **`expectations.ts` must not change.** No capability flag moves in this phase. Editing that table means you have changed behavior you were not asked to change.

## The contracts this swap must not break

These are the reason the phase exists in this order. Every one is load-bearing and verified present in the code today.

**1. Error message strings are matched by pattern, not just displayed.** Octokit throws `RequestError` on non-2xx instead of returning a response, so every message is rewritten by this swap unless deliberately preserved. Three matchers exist in the live harness alone:

- `tests/live/conformance.ts:838` matches `/\bmergePullRequest failed: 405\b/` to tell a transient GitLab merge race from a permanent block. Breaking it turns an Inconclusive into a hard failure.
- `tests/live/conformance.ts:611` matches `/approvePullRequest failed: 422\b/`, which is the entire proof that GitHub's approval request shape and auth are correct, given only one identity exists.
- `tests/live/conformance.ts` (merge cycle) matches `mergePullRequest merged but could not delete source branch`, added in phase 2 so a deletion failure does not cost the run both of its merge proofs.

The current format is `` `${op} failed: ${res.status} ${text}` `` in most methods and `` `${op} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}` `` in five (`approvePullRequest`, `retryPipeline`, `retryJob`, `fetchJobTrace`, `requestReReview`). Both shapes must survive, per method, exactly as they are.

**2. `restRequest` must never throw on a non-2xx.** It is a public pass-through returning `Promise<Response>`, and callers branch on `res.ok`. The harness's `branchExists()` depends on a 404 arriving as `res.ok === false`, not as an exception. Octokit's default is the opposite, so `restRequest` needs an explicit adapter.

**3. 22 test stub sites across 7 files replace the private `api()`** (`(provider as any).api = ...`): `gh-merge.test.ts` (7), `gh-fetch-prs.test.ts` (6), `gh-by-branch.test.ts` (5), and one each in `draft.test.ts`, `fetch-contract.test.ts`, `gh-review-threads.test.ts`, `gh-branch-protection.test.ts`. Task 2 keeps them all working. Tasks 4 through 7 migrate them in the same task as the call sites they cover, never separately.

## Defects this phase fixes as a side effect, and one it must not

**Fixed by adopting `octokit.paginate`:** `fetchAllPages` (`GitHubProvider.ts:1737`) does `if (!res.ok) break;` and returns the pages it already had. A failed or rate-limited second page silently yields a short list. It feeds `fetchAllPages<GHReview>` at `:1710`, whose reviews `toPullRequest` counts approvals from, so a truncated page can silently under-report approvals. This is the same silent-failure class as MAT-14, MAT-15, and MAT-131. Task 7 owns it.

**Fixed by wiring `octokit.hook`:** `GitHubProvider` emits zero `onRequest` instrumentation. `grep -c safeEmit src/GitHubProvider.ts` returns 0, against 5 in `GitLabProvider`. `onRequest` is a documented SDK feature that has always silently reported nothing for GitHub. Task 1 owns it.

**Explicitly NOT fixed here: MAT-133.** `graphql()` swallows every error and returns `null`. Task 8 moves it onto `octokit.graphql` while preserving that swallow exactly, including the two `log.warn` calls. Changing it is phase 4's job, it has no failing assertion driving it, and doing it inside a transport swap would make a behavior change indistinguishable from a transport regression. If a reviewer flags the swallow during this phase, the answer is "phase 4, by design", and the ledger says so.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/glance/src/githubClient.ts` | New. Octokit construction (plugins, GHE base URLs, throttling handlers, instrumentation hooks) and the `ghError` translation helper. |
| `packages/glance/src/GitHubProvider.ts` | Migrates from `fetch` to the client, group by group. |
| `packages/glance/src/instrumentation.ts` | Gains nothing new; `RequestInfo` and `safeEmit` are reused as they are. |
| `packages/glance/package.json` | Five new runtime dependencies. |
| `packages/glance/tests/github-client.test.ts` | New. Client construction, base URL resolution, instrumentation emission, error translation. |
| `packages/glance/tests/gh-*.test.ts`, `draft.test.ts`, `fetch-contract.test.ts` | Stub migration, each in the task that moves its call sites. |
| `docs/superpowers/specs/2026-08-04-github-parity-phase3-results.md` | New. The live verification record (final task). |

Tasks 1 through 8 need no network. Task 9 is the single live run.

---

### Task 1: The Octokit client and the error translation helper

**Files:**
- Create: `packages/glance/src/githubClient.ts`
- Modify: `packages/glance/package.json`
- Test: `packages/glance/tests/github-client.test.ts`

**Interfaces:**
- Consumes: `RequestInfo`, `OnRequestHook`, `safeEmit` from `./instrumentation.ts`; `ForgeLogger` and `noopLogger` from `./logger.ts`. Note the logger type is named `ForgeLogger`, not `Logger`; `noopLogger` is exported at `logger.ts:21`.
- Produces:
  - `type GlanceOctokit = Octokit & { paginate: ... }` (the plugin-augmented instance type; export the type `createGitHubClient` returns rather than hand-writing it).
  - `function resolveGitHubUrls(baseURL: string): { apiBase: string; graphqlURL: string }`
  - `function createGitHubClient(opts: { baseURL: string; token: string; log: ForgeLogger; onRequest?: OnRequestHook }): GlanceOctokit`
  - `function ghError(op: string, err: unknown, style?: 'plain' | 'statusText'): Error`
  - Task 2 consumes all four. Tasks 3 through 8 consume `ghError` at every migrated call site.

- [ ] **Step 1: Add the dependencies**

Run from `packages/glance`:

```bash
bun add @octokit/core@^7.0.7 @octokit/plugin-paginate-rest@^15.0.0 @octokit/plugin-retry@^8.1.1 @octokit/plugin-throttling@^11.0.5 @octokit/request-error@^7.1.1
```

These five pull 16 packages in total, including `bottleneck` (throttling's queue) and `before-after-hook` (the hook system). That is expected and was accepted deliberately: retry and throttling against GitHub's secondary rate limits are the wheel this phase exists not to reinvent.

- [ ] **Step 2: Write the failing tests**

Create `packages/glance/tests/github-client.test.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Octokit client construction and error translation.
 *
 * The error messages are not cosmetic: the live conformance harness matches
 * them by pattern to tell a transient failure from a permanent one, so a
 * reworded message silently disables a check rather than failing it.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import {
  createGitHubClient,
  ghError,
  resolveGitHubUrls
} from '../src/githubClient.ts';
import { noopLogger } from '../src/logger.ts';
import type { RequestInfo } from '../src/instrumentation.ts';

describe('resolveGitHubUrls', () => {
  test('github.com maps to the api subdomain', () => {
    expect(resolveGitHubUrls('https://github.com')).toEqual({
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    });
  });

  test('the www host is treated as github.com', () => {
    expect(resolveGitHubUrls('https://www.github.com').apiBase).toBe(
      'https://api.github.com'
    );
  });

  test('an enterprise host serves REST under /api/v3 and GraphQL under /api/graphql', () => {
    expect(resolveGitHubUrls('https://ghe.corp.example')).toEqual({
      apiBase: 'https://ghe.corp.example/api/v3',
      graphqlURL: 'https://ghe.corp.example/api/graphql'
    });
  });
});

function fakeRequestError(status: number, body: unknown): RequestError {
  return new RequestError('Oops', status, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
    response: {
      status,
      url: 'https://api.github.com/x',
      headers: {},
      data: body
    }
  });
}

describe('ghError', () => {
  test('plain style reproduces the shape most methods use today', () => {
    const err = ghError(
      'mergePullRequest',
      fakeRequestError(405, { message: 'Pull Request is not mergeable' })
    );
    expect(err.message).toMatch(/^mergePullRequest failed: 405 /);
    expect(err.message).toContain('Pull Request is not mergeable');
  });

  test('the harness pattern for a merge precondition still matches', () => {
    const err = ghError('mergePullRequest', fakeRequestError(405, {}));
    expect(/\bmergePullRequest failed: 405\b/.test(err.message)).toBe(true);
  });

  test('the harness pattern for self-approval rejection still matches', () => {
    const err = ghError(
      'approvePullRequest',
      fakeRequestError(422, { message: 'Unprocessable Entity' }),
      'statusText'
    );
    expect(/approvePullRequest failed: 422\b/.test(err.message)).toBe(true);
  });

  test('a non-RequestError is preserved rather than relabelled as an HTTP failure', () => {
    const err = ghError('fetchJobTrace', new TypeError('network down'));
    expect(err.message).toContain('network down');
    expect(err.message).not.toMatch(/failed: \d/);
  });
});

describe('createGitHubClient instrumentation', () => {
  test('emits one RequestInfo per request, with the op label and real status', async () => {
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    await octokit.request('GET /user', {
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ login: 'octocat' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.transport).toBe('rest');
    expect(seen[0]?.status).toBe(200);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.path).toContain('/user');
  });

  test('emits for a failed request too, carrying the real status', async () => {
    const seen: RequestInfo[] = [];
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: info => seen.push(info)
    });

    await octokit
      .request('GET /user', {
        request: {
          // Retries would turn one logical operation into several events, and
          // the SDK counts logical operations, so they stay off here.
          retries: 0,
          fetch: async () =>
            new Response(JSON.stringify({ message: 'Bad credentials' }), {
              status: 401,
              headers: { 'content-type': 'application/json' }
            })
        }
      })
      .catch(() => undefined);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe(401);
  });

  test('a throwing onRequest hook cannot break the request', async () => {
    const octokit = createGitHubClient({
      baseURL: 'https://github.com',
      token: 'tok',
      log: noopLogger,
      onRequest: () => {
        throw new Error('observer is broken');
      }
    });

    const res = await octokit.request('GET /user', {
      request: {
        fetch: async () =>
          new Response(JSON.stringify({ login: 'octocat' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    });

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/glance && bun test tests/github-client.test.ts`
Expected: FAIL, the module does not exist yet.

- [ ] **Step 4: Implement the client**

Create `packages/glance/src/githubClient.ts`:

```typescript
/**
 * Octokit construction and error translation for GitHubProvider.
 *
 * The provider used a bare fetch before this, which meant no retry, no
 * throttling, pagination that silently truncated on a failed page, and no
 * request instrumentation at all on the GitHub side.
 */
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { RequestError } from '@octokit/request-error';
import { safeEmit, type OnRequestHook } from './instrumentation.ts';
import type { ForgeLogger } from './logger.ts';

const GlanceOctokitBase = Octokit.plugin(paginateRest, retry, throttling);

export type GlanceOctokit = InstanceType<typeof GlanceOctokitBase>;

/**
 * GitHub Enterprise serves REST under /api/v3 but GraphQL under /api/graphql,
 * not beneath the REST root, so the two cannot be derived from one prefix.
 */
export function resolveGitHubUrls(baseURL: string): {
  apiBase: string;
  graphqlURL: string;
} {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return {
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    };
  }
  return {
    apiBase: `${baseURL}/api/v3`,
    graphqlURL: `${baseURL}/api/graphql`
  };
}

export function createGitHubClient(opts: {
  baseURL: string;
  token: string;
  log: ForgeLogger;
  onRequest?: OnRequestHook;
}): GlanceOctokit {
  const { apiBase } = resolveGitHubUrls(opts.baseURL);

  const octokit = new GlanceOctokitBase({
    auth: opts.token,
    baseUrl: apiBase,
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        // Two attempts absorb a quota window boundary. Retrying indefinitely
        // would turn a quota exhaustion into a hang with no upper bound.
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub secondary rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        return retryCount < 2;
      }
    }
  });

  if (opts.onRequest) {
    const started = new WeakMap<object, number>();
    octokit.hook.before('request', options => {
      started.set(options, performance.now());
    });
    octokit.hook.after('request', (response, options) => {
      emit(opts.onRequest!, started, options, response.status);
    });
    octokit.hook.error('request', (error, options) => {
      emit(
        opts.onRequest!,
        started,
        options,
        error instanceof RequestError ? error.status : 0
      );
      throw error;
    });
  }

  return octokit;
}

function emit(
  hook: OnRequestHook,
  started: WeakMap<object, number>,
  options: { method?: string; url?: string },
  status: number
): void {
  const at = started.get(options as object);
  safeEmit(hook, {
    op: `gh.${options.method ?? 'GET'} ${options.url ?? ''}`.trim(),
    transport: 'rest',
    method: options.method ?? 'GET',
    path: options.url ?? '',
    durationMs: at === undefined ? 0 : performance.now() - at,
    status
  });
}

/**
 * Translate a thrown Octokit error into the message shape callers already
 * match on.
 *
 * The live conformance harness pattern-matches three of these to distinguish a
 * transient failure from a permanent one, so a reworded message disables a
 * check silently instead of failing it. `style` picks between the two formats
 * the hand-rolled code used: most methods emitted status plus body, five
 * emitted status, statusText, and body.
 */
export function ghError(
  op: string,
  err: unknown,
  style: 'plain' | 'statusText' = 'plain'
): Error {
  if (!(err instanceof RequestError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const body = bodyText(err);
  if (style === 'statusText') {
    // The dash here is GitHub-facing text this SDK has always emitted in these
    // five messages, and the harness matches on the prefix before it.
    return new Error(
      `${op} failed: ${err.status} ${statusText(err)}${body ? ` — ${body}` : ''}`
    );
  }
  return new Error(`${op} failed: ${err.status} ${body}`);
}

function bodyText(err: RequestError): string {
  const data = err.response?.data;
  if (data === undefined || data === null) return '';
  return typeof data === 'string' ? data : JSON.stringify(data);
}

function statusText(err: RequestError): string {
  const headers = err.response?.headers as Record<string, unknown> | undefined;
  const fromResponse = headers?.status;
  // GitHub returns "404 Not Found" in its status header; the hand-rolled code
  // read Response.statusText, which is the same text without the code.
  if (typeof fromResponse === 'string') {
    return fromResponse.replace(/^\d+\s*/, '');
  }
  return '';
}
```

Note on the dash in `ghError`: this is one of the two standing exemptions. It reproduces a string this SDK already emits, in messages the harness matches, and rewording it to satisfy the style rule would be a behavior change disguised as a style fix. Do not "fix" it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/github-client.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 209 pass, 0 fail, clean type-check.

- [ ] **Step 7: Commit**

```bash
git add packages/glance/package.json packages/glance/src/githubClient.ts packages/glance/tests/github-client.test.ts
git commit -m "feat: add the octokit client factory and error translation"
```

Note: the lockfile at the repo root will also have changed. Stage it explicitly by path in the same commit; do not use `git add -A`.

---

### Task 2: Swap the transport underneath `api()`, changing nothing else

This is the step that makes the rest safe. `api()` keeps its exact signature and its `Response` return, so all 199 existing tests and all 22 stub sites keep working untouched. If the suite stays green here, the transport swap itself is behavior-preserving, and every later task changes call sites against a transport already proven.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` (constructor, `api()`, `restRequest()`)
- Test: no new test file; the existing 199 are the proof.

**Interfaces:**
- Consumes: `createGitHubClient`, `resolveGitHubUrls`, `GlanceOctokit` from `./githubClient.ts`.
- Produces: a private field `octokit: GlanceOctokit` on `GitHubProvider`, consumed by every later task. `api()` keeps the signature `(method: string, path: string, body?: unknown) => Promise<Response>`.

- [ ] **Step 1: Construct the client**

In the constructor (`GitHubProvider.ts:400-414`), replace the hand-rolled base URL branch with `resolveGitHubUrls`, keeping both fields since `graphqlURL` is still used by `graphql()` until Task 8:

```typescript
    const urls = resolveGitHubUrls(this.baseURL);
    this.apiBase = urls.apiBase;
    this.graphqlURL = urls.graphqlURL;
    this.octokit = createGitHubClient({
      baseURL: this.baseURL,
      token: this.token,
      log: this.log,
      onRequest: options.onRequest
    });
```

Declare the field alongside the existing private fields:

```typescript
  private readonly octokit: GlanceOctokit;
```

`GitHubProvider`'s options type is `{ logger?: ForgeLogger }` today and has no `onRequest`. Widen it to `{ logger?: ForgeLogger; onRequest?: OnRequestHook }`, which is exactly what `GitLabProvider` declares at `GitLabProvider.ts:641`. Use that name and shape, do not invent a different one. This is an additive change to a published constructor signature, so existing callers are unaffected.

- [ ] **Step 2: Reimplement `api()` over Octokit, preserving its contract**

Replace the body of `api()` (`GitHubProvider.ts:1302-1321`) with:

```typescript
  /**
   * Kept as a Response-returning seam while call sites migrate off it.
   *
   * Octokit throws on non-2xx; this converts that back into a Response so the
   * `if (!res.ok)` call sites still work and so `restRequest`, which is public
   * and documented to return a Response, does not start throwing on a 404 that
   * callers branch on.
   */
  private async api(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    try {
      const res = await this.octokit.request(`${method} ${path}`, {
        ...(body !== undefined ? { data: body } : {})
      });
      return toResponse(res.status, res.headers, res.data);
    } catch (err) {
      if (err instanceof RequestError) {
        return toResponse(err.status, err.response?.headers ?? {}, err.response?.data);
      }
      throw err;
    }
  }
```

Add this module-scope helper near the bottom of the file, outside the class:

```typescript
/**
 * Rebuild a Response from an Octokit result so the pre-Octokit call sites,
 * and the public restRequest contract, keep seeing what they always saw.
 */
function toResponse(
  status: number,
  headers: Record<string, unknown>,
  data: unknown
): Response {
  const body =
    data === undefined || data === null
      ? null
      : typeof data === 'string'
        ? data
        : JSON.stringify(data);
  const init: ResponseInit = { status, headers: {} };
  const link = headers.link;
  if (typeof link === 'string') init.headers = { Link: link };
  return new Response(body, init);
}
```

Import `RequestError` from `@octokit/request-error` at the top of the file.

Two traps to check while implementing:

- `octokit.request('GET /repos/{owner}/{repo}')` treats `{...}` as parameter placeholders. The provider builds paths by interpolation, so a branch name containing `{` would be misread. Pass the already-built path and no route parameters, which is what the code above does, and confirm by running the suite.
- Octokit's `data` option is the request body for non-GET verbs. Confirm the merge tests still pass, since they assert on exact body contents.

- [ ] **Step 3: Route `restRequest` through the same seam**

`restRequest` already delegates to `api()` (`GitHubProvider.ts:946`), so it needs no change, but it now inherits retry and throttling. Verify by reading that its contract is unchanged: still returns a `Response`, still does not throw on 404.

- [ ] **Step 4: Run the full suite**

Run: `cd packages/glance && bun test tests/`
Expected: **209 pass, 0 fail, with no test file edited.** That is the whole point of this task. If any test needs changing to pass, stop: it means the swap changed observable behavior, and the difference must be understood and reported before proceeding, not accommodated by editing the test.

- [ ] **Step 5: Type-check**

Run: `cd packages/glance && bun run check-types`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts
git commit -m "refactor: run GitHubProvider's api() over octokit, unchanged contract"
```

---

### Task 3: Migrate the read path

From here each task moves a group of call sites off `api()` onto `this.octokit.request` directly, deletes that group's `if (!res.ok)` blocks in favor of `ghError`, and updates the tests that stub those paths. Groups are drawn so each is independently reviewable and its tests are in one or two files.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` ... `validateToken` (`:433`), `currentUser` (`:1640`), `fetchPR` (`:1561`), `listRepoPRs` (`:1597`), `searchPRs` (`:1494`), `fetchCheckRuns` (`:1720`), `fetchPullRequestByBranch` (`:761`, `:788`)
- Test: `packages/glance/tests/gh-fetch-prs.test.ts`, `packages/glance/tests/gh-by-branch.test.ts`, `packages/glance/tests/fetch-contract.test.ts`

**Interfaces:**
- Consumes: `this.octokit` and `ghError` from Tasks 1 and 2.
- Produces: nothing new. These methods keep their existing signatures and return types exactly.

- [ ] **Step 1: Record the current behavior of the methods that swallow**

Before changing anything, read each of the seven methods and write down, in the task report, which ones return `null` or `[]` on a non-ok response rather than throwing. `fetchPR` and `currentUser` both do. That swallow is existing behavior that callers depend on (`fetchPullRequestByBranch` returns `null` for "no PR", which the harness asserts), and it must be preserved exactly. Octokit throwing makes it easy to convert a silent `null` into a new exception by accident, which would be a regression dressed as a fix.

- [ ] **Step 2: Migrate one method as the pattern, and run its tests**

Take `validateToken` first. Replace:

```typescript
    const res = await this.api('GET', '/user');
    if (!res.ok) {
      throw new Error(`validateToken failed: ${res.status} ${await res.text()}`);
    }
    const user = (await res.json()) as GHUser;
```

with:

```typescript
    let user: GHUser;
    try {
      const res = await this.octokit.request('GET /user');
      user = res.data as GHUser;
    } catch (err) {
      throw ghError('validateToken', err);
    }
```

Run: `cd packages/glance && bun test tests/fetch-contract.test.ts`
Expected: the stub for `api()` no longer intercepts this call, so this test will fail until its stub moves to `octokit.request`. Update that stub as described in Step 3.

- [ ] **Step 3: Move the stubs for this group**

In each affected test file, replace the `(provider as any).api = ...` stub with an `octokit.request` stub. The shape:

```typescript
  (provider as any).octokit = {
    request: async (route: string, params?: Record<string, unknown>) => {
      calls.push({ route, params });
      return { status: 200, headers: {}, data: payload };
    }
  };
```

For a test that needs to simulate a failure, throw a `RequestError` rather than returning a non-ok object, because that is what the real client does:

```typescript
      throw new RequestError('Not Found', 404, {
        request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
        response: { status: 404, url: '', headers: {}, data: { message: 'Not Found' } }
      });
```

Keep every existing assertion. If an assertion checked a path string, it now checks the route string; adapt the expected value, never the assertion's intent.

- [ ] **Step 4: Migrate the remaining six methods in this group**

Apply the same pattern to `currentUser`, `fetchPR`, `listRepoPRs`, `searchPRs`, `fetchCheckRuns`, and both call sites in `fetchPullRequestByBranch`. For the two that swallow (`fetchPR`, `currentUser`), the catch returns `null` instead of throwing, preserving Step 1's recorded behavior:

```typescript
    } catch (err) {
      if (err instanceof RequestError && err.status === 404) return null;
      throw ghError('fetchPR', err);
    }
```

Read each method's current swallow condition before writing its catch. Do not assume every swallow is a 404: write down what the code does today and reproduce that, and if any of them swallows *every* status, say so in the report rather than narrowing it silently.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 209 pass, 0 fail, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-fetch-prs.test.ts packages/glance/tests/gh-by-branch.test.ts packages/glance/tests/fetch-contract.test.ts
git commit -m "refactor: move the GitHub read path onto octokit"
```

---

### Task 4: Migrate the PR write path

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` ... `createPullRequest` (`:828`, `:841`, `:850`, `:859`), `updatePullRequest` (`:894`, `:913`, `:922`, `:931`)
- Test: `packages/glance/tests/draft.test.ts`, `packages/glance/tests/gh-merge.test.ts` (its `stubGitHub` helper is shared with Task 5)

**Interfaces:**
- Consumes: `this.octokit`, `ghError`, and the stub pattern established in Task 3.
- Produces: nothing new.

- [ ] **Step 1: Fix the three unchecked sub-requests while you are here, and say so**

`updatePullRequest`'s reviewers, assignees, and labels calls (`:913`, `:922`, `:931`) never check `res.ok` today, so a failure is silently swallowed. Octokit throws, which means migrating them changes behavior: those failures will now surface. That is a fix, and it is in scope only because the transport swap makes silence impossible to preserve without writing an explicit catch that discards errors, which nobody should write.

Wrap each in a catch that throws `ghError('updatePullRequest', err)`. Record the change in your task report as a deliberate behavior change, since MAT-24 owns these fields and this plan does not otherwise touch them.

- [ ] **Step 2: Migrate the eight call sites**

Same pattern as Task 3. `createPullRequest`'s first call returns the created PR and already throws on non-ok; the following three are the reviewers, assignees, and labels calls, which have the same silent-swallow property as Step 1 describes.

- [ ] **Step 3: Update the stubs in both test files**

`draft.test.ts`'s `stubGitHub` and `gh-merge.test.ts`'s `stubGitHub` both intercept `api()`. Move both to `octokit.request`. `gh-merge.test.ts`'s helper is also used by Task 5's tests, so keep its signature (`(provider, sourceBranch?, projectPath?)`) and its returned call-recording array shape intact; only the interception point changes.

- [ ] **Step 4: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 209 pass, 0 fail, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/draft.test.ts packages/glance/tests/gh-merge.test.ts
git commit -m "refactor: move the GitHub PR write path onto octokit"
```

---

### Task 5: Migrate the merge and review path, preserving two harness contracts

The highest-risk group. Two of the three harness error-string matchers live here, and phase 2's merge fixes are the newest code in the file.

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` ... `mergePullRequest` (`:982`), `deleteMergedSourceBranch` (`:1079`, `:1088`), `approvePullRequest` (`:1106`), `requestReReview` (`:1272`, `:1287`), `deleteBranch` (`:741`)
- Test: `packages/glance/tests/gh-merge.test.ts`

**Interfaces:**
- Consumes: `this.octokit`, `ghError` with both styles.
- Produces: nothing new. `deleteMergedSourceBranch` keeps its `(repoPath, branch)` signature from phase 2.

- [ ] **Step 1: Preserve `mergePullRequest`'s message exactly**

Its current throw is `` `mergePullRequest failed: ${res.status} ${text}` ``, which `conformance.ts:838` matches as `/\bmergePullRequest failed: 405\b/`. Use `ghError('mergePullRequest', err)` with the default `plain` style, which reproduces that shape. Add a comment at the call site naming the harness dependency, so a future reader does not reword it.

- [ ] **Step 2: Preserve `approvePullRequest`'s message exactly**

Its current throw uses the statusText shape and is matched by `conformance.ts:611` as `/approvePullRequest failed: 422\b/`. Use `ghError('approvePullRequest', err, 'statusText')`.

- [ ] **Step 3: Preserve `deleteMergedSourceBranch`'s two behaviors**

This method is phase 2's fix and has two properties the harness and its own tests depend on. Both must survive:

- Its thrown message begins `mergePullRequest merged but could not delete source branch`, which the harness matches to keep the merge proofs alive when only the deletion failed.
- It verifies the ref is actually gone rather than trusting a status code, because GitHub reuses 422 for "reference does not exist" and for a protection-refused delete.

Under Octokit, the DELETE throws instead of returning a non-ok response, and the verification GET throws a `RequestError` with `status === 404` instead of returning one. Rewrite both branches accordingly, keeping the logic identical: attempt the delete, and on failure check existence, treating "confirmed gone" as success and everything else, including a failed check, as a throw.

The nine MAT-127 tests in `gh-merge.test.ts` cover this, including the 422-with-ref-still-present regression test. Every one must still pass. If any needs its expectations changed beyond the stub interception point, stop and report it: that means behavior moved.

- [ ] **Step 4: Migrate `requestReReview` and `deleteBranch`**

Both use the statusText shape today. Use `ghError(op, err, 'statusText')`.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 209 pass, 0 fail, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-merge.test.ts
git commit -m "refactor: move the GitHub merge path onto octokit, message contracts intact"
```

---

### Task 6: Migrate the CI and branch-protection path

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` ... `fetchBranchProtectionRules` (`:676`, `:701`), `retryPipeline` (`:1205`), `retryJob` (`:1221`), `fetchJobTrace` (`:1236`)
- Test: `packages/glance/tests/gh-branch-protection.test.ts`

**Interfaces:**
- Consumes: `this.octokit`, `ghError`.
- Produces: nothing new.

- [ ] **Step 1: Keep MAT-131's throw semantics**

`fetchBranchProtectionRules`'s per-branch read throws on failure (phase 2's fix, MAT-131), naming the branch and carrying the status so the known 403 case is self-explanatory. Preserve the message shape:

```typescript
      } catch (err) {
        throw new Error(
          `fetchBranchProtectionRules failed reading protection for "${b.name}": ${
            err instanceof RequestError ? err.status : ''
          } ${err instanceof RequestError ? JSON.stringify(err.response?.data ?? '') : String(err)}`
        );
      }
```

The three tests in `gh-branch-protection.test.ts` match on `/protection for "main"/` and `/403/`. Both must still match.

- [ ] **Step 2: `fetchJobTrace` returns text, not JSON**

The Actions logs endpoint answers a redirect to plain-text log content. Octokit parses by content type, so confirm the returned `data` is the log string and not an object. If Octokit hands back something other than a string, coerce at this one call site and explain why in a comment. Do not change the method's `Promise<string>` signature.

This method is one of the few whose live behavior contradicted an earlier prediction (phase 1 proved it works), so treat any change in its shape as a real finding worth reporting, not a detail to paper over.

- [ ] **Step 3: Migrate `retryPipeline` and `retryJob`**

Both use the statusText shape. `retryJob`'s 403 message is quoted in two specs documents as evidence; its format must not change.

- [ ] **Step 4: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 209 pass, 0 fail, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-branch-protection.test.ts
git commit -m "refactor: move the GitHub CI and protection paths onto octokit"
```

---

### Task 7: Replace `fetchAllPages` with `octokit.paginate`, fixing the silent truncation

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` ... delete `fetchAllPages` (`:1737`), update `fetchMRDiscussions` (`:619`, two calls at `:627` and `:630`) and the reviews fetch (`:1710`)
- Test: `packages/glance/tests/gh-review-threads.test.ts`, plus a new test for the truncation fix

**Interfaces:**
- Consumes: `this.octokit.paginate`.
- Produces: `fetchAllPages` no longer exists. Nothing outside the class referenced it.

- [ ] **Step 1: Write the failing test for the defect**

Add to `packages/glance/tests/gh-review-threads.test.ts` a test proving a failed second page is no longer swallowed: stub `octokit.paginate` to reject, and assert the calling method rejects rather than returning a short list. Before Octokit, `fetchAllPages` returned page one and dropped the error, so this test encodes the actual bug being fixed. State in the test's comment that a truncated review list silently under-reports approvals, which is why this matters beyond tidiness.

- [ ] **Step 2: Replace the three call sites**

```typescript
    const reviews = await this.octokit.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner,
      repo,
      pull_number: mrIid,
      per_page: 100
    });
```

Note this is the one place where route parameters are the right call: `paginate` needs the route template to follow `Link` headers correctly. Splitting `projectPath` into `owner` and `repo` is required here. Do it with a small private helper if more than one call site needs it, and give the helper a name that says what it does.

- [ ] **Step 3: Delete `fetchAllPages` and confirm nothing references it**

Run: `grep -n "fetchAllPages" packages/glance/src/GitHubProvider.ts`
Expected: no output.

- [ ] **Step 4: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 210 pass, 0 fail, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-review-threads.test.ts
git commit -m "fix: stop silently truncating paginated GitHub reads"
```

---

### Task 8: Move `graphql()` onto `octokit.graphql`, preserving MAT-133 exactly

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts` ... `graphql` (`:1326`), and remove the now-unused `graphqlURL` field if nothing else reads it
- Test: `packages/glance/tests/gh-review-threads.test.ts`, `packages/glance/tests/draft.test.ts` (both stub `graphql`)

**Interfaces:**
- Consumes: `this.octokit.graphql`, which `@octokit/core` provides directly. There is no separate GraphQL plugin to install; the design doc's mention of one is inaccurate.
- Produces: `graphql<T>()` keeps its exact signature `(query, variables) => Promise<T | null>`.

- [ ] **Step 1: Preserve the swallow, deliberately**

`graphql()` returns `null` on transport, HTTP, and GraphQL errors, warning only. That is MAT-133, it is assigned to **phase 4**, and it must not change here. Under Octokit the errors arrive as exceptions rather than as a parsed payload, so the catch has to be written explicitly to keep swallowing them, and it must keep emitting the same two `log.warn` calls with the same shapes.

Write a comment saying the swallow is intentional here and owned by MAT-133 in phase 4, so a reviewer reading this in isolation does not "fix" it. Changing it inside a transport swap would make a behavior change indistinguishable from a transport regression.

- [ ] **Step 2: Confirm GHE still works**

`octokit.graphql` derives its endpoint from the client's `baseUrl`, which Task 1 set to the REST base. On GitHub Enterprise the GraphQL endpoint is `/api/graphql`, NOT under the REST `/api/v3` root, which is why `resolveGitHubUrls` returns both. Verify which URL `octokit.graphql` actually targets for an enterprise base URL, and if it derives the wrong one, pass the correct endpoint explicitly. Test both hosts.

This is the single most likely place for a silent enterprise-only breakage, and no fixture exercises GHE, so it has to be proven by unit test.

- [ ] **Step 3: Run the full suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 212 pass, 0 fail, clean.

- [ ] **Step 4: Delete the now-dead seam**

`api()` should now have exactly one caller left, `restRequest`, which needs a `Response`. Either keep `api()` as `restRequest`'s private implementation, or inline it there and delete the name. Whichever you choose, `restRequest` must still return a `Response` and must still not throw on a non-2xx: the harness's `branchExists()` reads a 404 as `res.ok === false`.

Run: `grep -c "this.api(" packages/glance/src/GitHubProvider.ts`
Expected: `1` if you kept the seam for `restRequest`, `0` if you inlined it.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-review-threads.test.ts packages/glance/tests/draft.test.ts
git commit -m "refactor: move GitHub GraphQL onto octokit, MAT-133 swallow unchanged"
```

---

### Task 9: Live verification, once

**Files:**
- Create: `docs/superpowers/specs/2026-08-04-github-parity-phase3-results.md` (rename to the run's actual date)
- Modify: `.superpowers/handoff-phase2.md` (gitignored, never staged)

**Interfaces:**
- Consumes: everything above.
- Produces: no code symbols.

- [ ] **Step 1: Confirm the harness target before running**

Run: `grep -rn "gitq-test-sandbox" packages/glance/tests/live/ harness_credentials.example.json`
Expected: no output.

- [ ] **Step 2: Run the live harness**

Run: `cd packages/glance && bun tests/live/runner.ts`

This mutates both fixtures. Capture the full output to a file.

- [ ] **Step 3: Compare against the phase 2 baseline, line by line**

The phase 2 run is recorded in `docs/superpowers/specs/2026-08-04-github-parity-phase2-results.md`. This phase changed no behavior, so the expectation is that **every line matches**, with these known exceptions:

| Line | Expected |
| --- | --- |
| `github mergePullRequest: ... (MAT-25)` | ok, unchanged |
| `github mergePullRequest: shouldRemoveSourceBranch ...` | ok, unchanged |
| `github retryJob: accepts a retry of the failed job` | either; timing-dependent, MAT-128 untouched |
| `gitlab fetchJobTrace: returns non-empty log text` | FAIL, known harness gap, untouched |
| The five `coverage:` lines | unchanged |
| Everything else | identical to phase 2 |

Any other difference is a regression from this swap and must be reported, not explained away. A transport swap that changes a live result changed behavior, which is exactly what this phase promised not to do.

- [ ] **Step 4: Verify the instrumentation actually fires**

This phase's main new capability has no assertion in the harness. Prove it separately with a short script that constructs a `GitHubProvider` with an `onRequest` hook, calls `validateToken()`, and prints the collected `RequestInfo` records. Before this phase that array was always empty. Include the output in the results document.

- [ ] **Step 5: Write the results document**

Same structure as the phase 2 results doc: verbatim output in a collapsed block, the comparison table, what changed and what did not, and an explicit list of what remains uncovered. Do not amend the phase 1 or phase 2 records.

- [ ] **Step 6: Commit and update the handoff**

```bash
git add docs/superpowers/specs/2026-08-04-github-parity-phase3-results.md
git commit -m "docs: record the phase 3 live verification run"
```

Then rewrite `.superpowers/handoff-phase2.md` for phase 4, carrying forward the open MAT-131 decision, the deferred ticket table, and the two untracked defects (GitLab's hardcoded protection fields, MAT-24's unchecked `res.ok`). Never stage it.

---

## Self-Review

**Spec coverage.** The design doc's phase 3 section lists five justifications. `fetchJobTrace` was retracted by phase 1 and is not treated as a reason here. Rate limiting is Task 1 (throttling and retry plugins). Pagination is Task 7, which also fixes the silent truncation the design doc did not know about. Types are partially addressed: this plan adopts Octokit's runtime but does not replace the hand-written `GHPullRequest` and friends with `@octokit/openapi-types`, because doing so inside the same change would make a type-shape regression indistinguishable from a transport regression. That is a deliberate deferral and is called out here rather than silently dropped; it should become its own ticket. Instrumentation is Task 1 plus Task 9's verification.

**Placeholders.** None. Tasks 3 through 6 give exact code for the first instance of each distinct pattern and enumerate the remaining call sites by file and line rather than repeating near-identical code eight times; that is a deliberate choice for mechanical repetition, not an unwritten decision.

**Type consistency.** `createGitHubClient`, `resolveGitHubUrls`, `ghError`, and `GlanceOctokit` are defined in Task 1 and used under those exact names in Tasks 2 through 8. `toResponse` is module-scope in `GitHubProvider.ts`, introduced in Task 2 and removed or retained by Task 8 Step 4 depending on the seam decision made there. `deleteMergedSourceBranch` keeps the `(repoPath, branch)` signature phase 2 gave it.

**Test counts.** 199 at baseline, plus 10 in Task 1, plus 1 in Task 7, plus 2 in Task 8, equals 212. Tasks 2 through 6 add no tests by design: they are refactors whose proof is that the existing tests keep passing without modification beyond the stub interception point.

**The known risk this plan carries.** Tasks 3 through 6 edit tests in the same commits as the code those tests cover, which is the thing Task 2 exists to compensate for. Task 2 is the checkpoint: if the suite passes there with zero test edits, the transport is proven, and later test edits are known to be interception-point changes rather than accommodations. If Task 2 cannot go green without editing a test, that is a stop-and-report condition, not something to work around.
