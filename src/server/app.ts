import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import pkg from '../../package.json' with { type: 'json' };

/**
 * Routes are CHAINED and handlers are INLINE, both load-bearing for Hono's RPC
 * inference: a handler lifted into a named function loses path-param typing,
 * and an unchained `app.get(...)` statement never reaches `typeof routes`.
 */
const routes = new Hono().get('/api/health', async c =>
  c.json({ ok: true, version: pkg.version }, 200)
);

/** The 404 every unmatched route falls to. `c.notFound()` would produce a
    response the RPC client cannot type. */
routes.notFound(c => c.json({ error: 'not found' }, 404));

/**
 * The JSON floor under every failure, and the other half of Global
 * Constraint 3. Without it Hono answers a thrown error with a `text/plain`
 * "Internal Server Error" that drops rt's actual message, and answers a
 * malformed request body with a 400 carrying NO content-type at all -- both
 * unparseable by a client that expects JSON.
 *
 * The reachable case is the first one: any throw out of rt-client (daemon
 * down, socket closed, timeout) lands here. One handler on the root app
 * covers every route; no per-route middleware is involved.
 */
routes.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  return c.json({ error: err.message }, status);
});

export const app = routes;
export type AppType = typeof routes;
