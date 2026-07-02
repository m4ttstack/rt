import { LinearApiError } from "./errors.js";
import { postGraphql } from "../util/graphql.js";
import type { RawIssueConnection } from "./raw-types.js";

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

/**
 * POST a GraphQL query to Linear. The personal API key goes in the Authorization header
 * verbatim (no "Bearer" prefix ... that is Linear's convention). Throws LinearApiError on
 * transport or query errors.
 */
export function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return postGraphql<T>(
    {
      url: LINEAR_ENDPOINT,
      headers: { Authorization: apiKey },
      label: "Linear",
      makeError: (message, status) => new LinearApiError(message, status),
    },
    query,
    variables,
    signal,
  );
}

/**
 * Walk a cursor-paginated `issues` connection to completion (bounded by maxPages).
 * `fetchPage` returns one connection given the previous cursor.
 */
export async function collectIssues(
  fetchPage: (after: string | null) => Promise<RawIssueConnection>,
  maxPages = 100,
): Promise<RawIssueConnection["nodes"]> {
  const all: RawIssueConnection["nodes"] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const conn = await fetchPage(after);
    all.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return all;
}
