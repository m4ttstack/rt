/** Typed shapes of the raw GitLab API responses we consume (only the fields we use). */

export interface RawUserRef {
  username: string | null;
}

export interface RawNoteNode {
  system: boolean;
  createdAt: string;
  author: RawUserRef | null;
  /** Non-null on inline diff notes (DiffNote). */
  position: { __typename?: string } | null;
}

/** Lightweight MR fields from the list pagination (phase 1). */
export interface RawMrListNode {
  iid: string;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  preparedAt?: string | null;
  author: RawUserRef | null;
  project: { fullPath: string } | null;
  sourceBranch: string | null;
}

export interface RawDiffStat {
  path: string;
  additions: number;
  deletions: number;
}

/** Expensive per-MR detail (phase 2). */
export interface RawMrDetail {
  description: string | null;
  diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null;
  diffStats: RawDiffStat[] | null;
  labels: { nodes: Array<{ title: string }> } | null;
  approvedBy: { nodes: RawUserRef[] } | null;
  notes: { nodes: RawNoteNode[] } | null;
}

export interface RawPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface RawMrConnection {
  pageInfo: RawPageInfo;
  nodes: RawMrListNode[];
}

/** REST pipeline list item (the list endpoint does not include the triggering user). */
export interface RawPipeline {
  id: number;
  status: string;
  created_at: string;
}

/** REST user lookup (GET /users?username=). */
export interface RawUser {
  id: number;
  username: string;
  name: string | null;
}

/** REST event (GET /users/:id/events?action=pushed). */
export interface RawEvent {
  action_name?: string;
  created_at: string;
  project_id?: number;
}
