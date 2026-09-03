import { useEffect, useRef, useState } from "react";
import type { RefreshProgress as Progress } from "../../../shared/types";
import { progressKey, stallNotice } from "../lib/progress";

interface Props {
  progress: Progress | null;
  onCancel: () => void;
}

export function RefreshProgress({ progress, onCancel }: Props) {
  // The server sends a human label with every progress event; phase is the raw fallback.
  const label = progress ? (progress.label || progress.phase) : "Starting…";
  const determinate = !!progress && progress.total > 0;
  const pct = determinate ? Math.round((progress.done / progress.total) * 100) : null;

  // A single stalled request holds the count still. Without this the bar looks healthy the
  // whole time and there's no way to tell "working" from "wedged".
  const stalled = stallNotice(useIdleMs(progressKey(progress)));

  return (
    <div
      className={`mt-4 flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm ${
        stalled ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted"
      }`}
    >
      <span className="font-medium text-foreground">Refreshing · {label}</span>

      {stalled && (
        <span className="whitespace-nowrap text-xs text-amber-700 dark:text-amber-300/90">
          {stalled}
        </span>
      )}

      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-background">
        {determinate ? (
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              stalled ? "animate-pulse bg-amber-500" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-primary/70" />
        )}
      </div>

      {determinate && (
        <span className="tabular-nums text-xs text-muted-foreground">
          {progress.done}/{progress.total}
        </span>
      )}

      <button
        onClick={onCancel}
        className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  );
}

/** Milliseconds since `key` last changed, re-rendering once a second while it holds. */
function useIdleMs(key: string): number {
  const changedAt = useRef(Date.now());
  const [idleMs, setIdleMs] = useState(0);

  useEffect(() => {
    changedAt.current = Date.now();
    setIdleMs(0);
  }, [key]);

  useEffect(() => {
    const timer = setInterval(() => setIdleMs(Date.now() - changedAt.current), 1_000);
    return () => clearInterval(timer);
  }, []);

  return idleMs;
}
