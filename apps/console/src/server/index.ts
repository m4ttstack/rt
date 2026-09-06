import { serveMattstackApp } from '@mattstack/app-server';

import pkg from '../../package.json' with { type: 'json' };
import { routes } from './routes';

await serveMattstackApp({
  name: 'console',
  version: pkg.version,
  routes,
  port: 11011,
  relay: [
    { match: t => t === 'run-updated', topic: 'runs' },
    { match: t => t.startsWith('gate/'), topic: 'gates' },
  ],
  // `as string` keeps TS from resolving the gitignored, build-time-only
  // manifest; `bun build --compile` still sees the literal and embeds it.
  embedded: () => import('./embedded/manifest' as string),
});
