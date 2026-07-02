/**
 * All workflow states across every team (or filtered to one team). Used by the settings
 * page so the user can pick which state names count as "done" for issuesCompleted.
 * 500 is enough to cover ~40 teams × ~18 states without pagination.
 */
export const WORKFLOW_STATES_QUERY = /* GraphQL */ `
  query WorkflowStates($filter: WorkflowStateFilter) {
    workflowStates(first: 500, filter: $filter) {
      nodes {
        name
        type
        team {
          key
          name
        }
      }
    }
  }
`;
