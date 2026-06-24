import type { Column } from "../columns";

/** Tooltip body for a metric: name, what it measures, and which direction is better. */
export function MetricTip({ col }: { col: Column }) {
  return (
    <>
      <div className="font-semibold text-popover-foreground">{col.label}</div>
      <div className="mt-1 text-muted-foreground">{col.description}</div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {col.better === "asc" ? "↓ lower is better" : "↑ higher is better"} · {col.group}
      </div>
    </>
  );
}
