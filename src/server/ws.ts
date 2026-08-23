import { subscribe } from '@mattstack/rt-client';

/**
 * ONE daemon subscription for the whole process. Every browser tab is a
 * subscriber to Bun's `runs` topic, so tab count does not multiply daemon
 * load. Returns the unsubscribe.
 *
 * The `/ws` route itself lives in `index.ts`, not here: that file imports
 * `hono/bun`, which reads the `Bun` global at module load, and this file
 * must stay importable under vitest's Node runtime.
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
