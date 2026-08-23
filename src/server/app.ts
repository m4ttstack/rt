import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import pkg from '../../package.json' with { type: 'json' };
import { runs } from './runs';
import { settings } from './settings';

/**
 * Routes are CHAINED and handlers are INLINE, both load-bearing for Hono's RPC
 * inference: a handler lifted into a named function loses path-param typing,
 * and an unchained `app.get(...)` statement never reaches `typeof routes`.
 */
const routes = new Hono()
  .get('/api/health', async c =>
    c.json({ ok: true, version: pkg.version }, 200)
  )
  .route('/', runs)
  .route('/', settings);

/** The 404 every unmatched route falls to. `c.notFound()` would produce a
    response the RPC client cannot type. */
routes.notFound(c => c.json({ error: 'not found' }, 404));

/**
 * The JSON floor under every failure: Hono's default answers a thrown error
 * with `text/plain` "Internal Server Error", dropping the underlying message.
 * One handler on the root app covers every route.
 */
routes.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  return c.json({ error: err.message }, status);
});

export const app = routes;
export type AppType = typeof routes;
