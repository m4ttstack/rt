import type { Column } from "../columns";

/** Tooltip body for a metric: name, what it measures, and which direction is better. */
export function MetricTip({ col }: { col: Column }) {
  return (
    <>
      <div className="font-semibold text-slate-100">{col.label}</div>
      <div className="mt-1 text-slate-300">{col.description}</div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        {col.better === "asc" ? "↓ lower is better" : "↑ higher is better"} · {col.group}
      </div>
    </>
  );
}
