import type { RefreshProgress as Progress } from "../../../shared/types";

interface Props {
  progress: Progress | null;
  onCancel: () => void;
}

const PHASE_LABEL: Record<Progress["phase"], string> = {
  users: "Resolving users",
  "mrs-list": "Listing merge requests",
  "mrs-detail": "Fetching MR details",
  pipelines: "Fetching pipelines",
  pushes: "Fetching push events",
  linear: "Fetching Linear issues",
  compute: "Computing metrics",
};

export function RefreshProgress({ progress, onCancel }: Props) {
  const label = progress ? (progress.label || PHASE_LABEL[progress.phase]) : "Starting…";
  const determinate = !!progress && progress.total > 0;
  const pct = determinate ? Math.round((progress.done / progress.total) * 100) : null;
  const windowHint = progress?.window === "prior" ? " · trend window (2 of 2)" : "";

  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm">
      <span className="font-medium text-foreground">
        Refreshing · {label}
        {windowHint}
      </span>

      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-background">
        {determinate ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
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
