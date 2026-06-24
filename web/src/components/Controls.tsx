import { useState } from "react";
import { RefreshCw } from "lucide-react";

import type { LeaderboardResponse, RangePreset } from "../../../shared/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ViewMode = "table" | "cards";

interface Props {
  range: string;
  /** Persisted custom-window bounds (ISO), used to pre-fill the date inputs after a reload. */
  start?: string;
  end?: string;
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

/** <input type="date"> wants YYYY-MM-DD; the persisted bounds are full ISO timestamps. */
const toDateInput = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : "");

export function Controls(props: Props) {
  const { range, start: initialStart, end: initialEnd, onRange, trend, onTrend, view, onView, refreshing, onRefresh, data } = props;
  const [customOpen, setCustomOpen] = useState(range === "custom");
  const [start, setStart] = useState(() => toDateInput(initialStart));
  const [end, setEnd] = useState(() => toDateInput(initialEnd));

  return (
    <div className="flex flex-col gap-3 border-b pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={range === p ? "default" : "outline"}
              onClick={() => {
                setCustomOpen(false);
                onRange(p);
              }}
            >
              {p}
            </Button>
          ))}
          <Button
            size="sm"
            variant={range === "custom" ? "default" : "outline"}
            onClick={() => setCustomOpen((o) => !o)}
          >
            Custom
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="trend" checked={trend} onCheckedChange={onTrend} />
          <label htmlFor="trend" className="cursor-pointer text-sm text-muted-foreground">
            Trend vs prior
          </label>
        </div>

        <Tabs value={view} onValueChange={(v) => onView(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="cards">Cards</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} className="ml-auto">
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {customOpen && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-muted-foreground">
            Start
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground">
            End
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <Button
            size="sm"
            disabled={!start || !end}
            onClick={() => onRange("custom", new Date(start).toISOString(), new Date(end).toISOString())}
          >
            Apply
          </Button>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Scope:{" "}
            <span className="text-foreground">
              {data.scope.type === "group" ? data.scope.groupPath : `${data.scope.projectPaths?.length ?? 0} projects`}
            </span>
          </span>
          <span>
            Window:{" "}
            <span className="text-foreground">
              {fmtDate(data.window.start)} → {fmtDate(data.window.end)}
            </span>
          </span>
          <span>{data.fromCache ? "cached" : "fresh"}</span>
          {data.hasTrend && <span className="text-primary">trend vs {fmtDate(data.priorWindow!.start)}+</span>}
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
