import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// A second deck that dies on a port clash must not leave api.json naming
// its dead API port: every CLI call and every app's deck lookup reads that
// file. Real (non-fixture) boot with the gateway port already held.
const PRIOR = JSON.stringify({ port: 47000, pid: 999_999 });

function spawnDeck(opts: { port: number; gatewayPort: number }): {
  home: string;
  proc: ReturnType<typeof Bun.spawn>;
} {
  const home = mkdtempSync(join(tmpdir(), 'deck-api-json-'));
  writeFileSync(join(home, 'routes.json'), '[]');
  writeFileSync(join(home, 'api.json'), PRIOR);
  const proc = Bun.spawn(
    ['bun', 'run', join(import.meta.dir, 'main.ts'), 'serve'],
    {
      env: {
        ...process.env,
        HOME: home,
        LOCAL_STATE_DIR: home,
        LOCAL_REGISTRY_PATH: join(home, 'registry.json'),
        LOCAL_APPS_ROUTES_PATH: join(home, 'routes.json'),
        LOCAL_APPS_SETTINGS_PATH: join(home, 'settings.json'),
        LOCAL_PLATFORM_SETTINGS_PATH: join(home, 'platform.json'),
        LOCAL_APPS_AUTO_HEAL: '0',
        PORT: String(opts.port),
        LOCAL_APPS_CANARY_PORT: String(opts.port + 1),
        LOCAL_APPS_GATEWAY_PORT: String(opts.gatewayPort),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  return { home, proc };
}

const heldGateway = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => new Response('held'),
});
afterAll(() => heldGateway.stop(true));

test('a deck whose gateway bind fails exits without writing api.json', async () => {
  const { home, proc } = spawnDeck({
    port: 47963,
    gatewayPort: heldGateway.port!,
  });
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000)),
  ]);
  if (exitCode === 'timeout') proc.kill();

  expect(exitCode).toBe(1);
  expect(readFileSync(join(home, 'api.json'), 'utf8')).toBe(PRIOR);
}, 15_000);

test('a deck that binds every port replaces a dead api.json with its own', async () => {
  const { home, proc } = spawnDeck({ port: 47973, gatewayPort: 0 });
  try {
    let recorded: unknown = null;
    for (let i = 0; i < 100; i++) {
      try {
        recorded = JSON.parse(readFileSync(join(home, 'api.json'), 'utf8'));
        if ((recorded as { port: number }).port === 47973) break;
      } catch {
        // writeFileSync truncates first: a poll can land mid-write.
      }
      await new Promise(r => setTimeout(r, 100));
    }
    expect(recorded).toEqual({
      port: 47973,
      pid: proc.pid,
      runMode: 'standalone',
    });
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 15_000);
