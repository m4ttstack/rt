import { describe, expect, it } from 'vitest';

import { unitOf } from './units';

describe('unitOf', () => {
  it('reads the unit off the key or field name', () => {
    expect(unitOf('rt.runsPruneDays')).toBe('days');
    expect(unitOf('rt.gates.escalationTtlMinutes')).toBe('min');
    expect(unitOf('herd.watchdog.fastMins')).toBe('min');
    expect(unitOf('janitorIntervalMin')).toBe('min');
    expect(unitOf('debounceSec')).toBe('sec');
    expect(unitOf('janitorThresholdHours')).toBe('hours');
    expect(unitOf('rt.apiPort')).toBeNull();
  });
});
