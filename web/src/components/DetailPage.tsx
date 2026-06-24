import { useEffect, useMemo, useState } from "react";
import type { MetricGroup } from "../../../shared/metrics";
import type { MetricKey, UserDetailResponse } from "../../../shared/types";
import { fetchDetail } from "../api";
import {
  COLUMNS,
  type Column,
  deltaIsGood,
  deltaValue,
  formatValue,
  rankValue,
  sortValue,
} from "../columns";
import { navigateHome } from "../hooks/useHashRoute";
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

const GROUPS: { key: MetricGroup; label: string; accent: string }[] = [
  { key: "volume", label: "Volume", accent: "text-slate-400" },
  { key: "quality", label: "Quality & consistency", accent: "text-indigo-300/70" },
  { key: "delivery", label: "Delivery (Linear)", accent: "text-emerald-300/70" },
];

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

  // Keep the focused tab in sync if the deep-linked stat changes (navigating between people).
  useEffect(() => {
    if (validInitial) setSelected(validInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, initialStat]);

  const col = useMemo(() => COLUMNS.find((c) => c.key === selected) ?? COLUMNS[0]!, [selected]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <button
        onClick={navigateHome}
        className="mb-4 text-sm text-slate-400 hover:text-slate-100"
      >
        ← Back to leaderboard
      </button>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <strong>Error:</strong> {error}
        </div>
      )}
      {loading && !data && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <header className="mb-5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">
              {data.user.name ?? data.user.username}
              {data.user.isCurrentUser && (
                <span className="ml-2 rounded bg-indigo-500/30 px-1.5 py-0.5 text-xs text-indigo-200">you</span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              @{data.user.username} · {data.window.start.slice(0, 10)} → {data.window.end.slice(0, 10)}
              {data.hasTrend && " · trend on"}
              {!data.user.resolved && <span className="ml-2 text-amber-400">unresolved on GitLab</span>}
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
            <ul className="overflow-hidden rounded-lg border border-white/10">
              {cols.map((c) => {
                const value = sortValue(data.user.metrics, c);
                const rank = rankValue(data.user.metrics, c);
                const active = c.key === selected;
                return (
                  <li key={c.key}>
                    <button
                      onClick={() => onSelect(c.key)}
                      className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                        active ? "bg-indigo-500/15 text-indigo-100" : "text-slate-300 hover:bg-white/[0.03]"
                      }`}
                    >
                      <span className="truncate">{c.label}</span>
                      <span className="shrink-0 font-mono tabular-nums text-slate-200">
                        {formatValue(value, c)}
                        {rank !== null && <span className="ml-1 text-[10px] text-slate-500">#{rank}</span>}
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
          <h2 className="text-lg font-semibold text-slate-100">{col.label}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{col.description}</p>
        </div>
        <div className="flex items-baseline gap-3 font-mono tabular-nums">
          <span className="text-2xl text-slate-100">{formatValue(value, col)}</span>
          {rank !== null && <span className="text-sm text-slate-400">#{rank}</span>}
          {delta !== null && delta !== 0 && (
            <span className={`text-sm ${deltaIsGood(delta, col.better) ? "text-emerald-400" : "text-rose-400"}`}>
              {delta > 0 ? "▲" : "▼"} {formatValue(Math.abs(delta), col)}
            </span>
          )}
        </div>
      </div>

      {evidence?.summary && <p className="mb-2 text-sm text-slate-400">{evidence.summary}</p>}
      <EvidenceTable evidence={evidence} />
    </section>
  );
}
