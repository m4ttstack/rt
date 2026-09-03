# Glance Retry and Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The six metric-grade reads on `GitLabProvider` accept an `AbortSignal` and retry transient failures with per-attempt deadlines, so boxscore's SP4 data layer can drop its own `server/util/http.ts` wrapper around SDK calls.

**Architecture:** A new internal `src/retry.ts` ports boxscore's proven `withRetry` machinery (per-attempt deadline via `AbortSignal.timeout` + `AbortSignal.any`, `RetryableError` classification, Retry-After honor with a cap, half-jittered exponential backoff, caller cancellation never retried). The two transport choke points, `runQuery` (GraphQL) and `restRequest` (REST), gain an optional trailing `io: { signal?, retry? }` parameter that changes nothing when absent; only the six metric reads pass `{ signal, retry: true }`. Existing methods keep byte-identical behavior.

**Tech Stack:** TypeScript, Bun (`bun test`), no new dependencies.

**Spec:** docs/superpowers/specs/2026-09-02-mattstack-integration-design.md, section 6 (SP3 follow-up: "retry and AbortSignal on the new reads, before boxscore's data layer adopts them") and section 9. The behavioral reference for retry semantics is boxscore's `server/util/http.ts` (read it; its constants and classifications are the contract).

## Global Constraints

- Repo: glance (rt-managed; the worktree comes from `rt worktree provision`, branch `feat/retry-cancellation` off main). Package dir `packages/glance`. Validation: `bun test`, `bun run check-types`, `bun run check:node` all green after every task.
- Existing behavior is frozen: any call that does not pass the new `io` argument makes exactly one attempt with no signal, as today. No existing test may need its expectations changed (adding tests is fine).
- `restRequest` is on the public `GitProvider` interface as `restRequest(method, path, body?)`; its signature change must be purely additive (new optional trailing params). Same for the six read methods: new optional trailing options objects, never a changed required parameter.
- Retry semantics are ported from boxscore `server/util/http.ts` verbatim in behavior: transient = 408, 429, 5xx, plus network/deadline rejections; caller abort never retried; Retry-After honored in seconds or HTTP-date form, clamped to 30s; backoff 400ms base, doubling, 5s ceiling, half-jittered; defaults 3 attempts, 30s per-attempt deadline. Constants are module-level in `src/retry.ts`, not per-call options (attempts/timeoutMs stay overridable via `withRetry`'s own opts for tests).
- House style: single quotes, no em dashes anywhere (boxscore's http.ts uses `--` in comments; keep that form or rephrase), comments only for constraints code cannot show.
- Live fixtures and the conformance harness are untouched by this plan.
- Version lands as 0.24.0 in the final task. npm publish is Matt's gated step, not part of any task.

---

### Task 1: `src/retry.ts` and its unit tests

**Files:**
- Create: `packages/glance/src/retry.ts`
- Test: `packages/glance/tests/retry.test.ts`

**Interfaces:**
- Produces (Task 2 imports these from `./retry.ts`): `class RetryableError extends Error { constructor(reason: Error, retryAfterMs?: number) }` with readonly fields `reason`, `retryAfterMs`; `isTransientStatus(status: number): boolean`; `retryAfterMs(res: Response): number | undefined`; `asRetryable(err: unknown, callerSignal?: AbortSignal): Error`; `withRetry<T>(run: (signal: AbortSignal) => Promise<T>, opts?: { signal?: AbortSignal; timeoutMs?: number; attempts?: number }): Promise<T>`. NOT exported from `src/index.ts`.

- [ ] **Step 1: Write the failing tests**

Port these cases from boxscore's `test/http-retry.test.ts` (read it at `/Users/matt/Documents/GitHub/boxscore/test/http-retry.test.ts`) to `bun:test`, keeping the `stallUntilAborted` helper pattern:

```ts
#!/usr/bin/env bun
/**
 * withRetry: per-attempt deadlines and bounded retry. Ported from boxscore's
 * server/util/http.ts test suite; the semantics are the SP4 contract.
 */
import { describe, expect, test } from 'bun:test';
import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from '../src/retry.ts';

async function stallUntilAborted(signal: AbortSignal, callerSignal?: AbortSignal): Promise<never> {
  try {
    await new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } catch (err) {
    throw asRetryable(err, callerSignal);
  }
  throw new Error('unreachable');
}

describe('withRetry', () => {
  test('ends an attempt that never settles and retries it on a fresh deadline', async () => {
    const signals: AbortSignal[] = [];
    let attempts = 0;
    const out = await withRetry(async (signal) => {
      signals.push(signal);
      attempts += 1;
      if (attempts === 1) await stallUntilAborted(signal);
      return 'ok';
    }, { timeoutMs: 40, attempts: 2 });
    expect(out).toBe('ok');
    expect(attempts).toBe(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  test('does not retry caller cancellation', async () => {
    const caller = new AbortController();
    let attempts = 0;
    const p = withRetry(async (signal) => {
      attempts += 1;
      caller.abort();
      await stallUntilAborted(signal, caller.signal);
    }, { signal: caller.signal, timeoutMs: 5_000, attempts: 3 });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  test('a pre-aborted signal rejects before the first attempt runs', async () => {
    const caller = new AbortController();
    caller.abort();
    let attempts = 0;
    const p = withRetry(async () => {
      attempts += 1;
      return 'never';
    }, { signal: caller.signal });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(0);
  });

  test('a non-retryable rejection propagates untouched on the first attempt', async () => {
    let attempts = 0;
    const p = withRetry(async () => {
      attempts += 1;
      throw new Error('plain failure');
    }, { attempts: 3 });
    await expect(p).rejects.toThrow('plain failure');
    expect(attempts).toBe(1);
  });

  test('exhausted attempts throw the underlying reason, not the wrapper', async () => {
    let attempts = 0;
    const p = withRetry(async () => {
      attempts += 1;
      throw new RetryableError(new Error('socket dropped'), 0);
    }, { attempts: 2 });
    await expect(p).rejects.toThrow('socket dropped');
    expect(attempts).toBe(2);
  });

  test('honors a RetryableError retryAfterMs of zero without a backoff sleep', async () => {
    let attempts = 0;
    const started = performance.now();
    const out = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new RetryableError(new Error('429'), 0);
      return 'ok';
    }, { attempts: 3 });
    expect(out).toBe('ok');
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('classification', () => {
  test('transient statuses are 408, 429, and 5xx', () => {
    for (const s of [408, 429, 500, 502, 503, 599]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [200, 301, 400, 401, 403, 404, 422]) expect(isTransientStatus(s)).toBe(false);
  });

  test('retryAfterMs reads seconds, an HTTP date, and clamps to 30s', () => {
    const res = (retryAfter?: string) =>
      new Response('', retryAfter === undefined ? {} : { headers: { 'retry-after': retryAfter } });
    expect(retryAfterMs(res())).toBeUndefined();
    expect(retryAfterMs(res('2'))).toBe(2_000);
    expect(retryAfterMs(res('120'))).toBe(30_000);
    const at = retryAfterMs(res(new Date(Date.now() + 5_000).toUTCString()));
    expect(at).toBeGreaterThan(3_000);
    expect(at).toBeLessThanOrEqual(30_000);
    expect(retryAfterMs(res('soon'))).toBeUndefined();
  });

  test('asRetryable passes caller aborts through and wraps everything else', () => {
    const caller = new AbortController();
    caller.abort();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(asRetryable(abortErr)).toBe(abortErr);
    expect(asRetryable(new Error('x'), caller.signal)).toBeInstanceOf(Error);
    expect(asRetryable(new Error('x'), caller.signal)).not.toBeInstanceOf(RetryableError);
    expect(asRetryable(new Error('boom'))).toBeInstanceOf(RetryableError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run in `packages/glance`: `bun test tests/retry.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/retry.ts`**

Port `/Users/matt/Documents/GitHub/boxscore/server/util/http.ts` (read it first) with these adjustments and nothing else: single-quote style; keep the module doc but state it as glance's contract ("per-attempt deadline plus bounded retry for the provider transports; ported from boxscore, which retires its wrapper in SP4"); identical constants (`DEFAULT_TIMEOUT_MS = 30_000`, `DEFAULT_ATTEMPTS = 3`, `BASE_BACKOFF_MS = 400`, `MAX_BACKOFF_MS = 5_000`, `MAX_RETRY_AFTER_MS = 30_000`); identical exports as named in Interfaces. One addition: `withRetry` must reject with the caller's abort reason before the first attempt when `opts.signal` is already aborted (boxscore's `signal?.throwIfAborted()` loop head already does this; keep it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/retry.test.ts`, then the full `bun test` and `bun run check-types`. Expected: all green, existing count 522 plus the new file.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/retry.ts packages/glance/tests/retry.test.ts
git commit -m "glance: internal withRetry with per-attempt deadlines, ported from boxscore"
```

---

### Task 2: Thread `io` through the two transports

**Files:**
- Modify: `packages/glance/src/GitLabProvider.ts` (`runQuery` ~line 2362, `restRequest` ~line 1722, `restPages` ~line 1347)
- Test: `packages/glance/tests/gitlab-transport-io.test.ts` (create)

**Interfaces:**
- Produces (Task 3 uses these internally):
  - `interface RequestIO { signal?: AbortSignal; retry?: boolean }` declared in `GitLabProvider.ts` (module scope, exported from the file but NOT from `src/index.ts`).
  - `private runQuery<T>(op, query, variables?, io?: RequestIO): Promise<T>`
  - `restRequest(method, path, body?, op = 'restRequest', io?: RequestIO): Promise<Response>`
  - `private restPages<T>(op, path, query, io?: RequestIO): Promise<T[]>`

- [ ] **Step 1: Write the failing tests**

`tests/gitlab-transport-io.test.ts`, stubbing `globalThis.fetch` in the same save/restore pattern as `tests/gitlab-metrics-rest.test.ts` (read it for the idiom):

```ts
#!/usr/bin/env bun
/**
 * The io parameter on the transports: absent means one attempt and no signal
 * (frozen legacy behavior); { retry: true } retries transient faults; a signal
 * reaches fetch and cancels between attempts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Hit = { status?: number; body?: unknown; headers?: Record<string, string> };

function stubFetch(hits: Hit[]): { count: () => number; signals: (AbortSignal | null | undefined)[] } {
  const signals: (AbortSignal | null | undefined)[] = [];
  let n = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const hit = hits[Math.min(n, hits.length - 1)];
    n += 1;
    signals.push(init?.signal);
    return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status ?? 200, headers: hit.headers });
  }) as typeof fetch;
  return { count: () => n, signals };
}

const p = () => new GitLabProvider('https://gitlab.example', 't');

describe('restRequest io', () => {
  test('without io a 503 is returned once, not retried, with no signal', async () => {
    const s = stubFetch([{ status: 503 }]);
    const res = await p().restRequest('GET', '/projects/1');
    expect(res.status).toBe(503);
    expect(s.count()).toBe(1);
    expect(s.signals[0] ?? null).toBeNull();
  });

  test('with retry a 503 is retried and the success returned', async () => {
    const s = stubFetch([{ status: 503, headers: { 'retry-after': '0' } }, { status: 200, body: { id: 1 } }]);
    const res = await p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true });
    expect(res.status).toBe(200);
    expect(s.count()).toBe(2);
  });

  test('with retry a 404 comes back on the first attempt', async () => {
    const s = stubFetch([{ status: 404 }]);
    const res = await p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true });
    expect(res.status).toBe(404);
    expect(s.count()).toBe(1);
  });

  test('a pre-aborted signal rejects without any fetch', async () => {
    const s = stubFetch([{ status: 200 }]);
    const caller = new AbortController();
    caller.abort();
    await expect(
      p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true, signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(0);
  });

  test('the attempt signal reaches fetch when io carries one', async () => {
    const s = stubFetch([{ status: 200 }]);
    const caller = new AbortController();
    await p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true, signal: caller.signal });
    expect(s.signals[0]).toBeDefined();
  });
});

describe('runQuery io (via fetchGroupProjects wiring in Task 3, exercised here through a raw GraphQL call path)', () => {
  test('without io a GraphQL 502 throws once', async () => {
    const s = stubFetch([{ status: 502 }]);
    await expect(
      (p() as unknown as { runQuery: (op: string, q: string) => Promise<unknown> }).runQuery('op', 'query {}'),
    ).rejects.toThrow('502');
    expect(s.count()).toBe(1);
  });

  test('with retry a GraphQL 502 then 200 succeeds', async () => {
    const s = stubFetch([
      { status: 502, headers: { 'retry-after': '0' } },
      { status: 200, body: { data: { ok: true } } },
    ]);
    const out = await (
      p() as unknown as { runQuery: (op: string, q: string, v?: unknown, io?: unknown) => Promise<unknown> }
    ).runQuery('op', 'query {}', undefined, { retry: true });
    expect(out).toEqual({ ok: true });
    expect(s.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/gitlab-transport-io.test.ts`. Expected: FAIL (io parameter unknown / retry not happening).

- [ ] **Step 3: Implement the threading**

In `GitLabProvider.ts`:

1. `import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from './retry.ts';` and declare at module scope:

```ts
export interface RequestIO {
  signal?: AbortSignal;
  retry?: boolean;
}
```

2. Extract each transport's single round-trip into the shape `withRetry` runs. For `restRequest`: when `io?.retry` or `io?.signal` is present, wrap the fetch in `withRetry(run, { signal: io.signal })` where `run(signal)` performs the fetch with `signal` in the init, and on a response whose status `isTransientStatus` throws `new RetryableError(new Error(\`${op}: HTTP ${res.status} for ${path}\`), retryAfterMs(res))` ONLY when `io.retry` is true; a fetch rejection becomes `throw asRetryable(err, io.signal)`. When `io` is present but `retry` is not true, still run through `withRetry` with `attempts: 1` so the signal and per-attempt deadline semantics hold with no second attempt. When `io` is absent, keep today's literal code path (one bare fetch, no signal). The `safeEmit(this.onRequest, ...)` stays per attempt, inside `run`, so the debug channel sees every attempt.
3. `runQuery` gets the identical treatment: `run(signal)` covers the fetch AND the `res.json()` body read; transient non-ok statuses throw `RetryableError` before the existing `GraphQL request failed` error; non-transient keep today's error. The GraphQL-errors envelope check stays outside retry (a GraphQL-level error is not transient).
4. `restPages(op, path, query, io?)` passes `io` to each `restRequest` call. Its non-ok check must not double-fire: with `io?.retry`, a transient status has already been retried to exhaustion inside `restRequest` and comes back as the final response, so the existing `HTTP ${status}` throw still applies unchanged.

- [ ] **Step 4: Run the full suite to prove the frozen path**

Run: `bun test` and `bun run check-types`. Expected: every pre-existing test green with zero expectation edits (that is the frozen-behavior proof), plus the new file.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/GitLabProvider.ts packages/glance/tests/gitlab-transport-io.test.ts
git commit -m "glance transports take io: optional signal and transient retry, default frozen"
```

---

### Task 3: Signal and retry on the six metric reads

**Files:**
- Modify: `packages/glance/src/GitProvider.ts`, `packages/glance/src/GitLabProvider.ts`, `packages/glance/src/index.ts`
- Test: `packages/glance/tests/gitlab-metrics-cancellation.test.ts` (create)

**Interfaces:**
- Produces (the SP4 consumer surface):
  - `FetchMergeRequestIndexOptions`, `FetchProjectPipelinesOptions`, `FetchUserEventsOptions` each gain `signal?: AbortSignal` (documented: "cancels the walk between and during requests; an abort is surfaced as the signal's reason and never retried").
  - New exported option types in `GitProvider.ts`: `FetchMergeRequestMetricsOptions { signal?: AbortSignal }`, `FetchGroupProjectsOptions { signal?: AbortSignal }`, `FetchProjectOptions { signal?: AbortSignal }`.
  - Interface signatures become `fetchMergeRequestMetrics?(projectPath, mrIid, options?: FetchMergeRequestMetricsOptions)`, `fetchGroupProjects?(groupPath, options?: FetchGroupProjectsOptions)`, `fetchProject?(projectPath, options?: FetchProjectOptions)`; the doc comment on each of the six notes bounded transient retry (3 attempts, per-attempt 30s deadline) as provider behavior.
  - `src/index.ts` exports the three new option type names.

- [ ] **Step 1: Write the failing tests**

`tests/gitlab-metrics-cancellation.test.ts`, reusing the `Hit`/`stubFetch` helper shape from Task 2's test file (copy it locally; the two files stay independent):

```ts
#!/usr/bin/env bun
/**
 * The six metric reads: a signal cancels the walk, transient faults retry,
 * and non-transient failures do not.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Hit = { status?: number; body?: unknown; headers?: Record<string, string> };

function stubFetch(hits: Hit[]): { count: () => number } {
  let n = 0;
  globalThis.fetch = (async () => {
    const hit = hits[Math.min(n, hits.length - 1)];
    n += 1;
    return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status ?? 200, headers: hit.headers });
  }) as typeof fetch;
  return { count: () => n };
}

const p = () => new GitLabProvider('https://gitlab.example', 't');
const UA = '2026-08-01T00:00:00Z';

const indexPage = (hasNext: boolean, cursor: string | null) => ({
  data: {
    project: {
      mergeRequests: {
        pageInfo: { hasNextPage: hasNext, endCursor: cursor },
        nodes: [],
      },
    },
  },
});

describe('metric reads under io', () => {
  test('fetchMergeRequestIndex retries a 502 page and completes', async () => {
    const s = stubFetch([
      { status: 502, headers: { 'retry-after': '0' } },
      { status: 200, body: indexPage(false, null) },
    ]);
    const rows = await p().fetchMergeRequestIndex({ projectPaths: ['g/p'], updatedAfter: UA });
    expect(rows).toEqual([]);
    expect(s.count()).toBe(2);
  });

  test('a pre-aborted signal stops fetchMergeRequestIndex before any request', async () => {
    const s = stubFetch([{ status: 200, body: indexPage(false, null) }]);
    const caller = new AbortController();
    caller.abort();
    await expect(
      p().fetchMergeRequestIndex({ projectPaths: ['g/p'], updatedAfter: UA, signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(0);
  });

  test('an abort between index pages stops the walk', async () => {
    const caller = new AbortController();
    const s = stubFetch([
      { status: 200, body: indexPage(true, 'c1') },
      { status: 200, body: indexPage(false, null) },
    ]);
    await expect(
      p().fetchMergeRequestIndex({
        projectPaths: ['g/p'],
        updatedAfter: UA,
        signal: caller.signal,
        onPage: () => caller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(1);
  });

  test('fetchProject passes the signal and still maps 404 to null on the first attempt', async () => {
    const s = stubFetch([{ status: 404 }]);
    const out = await p().fetchProject('g/p', { signal: new AbortController().signal });
    expect(out).toBeNull();
    expect(s.count()).toBe(1);
  });

  test('fetchGroupProjects retries a transient page fault', async () => {
    const s = stubFetch([
      { status: 503, headers: { 'retry-after': '0' } },
      {
        status: 200,
        body: { data: { group: { projects: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ fullPath: 'g/p' }] } } } },
      },
    ]);
    const out = await p().fetchGroupProjects('g');
    expect(out).toEqual(['g/p']);
    expect(s.count()).toBe(2);
  });

  test('fetchProjectPipelines retries a 429 and keeps its rows', async () => {
    const s = stubFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: [{ id: 9, status: 'SUCCESS', created_at: UA }] },
    ]);
    const out = await p().fetchProjectPipelines('g/p', { updatedAfter: UA, updatedBefore: UA });
    expect(out).toHaveLength(1);
    expect(s.count()).toBe(2);
  });

  test('fetchUserEvents does not retry a 400', async () => {
    const s = stubFetch([{ status: 400 }]);
    await expect(
      p().fetchUserEvents('gitlab:user:1', { action: 'pushed', after: '2026-01-01', before: '2026-02-01' }),
    ).rejects.toThrow('400');
    expect(s.count()).toBe(1);
  });

  test('fetchMergeRequestMetrics takes a signal in its new options bag', async () => {
    const caller = new AbortController();
    caller.abort();
    const s = stubFetch([{ status: 200, body: {} }]);
    await expect(
      p().fetchMergeRequestMetrics('g/p', 7, { signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(0);
  });
});
```

Note on the index-page stub shape: `runQuery` unwraps the GraphQL `data` envelope; the stub bodies above carry `data.project.mergeRequests`. Adjust field names to whatever `mrIndexQuery`'s response types actually use (read `MRIndexResponse` in the source) so the stub matches reality; the assertions stay as written.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/gitlab-metrics-cancellation.test.ts`. Expected: FAIL (signatures missing / no retry).

- [ ] **Step 3: Implement**

1. `GitProvider.ts`: add `signal?: AbortSignal` to the three existing option interfaces; declare and export the three new option interfaces; update the six method signatures and doc comments per Interfaces above.
2. `GitLabProvider.ts`: each of the six methods builds `const io: RequestIO = { signal: options?.signal, retry: true };` and passes it to every `runQuery` / `restPages` / `restRequest` call it makes, including `fetchMergeRequestIndex`'s per-scope page loop, `fetchMergeRequestMetrics`'s first query and notes follow-up loop, and `fetchGroupProjects`'s cursor loop.
3. `src/index.ts`: export `FetchMergeRequestMetricsOptions`, `FetchGroupProjectsOptions`, `FetchProjectOptions`.
4. `GitHubProvider` needs no change: its six capability flags are false and it does not implement the methods.

- [ ] **Step 4: Validate**

Run: `bun test` (all files), `bun run check-types`, `bun run check:node`. Expected: green, zero pre-existing expectation edits.

- [ ] **Step 5: Commit**

```bash
git add packages/glance/src/GitProvider.ts packages/glance/src/GitLabProvider.ts packages/glance/src/index.ts packages/glance/tests/gitlab-metrics-cancellation.test.ts
git commit -m "glance: metric reads take AbortSignal and retry transient faults"
```

---

### Task 4: Version, changelog, and the live sanity run

**Files:**
- Modify: `packages/glance/package.json` (0.23.0 -> 0.24.0), `packages/glance/CHANGELOG.md`

**Interfaces:**
- Consumes: everything above. Produces the releasable branch.

- [ ] **Step 1: Changelog and version**

`package.json` version `0.24.0`. New CHANGELOG section above 0.23.0:

```markdown
## 0.24.0

### Minor Changes

- The six metric-grade reads accept `signal?: AbortSignal` (new option field on
  the index, pipelines, and user-events option bags; new optional option bags
  `FetchMergeRequestMetricsOptions`, `FetchGroupProjectsOptions`, and
  `FetchProjectOptions` on the other three) and retry transient failures:
  408/429/5xx statuses, dropped sockets, and per-attempt deadline expiry, 3
  attempts with a 30s per-attempt deadline, Retry-After honored (capped at
  30s), half-jittered exponential backoff. A caller abort is never retried and
  surfaces as the signal's reason. Every other method's behavior is unchanged:
  no signal, one attempt, exactly as before.
- `GitLabProvider.restRequest` gains optional trailing `op` and
  `io: { signal?, retry? }` parameters; existing calls are unaffected.
```

- [ ] **Step 2: Full validation plus the live read-only runner**

Run in `packages/glance`: `bun test`, `bun run check-types`, `bun run check:node`, then `bun tests/live/reads-runner.ts` (harness credentials: copy `/Users/matt/Documents/GitHub/glance/harness_credentials.json` into the worktree root if absent; it is gitignored). Expected: suite green, runner exit 0 on both fixtures (retry must not change live conformance results).

- [ ] **Step 3: Commit**

```bash
git add packages/glance/package.json packages/glance/CHANGELOG.md
git commit -m "glance 0.24.0: cancellation and bounded retry on the metric reads"
```
