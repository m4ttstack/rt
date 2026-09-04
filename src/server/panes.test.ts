// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  paneFocus: vi.fn(),
}));

const { panes } = await import('./panes');
const rt = await import('@mattstack/rt-client');

function post(paneId: string) {
  return panes.fetch(
    new Request(`http://localhost/api/panes/${paneId}/focus`, {
      method: 'POST',
    })
  );
}

describe('POST /api/panes/:id/focus', () => {
  it('passes through the paneFocus result on ok:true', async () => {
    vi.mocked(rt.paneFocus).mockResolvedValueOnce({
      ok: true,
      data: { paneId: 'w1:p1', focused: true },
    });

    const res = await post('w1:p1');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      paneId: 'w1:p1',
      focused: true,
    });
    expect(rt.paneFocus).toHaveBeenCalledWith(
      { paneId: 'w1:p1' },
      { sockPath: process.env.RT_SOCK_PATH }
    );
  });

  it('answers 502, not a thrown 500, when rt-client answers ok:false', async () => {
    vi.mocked(rt.paneFocus).mockResolvedValueOnce({
      ok: false,
      error: 'no such pane',
    });

    const res = await post('w1:p1');

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'no such pane' });
  });
});
