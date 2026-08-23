import { describe, expect, it } from 'vitest';

import { agingWarning, daysUntilPrune } from './aging';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000_000 * DAY_MS;

describe('daysUntilPrune', () => {
  it('anchors a finished run on ended_at', () => {
    const run = {
      ended_at: NOW - 28 * DAY_MS,
      last_event_at: NOW - 29 * DAY_MS,
    };
    expect(daysUntilPrune(run, 30, NOW)).toBe(2);
  });

  it('anchors a still-running run on last_event_at', () => {
    const run = { ended_at: null, last_event_at: NOW - 29 * DAY_MS };
    expect(daysUntilPrune(run, 30, NOW)).toBe(1);
  });
});

describe('agingWarning', () => {
  it('is null when the prune-days setting has not loaded yet', () => {
    const run = {
      ended_at: NOW - 29 * DAY_MS,
      last_event_at: NOW - 29 * DAY_MS,
    };
    expect(agingWarning(run, undefined, NOW)).toBeNull();
  });

  it('is null while comfortably inside the retention window', () => {
    const run = { ended_at: NOW - 5 * DAY_MS, last_event_at: NOW - 5 * DAY_MS };
    expect(agingWarning(run, 30, NOW)).toBeNull();
  });

  it('names the day count once inside the warning threshold', () => {
    const run = {
      ended_at: NOW - 28 * DAY_MS,
      last_event_at: NOW - 28 * DAY_MS,
    };
    expect(agingWarning(run, 30, NOW)).toBe('ages out in 2 days');
  });

  it('singularizes at exactly one day left', () => {
    const run = {
      ended_at: NOW - 29 * DAY_MS,
      last_event_at: NOW - 29 * DAY_MS,
    };
    expect(agingWarning(run, 30, NOW)).toBe('ages out in 1 day');
  });

  it('is null once the run is already past the floor -- rt prunes it, not this warning', () => {
    const run = {
      ended_at: NOW - 31 * DAY_MS,
      last_event_at: NOW - 31 * DAY_MS,
    };
    expect(agingWarning(run, 30, NOW)).toBeNull();
  });
});
