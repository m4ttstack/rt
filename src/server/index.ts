import type { ServerWebSocket } from 'bun';
import { createBunWebSocket, serveStatic } from 'hono/bun';

import { app } from './app';
import { mountStaticDisk } from './static-disk';
import { startRelay } from './ws';

// The only file in the codebase importing `hono/bun`: everything else
// (app.ts, ws.ts, their tests) stays runnable under vitest's Node runtime.
mountStaticDisk(app, serveStatic);

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

// Registered here rather than in app.ts for the hono/bun constraint above,
// and with no middleware in front of it: a header-modifying middleware plus
// the websocket helper throws on immutable headers.
//
// Every socket subscribes to the one `chat` topic the relay publishes onto,
// so N tabs share a single daemon subscription instead of opening N.
app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      ws.raw?.subscribe('chat');
    },
  }))
);

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
  port,
});

// One subscription for the process, fanned out to every socket on the topic.
// The daemon being down is silence, not a crash: rt-client reconnects with
// capped backoff until this stop function runs.
const stopRelay = startRelay((topic, data) => server.publish(topic, data));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopRelay();
    process.exit(0);
  });
}

console.log(`chat server listening on http://localhost:${server.port}`);
