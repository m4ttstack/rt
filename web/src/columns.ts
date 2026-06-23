/**
 * The UI's view of metric metadata is just the shared single-source-of-truth, re-exported
 * with display formatting. Ranking/classification now comes from the server (each metric
 * carries a `rank`), so the UI never computes "who's #1" itself.
 */
import {
  METRICS,
  deltaIsGood,
  metricDelta,
  metricRank,
  metricValue,
  type MetricDescriptor,
} from "../../shared/metrics";

export type Column = MetricDescriptor;

export const COLUMNS: Column[] = METRICS;

export const sortValue = metricValue;
export const deltaValue = metricDelta;
export const rankValue = metricRank;
export { deltaIsGood };

export function formatValue(value: number | null, col: Column): string {
  if (value === null) return "—";
  if (col.kind === "dist") return `${formatNumber(value)}h`;
  if (col.percent) return `${Math.round(value * 100)}%`;
  return formatNumber(value) + (col.unit ?? "");
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
