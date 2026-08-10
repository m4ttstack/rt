/**
 * When the canary finds the proxy serving stale routes, restart it without
 * waiting to be asked.
 *
 * Restarting drops every in-flight .localhost connection for a few seconds, so
 * the policy is deliberately cautious: only on a positive "stale" answer (never
 * on an inconclusive one), at most once per cooldown, and it stops trying
 * entirely once restarts have failed to help. Those guards are what keep a
 * false positive from turning into a restart loop.
 */
import type { Freshness } from "./canary.ts";

export const MIN_HEAL_INTERVAL_MS = 10 * 60_000;
/** After this many restarts that did not resync, stop and leave it to a human. */
export const MAX_CONSECUTIVE_FAILURES = 2;

export interface HealState {
  freshness: Freshness;
  now: number;
  lastHealAt: number;
  consecutiveFailures: number;
  enabled: boolean;
}

export function shouldAutoHeal(s: HealState): boolean {
  if (!s.enabled) return false;
  // "unknown" means the proxy could not be reached, which is not evidence of a
  // dead watcher. Restarting on it would punish an unrelated outage.
  if (s.freshness !== "stale") return false;
  if (s.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return false;
  if (s.now - s.lastHealAt < MIN_HEAL_INTERVAL_MS) return false;
  return true;
}
