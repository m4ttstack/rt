import type { Env } from "../env.js";
import { GitLabApiError } from "./errors.js";
import type { RawPageInfo } from "./raw-types.js";

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/** POST a GraphQL query to the instance. Throws GitLabApiError on transport or query errors. */
export async function gqlRequest<T>(
  env: Env,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new GitLabApiError(`GraphQL request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new GitLabApiError(`GraphQL HTTP ${res.status}: ${body}`, res.status);
  }

  const json = (await res.json()) as GqlResponse<T>;
  // GitLab returns partial data alongside field-level errors (e.g. per-field timeouts).
  // Prefer using whatever data came back; only throw when there is no data at all.
  if (!json.data) {
    const msg = json.errors?.length
      ? `GraphQL errors: ${dedupeMessages(json.errors)}`
      : "GraphQL response had no data";
    throw new GitLabApiError(msg);
  }
  return json.data;
}

/** Collapse repeated identical GraphQL error messages so warnings stay readable. */
function dedupeMessages(errors: Array<{ message: string }>): string {
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.message, (counts.get(e.message) ?? 0) + 1);
  return [...counts.entries()]
    .map(([m, n]) => (n > 1 ? `${m} (×${n})` : m))
    .join("; ");
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
