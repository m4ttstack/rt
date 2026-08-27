import type { Server, ServerWebSocket } from 'bun';
import type { Hono } from 'hono';
import {
  createBunWebSocket,
  serveStatic,
  type BunWebSocketData,
} from 'hono/bun';

import { createApp } from './app';
import { startRelays, type RelaySpec } from './relays';
import {
  decideServingMode,
  isCompiledBinary,
  loadEmbeddedManifest,
  mountStatic,
  type EmbeddedManifestModule,
} from './static';

export interface ServeOptions {
  name: string;
  version: string;
  routes: Hono;
  /** `process.env.PORT` overrides it. */
  port: number;
  /** @default '127.0.0.1' */
  hostname?: string;
  relay?: RelaySpec[];
  /** The app's `() => import('./embedded/manifest' as string)`; omit for disk mode. */
  embedded?: () => Promise<EmbeddedManifestModule | null>;
}

/**
 * The only module in the package that touches `hono/bun` and `Bun.serve`.
 * `/ws` is registered with no middleware in front of it: a header-modifying
 * middleware plus the websocket helper throws on immutable headers.
 */
export async function serveMattstackApp(
  opts: ServeOptions
): Promise<Server<BunWebSocketData>> {
  const app = createApp({
    name: opts.name,
    version: opts.version,
    routes: opts.routes,
  });
  const relays = opts.relay ?? [];

  const manifest = await loadEmbeddedManifest(opts.embedded);
  const mode = decideServingMode({
    manifestLoaded: manifest !== null,
    isCompiledBinary: isCompiledBinary(),
  });
  if (mode.mode === 'fatal') {
    console.error(mode.message);
    process.exit(1);
  }

  const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();
  app.get(
    '/ws',
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        for (const spec of relays) ws.raw?.subscribe(spec.topic);
      },
    }))
  );
  mountStatic(app, serveStatic, { embedded: manifest });

  const port = Number(process.env.PORT ?? opts.port);
  const server = Bun.serve({
    port,
    hostname: opts.hostname ?? '127.0.0.1',
    fetch: app.fetch,
    websocket,
  });
  const stopRelays = startRelays(relays, (topic, data) =>
    server.publish(topic, data)
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopRelays();
      void server.stop();
      process.exit(0);
    });
  }
  console.log(
    `${opts.name} listening on http://${opts.hostname ?? '127.0.0.1'}:${server.port} (assets: ${mode.mode})`
  );
  return server;
}
