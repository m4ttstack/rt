// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveEmbeddedAsset, resolveEmbeddedIndexHtml } from './serve';
import type { EmbeddedManifest } from './types';

const manifest: EmbeddedManifest = {
  indexHtmlPath: '/embedded/index.html',
  files: {
    '/assets/app.js': '/embedded/assets/app.js',
    '/assets/app.css': '/embedded/assets/app.css',
    '/LICENSE': '/embedded/LICENSE',
  },
};

describe('resolveEmbeddedAsset', () => {
  it('resolves a mapped path to its file path and mime-derived content-type', () => {
    expect(resolveEmbeddedAsset(manifest, '/assets/app.js')).toEqual({
      path: '/embedded/assets/app.js',
      contentType: 'text/javascript; charset=utf-8',
    });
    expect(resolveEmbeddedAsset(manifest, '/assets/app.css')).toEqual({
      path: '/embedded/assets/app.css',
      contentType: 'text/css; charset=utf-8',
    });
  });

  it('returns undefined for a path the manifest has no entry for', () => {
    expect(
      resolveEmbeddedAsset(manifest, '/assets/does-not-exist.js')
    ).toBeUndefined();
  });

  it('falls back to application/octet-stream when the path has no recognizable extension', () => {
    expect(resolveEmbeddedAsset(manifest, '/LICENSE')).toEqual({
      path: '/embedded/LICENSE',
      contentType: 'application/octet-stream',
    });
  });
});

describe('resolveEmbeddedIndexHtml', () => {
  it("always resolves the manifest's index.html with an html content-type", () => {
    expect(resolveEmbeddedIndexHtml(manifest)).toEqual({
      path: '/embedded/index.html',
      contentType: 'text/html; charset=utf-8',
    });
  });
});
