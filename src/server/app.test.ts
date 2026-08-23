// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { app } from './app';

// Registered at MODULE SCOPE, deliberately. Hono builds its route matcher on
// the first dispatch and then refuses `add` with "Can not add a route since
// the matcher is already built" -- so a route added inside an `it` throws,
// because the tests above it have already dispatched. Any future test that
// extends the shared `app` hits the same wall.
//
// It also has to hang off the REAL `app`: a throwaway Hono with its own
// onError would assert that Hono works, not that this app installed a
// handler, and would stay green if `routes.onError` were deleted.
app.get('/api/__throw', () => {
  throw new Error('daemon socket exploded');
});

describe('server app', () => {
  it('answers /api/health', async () => {
    const res = await app.fetch(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it('returns a JSON 404 rather than c.notFound() on an unknown api route', async () => {
    const res = await app.fetch(new Request('http://localhost/api/nope'));

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('renders a thrown error as JSON carrying its message, not text/plain', async () => {
    // The reachable case: any throw out of rt-client (daemon down, socket
    // closed, timeout) lands here. Hono's default answers text/plain
    // "Internal Server Error" and drops rt's actual message.
    const res = await app.fetch(new Request('http://localhost/api/__throw'));

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({
      error: 'daemon socket exploded',
    });
  });
});
