import type { LeaderboardResponse, UserRow } from "../../../shared/types";
import { COLUMNS, type Column, deltaIsGood, deltaValue, formatValue, sortValue } from "../columns";
import { navigateToUser } from "../hooks/useHashRoute";
import { MetricTip } from "./MetricTip";
import { Tooltip } from "./Tooltip";

interface Props {
  data: LeaderboardResponse;
  trend: boolean;
}

const GROUP_STYLE: Record<string, string> = {
  volume: "text-slate-500",
  quality: "text-indigo-300/70",
  delivery: "text-emerald-300/70",
};

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
        <span className={`text-[10px] uppercase tracking-wide ${GROUP_STYLE[col.group] ?? "text-slate-500"}`}>
          {col.group}
        </span>
      </div>
      <ol className="space-y-1.5">
        {ranked.map((u, i) => {
          const d = trend ? deltaValue(u.metrics, col) : null;
          return (
            <li key={u.username}>
              <button
                onClick={() => navigateToUser(u.username, col.key)}
                className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-sm hover:bg-white/[0.04] ${u.isCurrentUser ? "text-indigo-200" : "text-slate-300"}`}
                title={`${u.name ?? u.username} · ${col.label} details`}
              >
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
              </button>
            </li>
          );
        })}
        {ranked.length === 0 && <li className="text-xs text-slate-500">No data.</li>}
      </ol>
    </div>
  );
}
