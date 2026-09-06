import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// Proves server.ts's settingsHandler mount refreshes the module-level `config`
// singleton after a successful write. Before that fix, `config` was only
// resolved once at boot and reloaded on config.json changes -- a write
// through this very API (e.g. the ConfigModal) persisted correctly but never
// reached a running process without a restart. Real (non-fixture) boot, so
// server.ts's actual settingsHandler mount and reload path both run for real.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-settings-reload-'));

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

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');

const PORT = 47944;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      PORT: String(PORT),
      GITLAB_TOKEN: 'fake',
      SLACK_TOKEN: '',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => {
  proc.kill();
});

async function waitForBoot(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('board never came up');
}

// /data.json's `title` field reads `config.title` fresh on every request
// (unlike the served HTML shell's <title>, which is baked once at boot into
// a module-level string -- a separate, pre-existing quirk this test doesn't
// touch), so it is the right place to observe whether `config` itself, the
// object this fix refreshes, actually changed.
async function dataJsonTitle(): Promise<string> {
  const body = (await (
    await fetch(`http://127.0.0.1:${PORT}/data.json`)
  ).json()) as { title: string };
  return body.title;
}

test('a board.* setting written through /api/settings/set applies live, no restart', async () => {
  await waitForBoot();
  expect(await dataJsonTitle()).toBe('MRs ready for review'); // BoardConfig's default, unset in the fixture team store

  const setRes = await fetch(`http://127.0.0.1:${PORT}/api/settings/set`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: 'board.title',
      value: 'Reload Proof',
      scope: 'team',
    }),
  });
  expect(setRes.ok).toBe(true);

  // No restart between the write and this read -- the same process must
  // reflect it on the very next request.
  expect(await dataJsonTitle()).toBe('Reload Proof');
}, 20_000);
