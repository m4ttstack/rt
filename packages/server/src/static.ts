import type { Context, Hono, MiddlewareHandler, Next } from 'hono';

import { mountEmbeddedStatic } from './embedded/mount';
import {
  toResponse as bunToResponse,
  type ResolvedAsset,
} from './embedded/serve';
import type { EmbeddedManifest } from './embedded/types';

export type ServeStaticFn = (options: {
  root?: string;
  path?: string;
}) => MiddlewareHandler;

export interface MountStaticOptions {
  /** Present in a compiled binary; null or absent means serve `distRoot` off disk. */
  embedded?: EmbeddedManifest | null;
  /** @default './dist', relative to the process cwd (the app root). */
  distRoot?: string;
  /** Test seam for embedded mode; defaults to the Bun.file-backed response. */
  toResponse?: (asset: ResolvedAsset) => Response;
}

const ICON_FILES = [
  'favicon-16.png',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-512.png',
];

/**
 * `serveStatic` is injected (hono/bun's in production) so this module and
 * its path rules stay importable under vitest. The SPA fallback checks the
 * request path itself rather than relying on registration order: a bare '*'
 * fallback would answer an unmatched /api route with 200 and index.html, and
 * /ws with 200 instead of an upgrade.
 */
export function mountStatic(
  app: Hono,
  serveStatic: ServeStaticFn,
  opts: MountStaticOptions = {}
): void {
  const distRoot = opts.distRoot ?? './dist';
  let serveIndex: (c: Context, next: Next) => Promise<Response | void>;

  if (opts.embedded) {
    const index = mountEmbeddedStatic(
      app,
      opts.embedded,
      opts.toResponse ?? bunToResponse
    );
    serveIndex = async c => index(c);
  } else {
    app.use('/assets/*', serveStatic({ root: distRoot }));
    app.use('/fonts/*', serveStatic({ root: distRoot }));
    app.get('/favicon.svg', serveStatic({ path: `${distRoot}/favicon.svg` }));
    for (const icon of ICON_FILES) {
      app.get(`/${icon}`, serveStatic({ path: `${distRoot}/${icon}` }));
    }
    serveIndex = serveStatic({ path: `${distRoot}/index.html` });
  }

  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return c.notFound();
    if (c.req.path === '/ws') return next();
    return (await serveIndex(c, next)) ?? c.notFound();
  });
}

export { decideServingMode } from './serving-mode';
export type { ServingModeDecision } from './serving-mode';
export {
  isCompiledBinary,
  isCompiledBinaryMain,
} from './embedded/compiled-binary';
export { loadEmbeddedManifest } from './embedded/manifest-loader';
export type { EmbeddedManifestModule } from './embedded/manifest-loader';
export type { EmbeddedManifest } from './embedded/types';
export type { ResolvedAsset } from './embedded/serve';
