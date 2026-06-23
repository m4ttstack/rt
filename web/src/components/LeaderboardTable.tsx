import { useMemo, useState } from "react";
import type { LeaderboardResponse, UserRow } from "../../../shared/types";
import {
  COLUMNS,
  type Column,
  deltaIsGood,
  deltaValue,
  formatValue,
  rankValue,
  sortValue,
} from "../columns";
import { MetricTip } from "./MetricTip";
import { Tooltip } from "./Tooltip";

interface Props {
  data: LeaderboardResponse;
  trend: boolean;
}

export function LeaderboardTable({ data, trend }: Props) {
  const [sortKey, setSortKey] = useState<string>("mrsMerged");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortCol = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0]!;

  const rows = useMemo(() => {
    const copy = [...data.users];
    copy.sort((a, b) => {
      const va = sortValue(a.metrics, sortCol);
      const vb = sortValue(b.metrics, sortCol);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls last
      if (vb === null) return -1;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return copy;
  }, [data.users, sortCol, sortDir]);

  const onSort = (col: Column) => {
    if (col.key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col.key);
      setSortDir(col.better === "asc" ? "asc" : "desc");
    }
  };

  const volume = COLUMNS.filter((c) => c.group === "volume");
  const quality = COLUMNS.filter((c) => c.group === "quality");

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 bg-[#0b0e14] px-3 py-2 text-left">Person</th>
            <th colSpan={volume.length} className="border-l border-white/10 px-3 py-2 text-left text-slate-400">
              Volume <span className="font-normal text-slate-600">(gameable)</span>
            </th>
            <th colSpan={quality.length} className="border-l border-white/10 px-3 py-2 text-left text-indigo-300/70">
              Quality &amp; consistency
            </th>
          </tr>
          <tr className="border-b border-white/10 text-xs text-slate-400">
            <th className="sticky left-0 bg-[#0b0e14] px-3 py-2 text-left font-medium">Name</th>
            {COLUMNS.map((col, i) => (
              <th
                key={col.key}
                className={`select-none px-3 py-2 text-right font-medium ${
                  i > 0 && COLUMNS[i - 1]!.group !== col.group ? "border-l border-white/10" : ""
                } ${col.key === sortKey ? "text-slate-100" : ""}`}
              >
                <Tooltip content={<MetricTip col={col} />}>
                  <span className="cursor-pointer hover:text-slate-100" onClick={() => onSort(col)}>
                    {col.label}
                    {col.key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </span>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.username} row={row} trend={trend} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-500">
                No users configured, or none resolved on the instance.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, trend }: { row: UserRow; trend: boolean }) {
  return (
    <tr
      className={`border-b border-white/5 last:border-0 ${
        row.isCurrentUser ? "bg-indigo-500/10" : "hover:bg-white/[0.03]"
      } ${row.resolved ? "" : "opacity-50"}`}
    >
      <td className={`sticky left-0 px-3 py-2 ${row.isCurrentUser ? "bg-[#141a2b]" : "bg-[#0b0e14]"}`}>
        <span className={row.isCurrentUser ? "font-semibold text-indigo-200" : "text-slate-200"}>
          {row.name ?? row.username}
        </span>
        <span className="ml-1 text-xs text-slate-500">@{row.username}</span>
        {!row.resolved && <span className="ml-2 text-[10px] text-amber-400">unresolved</span>}
      </td>
      {COLUMNS.map((col, i) => {
        const borderL = i > 0 && COLUMNS[i - 1]!.group !== col.group ? "border-l border-white/10" : "";
        return (
          <td key={col.key} className={`px-3 py-2 text-right font-mono tabular-nums ${borderL}`}>
            <Cell row={row} col={col} trend={trend} rank={rankValue(row.metrics, col) ?? undefined} />
          </td>
        );
      })}
    </tr>
  );
}

function Cell({
  row,
  col,
  trend,
  rank,
}: {
  row: UserRow;
  col: Column;
  trend: boolean;
  rank: number | undefined;
}) {
  if (trend) {
    const d = deltaValue(row.metrics, col);
    if (d === null || d === 0) return <span className="text-slate-500">{d === 0 ? "→ 0" : "—"}</span>;
    const good = deltaIsGood(d, col.better);
    const arrow = d > 0 ? "▲" : "▼";
    return (
      <span className={good ? "text-emerald-400" : "text-rose-400"}>
        {arrow} {formatValue(Math.abs(d), col)}
      </span>
    );
  }

  const v = sortValue(row.metrics, col);
  const cell = row.metrics[col.key];
  const p90 = col.kind === "dist" ? (cell as { p90: number | null }).p90 : null;
  return (
    <span title={p90 !== null ? `p90: ${p90}h` : undefined}>
      <span className="text-slate-100">{formatValue(v, col)}</span>
      {row.isCurrentUser && rank !== undefined && (
        <span className="ml-1.5 rounded bg-indigo-500/30 px-1 text-[10px] text-indigo-200">#{rank}</span>
      )}
    </span>
  );
}
