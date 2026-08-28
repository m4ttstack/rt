import { serveMattstackApp } from '@mattstack/app-server';

import { routes } from './routes';

await serveMattstackApp({
  name: 'chat',
  version: '0.0.0',
  routes,
  port: 11002,
  relay: [{ match: t => t.startsWith('chat/'), topic: 'chat' }],
});
