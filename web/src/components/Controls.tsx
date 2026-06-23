import { useState } from "react";
import type { LeaderboardResponse, RangePreset } from "../../../shared/types";

export type ViewMode = "table" | "cards";

interface Props {
  range: string;
  onRange: (range: string, start?: string, end?: string) => void;
  trend: boolean;
  onTrend: (v: boolean) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  refreshing: boolean;
  onRefresh: () => void;
  data: LeaderboardResponse | null;
}

const PRESETS: RangePreset[] = ["7d", "30d", "90d"];

export function Controls(props: Props) {
  const { range, onRange, trend, onTrend, view, onView, refreshing, onRefresh, data } = props;
  const [customOpen, setCustomOpen] = useState(range === "custom");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <div className="flex flex-col gap-3 border-b border-white/10 pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setCustomOpen(false); onRange(p); }}
              className={`px-3 py-1.5 text-sm font-medium transition ${
                range === p ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setCustomOpen((o) => !o)}
            className={`px-3 py-1.5 text-sm font-medium transition ${
              range === "custom" ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            Custom
          </button>
        </div>

        <ToggleButton active={trend} onClick={() => onTrend(!trend)}>
          {trend ? "Trend: vs prior" : "Trend: off"}
        </ToggleButton>

        <div className="flex overflow-hidden rounded-lg border border-white/10">
          <button
            onClick={() => onView("table")}
            className={`px-3 py-1.5 text-sm ${view === "table" ? "bg-white/15 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            Table
          </button>
          <button
            onClick={() => onView("cards")}
            className={`px-3 py-1.5 text-sm ${view === "cards" ? "bg-white/15 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            Cards
          </button>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {customOpen && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-slate-400">
            Start
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded bg-white/5 px-2 py-1 text-slate-100" />
          </label>
          <label className="flex flex-col gap-1 text-slate-400">
            End
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded bg-white/5 px-2 py-1 text-slate-100" />
          </label>
          <button
            disabled={!start || !end}
            onClick={() => onRange("custom", new Date(start).toISOString(), new Date(end).toISOString())}
            className="rounded-lg bg-indigo-500 px-3 py-1.5 text-white disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            Scope:{" "}
            <span className="text-slate-300">
              {data.scope.type === "group" ? data.scope.groupPath : `${data.scope.projectPaths?.length ?? 0} projects`}
            </span>
          </span>
          <span>
            Window: <span className="text-slate-300">{fmtDate(data.window.start)} → {fmtDate(data.window.end)}</span>
          </span>
          <span>{data.fromCache ? "cached" : "fresh"}</span>
          {data.hasTrend && <span className="text-indigo-300">trend vs {fmtDate(data.priorWindow!.start)}+</span>}
        </div>
      )}
    </div>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        active ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
