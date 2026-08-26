import { Hono } from 'hono';

import { chat } from './chat';
import { health } from './health';

export const app = new Hono()
  .get('/api/health', c => c.json({ ok: true, version: '0.1.0' }))
  .route('/', chat)
  .route('/', health);

// c.notFound() alone produces a response the RPC client can't type; every
// later route's error handling assumes a JSON floor.
app.notFound(c => c.json({ ok: false, error: 'Not Found' }, 404));

// Without this Hono answers a thrown error with text/plain "Internal Server
// Error", so the client's res.json() throws parsing it instead of surfacing
// the real error.
app.onError((err, c) => {
  console.error(err);
  return c.json({ ok: false, error: 'Internal Server Error' }, 500);
});
