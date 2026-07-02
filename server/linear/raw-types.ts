/** Raw Linear GraphQL shapes ... only the fields we actually request. */

export interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  /** Canonical Linear deep link to the issue. */
  url: string;
  state: { type: string; name: string } | null;
}

export interface RawPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface RawIssueConnection {
  pageInfo: RawPageInfo;
  nodes: RawIssue[];
}

export interface RawWorkflowState {
  name: string;
  type: string;
  team: { key: string; name: string } | null;
}

export interface RawWorkflowStateConnection {
  pageInfo: RawPageInfo;
  nodes: RawWorkflowState[];
}
