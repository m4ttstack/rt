/**
 * Issues completed within a window, by assignee email. Filtering happens server-side via
 * the IssueFilter variable so we page over exactly the issues we care about ... not the
 * whole org's history.
 */
export const COMPLETED_ISSUES_QUERY = /* GraphQL */ `
  query CompletedIssues($after: String, $filter: IssueFilter) {
    issues(first: 100, after: $after, filter: $filter) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        title
        url
        createdAt
        completedAt
        assignee {
          email
        }
        team {
          key
        }
      }
    }
  }
`;
