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
  type MetricGroup,
} from "../shared/metrics";

export type Column = MetricDescriptor;

export const COLUMNS: Column[] = METRICS;

export const sortValue = metricValue;
export const deltaValue = metricDelta;
export const rankValue = metricRank;
export { deltaIsGood, formatNumber, formatValue };

/** Display order + presentation metadata per metric group, shared by table/cards/detail. */
export const GROUP_ORDER: MetricGroup[] = ["delivery", "volume", "quality"];

/** `accent` is a Mantine color name, the one source every view reads for a group's tint. */
export const GROUP_META: Record<MetricGroup, { label: string; hint?: string; accent: string }> = {
  delivery: { label: "Delivery", hint: "Linear", accent: "green" },
  volume: { label: "Volume", hint: "gameable", accent: "dimmed" },
  quality: { label: "Quality & consistency", accent: "accent" },
};
