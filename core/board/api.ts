// Thin fetch wrappers over the frozen /api/v1 endpoints, transliterated from
// board.js's apiPut. None of these swallow errors -- a rejected fetch
// propagates to the caller, same as the oracle's raw apiPut.
import type { StatusData } from "./logic.ts";

export function getStatus(): Promise<StatusData> {
  return fetch("/api/v1/status").then((r) => r.json() as Promise<StatusData>);
}

function withJsonBody(path: string, method: string, payload?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (payload !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(payload);
  }
  return fetch(path, init);
}

export function apiPut(path: string, payload: unknown): Promise<Response> {
  return withJsonBody(path, "PUT", payload);
}

export function apiPost(path: string, payload?: unknown): Promise<Response> {
  return withJsonBody(path, "POST", payload);
}

export function apiPatch(path: string, payload: unknown): Promise<Response> {
  return withJsonBody(path, "PATCH", payload);
}

export function apiDelete(path: string): Promise<Response> {
  return fetch(path, { method: "DELETE" });
}

export function setRemote(name: string, enabled: boolean): Promise<Response> {
  return apiPost(`/api/v1/apps/${name}/remote`, { enabled });
}

export function pushRemote(name: string): Promise<Response> {
  return apiPost(`/api/v1/apps/${name}/push`, {});
}
