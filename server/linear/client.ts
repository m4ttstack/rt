import { LinearApiError } from "./errors.js";
import { postGraphql } from "../util/graphql.js";

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
