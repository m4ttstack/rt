/**
 * GitHub-Desktop-style long-form relative time ("2 days ago", "last
 * month"), for the mission branch dropdown's per-row date column.
 *
 * Distinct from lib/tui/utils/label.ts's timeAgo (compact "5m ago", no
 * month/year bucketing) and lib/mission/git-actions.ts's formatFetchMeta
 * ("Last fetched X ago", days-only capped) -- neither produces GHD's
 * long-form phrasing with week/month/year buckets, so this is its own
 * small formatter rather than a third divergent variant bolted onto
 * either of them.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  const diff = Math.max(0, now.getTime() - then);

  if (diff < MIN) return "just now";
  if (diff < HOUR) {
    const n = Math.floor(diff / MIN);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  if (diff < 2 * DAY) return "yesterday";
  if (diff < WEEK) {
    const n = Math.floor(diff / DAY);
    return `${n} days ago`;
  }
  if (diff < 2 * WEEK) return "last week";
  if (diff < MONTH) {
    const n = Math.floor(diff / WEEK);
    return `${n} weeks ago`;
  }
  if (diff < 2 * MONTH) return "last month";
  if (diff < YEAR) {
    const n = Math.floor(diff / MONTH);
    return `${n} months ago`;
  }
  if (diff < 2 * YEAR) return "last year";
  const n = Math.floor(diff / YEAR);
  return `${n} years ago`;
}
