/**
 * Runs in every unit suite as a standing assertion that the bun test preload
 * (test-setup.ts) scrubbed live-estate daemon pointers, and doubles as the
 * child probe for test-home-isolation.test.ts, which re-runs this file with
 * an ambient RT_DAEMON_SOCK to prove the scrub — not a clean shell — is what
 * makes the env safe.
 */
import { expect, test } from "bun:test";

test("live daemon socket pointers are scrubbed from the test process env", () => {
  expect(process.env.RT_DAEMON_SOCK).toBeUndefined();
  expect(process.env.RT_APP_SOCKET).toBeUndefined();
});

test("the forbidden-socket list is armed for the rtCommand guard", () => {
  const raw = process.env.RT_TEST_FORBID_SOCKS;
  expect(raw).toBeDefined();
  const forbidden = JSON.parse(raw!) as string[];
  expect(forbidden.length).toBeGreaterThan(0);
  expect(forbidden.some((p) => p.endsWith("/.mattstack/rt/rt.sock"))).toBe(true);
  // Set only by the parent test that spawns this file with a fake live sock.
  if (process.env.PROBE_EXPECT_FORBIDDEN) {
    expect(forbidden).toContain(process.env.PROBE_EXPECT_FORBIDDEN);
  }
});
