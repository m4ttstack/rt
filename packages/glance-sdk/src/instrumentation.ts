/**
 * Request instrumentation for the SDK's four HTTP transports (GraphQL
 * runQuery, the gitbeaker REST client, restRequest, and the standalone
 * fetchers). Consumers pass `onRequest` to receive one callback per logical
 * SDK operation; `op` is the SDK-level label ("fetchPullRequests.project",
 * "gb.MergeRequests.merge", ...) since raw {method, path} cannot distinguish
 * GraphQL operations (all POST /api/graphql).
 */

export interface RequestInfo {
  op: string;
  transport: 'graphql' | 'rest';
  method: string;
  path: string;
  durationMs: number;
  status: number;
}

export type OnRequestHook = (info: RequestInfo) => void;

/** Invoke the hook without letting a consumer bug break the request path. */
export function safeEmit(hook: OnRequestHook | undefined, info: RequestInfo): void {
  if (!hook) return;
  try {
    hook(info);
  } catch {
    // A broken observer must never fail an API call.
  }
}
