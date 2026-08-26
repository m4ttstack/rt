import type { Context, Hono, MiddlewareHandler, Next } from 'hono';

/** Where `bun run build` writes the client, relative to the process's
 * working directory (the repo root the server is launched from). */
export const DIST_ROOT = './dist';
const ICON_FILES = [
  'favicon-16.png',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-512.png',
] as const;

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
 *
 * `/ws` is excluded for a sharper reason: it is not a 404 case, it is a
 * live route. The fallback answering it with 200 and index.html means the
 * upgrade never happens, the client sees "Expected 101 status code", and
 * every push in the app silently stops working while the page still loads
 * fine. Excluding it here rather than registering `/ws` first keeps this
 * module order-independent, as the paragraph above intends.
 */
export function mountStaticDisk(
  app: Hono,
  serveStatic: (options: { root?: string; path?: string }) => MiddlewareHandler
): void {
  app.use('/assets/*', serveStatic({ root: DIST_ROOT }));
  app.use('/fonts/*', serveStatic({ root: DIST_ROOT }));
  app.get('/favicon.svg', serveStatic({ path: `${DIST_ROOT}/favicon.svg` }));
  // The raster icon set index.html links: each needs its own route, or the
  // SPA fallback answers a PNG request with index.html.
  for (const icon of ICON_FILES) {
    app.get(`/${icon}`, serveStatic({ path: `${DIST_ROOT}/${icon}` }));
  }

  const indexHtml = serveStatic({ path: `${DIST_ROOT}/index.html` });
  app.use('*', async (c: Context, next: Next) => {
    if (c.req.path.startsWith('/api')) return c.notFound();
    if (c.req.path === '/ws') return next();
    return indexHtml(c, next);
  });
}
