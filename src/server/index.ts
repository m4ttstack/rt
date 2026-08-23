import { serveStatic, websocket } from 'hono/bun';

import { app } from './app';

// Scoped away from /api and /ws DELIBERATELY. A bare '/*' static fallback
// makes an unknown /api/* route return 200 with the SPA's index.html: the RPC
// client then sees res.ok === true and throws parsing HTML as JSON, and the
// JSON-404 contract app.test.ts asserts silently stops holding in production
// (the test still passes, because it calls app.fetch before this file mounts
// anything).
//
// serveStatic resolves through Bun.file + node:path.join, i.e. relative to the
// process CWD -- so the deck's `workingDirectory` for this app must be the
// repo root, not the dist directory.
app.use('/assets/*', serveStatic({ root: './dist' }));
app.use('/fonts/*', serveStatic({ root: './dist' }));
app.use('/favicon.svg', serveStatic({ path: './dist/favicon.svg' }));
app.get('*', async c => {
  if (c.req.path.startsWith('/api') || c.req.path.startsWith('/ws')) {
    return c.json({ error: 'not found' }, 404);
  }
  return serveStatic({ path: './dist/index.html' })(c, async () => {});
});

const port = Number(process.env.PORT ?? 11011);

export const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch: app.fetch,
  websocket,
});

console.log(`console listening on http://127.0.0.1:${server.port}`);
