import { describe, expect, test } from 'bun:test';

import { emptyMrMemory, rollDay } from '../triage/memory.ts';

describe('rollDay', () => {
  test('resets the daily counters on a new day and keeps edge memory', () => {
    const m = {
      ...emptyMrMemory('2026-08-08'),
      attemptsToday: 3,
      budgetEscalatedDay: '2026-08-08',
      lastHandledPipelineId: 42,
    };
    const rolled = rollDay(m, '2026-08-09');
    expect(rolled.attemptsToday).toBe(0);
    expect(rolled.budgetEscalatedDay).toBeNull();
    expect(rolled.dayStamp).toBe('2026-08-09');
    expect(rolled.lastHandledPipelineId).toBe(42);
    expect(rollDay(m, '2026-08-08')).toEqual(m); // same day: unchanged
  });
});
