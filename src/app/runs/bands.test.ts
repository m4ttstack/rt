import { describe, expect, it } from 'vitest';

import { bandFor, sortBand, type BoardRun } from './bands';

// `status` values are rt's real vocabulary and nothing else: pipeline-state.sh
// writes `running` at start and accepts only done|failed|abandoned to close.
// There is no `succeeded`.
const run = (over: Partial<BoardRun>): BoardRun => ({
  id: 'r',
  repo: 'repo-tools',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'running',
  current_stage: null,
  // NULL means INTERACTIVE. --spawned-by carries a surface name (e.g.
  // "shepherdr job x") and is passed only when the run was NOT interactive.
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  last_event_at: 0,
  ticket: null,
  branch: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  seen: false,
  ...over,
});

describe('bandFor', () => {
  it('puts anything rt flags into attention, whatever its status', () => {
    const r = run({
      status: 'done',
      attention: { needs: true, reason: 'stranded', evidence: 'x' },
    });

    expect(bandFor(r)).toBe('attention');
  });

  it('keeps unflagged live runs in running and finished ones in finished', () => {
    expect(bandFor(run({ status: 'running' }))).toBe('running');
    expect(bandFor(run({ status: 'done', ended_at: 5 }))).toBe('finished');
  });
});

describe('sortBand', () => {
  it('orders by silence: longest since last event first', () => {
    const noisy = run({ id: 'noisy', last_event_at: 100 });
    const quiet = run({ id: 'quiet', last_event_at: 1 });

    expect(sortBand([noisy, quiet]).map(r => r.id)).toEqual(['quiet', 'noisy']);
  });

  it('sinks seen-but-unresolved rows to the bottom without hiding them', () => {
    const seenQuiet = run({ id: 'seen', last_event_at: 1, seen: true });
    const unseenNoisy = run({ id: 'unseen', last_event_at: 100 });

    expect(sortBand([seenQuiet, unseenNoisy]).map(r => r.id)).toEqual([
      'unseen',
      'seen',
    ]);
  });

  it('sinks live INTERACTIVE runs (spawned_by null) below batch runs', () => {
    const interactive = run({ id: 'tty', last_event_at: 1, spawned_by: null });
    const batch = run({
      id: 'batch',
      last_event_at: 100,
      spawned_by: 'shepherdr job nightly',
    });

    expect(sortBand([interactive, batch]).map(r => r.id)).toEqual([
      'batch',
      'tty',
    ]);
  });

  it('does not sink a FINISHED interactive run -- nobody is watching it any more', () => {
    const finishedTty = run({
      id: 'tty',
      last_event_at: 1,
      spawned_by: null,
      ended_at: 9,
    });
    const batch = run({
      id: 'batch',
      last_event_at: 100,
      spawned_by: 'shepherdr job nightly',
    });

    expect(sortBand([finishedTty, batch]).map(r => r.id)).toEqual([
      'tty',
      'batch',
    ]);
  });
});
