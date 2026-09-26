import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatMark: vi.fn(),
  chatBuddies: vi.fn(),
  chatJoin: vi.fn(),
  chatPost: vi.fn(),
  chatArchive: vi.fn(),
  chatDmOpen: vi.fn(),
  chatInvite: vi.fn(),
  paneList: vi.fn(),
  panePeek: vi.fn(),
  paneFocus: vi.fn(),
  paneSpawn: vi.fn(),
  paneAccounts: vi.fn(),
  paneDirectories: vi.fn(),
  daemonHealth: vi.fn(),
  getSetting: vi.fn(() => ({ value: 'matt' })),
}));
const rt = await import('@mattstack/rt-client');
const { routes } = await import('./routes');

beforeEach(() => vi.resetAllMocks());

const PANE = {
  paneId: 'w1:p1',
  workspace: 'chat',
  agentStatus: 'idle' as const,
};

test('GET /api/panes passes the rows through', async () => {
  vi.mocked(rt.paneList).mockResolvedValueOnce({
    ok: true,
    data: { panes: [PANE] },
  });
  const res = await routes.request('/api/panes');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ available: true, panes: [PANE] });
});

test('GET /api/panes reports herdr absence as available:false with 200, and other failures as 502', async () => {
  vi.mocked(rt.paneList).mockResolvedValueOnce({
    ok: false,
    error: 'herdr unavailable: no socket at /x',
  });
  const absent = await routes.request('/api/panes');
  expect(absent.status).toBe(200);
  expect(await absent.json()).toEqual({ available: false, panes: [] });
  vi.mocked(rt.paneList).mockResolvedValueOnce({
    ok: false,
    error: 'rt daemon unreachable at /x/rt.sock: ECONNREFUSED',
  });
  expect((await routes.request('/api/panes')).status).toBe(502);
});

test('GET /api/panes/:id/peek forwards lines and returns the screen', async () => {
  vi.mocked(rt.panePeek).mockResolvedValueOnce({
    ok: true,
    data: { paneId: 'w1:p1', lines: ['❯ '] },
  });
  const res = await routes.request('/api/panes/w1:p1/peek?lines=4');
  expect(res.status).toBe(200);
  expect(rt.panePeek).toHaveBeenCalledWith(
    { paneId: 'w1:p1', lines: 4 },
    expect.anything()
  );
  expect(await res.json()).toEqual({ paneId: 'w1:p1', lines: ['❯ '] });
});

test('POST /api/panes/:id/focus forwards the pane id and returns the focus result', async () => {
  vi.mocked(rt.paneFocus).mockResolvedValueOnce({
    ok: true,
    data: { paneId: 'w1:p1', focused: true },
  });
  const res = await routes.request('/api/panes/w1:p1/focus', {
    method: 'POST',
  });
  expect(res.status).toBe(200);
  expect(rt.paneFocus).toHaveBeenCalledWith(
    { paneId: 'w1:p1' },
    expect.anything()
  );
  expect(await res.json()).toEqual({ paneId: 'w1:p1', focused: true });
});

test('POST /api/panes/:id/focus maps an rt failure to 502', async () => {
  vi.mocked(rt.paneFocus).mockResolvedValueOnce({
    ok: false,
    error: 'tray unavailable',
  });
  const res = await routes.request('/api/panes/w1:p1/focus', {
    method: 'POST',
  });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: 'tray unavailable' });
});

test('GET /api/panes/accounts and /directories pass through; directories forwards q', async () => {
  vi.mocked(rt.paneAccounts).mockResolvedValueOnce({
    ok: true,
    data: { accounts: [] },
  });
  vi.mocked(rt.paneDirectories).mockResolvedValueOnce({
    ok: true,
    data: { directories: [] },
  });
  expect((await routes.request('/api/panes/accounts')).status).toBe(200);
  expect((await routes.request('/api/panes/directories?q=chat')).status).toBe(
    200
  );
  expect(rt.paneDirectories).toHaveBeenCalledWith(
    { q: 'chat' },
    expect.anything()
  );
});

test('POST /api/panes spawns with every field and answers pane plus ready', async () => {
  vi.mocked(rt.paneSpawn).mockResolvedValueOnce({
    ok: true,
    data: { pane: PANE, ready: true },
  });
  const res = await routes.request('/api/panes', {
    method: 'POST',
    body: JSON.stringify({
      cwd: '/repos/chat',
      account: 'Acme',
      model: 'claude-fable-5',
      effort: 'high',
      prompt: 'hi',
      workspace: 'chat',
    }),
  });
  expect(res.status).toBe(200);
  expect(rt.paneSpawn).toHaveBeenCalledWith(
    {
      cwd: '/repos/chat',
      account: 'Acme',
      model: 'claude-fable-5',
      effort: 'high',
      prompt: 'hi',
      workspace: 'chat',
    },
    expect.anything()
  );
  expect(await res.json()).toEqual({ pane: PANE, ready: true });
});

test('POST /api/panes rejects a missing or relative cwd, and maps an unknown account to 400', async () => {
  expect(
    (
      await routes.request('/api/panes', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    ).status
  ).toBe(400);
  expect(
    (
      await routes.request('/api/panes', {
        method: 'POST',
        body: JSON.stringify({ cwd: 'relative' }),
      })
    ).status
  ).toBe(400);
  vi.mocked(rt.paneSpawn).mockResolvedValueOnce({
    ok: false,
    error: 'unknown cswap account "nobody"',
  });
  const res = await routes.request('/api/panes', {
    method: 'POST',
    body: JSON.stringify({ cwd: '/x', account: 'nobody' }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'unknown cswap account "nobody"' });
});
