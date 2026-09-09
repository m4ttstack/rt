import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { insertAgentState, mintHandle, setReportByHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

// Proves the real (non-fixture) /respond/report route -- readRespondReport's
// wiring into server.ts -- answers 404 before a fill has saved anything and
// 200 with the markdown once it has. Same minimal boot as
// server-healthz-fast.test.ts: a fake $HOME with a team settings store, no
// config.json, no live tokens.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-respond-report-'));

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

const PORT = 47946;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
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

const MR_URL = 'https://gitlab.example.com/g/p/-/merge_requests/1';

// The server process resolves its db via boardStateRoot(), which (absent
// BOARD_STATE_DB) is $HOME/.mattstack/board/state.db -- HOME is set to
// fakeHome above, so this is the same file the running server reads.
const stateDbPath = join(fakeHome, '.mattstack', 'board', 'state.db');

test('/respond/report 404s before a fill has saved anything, then serves the saved markdown', async () => {
  await ready();
  const before = await fetch(
    `http://127.0.0.1:${PORT}/respond/report?mr=${encodeURIComponent(MR_URL)}`
  );
  expect(before.status).toBe(404);

  const db = openStateDb(stateDbPath);
  const handle = mintHandle('respond', MR_URL, fakeHome);
  insertAgentState(
    'respond',
    MR_URL,
    1,
    { mrUrl: MR_URL, iid: 1, status: 'done', startedAt: 0, updatedAt: 0 },
    handle,
    db
  );
  setReportByHandle(handle, '# adjudication\n\nreply to thread 7080da2f', db);

  const after = await fetch(
    `http://127.0.0.1:${PORT}/respond/report?mr=${encodeURIComponent(MR_URL)}`
  );
  expect(after.status).toBe(200);
  expect(await after.text()).toContain('reply to thread 7080da2f');
}, 15_000);

test('/respond/report requires the mr query param', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/respond/report`);
  expect(res.status).toBe(400);
});
