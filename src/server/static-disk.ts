import type { Context, Hono, MiddlewareHandler, Next } from 'hono';

/** Where `bun run build` writes the client, relative to the process's
 * working directory (the repo root the server is launched from). */
export const DIST_ROOT = './dist';

/**
 * Wires the built client onto `app` from disk: `/assets/*` and `/fonts/*`
 * served straight out of `dist`, the favicon at its root path, and every
 * other non-API path falling through to `index.html` (the SPA shell).
 *
 * `serveStatic` comes from `hono/bun` and is passed in rather than imported
 * here, so `index.ts` stays the only file that touches `hono/bun` -- the
 * same constraint that keeps the health route's `app.ts` importable under
 * vitest's Node runtime.
 *
 * The index.html fallback checks the request path itself rather than
 * relying on route registration order: a bare `'*'` static fallback would
 * answer an unmatched `/api/*` route with 200 and the SPA's index.html,
 * and an RPC client that checks `res.ok` before parsing JSON would then
 * throw parsing HTML as JSON.
 */
export function mountStaticDisk(
  app: Hono,
  serveStatic: (options: { root?: string; path?: string }) => MiddlewareHandler
): void {
  app.use('/assets/*', serveStatic({ root: DIST_ROOT }));
  app.use('/fonts/*', serveStatic({ root: DIST_ROOT }));
  app.get('/favicon.svg', serveStatic({ path: `${DIST_ROOT}/favicon.svg` }));

  const indexHtml = serveStatic({ path: `${DIST_ROOT}/index.html` });
  app.use('*', async (c: Context, next: Next) => {
    if (c.req.path.startsWith('/api')) return c.notFound();
    return indexHtml(c, next);
  });
}
