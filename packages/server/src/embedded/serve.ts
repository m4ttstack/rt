import { getMimeType } from 'hono/utils/mime';

import type { EmbeddedManifest } from './types';

export interface ResolvedAsset {
  path: string;
  contentType: string;
}

/**
 * Pure lookup -- no Bun API touched -- so it stays importable and testable
 * under vitest's Node runtime. `toResponse` below is the only piece that
 * actually reads a file (`Bun.file`), reachable only from a real Bun
 * runtime, never vitest.
 */
export function resolveEmbeddedAsset(
  manifest: EmbeddedManifest,
  path: string
): ResolvedAsset | undefined {
  const filePath = manifest.files[path];
  return filePath
    ? {
        path: filePath,
        contentType: getMimeType(filePath) ?? 'application/octet-stream',
      }
    : undefined;
}

export function resolveEmbeddedIndexHtml(
  manifest: EmbeddedManifest
): ResolvedAsset {
  return {
    path: manifest.indexHtmlPath,
    contentType: 'text/html; charset=utf-8',
  };
}

/** Exercised by actually running the server (dev, serve, or the compiled
    binary) -- vitest runs under Node, where the `Bun` global doesn't exist. */
export function toResponse(asset: ResolvedAsset): Response {
  return new Response(Bun.file(asset.path), {
    headers: { 'content-type': asset.contentType },
  });
}
