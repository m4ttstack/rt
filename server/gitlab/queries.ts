/**
 * GraphQL query strings. THIS IS THE FILE TO TWEAK if field/argument names differ
 * on your GitLab version (spec section 4 ... verify against <baseUrl>/-/graphql-explorer).
 *
 * Two-phase strategy (so a busy monorepo doesn't time out GitLab's per-field resolvers):
 *   1. Paginate a LIGHTWEIGHT MR list ... only cheap scalar fields. Sorted UPDATED_DESC,
 *      stopped client-side once MRs fall before the window. No diffStats/notes/labels here.
 *   2. Fetch the EXPENSIVE per-MR detail (diffStatsSummary, notes, labels, approvedBy)
 *      one MR at a time, concurrently. A single MR's diff stats resolve well within the
 *      field timeout; 50 at once do not.
 */

const MR_LIST_FIELDS = `
  iid
  title
  state
  createdAt
  updatedAt
  mergedAt
  author { username }
  project { fullPath }
  sourceBranch
`;

export const GROUP_MRS_QUERY = `
query GroupMRs($fullPath: ID!, $after: String, $updatedAfter: Time) {
  group(fullPath: $fullPath) {
    mergeRequests(includeSubgroups: true, sort: UPDATED_DESC, first: 100, after: $after, updatedAfter: $updatedAfter) {
      pageInfo { hasNextPage endCursor }
      nodes { ${MR_LIST_FIELDS} }
    }
  }
}`;

export const PROJECT_MRS_QUERY = `
query ProjectMRs($fullPath: ID!, $after: String, $updatedAfter: Time) {
  project(fullPath: $fullPath) {
    mergeRequests(sort: UPDATED_DESC, first: 100, after: $after, updatedAfter: $updatedAfter) {
      pageInfo { hasNextPage endCursor }
      nodes { ${MR_LIST_FIELDS} }
    }
  }
}`;

/** Heavy per-MR detail, fetched one MR at a time (concurrency-capped). */
export const MR_DETAIL_QUERY = `
query MrDetail($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    mergeRequest(iid: $iid) {
      description
      diffStatsSummary { additions deletions fileCount }
      diffStats { path additions deletions }
      labels { nodes { title } }
      approvedBy { nodes { username } }
      notes(first: 100) {
        nodes {
          system
          createdAt
          author { username }
          position { __typename }
        }
      }
    }
  }
}`;

export const GROUP_PROJECTS_QUERY = `
query GroupProjects($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    projects(includeSubgroups: true, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { fullPath }
    }
  }
}`;
