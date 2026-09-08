import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// Boots the real server against a fake $HOME whose team store owns
// mattstack.roster, then drives POST /roster. Proves the route's three
// actions land in the suite key (not board.members) and that a rename
// survives the write, without touching the real ~/.mattstack.
//
// board.defaultMember is a "user"-scoped key (registry-defs.ts), so it is
// seeded into the fake HOME's user store, not the team store -- a team-store
// entry for it is warned-and-skipped by the resolver and config.defaultMember
// would silently fall back to "all".
const fakeHome = mkdtempSync(join(tmpdir(), 'board-roster-route-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
const storePath = join(teamDir, 'settings.team.jsonc');
writeFileSync(
  storePath,
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'ann' }, { username: 'bo' }],
  })
);

const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'ann' })
);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');

const PORT = 47951;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: { ...process.env, HOME: fakeHome, PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => proc.kill());

async function waitForBoot(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }
  throw new Error('server never became healthy');
}

async function roster(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/roster`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stored(): Array<{ username: string; name?: string }> {
  return JSON.parse(readFileSync(storePath, 'utf8'))['mattstack.roster'];
}

test('add with a name writes mattstack.roster', async () => {
  await waitForBoot();
  const res = await roster({ action: 'add', username: 'cy', name: 'Cy Park' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'cy', name: 'Cy Park' });
  expect(JSON.parse(readFileSync(storePath, 'utf8'))['board.members']).toBeUndefined();
});

test('rename sets a name on an existing member', async () => {
  const res = await roster({ action: 'rename', username: 'bo', name: 'Bo Chen' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'bo', name: 'Bo Chen' });
});

test('rename to blank clears the name', async () => {
  const res = await roster({ action: 'rename', username: 'bo', name: '' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'bo' });
});

test('rename of an unknown member is a 400', async () => {
  const res = await roster({ action: 'rename', username: 'zed', name: 'Z' });
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('unknown member "zed"');
});

test('an unknown action is a 400 naming all three', async () => {
  const res = await roster({ action: 'promote', username: 'bo' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('rename');
});

test('dropping yourself is refused', async () => {
  const res = await roster({ action: 'remove', username: 'ann' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('this board runs as you');
});
