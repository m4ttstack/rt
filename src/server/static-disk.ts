import type { Context, Hono } from 'hono';
import { serveStatic } from 'hono/bun';

/**
 * serveStatic resolves through Bun.file + node:path.join, i.e. relative to
 * the process CWD -- so the deck's `workingDirectory` for this app must be
 * the repo root, not the dist directory. Only reached when no embedded
 * manifest loaded (dev, `bun run serve`, or a binary built without running
 * `generate:embedded` first) -- see `embedded/mount.ts` for the compiled
 * counterpart and `index.ts` for how the two are chosen between.
 */
export function mountDiskStatic(app: Hono): (c: Context) => Promise<Response> {
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.use('/fonts/*', serveStatic({ root: './dist' }));
  app.use('/favicon.svg', serveStatic({ path: './dist/favicon.svg' }));

  return async c =>
    (await serveStatic({ path: './dist/index.html' })(c, async () => {})) ??
    c.notFound();
}
