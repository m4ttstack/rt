import { upgradeWebSocket, websocket } from 'hono/bun';

import { app } from './app';
import { isCompiledBinary } from './embedded/compiled-binary';
import { loadEmbeddedManifest } from './embedded/manifest-loader';
import { mountEmbeddedStatic } from './embedded/mount';
import { decideServingMode } from './embedded/serving-mode';
import { mountDiskStatic } from './static-disk';
import { startRelay } from './ws';

// Scoped away from /api and /ws DELIBERATELY. A bare '/*' static fallback
// makes an unknown /api/* route return 200 with the SPA's index.html: the RPC
// client then sees res.ok === true and throws parsing HTML as JSON, and the
// JSON-404 contract app.test.ts asserts silently stops holding in production
// (the test still passes, because it calls app.fetch before this file mounts
// anything).
//
// Static assets come from whichever source actually has them: the compiled
// binary embeds `dist/` at build time (see embedded/), so it has no
// dependency on a `dist/` directory existing on disk at runtime; `dev` and
// `serve` never produce that embedded manifest, so they fall back to reading
// `dist/` off disk exactly as before.
const embeddedManifest = await loadEmbeddedManifest();
const servingMode = decideServingMode({
  manifestLoaded: embeddedManifest !== null,
  isCompiledBinary: isCompiledBinary(),
});
// A compiled binary with no manifest has no `dist/` to fall back to either
// -- refuse to serve rather than let every request 404 in production. Exits
// before `Bun.serve` below, so nothing ever listens.
if (servingMode.mode === 'fatal') {
  console.error(servingMode.message);
  process.exit(1);
}
console.log(
  `static assets: ${servingMode.mode === 'embedded' ? 'embedded' : 'disk (./dist)'}`
);
const serveIndexHtml = embeddedManifest
  ? mountEmbeddedStatic(app, embeddedManifest)
  : mountDiskStatic(app);
// No middleware may touch this route: header-modifying middleware plus the
// websocket helper throws on immutable headers. Registered here, not in
// app.ts, so app.ts stays import-safe under vitest's Node runtime and /ws
// stays out of AppType, where no RPC client needs it.
app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_event, socket) {
      // `raw` is the underlying Bun ServerWebSocket, which is what carries
      // topic subscription; Hono's WSContext wraps it without taking it away.
      (socket.raw as { subscribe(topic: string): void } | undefined)?.subscribe(
        'runs'
      );
    },
  }))
);
app.get('*', async c => {
  if (c.req.path.startsWith('/api') || c.req.path.startsWith('/ws')) {
    return c.json({ error: 'not found' }, 404);
  }
  return serveIndexHtml(c);
});

const port = Number(process.env.PORT ?? 11011);

export const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch: app.fetch,
  websocket,
});

console.log(`console listening on http://127.0.0.1:${server.port}`);

const stopRelay = startRelay((topic, data) => server.publish(topic, data));

process.on('SIGTERM', () => {
  stopRelay();
  void server.stop();
});
