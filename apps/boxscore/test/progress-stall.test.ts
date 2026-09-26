import { describe, expect, it } from 'vitest';

import {
  progressKey,
  REQUEST_DEADLINE_MS,
  STALL_AFTER_MS,
  stallNotice,
} from '../src/app/lib/progress.js';
import type { RefreshProgress } from '../src/shared/types.js';

const at = (
  done: number,
  over: Partial<RefreshProgress> = {}
): RefreshProgress => ({
  phase: 'mrs-detail',
  label: 'Fetching MR details (752 cached, 134 new)',
  done,
  total: 134,
  window: 'current',
  ...over,
});

describe('progressKey', () => {
  it('holds steady while the count does, and changes when it moves', () => {
    expect(progressKey(at(133))).toBe(progressKey(at(133)));
    expect(progressKey(at(133))).not.toBe(progressKey(at(134)));
  });

  it('separates the same count in a different phase, label, or trend window', () => {
    const base = progressKey(at(133));
    expect(progressKey(at(133, { phase: 'pipelines' }))).not.toBe(base);
    expect(
      progressKey(at(133, { label: 'Fetching MR details (0 cached, 134 new)' }))
    ).not.toBe(base);
    expect(progressKey(at(133, { window: 'prior' }))).not.toBe(base);
  });

  it('has a key for no-progress-yet', () => {
    expect(progressKey(null)).toBe('');
  });
});

describe('stallNotice', () => {
  it('stays quiet while a refresh is merely working', () => {
    expect(stallNotice(0)).toBeNull();
    expect(stallNotice(STALL_AFTER_MS - 1)).toBeNull();
  });

  it('reports the stall once the reading stops moving', () => {
    expect(stallNotice(STALL_AFTER_MS)).toBe('stalled 20s');
  });

  it('says it is retrying only once the request deadline has certainly passed', () => {
    expect(stallNotice(REQUEST_DEADLINE_MS - 1_000)).toBe('stalled 29s');
    expect(stallNotice(REQUEST_DEADLINE_MS)).toBe('stalled 30s · retrying');
    expect(stallNotice(95_000)).toBe('stalled 95s · retrying');
  });
});
