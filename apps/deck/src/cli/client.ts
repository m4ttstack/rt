// src/cli/client.ts
import { bundleRootFromExec } from '../services/bundle-layout.ts';
import {
  deckStartHint,
  liveProbe,
  type Probe,
} from '../services/helper-owner.ts';
import { resolveApiInfo } from './api-info.ts';

export async function deckNotRunning(
  probe: Probe = liveProbe,
  bundleRoot: string | null = bundleRootFromExec()
): Promise<string> {
  return `Deck isn't running. ${await deckStartHint(probe, bundleRoot)}`;
}

export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const info = resolveApiInfo();
  if (!info) throw new Error(await deckNotRunning());
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
