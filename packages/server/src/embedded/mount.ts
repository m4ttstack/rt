import type { Context, Hono, Next } from 'hono';

import { ICON_FILES } from '../icon-files';
import {
  resolveEmbeddedAsset,
  resolveEmbeddedIndexHtml,
  toResponse,
  type ResolvedAsset,
} from './serve';
import type { EmbeddedManifest } from './types';

/**
 * Mounts `/assets/*`, `/fonts/*`, and the root icons against files embedded
 * in the compiled binary, and returns the SPA-fallback handler for the
 * caller's catch-all route. `static.ts`'s `mountStatic` calls this (or the
 * disk-mode branch) so the routes themselves never need to know which mode
 * is live.
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
  for (const icon of ICON_FILES) app.use(`/${icon}`, serveOrNext);

  return async () => toResponseFn(resolveEmbeddedIndexHtml(manifest));
}
