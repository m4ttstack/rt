import { serveMattstackApp } from '@mattstack/app-server';

import pkg from '../../package.json' with { type: 'json' };
import { installConsoleBridgeRule } from './event-bridge';
import { routes } from './routes';

const PORT = 11011;
// Mirrors `serveMattstackApp`'s own port resolution (packages/server/src/serve.ts:
// `Number(process.env.PORT ?? opts.port)`) so the bridge rule's fallback url
// points at the port the app actually binds.
const port = Number(process.env.PORT ?? PORT);

await serveMattstackApp({
  name: 'console',
  version: pkg.version,
  routes,
  port: PORT,
  relay: [
    { match: t => t === 'run-updated', topic: 'runs' },
    { match: t => t.startsWith('gate/'), topic: 'gates' },
  ],
  // `as string` keeps TS from resolving the gitignored, build-time-only
  // manifest; `bun build --compile` still sees the literal and embeds it.
  embedded: () => import('./embedded/manifest' as string),
});

// Fire-and-forget: awaits a deck round trip, so this must not block boot.
// Any failure (deck down, a stale rt-client without the setting key yet,
// or a settings read/write refusal) is logged once and otherwise ignored.
void installConsoleBridgeRule({ port }).catch(err =>
  console.error(
    `gate bridge-rule reconcile skipped: ${err instanceof Error ? err.message : err}`
  )
);
