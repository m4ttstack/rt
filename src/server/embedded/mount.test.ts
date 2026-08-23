// @vitest-environment node
import { Hono } from 'hono';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

import { mountEmbeddedStatic } from './mount';
import type { ResolvedAsset } from './serve';
import type { EmbeddedManifest } from './types';

const manifest: EmbeddedManifest = {
  indexHtmlPath: '/embedded/index.html',
  files: {
    '/assets/app.js': '/embedded/assets/app.js',
    '/fonts/tomorrow.woff2': '/embedded/fonts/tomorrow.woff2',
    '/favicon.svg': '/embedded/favicon.svg',
  },
};

// Bun-free stand-in for `toResponse` (`./serve`), which calls `Bun.file` --
// unavailable under vitest's Node runtime. Encodes the resolved asset into
// the response body/header instead, so assertions can see exactly what the
// routing decided to serve without needing a real file read.
const fakeToResponse = (asset: ResolvedAsset) =>
  new Response(`served:${asset.path}`, {
    headers: { 'content-type': asset.contentType },
  });

describe('mountEmbeddedStatic', () => {
  it('routes /assets/*, /fonts/*, and /favicon.svg to their manifest entries', async () => {
    const app = new Hono();
    mountEmbeddedStatic(app, manifest, fakeToResponse);

    const [assetRes, fontRes, faviconRes] = await Promise.all([
      app.request('/assets/app.js'),
      app.request('/fonts/tomorrow.woff2'),
      app.request('/favicon.svg'),
    ]);

    await expect(assetRes.text()).resolves.toBe(
      'served:/embedded/assets/app.js'
    );
    expect(assetRes.headers.get('content-type')).toContain('javascript');
    await expect(fontRes.text()).resolves.toBe(
      'served:/embedded/fonts/tomorrow.woff2'
    );
    expect(faviconRes.status).toBe(200);
  });

  it('falls through to the next handler on a miss, matching the disk variant', async () => {
    const app = new Hono();
    mountEmbeddedStatic(app, manifest, fakeToResponse);
    // Nothing else is mounted, so a fallthrough lands on Hono's own 404 --
    // this is what proves a miss calls `next()` rather than answering
    // itself, the same contract `hono/bun`'s serveStatic gives the disk path.
    const res = await app.request('/assets/does-not-exist.js');

    expect(res.status).toBe(404);
  });

  it('returns the manifest index.html from the returned SPA-fallback handler', async () => {
    const app = new Hono();
    const serveIndexHtml = mountEmbeddedStatic(app, manifest, fakeToResponse);

    const res = await serveIndexHtml({} as Context);

    await expect(res.text()).resolves.toBe('served:/embedded/index.html');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});
