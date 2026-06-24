import type { Env } from "../env.js";
import { GitLabApiError } from "./errors.js";

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

async function restGet<T>(
  env: Env,
  path: string,
  query: QueryParams,
  signal?: AbortSignal,
): Promise<RestPage<T>> {
  let res: Response;
  try {
    res = await fetch(buildUrl(env, path, query), {
      headers: { "PRIVATE-TOKEN": env.token },
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new GitLabApiError(`REST request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new GitLabApiError(`REST HTTP ${res.status} for ${path}: ${body}`, res.status);
  }
  const next = res.headers.get("x-next-page");
  return {
    body: (await res.json()) as T,
    nextPage: next ? Number(next) : null,
  };
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
