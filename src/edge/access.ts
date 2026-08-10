// src/edge/access.ts — stub. Task 4.6 replaces this whole file with the real
// CF Access driver; the endpoint's import path never changes.
import type { AccessTier } from "./access-tiers.ts";
import type { ApiDeps } from "../api/server.ts";

export async function syncAccessTier(
  _app: string,
  _tier: AccessTier,
  _deps: ApiDeps,
): Promise<{ ok: boolean }> {
  return { ok: true };
}
