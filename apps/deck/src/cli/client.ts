// src/cli/client.ts
import { resolveApiInfo } from './api-info.ts';

export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const info = resolveApiInfo();
  if (!info) {
    throw new Error(
      "Deck isn't running. Start it with `deck serve` or install it with `deck setup`."
    );
  }
  return fetch(`http://127.0.0.1:${info.port}${path}`, init);
}

export async function apiJson(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const res = await apiFetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
