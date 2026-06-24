/** Raw Linear GraphQL shapes ... only the fields we actually request. */

export interface RawPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  /** Canonical Linear deep link to the issue. */
  url: string;
  createdAt: string;
  completedAt: string | null;
  /** null when the issue is unassigned. */
  assignee: { email: string | null } | null;
  team: { key: string } | null;
}

export interface RawIssueConnection {
  pageInfo: RawPageInfo;
  nodes: RawIssue[];
}

/** Linear's IssueFilter input, built server-side and passed as a query variable. */
export interface IssueFilter {
  completedAt: { gte: string; lte: string };
  assignee: { email: { in: string[] } };
}
