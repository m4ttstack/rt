/** POST /triage/stand-down: the row menu's "never diagnose this stack".
    Flips the sticky memory flag runTriage checks (serialized behind the
    same tryClaimCron claim bin/triage.ts's own pass holds), and while
    turning it on, resolves + authorizes the MR from a real snapshot (own
    MRs only -- see resolveStandDownTarget) and cleans up whatever the
    doctor left on that MR's row AND every descendant's.

    Real (non-fixture) boot: fixture mode answers /data.json from a canned
    file and refuses every POST outright, so it can't exercise this route's
    cache.get()-backed authorization at all. A fake rt daemon (unix socket,
    mirrors server-slack-post-channel.test.ts's pattern) serves the MRs so
    cache.get() resolves real ownership/stack data without any GitLab
    connectivity. */
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
    'board.members': [{ username: 'alice' }, { username: 'bob' }],
  })
);

// board.defaultMember is a "user"-scoped key (registry-defs.ts): a
// team-store entry is warned-and-skipped by the resolver and
// config.defaultMember would silently fall back to "all" -- see
// server-roster-route.test.ts's own note on the same gotcha.
const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'alice' })
);

// board.rtRepos is machine-scoped (registry-defs.ts), not team-scoped -- a
// team-store value for it is silently ignored, which would leave
// fetchTeamMRs with no daemon mapping for "g/p" and every MR dropped before
// buildBoard ever saw them (same note as server-slack-post-channel.test.ts).
writeFileSync(join(fakeHome, '.mattstack', 'machine-key'), 'testmachine');
const machineDir = join(fakeHome, '.mattstack', 'user', 'local', 'testmachine');
mkdirSync(machineDir, { recursive: true });
writeFileSync(
  join(machineDir, 'settings.local.jsonc'),
  JSON.stringify({
    'board.rtRepos': [{ project: 'g/p', repo: 'gitlab.example.com/g/p' }],
  })
);

const GITLAB_HOST = 'https://gitlab.example.com';
const url = (iid: number) => `${GITLAB_HOST}/g/p/-/merge_requests/${iid}`;

function fakePr(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `gitlab:${overrides.iid}`,
    iid: overrides.iid,
    repositoryId: 'gitlab:42',
    title: 'An MR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: url(overrides.iid as number),
    sourceBranch: overrides.sourceBranch ?? 'feat/x',
    targetBranch: overrides.targetBranch ?? 'main',
    isStacked: overrides.isStacked ?? false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    sha: null,
    author: overrides.author,
    assignees: [],
    reviewers: [],
    roles: [],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 1,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

const ALICE = {
  id: 'gitlab:1',
  username: 'alice',
  name: 'Alice',
  avatarUrl: null,
};
const BOB = { id: 'gitlab:2', username: 'bob', name: 'Bob', avatarUrl: null };

// PARENT (7) <- CHILD (8): a real stack, both alice's. SOLO (9) and QUIET
// (11) and LIVE (13) are standalone alice MRs. OTHERS (20) is bob's, for
// the ownership check. UNKNOWN's iid (99) is never served.
const PARENT = url(7);
const CHILD = url(8);
const SOLO = url(9);
const QUIET = url(11);
const LIVE = url(13);
const OTHERS = url(20);
const UNKNOWN = url(99);

const mrs = [
  fakePr({
    iid: 7,
    author: ALICE,
    sourceBranch: 'feat-parent',
    targetBranch: 'main',
  }),
  fakePr({
    iid: 8,
    author: ALICE,
    sourceBranch: 'feat-child',
    targetBranch: 'feat-parent',
    isStacked: true,
  }),
  fakePr({ iid: 9, author: ALICE, sourceBranch: 'feat-solo' }),
  fakePr({ iid: 11, author: ALICE, sourceBranch: 'feat-quiet' }),
  fakePr({ iid: 13, author: ALICE, sourceBranch: 'feat-live' }),
  fakePr({ iid: 20, author: BOB, sourceBranch: 'feat-bob' }),
];

const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/project-mrs:read') {
      const byId: Record<string, unknown> = {};
      for (const pr of mrs) {
        byId[(pr as { id: string }).id] = {
          pr,
          fetchedAt: Date.now(),
          codeownerSections: [],
        };
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            mrs: byId,
            listSyncedAt: Date.now(),
            source: 'poll',
            syncedAt: Date.now(),
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ ok: false, error: 'not implemented' }),
      {
        headers: { 'content-type': 'application/json' },
      }
    );
  },
});

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

afterAll(() => {
  proc.kill();
  rtDaemon.stop(true);
});

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
    mintHandle('doctor', PARENT, fakeHome),
    { mrUrl: PARENT, iid: 7, status: 'error', message: 'registry push flake' },
    1000,
    db
  );
  writeDraft(
    PARENT,
    'inherited-note',
    { mrUrl: PARENT, iid: 7, body: 'draft body', status: 'held' },
    1000,
    db
  );

  const res = await standDown({ mrUrl: PARENT, on: true });
  expect(res.status).toBe(200);
  const resBody = (await res.json()) as { ok: boolean; standDown: boolean };
  expect(resBody).toEqual({ ok: true, standDown: true });

  expect(readMemory(db).mrs[PARENT]?.standDown).toBe(true);

  const doctorAfter = readDoctorStates(db).get(PARENT)!;
  expect(doctorAfter.status).toBe('done');
  expect(doctorAfter.message).toBe('stood down by operator');

  const draftAfter = readDrafts(db).find(d => d.mrUrl === PARENT);
  expect(draftAfter?.status).toBe('dismissed');
}, 15_000);

test('the whole stack: standing down the parent also cleans up the child row', async () => {
  await ready();
  writeDoctorState(
    mintHandle('doctor', CHILD, fakeHome),
    { mrUrl: CHILD, iid: 8, status: 'error', message: 'inherited failure' },
    1000,
    db
  );

  const res = await standDown({ mrUrl: PARENT, on: true });
  expect(res.status).toBe(200);

  // Only the submitted MR's own memory flag is set -- the child inherits
  // via isStoodDown's ancestor walk, not its own flag.
  expect(readMemory(db).mrs[CHILD]?.standDown).toBeUndefined();
  const childDoctor = readDoctorStates(db).get(CHILD)!;
  expect(childDoctor.status).toBe('done');
  expect(childDoctor.message).toBe('stood down by operator');
}, 15_000);

test('turning it off clears only the flag, leaving other state alone', async () => {
  await ready();
  const res = await standDown({ mrUrl: PARENT, on: false });
  expect(res.status).toBe(200);
  expect(readMemory(db).mrs[PARENT]?.standDown).toBe(false);
  // The prior test's doctor clear/draft dismissal stand: turning off never
  // re-launches or un-dismisses anything by itself.
  expect(readDoctorStates(db).get(PARENT)!.status).toBe('done');
}, 15_000);

test('a fresh MR with no memory row yet still gets one', async () => {
  await ready();
  expect(readMemory(db).mrs[SOLO]).toBeUndefined();
  const res = await standDown({ mrUrl: SOLO, on: true });
  expect(res.status).toBe(200);
  expect(readMemory(db).mrs[SOLO]?.standDown).toBe(true);
  expect(readMemory(db).mrs[SOLO]?.attemptsToday).toBe(0);
}, 15_000);

test('an unknown MR (not on the board) 400s rather than creating a memory row', async () => {
  await ready();
  const res = await standDown({ mrUrl: UNKNOWN, on: true });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('unknown MR');
  expect(readMemory(db).mrs[UNKNOWN]).toBeUndefined();
}, 15_000);

test("someone else's MR 403s, even though it resolves on the board", async () => {
  await ready();
  const res = await standDown({ mrUrl: OTHERS, on: true });
  expect(res.status).toBe(403);
  expect(await res.text()).toBe('not your MR');
  expect(readMemory(db).mrs[OTHERS]).toBeUndefined();
}, 15_000);

test('is POST-only and validates the body', async () => {
  await ready();
  expect(
    (await fetch(`http://127.0.0.1:${PORT}/triage/stand-down`)).status
  ).toBe(405);
  expect((await standDown({ on: true })).status).toBe(400);
  expect((await standDown({ mrUrl: PARENT })).status).toBe(400);
}, 15_000);

test('on: true against an MR with no doctor row and no drafts is a no-op past the flag flip', async () => {
  await ready();
  const res = await standDown({ mrUrl: QUIET, on: true });
  expect(res.status).toBe(200);
  expect(readDoctorStates(db).get(QUIET)).toBeUndefined();
}, 15_000);

test('nudging an in-flight doctor with an unreachable pane never fails the request', async () => {
  await ready();
  writeDoctorState(
    mintHandle('doctor', LIVE, fakeHome),
    { mrUrl: LIVE, iid: 13, status: 'fixing', paneId: 'not-a-real-pane' },
    1000,
    db
  );
  const res = await standDown({ mrUrl: LIVE, on: true });
  expect(res.status).toBe(200);
  expect(readDoctorStates(db).get(LIVE)!.status).toBe('done');
}, 15_000);
