import type { Env } from "../env.js";
import { GitLabApiError } from "./errors.js";
import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from "../util/http.js";

export type QueryParams = Record<string, string | number | undefined>;

function buildUrl(env: Env, path: string, query: QueryParams): string {
  const url = new URL(`${env.baseUrl}/api/v4${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

interface RestPage<T> {
  body: T;
  nextPage: number | null;
}

/**
 * One page GET. Stalls and transient faults (429/5xx) are retried under a per-attempt
 * deadline; a 4xx is final. Every call here is a read, so a retry is always safe.
 */
async function restGet<T>(
  env: Env,
  path: string,
  query: QueryParams,
  signal?: AbortSignal,
): Promise<RestPage<T>> {
  const url = buildUrl(env, path, query);

  return withRetry<RestPage<T>>(async (attemptSignal) => {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "PRIVATE-TOKEN": env.token }, signal: attemptSignal });
    } catch (err) {
      throw asRetryable(
        (err as Error).name === "AbortError"
          ? err
          : new GitLabApiError(`REST request failed: ${(err as Error).message}`),
        signal,
      );
    }

    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      const error = new GitLabApiError(`REST HTTP ${res.status} for ${path}: ${body}`, res.status);
      if (isTransientStatus(res.status)) throw new RetryableError(error, retryAfterMs(res));
      throw error;
    }

    const next = res.headers.get("x-next-page");
    try {
      return { body: (await res.json()) as T, nextPage: next ? Number(next) : null };
    } catch (err) {
      throw asRetryable(err, signal);
    }
  }, { signal });
}

/** Single-page GET (caller doesn't care about pagination). */
export async function restGetOne<T>(
  env: Env,
  path: string,
  query: QueryParams = {},
  signal?: AbortSignal,
): Promise<T> {
  return (await restGet<T>(env, path, query, signal)).body;
}

/** GET a list endpoint across all pages (per_page=100), bounded by maxPages. */
export async function restGetAll<T>(
  env: Env,
  path: string,
  query: QueryParams = {},
  maxPages = 50,
  signal?: AbortSignal,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const { body, nextPage } = await restGet<T[]>(env, path, { per_page: 100, page, ...query }, signal);
    all.push(...body);
    if (!nextPage) break;
    page = nextPage;
  }
  return all;
}

/** URL-encode a "group/project" full path for use as a REST :id segment. */
export function encodePath(fullPath: string): string {
  return encodeURIComponent(fullPath);
}
