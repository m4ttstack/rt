import { LinearApiError } from "./errors.js";
import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from "../util/http.js";

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * POST a GraphQL query to Linear and unwrap the data envelope. The personal API key goes
 * in the Authorization header verbatim (no "Bearer" prefix ... that is Linear's convention).
 * Stalls and transient server faults are retried under a per-attempt deadline; a query
 * error (a bad field) is final and fails on the first attempt.
 */
export async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const body = JSON.stringify({ query, variables });

  const json = await withRetry<GqlResponse<T>>(async (attemptSignal) => {
    let res: Response;
    try {
      res = await fetch(LINEAR_ENDPOINT, {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body,
        signal: attemptSignal,
      });
    } catch (err) {
      throw asRetryable(
        (err as Error).name === "AbortError"
          ? err
          : new LinearApiError(`Linear request failed: ${(err as Error).message}`),
        signal,
      );
    }

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      const error = new LinearApiError(`Linear HTTP ${res.status}: ${text}`, res.status);
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

  // Linear can return partial data alongside field-level errors; prefer whatever data came
  // back and only throw when there is none at all.
  if (!json.data) {
    const msg = json.errors?.length
      ? `Linear errors: ${dedupeMessages(json.errors)}`
      : "Linear response had no data";
    throw new LinearApiError(msg);
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
