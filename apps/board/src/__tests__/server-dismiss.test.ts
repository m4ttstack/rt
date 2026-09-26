/** POST /dismiss: the status line's "dismiss" on a failed lane. Stamps the
    lane dismissed against a real state db (BOARD_APP_ROOT points at the fake
    home), changing nothing else, and refuses a lane it does not own. Minimal
    boot, same recipe as server-reconciler-clear.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readDoctorStates, writeDoctorState } from '../doctor-state.ts';
import { mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-dismiss-'));

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
const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);
// The server mints its handles off BOARD_APP_ROOT; this row has to land
// under the same one or the route would look at a different handle.
const handle = mintHandle('doctor', MR, fakeHome);
writeDoctorState(
  handle,
  { mrUrl: MR, iid: 7, status: 'error', message: 'registry push flake' },
  1000,
  db
);

const PORT = 47961;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      BOARD_STATE_DB: dbPath,
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

function dismiss(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('stamps the lane dismissed, keeping its status and message', async () => {
  await ready();
  const res = await dismiss({ mrUrl: MR, lane: 'doctor' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; dismissedAt: number };
  expect(body.ok).toBe(true);

  const after = readDoctorStates(db).get(MR)!;
  expect(after.status).toBe('error');
  expect(after.message).toBe('registry push flake');
  expect(after.dismissedAt).toBe(body.dismissedAt);
  // The stamp is never older than the write it dismissed, which is what
  // makes the row skip the lane.
  expect(after.dismissedAt!).toBeGreaterThanOrEqual(after.updatedAt);
}, 15_000);

test('is POST-only and validates the lane and the MR', async () => {
  await ready();
  expect((await fetch(`http://127.0.0.1:${PORT}/dismiss`)).status).toBe(405);
  expect((await dismiss({ mrUrl: MR, lane: 'gitlab' })).status).toBe(400);
  expect((await dismiss({ lane: 'doctor' })).status).toBe(400);
  expect((await dismiss({ mrUrl: `${MR}00`, lane: 'doctor' })).status).toBe(
    404
  );
}, 15_000);
