/** Provider-agnostic GraphQL POST transport shared by the GitLab and Linear clients. */

import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from "./http.js";

export interface GraphqlEndpoint {
  url: string;
  headers: Record<string, string>;
  /** Error-message prefix, e.g. "GraphQL" (GitLab) or "Linear". */
  label: string;
  makeError(message: string, status?: number): Error;
}

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * POST a query and unwrap the data envelope. Throws the endpoint's error class on transport
 * or query errors. Stalls and transient server faults are retried under a per-attempt
 * deadline; a query error (a bad field) is final and fails on the first attempt.
 */
export async function postGraphql<T>(
  endpoint: GraphqlEndpoint,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const body = JSON.stringify({ query, variables });

  const json = await withRetry<GqlResponse<T>>(async (attemptSignal) => {
    let res: Response;
    try {
      res = await fetch(endpoint.url, {
        method: "POST",
        headers: { ...endpoint.headers, "Content-Type": "application/json" },
        body,
        signal: attemptSignal,
      });
    } catch (err) {
      throw asRetryable(
        (err as Error).name === "AbortError"
          ? err
          : endpoint.makeError(`${endpoint.label} request failed: ${(err as Error).message}`),
        signal,
      );
    }

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      const error = endpoint.makeError(`${endpoint.label} HTTP ${res.status}: ${text}`, res.status);
      if (isTransientStatus(res.status)) throw new RetryableError(error, retryAfterMs(res));
      throw error;
    }

    try {
      return (await res.json()) as GqlResponse<T>;
    } catch (err) {
      // A body that stalls or truncates mid-stream lands here, not on the fetch above.
      throw asRetryable(err, signal);
    }
  }, { signal });

  // Providers can return partial data alongside field-level errors (e.g. per-field
  // timeouts). Prefer whatever data came back; only throw when there is none at all.
  if (!json.data) {
    const msg = json.errors?.length
      ? `${endpoint.label} errors: ${dedupeMessages(json.errors)}`
      : `${endpoint.label} response had no data`;
    throw endpoint.makeError(msg);
  }
  return json.data;
}

/** Collapse repeated identical error messages so warnings stay readable. */
function dedupeMessages(errors: Array<{ message: string }>): string {
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.message, (counts.get(e.message) ?? 0) + 1);
  return [...counts.entries()]
    .map(([m, n]) => (n > 1 ? `${m} (×${n})` : m))
    .join("; ");
}
