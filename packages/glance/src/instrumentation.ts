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

/**
 * Wrap a gitbeaker client so every `gb.<Resource>.<method>()` call reports
 * through the hook. gitbeaker's preset requester is not injectable from
 * @gitbeaker/rest, so we instrument at the resource-method boundary instead:
 * one logical op per call (internal retries are invisible, matching the
 * SDK's logical-operation counting unit). Success status is reported as 200
 * (gitbeaker returns parsed bodies, not responses); failures extract the
 * real status from GitbeakerRequestError's structured cause when present.
 */
export function instrumentGitbeaker<T extends object>(gb: T, emit: (info: RequestInfo) => void): T {
  const resourceCache = new Map<PropertyKey, unknown>();
  return new Proxy(gb, {
    get(target, resourceName, receiver) {
      const resource = Reflect.get(target, resourceName, receiver);
      if (resource === null || typeof resource !== 'object') return resource;
      const cached = resourceCache.get(resourceName);
      if (cached) return cached;
      const methodCache = new Map<PropertyKey, unknown>();
      const proxied = new Proxy(resource as object, {
        get(res, methodName) {
          const fn = Reflect.get(res, methodName);
          if (typeof fn !== 'function') return fn;
          const cachedFn = methodCache.get(methodName);
          if (cachedFn) return cachedFn;
          const op = `gb.${String(resourceName)}.${String(methodName)}`;
          const wrapped = async (...args: unknown[]) => {
            const started = performance.now();
            const base = {
              op,
              transport: 'rest' as const,
              method: String(methodName),
              path: String(resourceName),
            };
            try {
              const out = await (fn as (...a: unknown[]) => Promise<unknown>).apply(res, args);
              emit({ ...base, durationMs: performance.now() - started, status: 200 });
              return out;
            } catch (err) {
              const status =
                (err as { cause?: { response?: { status?: number } } })?.cause?.response?.status ?? 0;
              emit({ ...base, durationMs: performance.now() - started, status });
              throw err;
            }
          };
          methodCache.set(methodName, wrapped);
          return wrapped;
        },
      });
      resourceCache.set(resourceName, proxied);
      return proxied;
    },
  }) as T;
}
