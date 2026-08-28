import { expect, test } from 'vitest';

import { dayKey, dayLabel } from './day-label';

const now = new Date(2026, 7, 26, 20, 0).getTime();
const days = (n: number) => now - n * 86_400_000;

test('dayLabel names today, yesterday, then the weekday and date, with the year only when it differs', () => {
  expect(dayLabel(now, now)).toBe('Today');
  expect(dayLabel(days(1), now)).toBe('Yesterday');
  expect(dayLabel(days(2), now)).toBe('Mon 24 Aug');
  expect(dayLabel(new Date(2025, 11, 31, 9, 0).getTime(), now)).toBe(
    'Wed 31 Dec 2025'
  );
});

test('dayKey follows the local calendar, not a 24h window', () => {
  const lateTonight = new Date(2026, 7, 26, 23, 59).getTime();
  const earlyTomorrow = new Date(2026, 7, 27, 0, 1).getTime();
  expect(dayKey(lateTonight)).not.toBe(dayKey(earlyTomorrow));
  expect(dayKey(lateTonight)).toBe(dayKey(now));
});
