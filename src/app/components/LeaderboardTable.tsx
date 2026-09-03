import { useMemo, useState } from "react";
import type { LeaderboardResponse, UserRow } from "../../shared/types";
import {
  COLUMNS,
  type Column,
  GROUP_META,
  GROUP_ORDER,
  deltaValue,
  formatValue,
  rankValue,
  sortValue,
} from "../columns";
import { DeltaBadge } from "./DeltaBadge";
import { navigateToUser } from "../hooks/useHashRoute";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      if (va === null) return 1;
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

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-background">Person</TableHead>
            {GROUP_ORDER.map((g) => {
              const cols = COLUMNS.filter((c) => c.group === g);
              if (cols.length === 0) return null;
              const meta = GROUP_META[g];
              return (
                <TableHead key={g} colSpan={cols.length} className={`border-l ${meta.accent}`}>
                  {meta.label}
                  {meta.hint && (
                    <>
                      {" "}
                      <span className="font-normal text-muted-foreground/60">({meta.hint})</span>
                    </>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-background">Name</TableHead>
            {COLUMNS.map((col, i) => (
              <TableHead
                key={col.key}
                className={`text-right ${i > 0 && COLUMNS[i - 1]!.group !== col.group ? "border-l" : ""} ${
                  col.key === sortKey ? "text-foreground" : ""
                }`}
              >
                <Tooltip content={<MetricTip col={col} />}>
                  <span className="cursor-pointer hover:text-foreground" onClick={() => onSort(col)}>
                    {col.label}
                    {col.key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </span>
                </Tooltip>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Row key={row.username} row={row} trend={trend} sortKey={sortKey} />
          ))}
          {rows.length === 0 && (
            <TableRow>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                No users configured, or none resolved on the instance.
              </td>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function Row({ row, trend, sortKey }: { row: UserRow; trend: boolean; sortKey: string }) {
  return (
    <TableRow className={`${row.isCurrentUser ? "bg-primary/10 hover:bg-primary/15" : ""} ${row.resolved ? "" : "opacity-50"}`}>
      <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 align-middle">
        <button
          onClick={() => navigateToUser(row.username, sortKey)}
          className="text-left hover:underline"
          title="View this person's stat details"
        >
          <span className={row.isCurrentUser ? "font-semibold text-primary" : "text-foreground"}>
            {row.name ?? row.username}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">@{row.username}</span>
        </button>
        {!row.resolved && <span className="ml-2 text-[10px] text-amber-500">unresolved</span>}
      </td>
      {COLUMNS.map((col, i) => {
        const borderL = i > 0 && COLUMNS[i - 1]!.group !== col.group ? "border-l" : "";
        return (
          <td
            key={col.key}
            onClick={() => navigateToUser(row.username, col.key)}
            className={`cursor-pointer whitespace-nowrap px-3 py-2 text-right align-middle font-mono tabular-nums hover:bg-primary/10 ${borderL}`}
            title={`${row.name ?? row.username} · ${col.label} details`}
          >
            <Cell row={row} col={col} trend={trend} rank={rankValue(row.metrics, col) ?? undefined} />
          </td>
        );
      })}
    </TableRow>
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
    if (d === null || d === 0) return <span className="text-muted-foreground">{d === 0 ? "→ 0" : "—"}</span>;
    return <DeltaBadge delta={d} col={col} />;
  }

  const v = sortValue(row.metrics, col);
  const cell = row.metrics[col.key];
  const p90 = col.kind === "dist" ? (cell as { p90: number | null }).p90 : null;
  return (
    <span title={p90 !== null ? `p90: ${p90}h` : undefined}>
      <span className="text-foreground">{formatValue(v, col)}</span>
      {row.isCurrentUser && rank !== undefined && (
        <Badge variant="secondary" className="ml-1.5 bg-primary/15 px-1 py-0 text-[10px] text-primary">
          #{rank}
        </Badge>
      )}
    </span>
  );
}
