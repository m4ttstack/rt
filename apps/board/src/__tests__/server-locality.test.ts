/** Local-only routes refuse anything that came in over a public edge, even
    when the Host it carries is a local one. Same minimal boot as
    server-note.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-locality-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.team.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'board.members': [{ username: 'alice' }],
  })
);

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';

const PORT = 47965;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      BOARD_STATE_DB: join(fakeHome, 'state.db'),
      PORT: String(PORT),
      GITLAB_TOKEN: '',
      SLACK_TOKEN: '',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => proc.kill());

async function ready(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

function post(path: string, headers: Record<string, string>, body: unknown) {
  return fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'board.mattstack',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const EDGES: Record<string, string>[] = [
  { 'x-mattstack-edge': 'public' },
  { 'cf-connecting-ip': '203.0.113.9' },
  { 'tailscale-funnel-request': '?1' },
  { 'x-forwarded-for': '203.0.113.9' },
];

test('a local-only route accepts a local request', async () => {
  await ready();
  const res = await post('/note', {}, { mrUrl: MR, text: 'hi' });
  expect(res.status).toBe(200);
}, 15_000);

test('a local-only route refuses every public edge marker', async () => {
  await ready();
  for (const edge of EDGES) {
    const res = await post('/note', edge, { mrUrl: MR, text: 'hi' });
    expect({ edge, status: res.status }).toEqual({ edge, status: 403 });
  }
}, 15_000);

test('settings writes refuse every public edge marker', async () => {
  await ready();
  for (const edge of EDGES) {
    const res = await post('/api/settings/set', edge, {
      key: 'board.projects',
      scope: 'team',
      value: ['g/q'],
    });
    expect({ edge, status: res.status }).toEqual({ edge, status: 403 });
  }
}, 15_000);

test('member check-in/out refuses every public edge marker', async () => {
  await ready();
  for (const edge of EDGES) {
    const res = await post('/settings', edge, {
      username: 'alice',
      hidden: true,
    });
    expect({ edge, status: res.status }).toEqual({ edge, status: 403 });
  }
}, 15_000);

test('member check-in/out still accepts a local request', async () => {
  await ready();
  const res = await post('/settings', {}, { username: 'alice', hidden: false });
  expect(res.status).not.toBe(403);
  expect(res.ok).toBe(true);
}, 15_000);

test('a forced slack sweep refuses a cross-origin page', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/slack/refresh`, {
    method: 'POST',
    headers: { host: 'board.mattstack', origin: 'https://evil.example.dev' },
  });
  expect(res.status).toBe(403);
}, 15_000);

test('a forced slack sweep passes the gate from its own origin', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/slack/refresh`, {
    method: 'POST',
    headers: { host: 'board.mattstack', origin: 'https://board.mattstack' },
  });
  expect(res.status).toBe(400);
}, 15_000);
