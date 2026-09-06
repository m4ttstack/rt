import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// Proves /slack/resolve and /slack/post reject a `channel` body value outside
// the configured set (config.slack.channel + every tab's slackChannel, see
// configuredSlackChannels in data.ts) with a 400 before ever touching Slack
// or GitLab. Real (non-fixture) boot -- fixture mode always reports slack as
// unconfigured (server.ts's getSlackToken short-circuits to null under
// BOARD_FIXTURE), which would hit the earlier "slack not configured" 400
// before ever reaching the channel check this test targets. A fake $HOME
// with a team settings store (mirrors server-healthz-fast.test.ts) plus a
// non-empty SLACK_TOKEN gets past that gate without a real Slack workspace;
// the channel-validation 400 fires before either handler calls cache.get()
// or makes any Slack API call, so no live GitLab/Slack connectivity is
// needed for this assertion to hold.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-slack-channel-'));

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

const PORT = 47945;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      // Keeps the booted server from writing state/board-port into the repo.
      BOARD_APP_ROOT: fakeHome,
      PORT: String(PORT),
      GITLAB_TOKEN: '',
      // Truthy but fake: only needs to clear the `!slackToken` gate. Both
      // endpoints reject an unconfigured `channel` before making any real
      // Slack API call, so this token is never actually used over the wire.
      SLACK_TOKEN: 'fake-slack-token',
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

test('/slack/resolve rejects a channel outside the configured set', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/slack/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mrUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
      iid: 1,
      channel: 'not-a-real-channel',
    }),
  });
  expect(res.status).toBe(400);
  // "code-review" is the only configured channel (DEFAULT_SLACK.channel; no
  // board.tabs override in this fake store) -- named in the error body.
  expect(await res.text()).toContain('code-review');
}, 15_000);

test('/slack/post rejects a channel outside the configured set', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/slack/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mrUrls: ['https://gitlab.example.com/g/p/-/merge_requests/1'],
      channel: 'not-a-real-channel',
    }),
  });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('code-review');
}, 15_000);
