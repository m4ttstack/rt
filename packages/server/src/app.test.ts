import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, expect, test, vi } from 'vitest';

import { createApp } from './app';

vi.mock('@mattstack/rt-client', () => ({
  daemonHealth: vi.fn(async () => ({
    reachable: false,
    error: 'ECONNREFUSED',
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function app() {
  const routes = new Hono()
    .get('/api/ok', c => c.json({ ok: true }))
    .get('/api/boom', () => {
      throw new Error('kaboom');
    })
    .get('/api/teapot', () => {
      throw new HTTPException(418, { message: 'short and stout' });
    });
  return createApp({ name: 'probe', version: '1.2.3', routes });
}

test('/api/health names the app and version', async () => {
  const res = await app().request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    name: 'probe',
    version: '1.2.3',
  });
});

test('/api/daemon relays the down envelope with 200', async () => {
  const res = await app().request('/api/daemon');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ reachable: false, error: 'ECONNREFUSED' });
});

test('app routes are mounted', async () => {
  expect(await (await app().request('/api/ok')).json()).toEqual({ ok: true });
});

test('unknown routes are a JSON 404', async () => {
  const res = await app().request('/api/nope');
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('a thrown Error is a JSON 500 carrying the message', async () => {
  const res = await app().request('/api/boom');
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'kaboom' });
});

test('an HTTPException keeps its status', async () => {
  const res = await app().request('/api/teapot');
  expect(res.status).toBe(418);
  expect(await res.json()).toEqual({ error: 'short and stout' });
});

test('a .localhost request is sent to MATTSTACK_CANONICAL_HOST before any route', async () => {
  vi.stubEnv('MATTSTACK_CANONICAL_HOST', 'probe.mattstack');
  const res = await app().request('/api/ok?x=1', {
    headers: { 'x-forwarded-host': 'probe.localhost' },
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(
    'https://probe.mattstack/api/ok?x=1'
  );
});

test('the canonical host itself, and any host with no canonical configured, is served', async () => {
  vi.stubEnv('MATTSTACK_CANONICAL_HOST', 'probe.mattstack');
  const canonical = await app().request('/api/ok', {
    headers: { 'x-forwarded-host': 'probe.mattstack' },
  });
  expect(canonical.status).toBe(200);
  vi.unstubAllEnvs();
  const unconfigured = await app().request('/api/ok', {
    headers: { 'x-forwarded-host': 'probe.localhost' },
  });
  expect(unconfigured.status).toBe(200);
});
