/**
 * Normalized, source-agnostic model that the metric layer operates on.
 * The fetch pipeline (GraphQL + REST) maps raw GitLab responses into these shapes,
 * so the pure metric functions never touch GitLab-specific field names.
 */

export type MrState = "merged" | "opened" | "closed" | "locked";

export interface NormNote {
  /** null when the note author can't be resolved (deleted user, etc.). */
  authorUsername: string | null;
  createdAt: string;
  /** GitLab system notes (status changes) ... excluded from review signals. */
  system: boolean;
  /** Inline diff comment (GraphQL: position != null; REST: type === "DiffNote"). */
  inline: boolean;
}

export interface NormMr {
  iid: number;
  projectPath: string;
  authorUsername: string | null;
  state: MrState;
  createdAt: string;
  /** When the MR left draft, if known. Preferred clock-start for latency. */
  preparedAt: string | null;
  mergedAt: string | null;
  title: string;
  labels: string[];
  additions: number;
  deletions: number;
  fileCount: number;
  /** Usernames who approved (may be empty on free tier / when inaccessible). */
  approvedByUsernames: string[];
  notes: NormNote[];
}

export interface NormPipeline {
  projectPath: string;
  username: string | null;
  /** GitLab pipeline status: success | failed | canceled | running | ... */
  status: string;
  createdAt: string;
}

export interface NormPushEvent {
  username: string;
  createdAt: string;
}

/** Everything the metric layer needs, already filtered to scope (not yet to window). */
export interface FetchResult {
  mrs: NormMr[];
  pipelines: NormPipeline[];
  pushEvents: NormPushEvent[];
  /** Whether approval data was actually available (drives the tier-fallback note). */
  approvalsAvailable: boolean;
}
