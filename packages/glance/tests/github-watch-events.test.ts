#!/usr/bin/env bun
/**
 * MAT-129: watchEvents on GitHub -- the provider wiring, not the poller.
 *
 * GitHubEventsPoller's own per-tick logic is covered in
 * github-events-poller.test.ts against an injected `fetchPage`. What is only
 * provable here is the layer this file's subject adds: the conditional GET
 * (`If-None-Match` on page 1, `etag`/`x-poll-interval` read back off the 200),
 * Octokit's habit of THROWING a 304 rather than returning one, and the
 * poller-result -> LoopTick mapping the shared watcher loop consumes.
 *
 * The transport is stubbed the way every other GitHubProvider unit test in
 * this suite stubs it -- `(provider as any).octokit` swapped for a scripted
 * object (see gh-automerge.test.ts) -- so nothing here touches a network.
 * Ticks run at a 5ms interval so a two-tick assertion costs milliseconds
 * rather than the 60s production cadence.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { EventCursor, InvalidationBatch } from '../src/types.ts';

const EVENTS_ROUTE = 'GET /repos/{owner}/{repo}/events';

interface RecordedCall {
  route: string;
  params: Record<string, unknown>;
  page: number;
  ifNoneMatch: string | undefined;
  /** 0-based position in the whole run, so a script can vary by tick. */
  index: number;
}

interface ScriptedResponse {
  status: 200 | 304;
  headers?: Record<string, string>;
  data?: unknown;
}

/**
 * A provider whose events feed is answered by `respond`, called once per
 * request with the page, the `If-None-Match` it carried, and how many
 * requests came before it.
 *
 * A scripted 304 is thrown as a `RequestError`, not returned: that is what
 * Octokit actually does with a conditional GET's 304 (it has no 2xx body to
 * hand back), and a stub that returned one would leave the translation this
 * test exists to pin completely unexercised.
 */
function scriptedProvider(respond: (call: RecordedCall) => ScriptedResponse) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const calls: RecordedCall[] = [];
  (provider as any).octokit = {
    request: async (route: string, params: Record<string, unknown>) => {
      const headers = (params.headers ?? {}) as Record<string, string>;
      const call: RecordedCall = {
        route,
        params,
        page: params.page as number,
        ifNoneMatch: headers['if-none-match'],
        index: calls.length
      };
      calls.push(call);
      const res = respond(call);
      if (res.status === 304) {
        throw new RequestError('Not Modified', 304, {
          request: {
            method: 'GET',
            url: 'https://api.github.com/repos/acme/repo/events',
            headers: {}
          },
          response: {
            status: 304,
            url: 'https://api.github.com/repos/acme/repo/events',
            headers: res.headers ?? {},
            data: undefined
          }
        });
      }
      return { status: 200, headers: res.headers ?? {}, data: res.data ?? [] };
    }
  };
  return { provider, calls };
}

/** A PullRequestEvent, trimmed to the fields the classifier reads. */
function prEvent(id: string, number: number, action = 'opened') {
  return {
    id,
    type: 'PullRequestEvent',
    actor: { login: 'octocat' },
    created_at: '2026-08-06T00:00:00Z',
    payload: { action, pull_request: { number } }
  };
}

describe('GitHubProvider.watchEvents', () => {
  test('capability is declared', () => {
    const p = new GitHubProvider('https://github.com', 'tok');
    expect(p.capabilities.canWatchEvents).toBe(true);
    expect(typeof p.watchEvents).toBe('function');
  });

  test('delivers invalidations from fresh events and a string-id cursor', async () => {
    // Tick 1 is a cold start: one page, seenIds seeded, no invalidations
    // (consumers full-refresh on boot). Tick 2 re-reads the same page with
    // one new event on top, so the only invalidation ever delivered is that
    // event's -- proving the cold snapshot was not replayed as activity.
    const { provider, calls } = scriptedProvider(({ index }) =>
      index === 0
        ? { status: 200, data: [prEvent('2', 2), prEvent('1', 1)] }
        : { status: 200, data: [prEvent('3', 3), prEvent('2', 2), prEvent('1', 1)] }
    );

    const delivered: InvalidationBatch[] = [];
    const cursors: EventCursor[] = [];
    await new Promise<void>((resolve) => {
      const dispose = provider.watchEvents!(
        'acme/repo',
        {
          intervalMs: 5,
          onCursor: (c) => cursors.push(c)
        },
        (batch) => {
          delivered.push(batch);
          setTimeout(() => {
            dispose();
            resolve();
          }, 0);
        }
      );
    });

    // Only tick 2's event, and only its keys.
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.invalidations).toEqual([
      { kind: 'mr', ref: '3', cause: 'opened' }
    ]);
    expect(delivered[0]?.syncedAt).toEqual(expect.any(String));

    // The cursor is GitHub-shaped: a STRING lastEventId (A6 -- GitHub event
    // ids are not numeric high-water marks) plus the seenIds set dedup
    // actually runs on. A numeric lastEventId here would mean the GitLab
    // cursor shape leaked through.
    const last = cursors.at(-1);
    expect(typeof last?.lastEventId).toBe('string');
    expect(last?.lastEventId).toBe('3');
    expect(last?.seenIds).toEqual(['2', '1', '3']);
    // The batch carries the same post-tick cursor onCursor got.
    expect(delivered[0]?.cursor).toEqual(last!);

    // The feed request was scoped to the right repo, page-1 first, and never
    // carried a `since`/`after` filter (A7: GitHub's events feed has none,
    // and sending one silently narrows nothing).
    expect(calls[0]?.route).toBe(EVENTS_ROUTE);
    expect(calls[0]?.params).toMatchObject({
      owner: 'acme',
      repo: 'repo',
      per_page: 100,
      page: 1
    });
    expect(calls[0]?.params).not.toHaveProperty('since');
    expect(calls[0]?.params).not.toHaveProperty('after');
  });

  test('a 304 tick makes exactly one request and delivers nothing', async () => {
    // Started warm (a valid GitHub-shaped cursor), so tick 1 is a real
    // page-walking tick: it takes the etag off page 1 and, finding nothing
    // already seen, walks to the 3-page ceiling. Tick 2 then sends that etag
    // back and gets a 304, which must short-circuit the whole tick -- one
    // request, no page 2, no delivery.
    const { provider, calls } = scriptedProvider(({ index, page }) => {
      if (index < 3) {
        return {
          status: 200,
          headers: page === 1 ? { etag: 'W/"abc123"' } : {},
          data: page === 1 ? [prEvent('1', 1)] : []
        };
      }
      return { status: 304 };
    });

    const delivered: InvalidationBatch[] = [];
    await new Promise<void>((resolve) => {
      const dispose = provider.watchEvents!(
        'acme/repo',
        { intervalMs: 5, cursor: { since: null, lastEventId: null, seenIds: [] } },
        (batch) => {
          delivered.push(batch);
        }
      );
      // Two ticks' worth of wall clock, then stop: the 304 tick has to be
      // observed by its absence of effects, so the test waits rather than
      // resolving off a delivery that must never come.
      setTimeout(() => {
        dispose();
        resolve();
      }, 40);
    });

    // Tick 1: pages 1-3, no If-None-Match on the first request (nothing
    // learned yet), never on pages 2-3 (the etag is page-1 scoped).
    expect(calls.slice(0, 3).map((c) => c.page)).toEqual([1, 2, 3]);
    expect(calls[0]?.ifNoneMatch).toBeUndefined();
    expect(calls[1]?.ifNoneMatch).toBeUndefined();

    // Tick 2 sent the etag back and stopped there.
    expect(calls[3]?.page).toBe(1);
    expect(calls[3]?.ifNoneMatch).toBe('W/"abc123"');
    expect(calls.slice(4).filter((c) => c.page > 1)).toEqual([]);

    // Tick 1's one fresh event is the only thing ever delivered; the 304
    // tick added nothing.
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.invalidations).toEqual([
      { kind: 'mr', ref: '1', cause: 'opened' }
    ]);
  });

  /**
   * The cadence rule, in both directions, measured as real gaps between
   * requests. `X-Poll-Interval` is what GitHub uses to ask a poller to slow
   * down, and ignoring it is how a token earns a secondary rate limit; the
   * server can never talk the loop into polling FASTER than the caller
   * asked, though, since the caller may be pacing for its own reasons.
   *
   * These two tests each cost about a second of wall clock, because the
   * header's unit is whole seconds and there is no shorter honest value to
   * assert on. Both assert a lower bound only, so a slow machine can only
   * make them pass more emphatically, never flake.
   */
  function tickGap(options: {
    intervalMs: number;
    pollIntervalSec: number;
  }): Promise<number> {
    // Page-1 requests only: a tick that finds nothing already seen walks to
    // the 3-page ceiling, and those within-tick requests are not gaps
    // between ticks.
    const stamps: number[] = [];
    const { provider } = scriptedProvider(({ page }) => {
      if (page === 1) stamps.push(Date.now());
      return {
        status: 200,
        headers: { 'x-poll-interval': String(options.pollIntervalSec) },
        data: []
      };
    });
    return new Promise<number>((resolve) => {
      const dispose = provider.watchEvents!(
        'acme/repo',
        { intervalMs: options.intervalMs, cursor: { since: null, lastEventId: null, seenIds: [] } },
        () => {}
      );
      const wait = setInterval(() => {
        if (stamps.length < 2) return;
        clearInterval(wait);
        dispose();
        resolve(stamps[1]! - stamps[0]!);
      }, 10);
    });
  }

  test("a server-requested cadence slower than the configured one wins", async () => {
    // 1s requested against a 5ms interval: the next tick must wait out the
    // server's number, not the caller's.
    const gap = await tickGap({ intervalMs: 5, pollIntervalSec: 1 });
    expect(gap).toBeGreaterThanOrEqual(850); // 1000ms, jitter is ±10%
  });

  test('a server-requested cadence faster than the configured one is ignored', async () => {
    // 1s requested against a 1.5s interval. Taking the server's number here
    // would poll faster than the caller asked for -- the one direction this
    // mapping must refuse.
    const gap = await tickGap({ intervalMs: 1500, pollIntervalSec: 1 });
    expect(gap).toBeGreaterThanOrEqual(1300); // 1500ms less jitter; 1000 would fail
  });
});

/**
 * The conditional-fetch helper on its own, without the loop: the header
 * reads and the page ceiling are cheaper to pin here than to arrange through
 * two timed ticks, and the 60s `x-poll-interval` cadence in particular
 * cannot be exercised through the loop without a real 60s wait.
 */
describe('GitHubProvider events page fetch', () => {
  function fetchPage(
    provider: GitHubProvider,
    opts: { page: number; etag: string | null }
  ): Promise<{
    status: number;
    events: unknown[];
    etag: string | null;
    pollIntervalSec: number | null;
  }> {
    return (provider as any).fetchEventsPage('acme', 'repo', opts);
  }

  test('reads etag and x-poll-interval off the 200', async () => {
    const { provider } = scriptedProvider(() => ({
      status: 200,
      headers: { etag: 'W/"e1"', 'x-poll-interval': '60' },
      data: [prEvent('1', 1)]
    }));

    const res = await fetchPage(provider, { page: 1, etag: null });

    expect(res.status).toBe(200);
    expect(res.etag).toBe('W/"e1"');
    expect(res.pollIntervalSec).toBe(60);
    expect(res.events).toHaveLength(1);
  });

  test('a 200 with no cadence or validator headers reports both as null', async () => {
    // Not hypothetical: GHES and proxies both strip headers, and a NaN or a
    // literal "undefined" leaking into the cursor/cadence path would be far
    // harder to read than a null.
    const { provider } = scriptedProvider(() => ({ status: 200, data: [] }));

    const res = await fetchPage(provider, { page: 1, etag: null });

    expect(res.etag).toBeNull();
    expect(res.pollIntervalSec).toBeNull();
  });

  test("Octokit's thrown 304 is translated into the unchanged shape, not rethrown", async () => {
    const { provider, calls } = scriptedProvider(() => ({ status: 304 }));

    const res = await fetchPage(provider, { page: 1, etag: 'W/"e1"' });

    expect(res).toEqual({ status: 304, events: [], etag: null, pollIntervalSec: null });
    expect(calls[0]?.ifNoneMatch).toBe('W/"e1"');
  });

  test('a non-304 failure still propagates untranslated', async () => {
    // Only 304 is a normal outcome here. Anything else has to reach the
    // watcher loop as a throw, which is what puts the loop into backoff and
    // reports `degraded`; swallowing it would look like a permanently quiet
    // feed instead of a broken one.
    const { provider } = scriptedProvider(() => {
      throw new RequestError('Not Found', 404, {
        request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
        response: { status: 404, url: '', headers: {}, data: { message: 'Not Found' } }
      });
    });

    let caught: unknown;
    try {
      await fetchPage(provider, { page: 1, etag: null });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).status).toBe(404);
  });

  test('page 4 throws instead of being requested', async () => {
    // The poller already clamps to 3 (A8). This is the defense in depth: a
    // future caller reaching past the clamp gets a loud failure here rather
    // than a quietly-issued request GitHub answers with an empty page.
    const { provider, calls } = scriptedProvider(() => ({ status: 200, data: [] }));

    await expect(fetchPage(provider, { page: 4, etag: null })).rejects.toThrow(/page/i);
    expect(calls).toHaveLength(0);
  });
});
