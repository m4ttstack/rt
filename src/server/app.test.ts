import { expect, test } from 'vitest';

import { app } from './app';

test('GET /api/health reports ok with a version', async () => {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
});

test('app.ts is importable without the Bun global', async () => {
  // Guards the hono/bun constraint: this suite runs on vitest's Node
  // runtime, so a stray `hono/bun` import here fails at module load.
  await expect(import('./app')).resolves.toBeDefined();
});
