import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { daemonHealth } from '@mattstack/rt-client';

export interface CreateAppOptions {
  name: string;
  version: string;
  /** The app's own Hono chain; `typeof routes` stays the RPC AppType. */
  routes: Hono;
}

/**
 * The JSON floor under every failure and every miss: an RPC client checks
 * `res.ok` then parses JSON, so a text/plain 500 or an HTML 404 makes it
 * throw on the parse instead of surfacing the real error.
 */
export function createApp({ name, version, routes }: CreateAppOptions): Hono {
  const app = new Hono()
    .get('/api/health', c => c.json({ ok: true, name, version }, 200))
    .get('/api/daemon', async c =>
      c.json(await daemonHealth({ sockPath: process.env.RT_SOCK_PATH }), 200)
    )
    .route('/', routes);

  app.notFound(c => c.json({ error: 'not found' }, 404));
  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    if (status >= 500) console.error(err);
    return c.json({ error: err.message }, status);
  });
  return app;
}
