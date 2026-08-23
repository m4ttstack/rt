import type { Context, Hono, Next } from 'hono';

import {
  resolveEmbeddedAsset,
  resolveEmbeddedIndexHtml,
  toResponse,
  type ResolvedAsset,
} from './serve';
import type { EmbeddedManifest } from './types';

/**
 * Mounts `/assets/*`, `/fonts/*`, and `/favicon.svg` against files embedded
 * in the compiled binary, and returns the SPA-fallback handler for the
 * catch-all route in index.ts -- same three-mounts-plus-fallback shape as
 * `mountDiskStatic` (`../static-disk.ts`), so index.ts picks between the two
 * without the routes themselves knowing which mode is live.
 *
 * `toResponseFn` defaults to the real, Bun-backed `toResponse`; tests pass a
 * Bun-free stand-in so the routing itself -- match, miss, fallthrough -- runs
 * under vitest without needing the `Bun` global `toResponse` depends on.
 */
export function mountEmbeddedStatic(
  app: Hono,
  manifest: EmbeddedManifest,
  toResponseFn: (asset: ResolvedAsset) => Response = toResponse
): (c: Context) => Promise<Response> {
  const serveOrNext = async (c: Context, next: Next) => {
    const asset = resolveEmbeddedAsset(manifest, c.req.path);
    return asset ? toResponseFn(asset) : next();
  };

  app.use('/assets/*', serveOrNext);
  app.use('/fonts/*', serveOrNext);
  app.use('/favicon.svg', serveOrNext);

  return async () => toResponseFn(resolveEmbeddedIndexHtml(manifest));
}
