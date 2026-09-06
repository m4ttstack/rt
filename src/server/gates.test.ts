// @vitest-environment node
import type { GateRow } from '@mattstack/rt-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  gateList: vi.fn(),
  gateAnswer: vi.fn(),
  paneList: vi.fn(),
  paneFocus: vi.fn(),
}));

const { gates } = await import('./gates');
const rt = await import('@mattstack/rt-client');

beforeEach(() => {
  vi.clearAllMocks();
});

function row(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1',
    subject: 'run:r1',
    kind: 'self-review',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 0,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    ...overrides,
  };
}

function get() {
  return gates.fetch(new Request('http://localhost/api/gates'));
}

function answer(id: string, body: unknown) {
  return gates.fetch(
    new Request(`http://localhost/api/gates/${id}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('GET /api/gates', () => {
  it('pages gateList to exhaustion and returns the combined rows', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => row({ id: `g${i}` }));
    const page2 = [row({ id: 'g200' })];
    vi.mocked(rt.gateList)
      .mockResolvedValueOnce({
        ok: true,
        data: { gates: page1, cursor: 200 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { gates: page2, cursor: 201 },
      });

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      gates: expect.arrayContaining([
        expect.objectContaining({ id: 'g0' }),
        expect.objectContaining({ id: 'g200' }),
      ]),
    });
    expect(rt.gateList).toHaveBeenCalledWith({
      subjectPrefix: 'run:',
      limit: 200,
      cursor: undefined,
    });
    expect(rt.gateList).toHaveBeenCalledWith({
      subjectPrefix: 'run:',
      limit: 200,
      cursor: 200,
    });
  });

  it('terminates on a short page even though the cursor keeps advancing', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: { gates: [row()], cursor: 5 },
    });

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ gates: [row()] });
    expect(rt.gateList).toHaveBeenCalledTimes(1);
  });

  it('terminates on a full page whose cursor makes no forward progress, not on a falsy cursor', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) =>
      row({ id: `g${i}` })
    );
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      // A full page (200 rows) with a cursor equal to the resume position
      // passed in (undefined on the first call is never equal to a real
      // cursor, so use two calls to prove repetition, not absence, ends it).
      data: { gates: fullPage, cursor: 42 },
    });
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: { gates: fullPage, cursor: 42 },
    });

    const res = await get();

    expect(res.status).toBe(200);
    // Two pages of 200 gathered (cursor progressed 42 -> repeated), the
    // repeat then ends the loop without a third call.
    expect(rt.gateList).toHaveBeenCalledTimes(2);
    await expect(res.json()).resolves.toMatchObject({
      gates: expect.arrayContaining([expect.objectContaining({ id: 'g0' })]),
    });
  });

  it('answers 502, not a thrown 500, when gate:list fails', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: false,
      error: 'rt daemon unreachable at /tmp/rt.sock: ECONNREFUSED',
    });

    const res = await get();

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'rt daemon unreachable at /tmp/rt.sock: ECONNREFUSED',
    });
  });
});

describe('POST /api/gates/:id/answer', () => {
  it('200s on a clean answer', async () => {
    const answered = row({ status: 'answered' });
    vi.mocked(rt.gateAnswer).mockResolvedValueOnce({
      ok: true,
      data: { row: answered },
    });

    const res = await answer('g1', { answers: { q1: 'yes' } });

    expect(res.status).toBe(200);
    expect(rt.gateAnswer).toHaveBeenCalledWith({
      id: 'g1',
      answers: { q1: 'yes' },
      by: 'console',
    });
    await expect(res.json()).resolves.toEqual({ row: answered });
  });

  it('409s with the winning row on a CAS conflict', async () => {
    const winner = row({
      status: 'answered',
      answer: { answers: {}, by: 'pane', answeredAt: 1 },
    });
    vi.mocked(rt.gateAnswer).mockResolvedValueOnce({
      ok: true,
      data: { row: winner, conflict: true },
    });

    const res = await answer('g1', { answers: { q1: 'yes' } });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ row: winner });
  });

  it.each(['not-found', 'closed'])(
    '404s on the exact daemon message %s',
    async message => {
      vi.mocked(rt.gateAnswer).mockResolvedValueOnce({
        ok: false,
        error: message,
      });

      const res = await answer('g1', { answers: { q1: 'yes' } });

      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: message });
    }
  );

  // Exact-equality, not substring: a strict-membership validation message can
  // legitimately echo an option value like "closed" without meaning the gate
  // itself is closed.
  it('400s a validation message that merely contains the word "closed"', async () => {
    vi.mocked(rt.gateAnswer).mockResolvedValueOnce({
      ok: false,
      error: 'answer "closed" is not among the offered options',
    });

    const res = await answer('g1', { answers: { q1: 'closed' } });

    expect(res.status).toBe(400);
  });

  it('502s on the transport unreachable-prefixed error', async () => {
    vi.mocked(rt.gateAnswer).mockResolvedValueOnce({
      ok: false,
      error: 'rt daemon unreachable at /tmp/rt.sock: ECONNREFUSED',
    });

    const res = await answer('g1', { answers: { q1: 'yes' } });

    expect(res.status).toBe(502);
  });

  it('502s on a thrown rejection rather than a bare 500', async () => {
    vi.mocked(rt.gateAnswer).mockRejectedValueOnce(new Error('socket reset'));

    const res = await answer('g1', { answers: { q1: 'yes' } });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'socket reset' });
  });

  it('400s any other validation-shaped daemon rejection', async () => {
    vi.mocked(rt.gateAnswer).mockResolvedValueOnce({
      ok: false,
      error: 'gate already answered by another surface',
    });

    const res = await answer('g1', { answers: { q1: 'yes' } });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'gate already answered by another surface',
    });
  });

  it('400s a body missing answers, without calling gateAnswer', async () => {
    const res = await answer('g1', {});

    expect(res.status).toBe(400);
    expect(rt.gateAnswer).not.toHaveBeenCalled();
  });
});

function focus(id: string) {
  return gates.fetch(
    new Request(`http://localhost/api/gates/${id}/focus`, { method: 'POST' })
  );
}

describe('POST /api/gates/:id/focus', () => {
  it('focuses directly by origin.paneId', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: {
        gates: [row({ origin: { paneId: 'p1', presentation: 'form' } })],
        cursor: 1,
      },
    });
    vi.mocked(rt.paneFocus).mockResolvedValueOnce({
      ok: true,
      data: { paneId: 'p1', focused: true },
    });
    const res = await focus('g1');
    expect(res.status).toBe(200);
    expect(rt.paneFocus).toHaveBeenCalledWith(
      { paneId: 'p1' },
      expect.anything()
    );
    expect(rt.paneList).not.toHaveBeenCalled();
  });

  it('falls back to a worktree match against live pane cwds', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: { gates: [row({ origin: { worktree: '/w' } })], cursor: 1 },
    });
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: true,
      data: {
        panes: [
          { paneId: 'a', cwd: '/other' },
          { paneId: 'b', cwd: '/w' },
        ],
      },
    } as never);
    vi.mocked(rt.paneFocus).mockResolvedValueOnce({
      ok: true,
      data: { paneId: 'b', focused: true },
    });
    const res = await focus('g1');
    expect(res.status).toBe(200);
    expect(rt.paneFocus).toHaveBeenCalledWith(
      { paneId: 'b' },
      expect.anything()
    );
  });

  it('an unresolvable origin is a 400 with the reason, never a dead focus', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: { gates: [row({})], cursor: 1 },
    });
    const res = await focus('g1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no origin on this gate' });
    expect(rt.paneFocus).not.toHaveBeenCalled();
  });

  it('unknown gate is 404', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({
      ok: true,
      data: { gates: [], cursor: 0 },
    });
    const res = await focus('missing');
    expect(res.status).toBe(404);
  });
});
