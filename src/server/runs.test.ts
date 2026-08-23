// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// `subscribe` must be in this factory even though these tests never call it:
// a websocket sub-app shares this `app.ts`; every named export it uses must
// be present here or vitest throws "No `subscribe` export is defined on the
// mock".
vi.mock('@mattstack/rt-client', () => ({
  listRuns: vi.fn(async () => ({ ok: true, data: { runs: [] } })),
  getRun: vi.fn(async () => ({ ok: false, error: 'no such run' })),
  abandonRun: vi.fn(async () => ({ ok: true, data: { ok: true } })),
  subscribe: vi.fn(() => () => {}),
}));

const { app } = await import('./app');
const rt = await import('@mattstack/rt-client');

describe('runs api', () => {
  it('lists runs and passes repo through', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs?repo=repo-tools')
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ runs: [] });
    expect(rt.listRuns).toHaveBeenCalledWith('repo-tools');
  });

  it('translates a daemon failure into 502, not a thrown 500', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1')
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'no such run' });
  });

  it('abandons a run with the reason from the body', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1/abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'wedged overnight' }),
      })
    );

    expect(res.status).toBe(200);
    expect(rt.abandonRun).toHaveBeenCalledWith(
      'run-1',
      'repo-tools',
      'wedged overnight'
    );
  });

  it('renders a DOWNED daemon as JSON, not text/plain', async () => {
    // rt-client THROWS when the daemon is unreachable rather than returning
    // ok:false, so this path -- not the 502 above -- is what a stopped daemon
    // actually produces. It exercises app.onError through the real route.
    vi.mocked(rt.listRuns).mockRejectedValueOnce(new Error('daemon is down'));

    const res = await app.fetch(new Request('http://localhost/api/runs'));

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'daemon is down' });
  });

  it('survives a POST with no body at all', async () => {
    // An ABSENT body: the validator sees `undefined` and still returns a
    // valid `{ reason: undefined }`, so the handler runs. A MALFORMED body is
    // deliberately different -- 400, handler skipped.
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-2/abandon', {
        method: 'POST',
      })
    );

    expect(res.status).toBe(200);
    expect(rt.abandonRun).toHaveBeenCalledWith(
      'run-2',
      'repo-tools',
      undefined
    );
  });
});
