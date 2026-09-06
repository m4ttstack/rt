/**
 * Normalized, source-agnostic model that the metric layer operates on.
 * The fetch pipeline (GraphQL + REST) maps raw GitLab responses into these shapes,
 * so the pure metric functions never touch GitLab-specific field names.
 */

export type MrState = 'merged' | 'opened' | 'closed' | 'locked';

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
  /** Last GitLab update. The fetch's window predicate scopes on this, so slicing must too. */
  updatedAt: string;
  /** When the MR left draft, if known. Preferred clock-start for latency. */
  preparedAt: string | null;
  mergedAt: string | null;
  title: string;
  /** Branch name + description, for Linear ticket detection. */
  sourceBranch: string | null;
  description: string | null;
  labels: string[];
  additions: number;
  deletions: number;
  fileCount: number;
  /** Usernames who approved (may be empty on free tier / when inaccessible). */
  approvedByUsernames: string[];
  notes: NormNote[];
  /** Per-file diff stats for file-pattern exclusion at compute time. */
  diffStats: { path: string; additions: number; deletions: number }[];
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

/** A Linear issue verified to exist, linked from a merged MR. */
export interface NormLinearIssue {
  id: string;
  /** Human-facing key, e.g. "ENG-123". */
  identifier: string;
  title: string;
  /** Canonical Linear deep link. */
  url: string;
  /** The GitLab username of the MR author who merged the MR linking this ticket. */
  assignedUser: string | null;
  /** MR(s) that referenced this ticket (iid + projectPath so evidence can build deep links). */
  linkedMrs: { iid: number; projectPath: string }[];
  /** Current Linear state. */
  stateType: string | null;
  stateName: string | null;
}

/** Everything the metric layer needs, already filtered to scope (not yet to window). */
export interface FetchResult {
  mrs: NormMr[];
  pipelines: NormPipeline[];
  pushEvents: NormPushEvent[];
  /** Linear issues for the configured people. Empty when Linear is unconfigured. */
  linearIssues: NormLinearIssue[];
  /** Whether approval data was actually available (drives the tier-fallback note). */
  approvalsAvailable: boolean;
}

/** A configured username resolved against the GitLab instance. */
export interface UserIdentity {
  username: string;
  name: string | null;
  resolved: boolean;
  /** GitLab numeric id, used internally for the per-user events endpoint. */
  userId?: number;
}
