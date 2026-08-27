import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { expect, test } from 'vitest';

import { mountStatic } from './static';

const fakeServeStatic =
  (options: { root?: string; path?: string }): MiddlewareHandler =>
  async c =>
    c.html(`STATIC:${options.path ?? options.root}`);

function disk() {
  const app = new Hono();
  mountStatic(app, fakeServeStatic);
  app.get('/ws', c => c.text('UPGRADE'));
  return app;
}

test('an unknown page path falls through to the SPA shell', async () => {
  const res = await disk().request('/some/client/route');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('index.html');
});

test('an unmatched /api path is a 404, never the SPA shell', async () => {
  const res = await disk().request('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain('index.html');
});

test('/ws reaches its route instead of the fallback', async () => {
  expect(await (await disk().request('/ws')).text()).toBe('UPGRADE');
});

test('assets, fonts, favicon and the raster icons come from dist', async () => {
  const app = disk();
  expect(await (await app.request('/assets/index.js')).text()).toContain(
    './dist'
  );
  expect(await (await app.request('/fonts/x.woff2')).text()).toContain(
    './dist'
  );
  expect(await (await app.request('/favicon.svg')).text()).toBe(
    'STATIC:./dist/favicon.svg'
  );
  for (const icon of ['favicon-32.png', 'apple-touch-icon.png']) {
    expect(await (await app.request(`/${icon}`)).text()).toBe(
      `STATIC:./dist/${icon}`
    );
  }
});

test('embedded mode serves from the manifest and falls back to its index', async () => {
  const app = new Hono();
  const manifest = {
    indexHtmlPath: '/$bunfs/root/index.html',
    files: { '/assets/a.js': '/$bunfs/root/assets/a.js' },
  };
  mountStatic(app, fakeServeStatic, {
    embedded: manifest,
    toResponse: asset => new Response(`EMBEDDED:${asset.path}`),
  });
  expect(await (await app.request('/assets/a.js')).text()).toBe(
    'EMBEDDED:/$bunfs/root/assets/a.js'
  );
  expect(await (await app.request('/anything')).text()).toBe(
    'EMBEDDED:/$bunfs/root/index.html'
  );
  expect((await app.request('/api/nope')).status).toBe(404);
});
