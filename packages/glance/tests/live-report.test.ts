/**
 * Reporter.assertFullCoverage exists because three early returns in
 * conformance.ts (two identical `if (prIid === null) return;` guards in the
 * merge and write cycles, plus a CI probe miss) dropped assertions from the
 * report with nothing recording that they never ran. A method that never
 * appears in the report reads as "nobody wrote a check for this" when what
 * actually happened is "an early return skipped it this run" -- those are
 * different failure modes and this is the structural fix that catches both,
 * plus any future early return of the same shape, without patching each
 * call site individually.
 */
import { describe, expect, test } from 'bun:test';
import { ALL_METHODS, type ProviderMethod } from './live/expectations.ts';
import { Reporter } from './live/report.ts';

describe('Reporter.assertFullCoverage', () => {
  test('fails and names a method with no pass, fail, or skip entry', () => {
    const r = new Reporter();
    r.pass('github', 'validateToken', 'returns a non-empty username');
    // Every other ALL_METHODS entry is deliberately left unrecorded.
    r.assertFullCoverage('github', ALL_METHODS);

    expect(r.exitCode).toBe(1);
    const rendered = r.render();
    expect(rendered).toContain('fetchPullRequests');
    expect(rendered).toContain('coverage');
  });

  test('passes silently when every method has at least one entry', () => {
    const r = new Reporter();
    for (const method of ALL_METHODS) {
      r.pass('github', method, 'exercised');
    }
    r.assertFullCoverage('github', ALL_METHODS);

    expect(r.exitCode).toBe(0);
  });

  test('a skip entry counts as coverage, not just pass or fail', () => {
    const r = new Reporter();
    for (const method of ALL_METHODS) {
      r.skip('github', method, 'not exercised here', 'declared unsupported');
    }
    r.assertFullCoverage('github', ALL_METHODS);

    expect(r.exitCode).toBe(0);
  });

  test('a fail entry counts as coverage: the method still ran, it just failed', () => {
    const r = new Reporter();
    for (const method of ALL_METHODS) {
      r.fail('github', method, 'exercised and failed', 'HTTP 500');
    }
    r.assertFullCoverage('github', ALL_METHODS);

    // exitCode is already 1 from the fail() calls; the point of this test is
    // that assertFullCoverage does not pile on *additional* coverage
    // failures for methods that already have a (failing) entry.
    const coverageFailures = r
      .render()
      .split('\n')
      .filter(line => line.includes('coverage'));
    expect(coverageFailures).toHaveLength(0);
  });

  test('checking one provider does not consult another provider\'s results', () => {
    const r = new Reporter();
    for (const method of ALL_METHODS) {
      r.pass('gitlab', method, 'exercised on gitlab only');
    }
    r.assertFullCoverage('github', ALL_METHODS);

    // Every method is covered on gitlab, none on github: github should
    // report a coverage failure for all of them despite gitlab being clean.
    expect(r.exitCode).toBe(1);
    expect(r.render()).toContain('github');
  });

  test('reports every missing method, not just the first', () => {
    const r = new Reporter();
    const subset: ProviderMethod[] = ['validateToken', 'watchEvents', 'deleteBranch'];
    r.assertFullCoverage('github', subset);

    const rendered = r.render();
    expect(rendered).toContain('validateToken');
    expect(rendered).toContain('watchEvents');
    expect(rendered).toContain('deleteBranch');
  });
});
