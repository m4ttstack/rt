import { serveStatic } from 'hono/bun';

import { app } from './app';
import { mountStaticDisk } from './static-disk';

// The only file in the codebase importing `hono/bun`: everything else
// (app.ts, its tests) stays runnable under vitest's Node runtime.
mountStaticDisk(app, serveStatic);

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`chat server listening on http://localhost:${server.port}`);
