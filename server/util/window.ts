import type { RangeKey, RangePreset, TimeWindow } from "../../shared/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_DAYS: Record<RangePreset, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function isPreset(value: string): value is RangePreset {
  return value === "7d" || value === "30d" || value === "90d";
}

/** Resolve a preset (relative to `now`) into a concrete window. */
export function resolvePreset(preset: RangePreset, now: Date): TimeWindow {
  const end = now;
  const start = new Date(end.getTime() - PRESET_DAYS[preset] * DAY_MS);
  return { start: start.toISOString(), end: end.toISOString(), key: preset };
}

/** Days fetched in one envelope. The 90d preset's prior window is why trend needs 180. */
const BASE_DAYS = { plain: 90, trend: 180 } as const;

/**
 * The single wide window every preset is sliced out of. Width is uniform rather than
 * per-preset so switching presets never refetches; toggling trend costs one refetch.
 */
export function baseWindow(trend: boolean, now: Date): TimeWindow {
  const d = trend ? BASE_DAYS.trend : BASE_DAYS.plain;
  return {
    start: new Date(now.getTime() - d * DAY_MS).toISOString(),
    end: now.toISOString(),
    key: `base${d}`,
  };
}

/** True when `inner`'s day-range lies within `outer`'s (day-granular, matching the cache key). */
export function covers(outer: TimeWindow, inner: TimeWindow): boolean {
  const day = (iso: string) => Date.parse(iso.slice(0, 10));
  return day(inner.start) >= day(outer.start) && day(inner.end) <= day(outer.end);
}

/** Build a custom window from explicit ISO bounds. */
export function customWindow(startIso: string, endIso: string): TimeWindow {
  return { start: startIso, end: endIso, key: "custom" };
}

/** The equal-length window immediately preceding `window`, for trend deltas. */
export function priorWindow(window: TimeWindow): TimeWindow {
  const start = new Date(window.start).getTime();
  const end = new Date(window.end).getTime();
  const length = end - start;
  const priorEnd = new Date(start);
  const priorStart = new Date(start - length);
  return {
    start: priorStart.toISOString(),
    end: priorEnd.toISOString(),
    key: window.key,
  };
}

// inWindow runs in per-note/per-MR loops, so the window's bounds are parsed once
// per TimeWindow object instead of on every call.
const boundsCache = new WeakMap<TimeWindow, [number, number]>();

function windowBounds(window: TimeWindow): [number, number] {
  let b = boundsCache.get(window);
  if (!b) {
    b = [Date.parse(window.start), Date.parse(window.end)];
    boundsCache.set(window, b);
  }
  return b;
}

/** Inclusive-start, exclusive-end membership test for an ISO timestamp. */
export function inWindow(iso: string | null, window: TimeWindow): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const [start, end] = windowBounds(window);
  return t >= start && t < end;
}

/**
 * Resolve range/start/end params (HTTP query or CLI flags) into a window.
 * Custom bounds are validated: both present, parseable, start before end.
 */
export function resolveWindowArgs(
  range: string | undefined,
  start: string | undefined,
  end: string | undefined,
  defaultRange: RangePreset,
): TimeWindow {
  if (range === "custom" || (start && end)) {
    if (!start || !end) throw new Error("custom range requires both start and end (ISO dates)");
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      throw new Error("start and end must be valid ISO dates");
    }
    if (Date.parse(start) >= Date.parse(end)) throw new Error("start must be before end");
    return customWindow(new Date(start).toISOString(), new Date(end).toISOString());
  }
  const preset: RangePreset = range && isPreset(range) ? range : defaultRange;
  return resolvePreset(preset, new Date());
}

/** A short stable key for caching, e.g. "30d:2026-04-29..2026-05-29". */
export function windowCacheKey(window: TimeWindow): string {
  const d = (iso: string) => iso.slice(0, 10);
  return `${window.key}:${d(window.start)}..${d(window.end)}`;
}

export type { RangeKey };
