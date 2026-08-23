import { describe, expect, it } from 'vitest';

import { matchRun, parseQuery } from './search';

// ticket and branch ride RunSummary itself -- they are NOT reachable through
// a `fields` map, which exists only on RunDetail.
const run = {
  id: 'run-1',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'failed',
  ticket: 'RT-44',
  branch: 'feat/events-bus',
};

describe('matchRun', () => {
  it('matches on ticket, branch, repo, verb, and status', () => {
    for (const q of [
      'RT-44',
      'events-bus',
      'repo-tools',
      'implement',
      'failed',
    ]) {
      expect(matchRun(run, parseQuery(q)), q).toBe(true);
    }
  });

  it('is case-insensitive and matches on substrings', () => {
    expect(matchRun(run, parseQuery('rt-4'))).toBe(true);
    expect(matchRun(run, parseQuery('EVENTS'))).toBe(true);
  });

  it('requires every term, so terms narrow rather than widen', () => {
    expect(matchRun(run, parseQuery('repo-tools failed'))).toBe(true);
    expect(matchRun(run, parseQuery('repo-tools succeeded'))).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(matchRun(run, parseQuery('   '))).toBe(true);
  });

  // `run.ticket` is null on every real run today -- nothing in the pipeline
  // writes one -- so the run id is the only thing an operator can actually
  // search by until a ticket field exists.
  it('matches on a partial run id even with no ticket recorded', () => {
    const untracked = { ...run, id: 'run-abc123', ticket: null };
    expect(matchRun(untracked, parseQuery('run-abc123'))).toBe(true);
    expect(matchRun(untracked, parseQuery('abc123'))).toBe(true);
  });
});
