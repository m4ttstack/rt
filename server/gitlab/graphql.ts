import type { Env } from "../config/index.js";
import { GitLabApiError } from "./errors.js";
import { postGraphql } from "../util/graphql.js";
import type { RawPageInfo } from "./raw-types.js";

/** POST a GraphQL query to the instance. Throws GitLabApiError on transport or query errors. */
export function gqlRequest<T>(
  env: Env,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return postGraphql<T>(
    {
      url: `${env.baseUrl}/api/graphql`,
      headers: { Authorization: `Bearer ${env.token}` },
      label: "GraphQL",
      makeError: (message, status) => new GitLabApiError(message, status),
    },
    query,
    variables,
    signal,
  );
}

export interface Connection<TNode> {
  nodes: TNode[];
  pageInfo: RawPageInfo;
}

/** Walk a cursor-paginated connection to completion (bounded by maxPages). */
export async function collectConnection<TNode>(
  fetchPage: (after: string | null) => Promise<Connection<TNode>>,
  maxPages = 100,
): Promise<TNode[]> {
  const all: TNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const conn: Connection<TNode> = await fetchPage(after);
    all.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return all;
}
