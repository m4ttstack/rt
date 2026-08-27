import { serveMattstackApp } from '@mattstack/app-server';
import { routes } from './routes';

await serveMattstackApp({
  name: 'probe',
  version: '0.0.0',
  routes,
  port: 11031,
  relay: [{ match: t => t.startsWith('probe/'), topic: 'probe' }],
});
