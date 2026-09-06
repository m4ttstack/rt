import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// Sparkle replaces the whole bundle on update (this process's inode vanishes
// mid-run) and launchd sends SIGTERM before its grace period expires either
// way -- proves the board exits promptly and cleanly on both, rather than
// leaking past its grace period into a SIGKILL. Real (non-fixture) boot, same
// isolation as server-healthz-fast.test.ts.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-sigterm-'));

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

/** A port the OS just told us was free, rather than a hardcoded one. A fixed
    port makes this test read a *previous* run's leaked server as "ready", then
    SIGTERM a child that never bound and see 143 instead of a clean exit. */
function freePort(): number {
  const probe = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  });
  const port = probe.port;
  probe.stop();
  return port;
}

let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;

// Spawned inside the test, not at module load: `bun test -t <filter>` still
// imports every test file, so a module-level spawn starts a server whose
// afterAll never runs, and it survives to squat the port on the next run.
afterAll(async () => {
  if (!proc) return;
  proc.kill('SIGKILL');
  await proc.exited;
});

test('SIGTERM exits promptly with code 0, not leaked past the grace period', async () => {
  const port = freePort();
  proc = Bun.spawn(['bun', 'run', join(import.meta.dir, '..', 'server.ts')], {
    env: {
      ...process.env,
      HOME: fakeHome,
      // Without this the booted server writes state/board-port into the repo,
      // pointing a developer's live board's status writers at a test port.
      BOARD_APP_ROOT: fakeHome,
      PORT: String(port),
      GITLAB_TOKEN: '',
      SLACK_TOKEN: '',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let healthy = false;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 100));
  }
  // Surfaces the child's own output, so a boot failure reads as the boot
  // failure it is rather than as a bare exit code from the kill below.
  expect({
    healthy,
    stderr: healthy ? '' : await new Response(proc.stderr).text(),
  }).toEqual({ healthy: true, stderr: '' });

  proc.kill('SIGTERM');
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);

  // The port is actually released, not just the process reaping -- a lingering
  // listener would mean shutdown() returned before httpServer.stop() took effect.
  await expect(
    fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(500),
    })
  ).rejects.toThrow();
});
