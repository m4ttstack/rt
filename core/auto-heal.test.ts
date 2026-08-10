import { test, expect } from "bun:test";

import {
  shouldAutoHeal,
  MAX_CONSECUTIVE_FAILURES,
  MIN_HEAL_INTERVAL_MS,
  type HealState,
} from "./auto-heal.ts";

const base: HealState = {
  freshness: "stale",
  now: 1_000_000_000,
  lastHealAt: 0,
  consecutiveFailures: 0,
  enabled: true,
};

test("heals when the proxy is definitely stale", () => {
  expect(shouldAutoHeal(base)).toBe(true);
});

test("never heals on a healthy proxy", () => {
  expect(shouldAutoHeal({ ...base, freshness: "fresh" })).toBe(false);
});

test("never heals on an inconclusive check", () => {
  // An unreachable proxy is not evidence of a dead watcher: restarting then
  // would punish an unrelated outage.
  expect(shouldAutoHeal({ ...base, freshness: "unknown" })).toBe(false);
});

test("respects the cooldown, so a flapping check cannot cause a restart loop", () => {
  const justHealed = { ...base, lastHealAt: base.now - 1000 };
  expect(shouldAutoHeal(justHealed)).toBe(false);
  const cooledDown = { ...base, lastHealAt: base.now - MIN_HEAL_INTERVAL_MS - 1 };
  expect(shouldAutoHeal(cooledDown)).toBe(true);
});

test("gives up after restarts stop helping, instead of restarting forever", () => {
  expect(
    shouldAutoHeal({ ...base, consecutiveFailures: MAX_CONSECUTIVE_FAILURES }),
  ).toBe(false);
  expect(
    shouldAutoHeal({ ...base, consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 }),
  ).toBe(true);
});

test("can be switched off entirely", () => {
  expect(shouldAutoHeal({ ...base, enabled: false })).toBe(false);
});
