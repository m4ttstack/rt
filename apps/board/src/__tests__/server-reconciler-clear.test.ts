import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// Proves POST /reconciler/clear (SDD executor-reconciler task 14): a thin
// proxy onto the daemon's `reconciler:clear` command, same shape as
// /gate/focus -- forward the body, degrade to a 502 JSON error when the
// daemon's own `{ok, data}` envelope says `ok: false` (never trust HTTP
// status alone, since the daemon answers every command with HTTP 200 and
// encodes success/failure in the body), and gate on method/CSRF/body shape
// like every other POST route. Minimal boot, same recipe as
// server-healthz-fast.test.ts: no MR/gitlab traffic needed for this route.
//
// The fake daemon below mirrors rt-client's real transport contract: the
// request PATHNAME IS THE COMMAND NAME (`/reconciler:status`,
// `/reconciler:clear`), POSTed with a JSON payload, answered with a JSON
// `{ok, data}` or `{ok: false, error}` body at HTTP 200.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-reconciler-clear-'));

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

// Records every command the board forwards and answers per-command so a
// test can flip one outcome without touching the others.
const seen: Array<{ cmd: string; body: unknown }> = [];
let clearOutcome: 'ok' | 'fail' = 'ok';
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const cmd = pathname.slice(1);
    const body =
      req.method === 'POST' ? await req.json().catch(() => null) : null;
    seen.push({ cmd, body });
    if (cmd === 'reconciler:clear') {
      if (clearOutcome === 'fail')
        return new Response(
          JSON.stringify({ ok: false, error: 'daemon refused' }),
          { headers: { 'content-type': 'application/json' } }
        );
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (cmd === 'reconciler:status') {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { sweptAt: 0, herdrReachable: true, executors: [] },
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

const PORT = 47953;
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

function clear(
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/reconciler/clear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('forwards { agentId } to the daemon as reconciler:clear and returns ok', async () => {
  await ready();
  const res = await clear({ agentId: 'agent-9' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  const forwarded = seen.find(s => s.cmd === 'reconciler:clear');
  expect(forwarded?.body).toEqual({ agentId: 'agent-9' });
}, 15_000);

test('is POST-only', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/reconciler/clear`);
  expect(res.status).toBe(405);
}, 15_000);

test('rejects a body missing agentId with 400', async () => {
  await ready();
  const res = await clear({});
  expect(res.status).toBe(400);
}, 15_000);

test('an {ok:false} envelope from the daemon degrades to a 502 and never reports success', async () => {
  await ready();
  clearOutcome = 'fail';
  try {
    const res = await clear({ agentId: 'agent-9' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('daemon refused');
  } finally {
    clearOutcome = 'ok';
  }
}, 15_000);

test('GET /data.json sweeps the reconciler view via the reconciler:status command', async () => {
  await ready();
  await fetch(`http://127.0.0.1:${PORT}/data.json`);
  expect(seen.some(s => s.cmd === 'reconciler:status')).toBe(true);
  expect(
    seen.some(s => s.cmd === 'reconciler' || s.cmd === 'api/reconciler')
  ).toBe(false);
}, 15_000);
