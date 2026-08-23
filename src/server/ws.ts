import { subscribe } from '@mattstack/rt-client';
import { Hono } from 'hono';

/**
 * ONE daemon subscription for the whole process. Every browser tab is a
 * subscriber to Bun's `runs` topic, so tab count does not multiply daemon
 * load. Returns the unsubscribe.
 */
export function startRelay(
  publish: (topic: string, data: string) => void
): () => void {
  return subscribe((type, data) => {
    // The daemon multiplexes everything through this one socket -- ports,
    // status, system-processes, project-mrs, discussions:* all arrive on
    // pollers. Filtering HERE rather than in the browser is what keeps an
    // unrelated daemon tick from making every open tab refetch the run list.
    if (type !== 'event') return;
    const frame = data as { topic?: unknown };
    if (frame?.topic !== 'run-updated') return;
    publish('runs', JSON.stringify(data));
  });
}

/** No middleware may touch this route: header-modifying middleware plus the
    websocket helper throws on immutable headers. */
export const ws = new Hono().get('/ws', async (c, next) => {
  // `hono/bun`'s barrel re-exports its SSG helper, which reads the `Bun`
  // global at import time; importing it statically breaks every test that
  // loads this module under vitest's Node runtime. Importing it here instead
  // defers that read to an actual request, which only happens inside a real
  // Bun process.
  const { upgradeWebSocket } = await import('hono/bun');
  return upgradeWebSocket(() => ({
    onOpen(_event, socket) {
      // `raw` is the underlying Bun ServerWebSocket, which is what carries
      // topic subscription; Hono's WSContext wraps it without taking it away.
      (socket.raw as { subscribe(topic: string): void } | undefined)?.subscribe(
        'runs'
      );
    },
  }))(c, next);
});
