/** Pure statistical helpers used across the metric layer. */

/** Linear-interpolated percentile of an unsorted sample. p in [0,1]. null if empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

/** Arithmetic mean; 0 for an empty sample. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * GitLab bot / service accounts that comment automatically (resource access tokens,
 * group/project bots, CI bots). They post non-system notes seconds after MR creation,
 * which would otherwise dominate "first review" timing and reviewer counts.
 */
export function isBotUsername(username: string | null): boolean {
  if (!username) return false;
  const u = username.toLowerCase();
  return (
    /^(project|group)_\d+_bot/.test(u) ||
    u.includes("_bot_") ||
    u.endsWith("_bot") ||
    u === "ghost"
  );
}

/** UTC calendar-day key (YYYY-MM-DD) for an ISO timestamp. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StreakResult {
  distinct: number;
  current: number;
  longest: number;
}

/**
 * Given ISO timestamps, compute distinct active days, the longest consecutive-day
 * run, and the current streak (the run that ends on the most recent active day).
 */
export function streaks(timestamps: readonly string[]): StreakResult {
  const keys = [...new Set(timestamps.map(dayKey))].sort();
  if (keys.length === 0) return { distinct: 0, current: 0, longest: 0 };

  const dayNums = keys.map((k) => Math.round(Date.parse(`${k}T00:00:00Z`) / DAY_MS));

  let longest = 1;
  let run = 1;
  for (let i = 1; i < dayNums.length; i++) {
    run = dayNums[i]! - dayNums[i - 1]! === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // Current streak = trailing consecutive run ending at the latest active day.
  let current = 1;
  for (let i = dayNums.length - 1; i > 0; i--) {
    if (dayNums[i]! - dayNums[i - 1]! === 1) current++;
    else break;
  }

  return { distinct: keys.length, current, longest };
}

/** Round to a fixed number of decimals (avoids float noise in the wire payload). */
export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
