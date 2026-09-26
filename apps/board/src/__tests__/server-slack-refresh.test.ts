import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { dbPathForRoot, openStateDb } from '../state/index.ts';

// Proves POST /slack/refresh runs a FORCED sweep: a `notfound` ref checked a
// moment ago (which the periodic sweep would leave alone until its retry
// window passes) is re-resolved against the channel and flips to `found`.
// Same boot recipe as server-slack-post-channel.test.ts: real server, fake rt
// daemon over a unix socket, slack.com answered by slack-api-mock-preload.ts.
// The periodic sweep is disabled (autoResolveIntervalMinutes 0) so the only
// thing that can flip the ref is the endpoint under test.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-slack-refresh-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.team.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'board.members': [{ username: 'alice' }],
    'board.slack': { channel: 'code-review', autoResolveIntervalMinutes: 0 },
  })
);

writeFileSync(join(fakeHome, '.mattstack', 'machine-key'), 'testmachine');
const machineDir = join(fakeHome, '.mattstack', 'user', 'local', 'testmachine');
mkdirSync(machineDir, { recursive: true });
writeFileSync(
  join(machineDir, 'settings.local.jsonc'),
  JSON.stringify({
    'board.rtRepos': [{ project: 'g/p', repo: 'gitlab.example.com/g/p' }],
  })
);

const mrUrl = 'https://gitlab.example.com/g/p/-/merge_requests/601';

const pr = {
  id: 'gitlab:601',
  iid: 601,
  repositoryId: 'gitlab:42',
  title: 'An MR',
  description: null,
  state: 'opened',
  draft: false,
  conflicts: false,
  webUrl: mrUrl,
  sourceBranch: 'feat/x',
  targetBranch: 'main',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
  sha: null,
  author: { id: 'gitlab:1', username: 'alice', name: 'Alice', avatarUrl: null },
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

// A fresh notfound ref: the periodic sweep's retry window has not elapsed.
// Seeded directly into the same state.db the spawned server will open (same
// HOME, no BOARD_STATE_DB override -- boardStateRoot() resolves identically
// in both processes).
const seedDb = openStateDb(
  dbPathForRoot(join(fakeHome, '.mattstack', 'board'))
);
seedDb
  .query('INSERT INTO slack_refs (mr_url, ref, updated_at) VALUES (?, ?, ?)')
  .run(
    mrUrl,
    JSON.stringify({
      mrUrl,
      iid: 601,
      status: 'notfound',
      checkedAt: Date.now(),
    }),
    Date.now()
  );
seedDb.close();

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/project-mrs:read') {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            mrs: {
              'gitlab:601': {
                pr,
                fetchedAt: Date.now(),
                codeownerSections: [],
              },
            },
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

const PORT = 47947;
const proc = Bun.spawn(
  [
    'bun',
    'run',
    '--preload',
    join(import.meta.dir, 'slack-api-mock-preload.ts'),
    join(import.meta.dir, '..', 'server.ts'),
  ],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      PORT: String(PORT),
      GITLAB_TOKEN: '',
      SLACK_TOKEN: 'fake-slack-token',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
      SLACK_MOCK_MR_URL: mrUrl,
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

async function slackStatus(): Promise<
  { status?: string; posted?: boolean } | undefined
> {
  const data = (await (
    await fetch(`http://127.0.0.1:${PORT}/data.json`)
  ).json()) as {
    mrs: Array<{ webUrl: string; slack?: { status: string; posted: boolean } }>;
  };
  return data.mrs.find(m => m.webUrl === mrUrl)?.slack;
}

test('/slack/refresh re-resolves a fresh notfound ref the periodic sweep would skip', async () => {
  await ready();
  expect((await slackStatus())?.status).toBe('notfound');

  const res = await fetch(`http://127.0.0.1:${PORT}/slack/refresh`, {
    method: 'POST',
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, resolved: 1, failed: 0 });

  const after = await slackStatus();
  expect(after?.status).toBe('found');
  expect(after?.posted).toBe(true);
}, 15_000);

test('/slack/refresh is POST-only', async () => {
  await ready();
  expect((await fetch(`http://127.0.0.1:${PORT}/slack/refresh`)).status).toBe(
    405
  );
}, 15_000);
