import type { LeaderboardResponse, UserRow } from "../../../shared/types";
import { COLUMNS, type Column, deltaIsGood, deltaValue, formatValue, sortValue } from "../columns";
import { MetricTip } from "./MetricTip";
import { Tooltip } from "./Tooltip";

interface Props {
  data: LeaderboardResponse;
  trend: boolean;
}

export function MetricCards({ data, trend }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {COLUMNS.map((col) => (
        <Card key={col.key} col={col} users={data.users} trend={trend} />
      ))}
    </div>
  );
}

function Card({ col, users, trend }: { col: Column; users: UserRow[]; trend: boolean }) {
  const ranked = [...users]
    .filter((u) => u.resolved && sortValue(u.metrics, col) !== null)
    .sort((a, b) => {
      const va = sortValue(a.metrics, col)!;
      const vb = sortValue(b.metrics, col)!;
      return col.better === "asc" ? va - vb : vb - va;
    });

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-200">
          <Tooltip content={<MetricTip col={col} />}>{col.label}</Tooltip>
        </h3>
        <span className={`text-[10px] uppercase tracking-wide ${col.group === "volume" ? "text-slate-500" : "text-indigo-300/70"}`}>
          {col.group === "volume" ? "volume" : "quality"}
        </span>
      </div>
      <ol className="space-y-1.5">
        {ranked.map((u, i) => {
          const d = trend ? deltaValue(u.metrics, col) : null;
          return (
            <li key={u.username} className={`flex items-center justify-between text-sm ${u.isCurrentUser ? "text-indigo-200" : "text-slate-300"}`}>
              <span className="flex items-center gap-2">
                <span className="w-4 text-right text-xs text-slate-500">{i + 1}</span>
                <span className={u.isCurrentUser ? "font-semibold" : ""}>{u.name ?? u.username}</span>
              </span>
              <span className="flex items-center gap-2 font-mono tabular-nums">
                <span>{formatValue(sortValue(u.metrics, col), col)}</span>
                {d !== null && d !== 0 && (
                  <span className={`text-xs ${deltaIsGood(d, col.better) ? "text-emerald-400" : "text-rose-400"}`}>
                    {d > 0 ? "▲" : "▼"}
                    {formatValue(Math.abs(d), col)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {ranked.length === 0 && <li className="text-xs text-slate-500">No data.</li>}
      </ol>
    </div>
  );
}
