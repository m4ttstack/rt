import { useLocation } from "wouter";
import type { LeaderboardResponse, UserRow } from "../../shared/types";
import { COLUMNS, type Column, GROUP_META, deltaValue, formatValue, rankValue, sortValue } from "../columns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DeltaBadge } from "./DeltaBadge";
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
        <Card key={col.key}>
          <CardHeader className="flex-row items-baseline justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              <Tooltip content={<MetricTip col={col} />}>{col.label}</Tooltip>
            </h3>
            <span className={`text-[10px] uppercase tracking-wide ${GROUP_META[col.group].accent}`}>
              {col.group}
            </span>
          </CardHeader>
          <CardContent>
            <Ranking col={col} users={data.users} trend={trend} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Ranking({ col, users, trend }: { col: Column; users: UserRow[]; trend: boolean }) {
  const [, setLocation] = useLocation();
  // Order and position come from the server-computed rank (ties share a rank),
  // so the cards never disagree with the table or the detail rail.
  const ranked = [...users]
    .filter((u) => u.resolved && sortValue(u.metrics, col) !== null)
    .sort((a, b) => (rankValue(a.metrics, col) ?? 99) - (rankValue(b.metrics, col) ?? 99));

  if (ranked.length === 0) return <p className="text-xs text-muted-foreground">No data.</p>;

  return (
    <ol className="space-y-0.5">
      {ranked.map((u) => {
        const d = trend ? deltaValue(u.metrics, col) : null;
        return (
          <li key={u.username}>
            <button
              onClick={() => setLocation(`/user/${encodeURIComponent(u.username)}/${encodeURIComponent(col.key)}`)}
              className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-sm hover:bg-muted ${
                u.isCurrentUser ? "text-primary" : "text-foreground/90"
              }`}
              title={`${u.name ?? u.username} · ${col.label} details`}
            >
              <span className="flex items-center gap-2">
                <span className="w-4 text-right text-xs text-muted-foreground">{rankValue(u.metrics, col) ?? "—"}</span>
                <span className={u.isCurrentUser ? "font-semibold" : ""}>{u.name ?? u.username}</span>
              </span>
              <span className="flex items-center gap-2 font-mono tabular-nums">
                <span>{formatValue(sortValue(u.metrics, col), col)}</span>
                {d !== null && d !== 0 && <DeltaBadge delta={d} col={col} className="text-xs" />}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
