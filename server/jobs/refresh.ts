import { randomUUID } from "node:crypto";
import { getLeaderboard } from "../leaderboard.js";
import type {
  LeaderboardResponse,
  RefreshJobStatus,
  RefreshProgress,
  RefreshStatusResponse,
  TimeWindow,
} from "../../shared/types.js";

/** What the client asked to refresh, echoed back so it can match results to its current view. */
export interface RefreshSelection {
  range: string;
  start?: string;
  end?: string;
  trend: boolean;
}

export interface RefreshRequest {
  window: TimeWindow;
  trend: boolean;
  selection: RefreshSelection;
}

export interface RefreshJob {
  id: string;
  status: RefreshJobStatus;
  progress: RefreshProgress | null;
  startedAt: string;
  selection: RefreshSelection;
  result?: LeaderboardResponse;
  error?: string;
  controller: AbortController;
}

/** The slice of getLeaderboard the job needs. Injectable so tests avoid the network. */
type Runner = (opts: {
  window: TimeWindow;
  refresh: true;
  trend: boolean;
  signal: AbortSignal;
  onProgress: (p: RefreshProgress) => void;
}) => Promise<LeaderboardResponse>;

// Single-operator app: at most one job exists at a time.
let currentJob: RefreshJob | null = null;

export function startRefresh(req: RefreshRequest, run: Runner = getLeaderboard): RefreshJob {
  if (currentJob && currentJob.status === "running") return currentJob;

  const controller = new AbortController();
  const job: RefreshJob = {
    id: randomUUID().slice(0, 8),
    status: "running",
    progress: null,
    startedAt: new Date().toISOString(),
    selection: req.selection,
    controller,
  };
  currentJob = job;

  void run({
    window: req.window,
    refresh: true,
    trend: req.trend,
    signal: controller.signal,
    onProgress: (p) => { job.progress = p; },
  }).then(
    (result) => { job.status = "done"; job.result = result; },
    (err) => {
      if ((err as Error).name === "AbortError") {
        job.status = "cancelled";
      } else {
        job.status = "error";
        job.error = (err as Error).message;
      }
    },
  );

  return job;
}

export function getRefresh(id: string): RefreshJob | null {
  return currentJob && currentJob.id === id ? currentJob : null;
}

export function cancelRefresh(id: string): RefreshJob | null {
  const job = getRefresh(id);
  if (job && job.status === "running") {
    job.controller.abort();
    // Flip to a terminal state synchronously. The run's rejection handler also sets
    // "cancelled" once the AbortError unwinds, but doing it here closes the race where a
    // re-click between abort() and that rejection would see status "running" and re-attach
    // the aborting job; it also makes the cancel response report "cancelled" immediately.
    job.status = "cancelled";
  }
  return job;
}

/** Serialize a job to the wire response (drops the AbortController). */
export function toStatusResponse(job: RefreshJob): RefreshStatusResponse {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === "done" && job.result !== undefined ? { result: job.result } : {}),
  };
}

/** Test-only: clear the singleton between cases. */
export function __resetJobs(): void {
  currentJob = null;
}
