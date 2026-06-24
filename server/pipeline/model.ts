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

/** A Linear issue, keyed back to the canonical GitLab username via the email map. */
export interface NormLinearIssue {
  id: string;
  /** Human-facing key, e.g. "ENG-123". */
  identifier: string;
  title: string;
  /** Canonical Linear deep link. */
  url: string;
  /** The configured GitLab username this issue's assignee resolved to. null = unmapped. */
  assignedUser: string | null;
  createdAt: string;
  /** null when the issue is not yet completed. */
  completedAt: string | null;
  /** Linear team key, e.g. "ENG". */
  teamKey: string;
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
