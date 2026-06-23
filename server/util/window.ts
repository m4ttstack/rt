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

/** Inclusive-start, exclusive-end membership test for an ISO timestamp. */
export function inWindow(iso: string | null, window: TimeWindow): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(window.start).getTime() && t < new Date(window.end).getTime();
}

/** A short stable key for caching, e.g. "30d:2026-04-29..2026-05-29". */
export function windowCacheKey(window: TimeWindow): string {
  const d = (iso: string) => iso.slice(0, 10);
  return `${window.key}:${d(window.start)}..${d(window.end)}`;
}

export type { RangeKey };
