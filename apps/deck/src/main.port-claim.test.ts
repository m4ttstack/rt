import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// A deck that loses the port race must exit before touching shared state:
// launchd retries the loser every 10s, so any write it makes before dying
// is a second live writer on the winner's registry and routes.
const REGISTRY = JSON.stringify(
  {
    version: 1,
    apps: {
      deck: {
        name: 'deck',
        managedBy: 'deck',
        port: 47980,
        kind: 'service',
        label: 'com.mattstack.deck',
        sourceDirectory: '/nowhere/deck',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      board: {
        name: 'board',
        managedBy: 'rt',
        port: 47981,
        kind: 'service',
        label: 'com.mattstack.deck.board',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  },
  null,
  2
);
const ROUTES = '[]';

const heldGateway = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => new Response('held'),
});
afterAll(() => heldGateway.stop(true));

const heldApi = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => new Response('held'),
});
afterAll(() => heldApi.stop(true));

async function losingBoot(ports: { api: number; gateway: number }) {
  const home = mkdtempSync(join(tmpdir(), 'deck-port-claim-'));
  writeFileSync(join(home, 'registry.json'), REGISTRY);
  writeFileSync(join(home, 'routes.json'), ROUTES);
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
        PORT: String(ports.api),
        LOCAL_APPS_CANARY_PORT: '47984',
        LOCAL_APPS_GATEWAY_PORT: String(ports.gateway),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000)),
  ]);
  if (exitCode === 'timeout') proc.kill();
  return {
    exitCode,
    registry: readFileSync(join(home, 'registry.json'), 'utf8'),
    routes: readFileSync(join(home, 'routes.json'), 'utf8'),
  };
}

test('a deck that loses the gateway port leaves registry and routes untouched', async () => {
  const boot = await losingBoot({ api: 47983, gateway: heldGateway.port! });

  expect(boot.exitCode).toBe(1);
  expect(boot.registry).toBe(REGISTRY);
  expect(boot.routes).toBe(ROUTES);
}, 15_000);

test('a deck that loses the API port leaves registry and routes untouched', async () => {
  const boot = await losingBoot({ api: heldApi.port!, gateway: 0 });

  expect(boot.exitCode).toBe(1);
  expect(boot.registry).toBe(REGISTRY);
  expect(boot.routes).toBe(ROUTES);
}, 15_000);
