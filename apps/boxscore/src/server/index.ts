import { serveMattstackApp } from '@mattstack/app-server';
import pkg from '../../package.json' with { type: 'json' };
import { routes } from './routes.js';

await serveMattstackApp({
  name: 'boxscore',
  version: pkg.version,
  routes,
  port: 11005,
  // `as string` keeps TS from resolving the gitignored, build-time-only
  // manifest; `bun build --compile` still sees the literal and embeds it.
  embedded: () => import('./embedded/manifest' as string),
});
