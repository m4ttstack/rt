import { LinearApiError } from "./errors.js";
import type { RawIssueConnection } from "./raw-types.js";

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * POST a GraphQL query to Linear. The personal API key goes in the Authorization header
 * verbatim (no "Bearer" prefix ... that is Linear's convention). Throws LinearApiError on
 * transport or query errors.
 */
export async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(LINEAR_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new LinearApiError(`Linear request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new LinearApiError(`Linear HTTP ${res.status}: ${body}`, res.status);
  }

  const json = (await res.json()) as GqlResponse<T>;
  if (!json.data) {
    const msg = json.errors?.length
      ? `Linear errors: ${json.errors.map((e) => e.message).join("; ")}`
      : "Linear response had no data";
    throw new LinearApiError(msg);
  }
  return json.data;
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
