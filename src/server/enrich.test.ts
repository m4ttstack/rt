// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// See runs.test.ts for why every export any sub-app under `app.ts` touches
// must be present here, even the ones these tests never call.
vi.mock('@mattstack/rt-client', () => ({
  listRuns: vi.fn(async () => ({ ok: true, data: { runs: [] } })),
  getRun: vi.fn(async () => ({ ok: false, error: 'no such run' })),
  abandonRun: vi.fn(async () => ({ ok: true, data: { ok: true } })),
  subscribe: vi.fn(() => () => {}),
  getSetting: vi.fn(() => ({ value: 30, provenance: [] })),
  serializeIdentity: (id: { kind: string; id: string }) =>
    `${id.kind}:${encodeURIComponent(id.id)}`,
  readBranchCache: vi.fn(async () => ({ ok: true, data: {} })),
}));

const { app } = await import('./app');
const rt = await import('@mattstack/rt-client');

function post(body: unknown) {
  return app.fetch(
    new Request('http://localhost/api/runs/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/runs/enrich', () => {
  // Call counts otherwise accumulate across `it`s sharing this mock, which
  // would make the `not.toHaveBeenCalled()` assertions below pass by accident.
  beforeEach(() => {
    vi.mocked(rt.readBranchCache).mockClear();
  });

  it('returns the cache map for the requested branches', async () => {
    const data = {
      'demo-1265-add-shield-toggle': {
        ticket: {
          identifier: 'DEMO-1265',
          title: 'Add shield toggle',
          url: 'https://gitlab.example.com/acme/demo/-/issues/1265',
        },
        mr: null,
        fetchedAt: 1_700_000_000_000,
      },
    };
    vi.mocked(rt.readBranchCache).mockResolvedValueOnce({ ok: true, data });

    const res = await post({ branches: ['demo-1265-add-shield-toggle'] });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(data);
    expect(rt.readBranchCache).toHaveBeenCalledWith([
      'demo-1265-add-shield-toggle',
    ]);
  });

  it('answers 502, not a thrown 500, when rt-client answers ok:false', async () => {
    vi.mocked(rt.readBranchCache).mockResolvedValueOnce({
      ok: false,
      error: 'daemon is down',
    });

    const res = await post({ branches: ['demo-1265-add-shield-toggle'] });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'daemon is down' });
  });

  it('answers 200 {} for an empty branch list without calling rt-client', async () => {
    const res = await post({ branches: [] });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({});
    expect(rt.readBranchCache).not.toHaveBeenCalled();
  });

  it('rejects more than 100 branches with 400 rather than forwarding them', async () => {
    const branches = Array.from({ length: 101 }, (_, i) => `branch-${i}`);

    const res = await post({ branches });

    expect(res.status).toBe(400);
    expect(rt.readBranchCache).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 branches', async () => {
    const branches = Array.from({ length: 100 }, (_, i) => `branch-${i}`);
    vi.mocked(rt.readBranchCache).mockResolvedValueOnce({ ok: true, data: {} });

    const res = await post({ branches });

    expect(res.status).toBe(200);
    expect(rt.readBranchCache).toHaveBeenCalledWith(branches);
  });

  it('rejects a body whose branches field is not an array of strings', async () => {
    const res = await post({ branches: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(rt.readBranchCache).not.toHaveBeenCalled();
  });
});
