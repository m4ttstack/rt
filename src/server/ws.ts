import { createRelay } from '@mattstack/rt-client';

/** Every chat topic the daemon publishes is `chat/<room>/msg` or
    `chat/wake/<handle>`, so the filter is a prefix test. Console's relay
    compared one fixed topic for equality; chat topics carry the room, so
    equality would drop every real message. `startsWith`, not `includes`:
    a substring test would also pass `run-updated/chat/build`. */
const CHAT_PREFIX = 'chat/';

/**
 * One daemon subscription for this whole process, republished onto the
 * `chat` pub/sub topic every open socket shares.
 *
 * The filtering happens here rather than at each subscriber, which is what
 * stops an unrelated daemon tick from waking every open tab. The
 * reconnect-with-backoff and event-frames-only behaviour lives in
 * rt-client's `createRelay` and is tested there; this module owns only the
 * predicate and the target topic.
 *
 * `chat/wake/<handle>` frames are republished too. A wake frame means a
 * message needs delivering to that handle, NOT that its tail is alive: the
 * viewer treats one as a hint to refetch the room's tail and the roster,
 * never as a status change. Status is the daemon's, always.
 *
 * No `hono/bun` import here, deliberately: this module has to stay
 * importable under vitest's Node runtime, same constraint as `app.ts`. The
 * socket route itself is registered in `index.ts`.
 */
export function startRelay(
  publish: (topic: string, data: string) => void
): () => void {
  return createRelay({
    match: t => t.startsWith(CHAT_PREFIX),
    topic: 'chat',
    publish,
  });
}
