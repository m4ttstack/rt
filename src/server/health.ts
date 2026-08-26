import { daemonHealth, type RtClientOptions } from '@mattstack/rt-client';
import { Hono } from 'hono';

/**
 * Resolved at CALL time (mirrors chat.ts's own `rtOpts()`): an env override
 * read fresh per request, undefined otherwise so rt-client's built-in
 * default sock path still applies.
 */
function rtOpts(): RtClientOptions {
  return { sockPath: process.env.RT_SOCK_PATH };
}

/**
 * `daemonHealth()` already reshapes a down probe into `{ reachable: false,
 * error }` rather than throwing -- a dead daemon is a successful probe
 * result, never a server failure -- so this route always answers 200 and
 * relays that envelope verbatim.
 */
export const health = new Hono().get('/api/daemon', async c => {
  const res = await daemonHealth(rtOpts());
  return c.json(res, 200);
});
