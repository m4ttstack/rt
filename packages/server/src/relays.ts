import { createRelay } from '@mattstack/rt-client';

export interface RelaySpec {
  /** Daemon topic predicate, e.g. `t => t.startsWith('chat/')`. */
  match: (topic: string) => boolean;
  /** The Bun pub/sub topic every browser socket subscribes to. */
  topic: string;
}

/**
 * One daemon subscription per spec for the whole process, fanned out to
 * every socket on the spec's topic, so tab count never multiplies daemon
 * load. Reconnect-with-backoff lives in rt-client's `createRelay`.
 */
export function startRelays(
  relays: RelaySpec[],
  publish: (topic: string, data: string) => void
): () => void {
  const stops = relays.map(spec =>
    createRelay({ match: spec.match, topic: spec.topic, publish })
  );
  return () => {
    for (const stop of stops) stop();
  };
}
