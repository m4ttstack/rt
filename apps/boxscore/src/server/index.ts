import { serveMattstackApp } from '@mattstack/app-server';
import pkg from '../../package.json' with { type: 'json' };
import { routes } from './routes.js';

await serveMattstackApp({
  name: 'boxscore',
  version: pkg.version,
  routes,
  port: 11005,
});
