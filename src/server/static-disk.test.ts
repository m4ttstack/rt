import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { expect, test } from 'vitest';

import { mountStaticDisk } from './static-disk';

/**
 * Stands in for `hono/bun`'s `serveStatic`, which cannot be imported here:
 * these tests run on vitest's Node runtime. It answers with a marker body so
 * a test can tell "the static fallback handled this" from "the fallback let
 * it through".
 */
const fakeServeStatic =
  (options: { root?: string; path?: string }): MiddlewareHandler =>
  async c =>
    c.html(`STATIC:${options.path ?? options.root}`);

function mounted() {
  const app = new Hono();
  // A live route registered AFTER the static mount, exactly as index.ts
  // registers /ws. If the fallback swallowed it, this would never run.
  mountStaticDisk(app, fakeServeStatic);
  app.get('/ws', c => c.text('UPGRADE'));
  return app;
}

test('an unknown page path falls through to the SPA shell', async () => {
  const res = await mounted().request('/some/client/route');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('index.html');
});

test('an unmatched /api path is a JSON-able 404, never the SPA shell', async () => {
  // A bare '*' fallback would answer 200 with index.html here, and an RPC
  // client that checks res.ok before parsing would throw on the HTML.
  const res = await mounted().request('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain('index.html');
});

test('/ws reaches its route instead of being answered by the fallback', async () => {
  // Regression: the fallback used to match '*' minus /api, so it answered
  // /ws with 200 and index.html. The socket never upgraded -- the client saw
  // "Expected 101 status code" -- while the page still loaded perfectly, so
  // every push in the app was dead with nothing visibly broken.
  const res = await mounted().request('/ws');
  expect(await res.text()).toBe('UPGRADE');
});

test('assets and fonts are served out of dist', async () => {
  const app = mounted();
  expect(await (await app.request('/assets/index.js')).text()).toContain(
    './dist'
  );
  expect(await (await app.request('/fonts/x.woff2')).text()).toContain(
    './dist'
  );
});

test('the raster icons are served out of dist, never answered by the SPA shell', async () => {
  const app = mounted();
  for (const icon of ['favicon-32.png', 'apple-touch-icon.png']) {
    expect(await (await app.request(`/${icon}`)).text()).toBe(
      `STATIC:./dist/${icon}`
    );
  }
});
