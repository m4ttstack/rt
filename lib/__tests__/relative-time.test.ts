import { test, expect } from "bun:test";
import { formatRelativeTime } from "../relative-time.ts";

const NOW = new Date("2026-09-19T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW.getTime() - offsetMs).toISOString();

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY, MONTH = 30 * DAY, YEAR = 365 * DAY;

test("formatRelativeTime buckets GHD-style, long form", () => {
  expect(formatRelativeTime(iso(0), NOW)).toBe("just now");
  expect(formatRelativeTime(iso(30 * SEC), NOW)).toBe("just now");
  expect(formatRelativeTime(iso(5 * MIN), NOW)).toBe("5 minutes ago");
  expect(formatRelativeTime(iso(1 * MIN), NOW)).toBe("1 minute ago");
  expect(formatRelativeTime(iso(3 * HOUR), NOW)).toBe("3 hours ago");
  expect(formatRelativeTime(iso(1 * HOUR), NOW)).toBe("1 hour ago");
  expect(formatRelativeTime(iso(1 * DAY + 2 * HOUR), NOW)).toBe("yesterday");
  expect(formatRelativeTime(iso(2 * DAY), NOW)).toBe("2 days ago");
  expect(formatRelativeTime(iso(8 * DAY), NOW)).toBe("last week");
  expect(formatRelativeTime(iso(3 * WEEK), NOW)).toBe("3 weeks ago");
  expect(formatRelativeTime(iso(35 * DAY), NOW)).toBe("last month");
  expect(formatRelativeTime(iso(4 * MONTH), NOW)).toBe("4 months ago");
  expect(formatRelativeTime(iso(1 * YEAR + 10 * DAY), NOW)).toBe("last year");
  expect(formatRelativeTime(iso(3 * YEAR), NOW)).toBe("3 years ago");
});

test("formatRelativeTime returns empty string for an unparseable date", () => {
  expect(formatRelativeTime("", NOW)).toBe("");
  expect(formatRelativeTime("not-a-date", NOW)).toBe("");
});
