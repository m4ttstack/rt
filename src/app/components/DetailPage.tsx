import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import type { MetricKey, UserDetailResponse } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { fetchDetail } from "../api";
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
import { navigateHome } from "../hooks/useHashRoute";
import { Badge } from "@/components/ui/badge";
import { DeltaBadge } from "./DeltaBadge";
import { EvidenceTable } from "./EvidenceTable";

interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

interface Props {
  username: string;
  initialStat: string | null;
  range: RangeState;
  trend: boolean;
}

const GROUPS = GROUP_ORDER.map((key) => {
  const meta = GROUP_META[key];
  return { key, label: meta.hint ? `${meta.label} (${meta.hint})` : meta.label, accent: meta.accent };
});

export function DetailPage({ username, initialStat, range, trend }: Props) {
  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validInitial = COLUMNS.some((c) => c.key === initialStat) ? (initialStat as MetricKey) : null;
  const [selected, setSelected] = useState<MetricKey>(validInitial ?? COLUMNS[0]!.key);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDetail(username, { ...range, trend })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [username, range, trend]);

  useEffect(() => {
    if (validInitial) setSelected(validInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, initialStat]);

  const col = useMemo(() => COLUMNS.find((c) => c.key === selected) ?? COLUMNS[0]!, [selected]);

  return (
    <div className="mx-auto max-w-[96rem] px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={navigateHome} className="-ml-2 text-muted-foreground">
          <ArrowLeft /> Back to leaderboard
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      )}
      {loading && !data && <p className="text-muted-foreground">Loading…</p>}

      {data && (
        <>
          <header className="mb-5">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              {data.user.name ?? data.user.username}
              {data.user.isCurrentUser && <Badge>you</Badge>}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              @{data.user.username} · {data.window.start.slice(0, 10)} → {data.window.end.slice(0, 10)}
              {data.hasTrend && " · trend on"}
              {!data.user.resolved && <span className="ml-2 text-amber-500">unresolved on GitLab</span>}
            </p>
          </header>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-[16rem_1fr]">
            <StatRail data={data} selected={selected} onSelect={setSelected} />
            <EvidencePanel data={data} col={col} trend={trend} />
          </div>
        </>
      )}
    </div>
  );
}

function StatRail({
  data,
  selected,
  onSelect,
}: {
  data: UserDetailResponse;
  selected: MetricKey;
  onSelect: (k: MetricKey) => void;
}) {
  return (
    <nav className="space-y-4 self-start md:sticky md:top-6">
      {GROUPS.map((g) => {
        const cols = COLUMNS.filter((c) => c.group === g.key);
        if (cols.length === 0) return null;
        return (
          <div key={g.key}>
            <div className={`mb-1 text-[10px] uppercase tracking-wide ${g.accent}`}>{g.label}</div>
            <ul className="overflow-hidden rounded-lg border">
              {cols.map((c) => {
                const value = sortValue(data.user.metrics, c);
                const rank = rankValue(data.user.metrics, c);
                const active = c.key === selected;
                return (
                  <li key={c.key}>
                    <button
                      onClick={() => onSelect(c.key)}
                      className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                        active ? "bg-primary/15 text-primary" : "text-foreground/90 hover:bg-muted"
                      }`}
                    >
                      <span className="truncate">{c.label}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {formatValue(value, c)}
                        {rank !== null && <span className="ml-1 text-[10px] text-muted-foreground">#{rank}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function EvidencePanel({ data, col, trend }: { data: UserDetailResponse; col: Column; trend: boolean }) {
  const value = sortValue(data.user.metrics, col);
  const rank = rankValue(data.user.metrics, col);
  const delta = trend ? deltaValue(data.user.metrics, col) : null;
  const evidence = data.evidence[col.key];

  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{col.label}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{col.description}</p>
        </div>
        <div className="flex items-baseline gap-3 font-mono tabular-nums">
          <span className="text-2xl text-foreground">{formatValue(value, col)}</span>
          {rank !== null && <span className="text-sm text-muted-foreground">#{rank}</span>}
          {delta !== null && delta !== 0 && <DeltaBadge delta={delta} col={col} className="text-sm" />}
        </div>
      </div>

      {evidence?.summary && <p className="mb-2 text-sm text-muted-foreground">{evidence.summary}</p>}
      <EvidenceTable evidence={evidence} />
    </section>
  );
}
