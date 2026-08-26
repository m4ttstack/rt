import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatMark: vi.fn(),
  chatBuddies: vi.fn(),
  daemonHealth: vi.fn(),
  getSetting: vi.fn(() => ({ value: 'matt' })),
}));
const rt = await import('@mattstack/rt-client');
const { app } = await import('./app');

beforeEach(() => vi.resetAllMocks());

test('GET /api/daemon reports unreachable rather than 500ing', async () => {
  vi.mocked(rt.daemonHealth).mockResolvedValueOnce({
    reachable: false,
    error: 'rt daemon unreachable at /x/rt.sock: ECONNREFUSED',
  });
  const res = await app.request('/api/daemon');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ reachable: false });
});

test('GET /api/daemon relays a reachable probe the same way', async () => {
  vi.mocked(rt.daemonHealth).mockResolvedValueOnce({ reachable: true });
  const res = await app.request('/api/daemon');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ reachable: true });
});
