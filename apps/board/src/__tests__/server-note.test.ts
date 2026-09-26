/** POST /note: the row's own note (B10). Writes through to the state db the
    server booted with, clears on an empty body, and refuses anything that is
    not a local POST with an MR and a string. Same minimal boot as
    server-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { MAX_NOTE_LEN, readNotes } from '../row-note.ts';
import { openStateDb } from '../state/db.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-note-route-'));

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

const PORT = 47963;
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

function note(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/note`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('writes the note, then clears it on an empty save', async () => {
  await ready();
  const res = await note({ mrUrl: MR, text: '  rebase after !8 lands ' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    note: 'rebase after !8 lands',
  });
  expect(readNotes(db).get(MR)).toBe('rebase after !8 lands');

  const cleared = await note({ mrUrl: MR, text: '' });
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toEqual({ ok: true, note: null });
  expect(readNotes(db).has(MR)).toBe(false);
}, 15_000);

test('is POST-only and validates its body', async () => {
  await ready();
  expect((await fetch(`http://127.0.0.1:${PORT}/note`)).status).toBe(405);
  expect((await note({ mrUrl: MR })).status).toBe(400);
  expect((await note({ text: 'orphan' })).status).toBe(400);
  expect((await note({ mrUrl: MR, text: 42 })).status).toBe(400);
  expect(
    (await note({ mrUrl: MR, text: 'x'.repeat(MAX_NOTE_LEN + 1) })).status
  ).toBe(400);
}, 15_000);
