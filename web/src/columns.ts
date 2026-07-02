/**
 * The UI's view of metric metadata is just the shared single-source-of-truth, re-exported
 * with display formatting. Ranking/classification now comes from the server (each metric
 * carries a `rank`), so the UI never computes "who's #1" itself.
 */
import {
  METRICS,
  deltaIsGood,
  formatNumber,
  formatValue,
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
export { deltaIsGood, formatNumber, formatValue };
