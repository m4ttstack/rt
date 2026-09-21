/** POST /triage/stand-down: the row menu's "never diagnose this stack".
    Flips the sticky memory flag runTriage checks, and while turning it on,
    clears whatever the doctor left on this MR's own row (status, held
    draft). Real state db + real subprocess, same recipe as
    server-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readDoctorStates, writeDoctorState } from '../doctor-state.ts';
import { readDrafts, writeDraft } from '../draft-state.ts';
import { mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory } from '../triage/memory-store.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-stand-down-'));

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
const doctorHandle = mintHandle('doctor', MR, fakeHome);

const PORT = 47962;
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

function standDown(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/triage/stand-down`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('turning it on flips the memory flag, clears the doctor row, and dismisses a held draft', async () => {
  await ready();
  writeDoctorState(
    doctorHandle,
    { mrUrl: MR, iid: 7, status: 'error', message: 'registry push flake' },
    1000,
    db
  );
  writeDraft(
    MR,
    'inherited-note',
    { mrUrl: MR, iid: 7, body: 'draft body', status: 'held' },
    1000,
    db
  );

  const res = await standDown({ mrUrl: MR, iid: 7, on: true });
  expect(res.status).toBe(200);
  const resBody = (await res.json()) as { ok: boolean; standDown: boolean };
  expect(resBody).toEqual({ ok: true, standDown: true });

  expect(readMemory(db).mrs[MR]?.standDown).toBe(true);

  const doctorAfter = readDoctorStates(db).get(MR)!;
  expect(doctorAfter.status).toBe('done');
  expect(doctorAfter.message).toBe('stood down by operator');

  const draftAfter = readDrafts(db).find(d => d.mrUrl === MR);
  expect(draftAfter?.status).toBe('dismissed');
}, 15_000);

test('turning it off clears only the flag, leaving other state alone', async () => {
  await ready();
  const res = await standDown({ mrUrl: MR, iid: 7, on: false });
  expect(res.status).toBe(200);
  expect(readMemory(db).mrs[MR]?.standDown).toBe(false);
  // The prior test's doctor clear/draft dismissal stand: turning off never
  // re-launches or un-dismisses anything by itself.
  expect(readDoctorStates(db).get(MR)!.status).toBe('done');
}, 15_000);

test('a fresh MR with no memory row yet still gets one', async () => {
  await ready();
  const freshMr = 'https://gitlab.example.com/g/p/-/merge_requests/9';
  expect(readMemory(db).mrs[freshMr]).toBeUndefined();
  const res = await standDown({ mrUrl: freshMr, iid: 9, on: true });
  expect(res.status).toBe(200);
  expect(readMemory(db).mrs[freshMr]?.standDown).toBe(true);
  expect(readMemory(db).mrs[freshMr]?.attemptsToday).toBe(0);
}, 15_000);

test('is POST-only and validates the body', async () => {
  await ready();
  expect(
    (await fetch(`http://127.0.0.1:${PORT}/triage/stand-down`)).status
  ).toBe(405);
  expect((await standDown({ iid: 7, on: true })).status).toBe(400);
  expect((await standDown({ mrUrl: MR, on: true })).status).toBe(400);
  expect((await standDown({ mrUrl: MR, iid: 7 })).status).toBe(400);
}, 15_000);

test('on: true against an MR with no doctor row and no drafts is a no-op past the flag flip', async () => {
  await ready();
  const quietMr = 'https://gitlab.example.com/g/p/-/merge_requests/11';
  const res = await standDown({ mrUrl: quietMr, iid: 11, on: true });
  expect(res.status).toBe(200);
  expect(readDoctorStates(db).get(quietMr)).toBeUndefined();
}, 15_000);

test('nudging an in-flight doctor with an unreachable pane never fails the request', async () => {
  await ready();
  const liveMr = 'https://gitlab.example.com/g/p/-/merge_requests/13';
  writeDoctorState(
    mintHandle('doctor', liveMr, fakeHome),
    {
      mrUrl: liveMr,
      iid: 13,
      status: 'fixing',
      paneId: 'not-a-real-pane',
    },
    1000,
    db
  );
  const res = await standDown({ mrUrl: liveMr, iid: 13, on: true });
  expect(res.status).toBe(200);
  expect(readDoctorStates(db).get(liveMr)!.status).toBe('done');
}, 15_000);
