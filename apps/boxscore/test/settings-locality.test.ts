import { describe, expect, it } from 'vitest';

const { routes: app } = await import('../src/server/routes.js');

const peer = (address: string) => ({ requestIP: () => ({ address }) });

function write(headers: Record<string, string>, env?: unknown) {
  return app.request(
    'http://boxscore.mattstack/api/settings/set',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'boxscore.mattstack',
        ...headers,
      },
      body: JSON.stringify({ key: 'nope.unknown', scope: 'user', value: 1 }),
    },
    env
  );
}

describe('settings writes', () => {
  it('pass the locality gate from a local peer and host', async () => {
    const res = await write({}, peer('127.0.0.1'));
    expect(res.status).toBe(404);
  });

  it.each<Record<string, string>>([
    { 'x-mattstack-edge': 'public' },
    { 'cf-connecting-ip': '203.0.113.9' },
    { 'x-forwarded-for': '203.0.113.9' },
  ])('refuse a request carrying %o', async edge => {
    const res = await write(edge, peer('127.0.0.1'));
    expect(res.status).toBe(403);
  });

  it('refuse a non-loopback socket peer', async () => {
    const res = await write({}, peer('192.168.1.20'));
    expect(res.status).toBe(403);
  });
});
