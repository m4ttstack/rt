import { watch, type FSWatcher } from 'fs';
import { join } from 'path';

import { buildClientBundle, type ClientBundle } from './client-bundle.ts';

let injected: ClientBundle | null = null;

/**
 * The compiled entry (src/compiled.ts) hands over pre-built, embedded client
 * assets BEFORE importing the server — a standalone binary cannot run
 * Bun.build against a source tree it does not carry. Must be called before
 * getClientAssets(); a later call would be ignored by a server that already
 * bundled, so it throws instead of lying.
 */
export function injectClientAssets(assets: ClientBundle): void {
  if (resolved)
    throw new Error(
      'injectClientAssets called after the server already loaded its client bundle'
    );
  injected = assets;
}

let resolved = false;

/** Injected assets when running compiled; a fresh runtime bundle in dev. */
export async function getClientAssets(): Promise<ClientBundle> {
  resolved = true;
  return injected ?? (await buildClientBundle());
}

/**
 * Coalesces a burst of file events into one build, and a change that lands
 * mid-build into exactly one more, so the served bundle always reflects the
 * last save. A failed build (a half-typed file) is reported and the previous
 * bundle stays up.
 */
export function createRebuilder<T>(opts: {
  build: () => Promise<T>;
  onBuilt: (result: T, ms: number) => void;
  onFailed: (err: unknown) => void;
  delayMs: number;
}): { poke: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let dirty = false;
  const run = async () => {
    building = true;
    do {
      dirty = false;
      const started = performance.now();
      try {
        const result = await opts.build();
        opts.onBuilt(result, Math.round(performance.now() - started));
      } catch (err) {
        opts.onFailed(err);
      }
    } while (dirty);
    building = false;
  };
  return {
    poke() {
      if (building) {
        dirty = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, opts.delayMs);
    },
  };
}

/**
 * Dev only: rebuild the client bundle whenever a file under src/client
 * changes, and report a stylesheet save (which /style.css already re-reads
 * from disk) so the caller can tell browsers to reload either way. Returns
 * the stop function.
 */
export function watchClientAssets(handlers: {
  onBundle: (assets: ClientBundle) => void;
  onStyle: () => void;
}): () => void {
  const clientDir = join(import.meta.dir, 'client');
  const stylePath = join(import.meta.dir, 'style.css');
  const rebuilder = createRebuilder({
    build: buildClientBundle,
    onBuilt: (assets, ms) => {
      console.log(`client bundle rebuilt in ${ms}ms`);
      handlers.onBundle(assets);
    },
    onFailed: err =>
      console.error(
        `client bundle rebuild failed, serving the previous one: ${String(err)}`
      ),
    delayMs: 120,
  });
  const watchers: FSWatcher[] = [
    watch(clientDir, { recursive: true }, () => rebuilder.poke()),
    watch(stylePath, () => handlers.onStyle()),
  ];
  return () => {
    for (const w of watchers) w.close();
  };
}
