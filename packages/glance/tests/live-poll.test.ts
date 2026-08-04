/**
 * pollUntil exists because GitHub's involvement-mode fetch is search-backed
 * and eventually consistent. Measured on a sandbox: two fresh PRs absent at
 * t+3.7s, present at t+9.7s, while the REST listing had them at t+0.9s.
 * A guessed sleep is how MAT-80 got mistaken for a deleted branch.
 */
import { describe, expect, test } from 'bun:test';
import { pollUntil } from './live/poll.ts';
import { Reporter } from './live/report.ts';

describe('pollUntil', () => {
  test('returns the first non-null value', async () => {
    let calls = 0;
    const value = await pollUntil(
      'eventual',
      async () => (++calls < 3 ? null : `after ${calls}`),
      { intervalMs: 1, timeoutMs: 1000 }
    );
    expect(value).toBe('after 3');
  });

  test('returns immediately when the first call succeeds', async () => {
    // Call count alone doesn't prove the first attempt runs before any sleep:
    // a pollUntil that sleeps unconditionally on every iteration, including
    // the first, would still land on calls === 1. Elapsed time is the part
    // that actually pins "no pre-check sleep".
    let calls = 0;
    const start = Date.now();
    await pollUntil('instant', async () => { calls++; return 'ok'; }, { intervalMs: 500 });
    expect(calls).toBe(1);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test('returns the first defined value when earlier calls resolve undefined', async () => {
    let calls = 0;
    const value = await pollUntil(
      'possibly-undefined',
      async () => (++calls < 3 ? undefined : `after ${calls}`),
      { intervalMs: 1, timeoutMs: 1000 }
    );
    expect(value).toBe('after 3');
  });

  test('throws a labelled error on timeout', async () => {
    await expect(
      pollUntil('never-appears', async () => null, { intervalMs: 1, timeoutMs: 20 })
    ).rejects.toThrow(/never-appears.*timed out/);
  });

  test('a thrown predicate does not abort the poll', async () => {
    let calls = 0;
    const value = await pollUntil(
      'flaky',
      async () => {
        if (++calls < 3) throw new Error('transient 502');
        return 'recovered';
      },
      { intervalMs: 1, timeoutMs: 1000 }
    );
    expect(value).toBe('recovered');
  });
});

describe('Reporter', () => {
  test('exitCode is 0 when nothing failed', () => {
    const r = new Reporter();
    r.pass('github', 'validateToken', 'returns a username');
    r.skip('github', 'watchMR', 'realtime', 'no push channel');
    expect(r.exitCode).toBe(0);
  });

  test('exitCode is 1 once anything failed', () => {
    const r = new Reporter();
    r.pass('github', 'validateToken', 'returns a username');
    r.fail('github', 'fetchJobTrace', 'returns log text', 'HTTP 400');
    expect(r.exitCode).toBe(1);
  });

  test('render groups by provider and shows failure detail', () => {
    const r = new Reporter();
    r.fail('github', 'fetchJobTrace', 'returns log text', 'HTTP 400 from blob storage');
    const out = r.render();
    expect(out).toContain('github');
    expect(out).toContain('fetchJobTrace');
    expect(out).toContain('HTTP 400 from blob storage');
  });
});
