/**
 * Standing assertion that the bun test preload (test-setup.ts) neutralized
 * ambient live-daemon pointers. A herdr pane sets RT_DAEMON_SOCK, which wins
 * over the repointed HOME inside rt-client's rtCommand, so without the scrub
 * this suite dispatches at the developer's LIVE rt daemon.
 */
import { expect, test } from 'bun:test';

test('live daemon socket pointers are scrubbed from the test process env', () => {
  expect(process.env.RT_DAEMON_SOCK).toBeUndefined();
  expect(process.env.RT_APP_SOCKET).toBeUndefined();
});

test('the forbidden-socket list is armed for the rtCommand guard', () => {
  const raw = process.env.RT_TEST_FORBID_SOCKS;
  expect(raw).toBeDefined();
  const forbidden = JSON.parse(raw!) as string[];
  expect(forbidden.some(p => p.endsWith('/.mattstack/rt/rt.sock'))).toBe(true);
});
