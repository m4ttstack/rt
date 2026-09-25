import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import type { Status } from './status.ts';

const dir = mkdtempSync(join(tmpdir(), 'local-api-restart-self-'));
process.env.LOCAL_REGISTRY_PATH = join(dir, 'registry.json');
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, 'routes.json');
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, 'settings.json');
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, 'platform.json');
process.env.LOCAL_AGENTS_DIR = join(dir, 'agents-not-present');
process.env.HOME = dir;
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, '[]');

const { startApi } = await import('./server.ts');
const { FakeServiceManager } = await import('../services/fake.ts');
const { FakeEdgeProxy } = await import('../edge/portless.ts');
const { FakeTunnelDriver } = await import('../edge/tunnel.ts');
const { reloadRegistry, putRecord } = await import('../registry/records.ts');

const PORT = 18951;
const manager = new FakeServiceManager();
let selfAsks = 0;
reloadRegistry();
putRecord({
  name: 'deck',
  managedBy: 'deck',
  port: PORT,
  kind: 'service',
  label: 'com.mattstack.deck',
  createdAt: 'x',
});
const server = startApi({
  manager,
  edge: new FakeEdgeProxy(),
  port: PORT,
  canaryPort: PORT + 1,
  freshness: () => 'unknown',
  autoHeal: () => null,
  onRouteWrite: () => {},
  tunnel: new FakeTunnelDriver(),
  devMode: () => false,
  deckOwner: {
    helperOwned: async () => true,
    runningLabel: async () => 'com.mattstack.deck.dev',
    selfLabel: async () => {
      selfAsks++;
      return 'com.mattstack.deck.dev';
    },
  },
});
afterAll(() => server.stop(true));

test('restarting deck kickstarts the helper launchd runs, not the retired hand label', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/apps/deck/restart`, {
    method: 'POST',
  });

  expect(res.status).toBe(200);
  expect(manager.kickstarts).toEqual(['com.mattstack.deck.dev']);
});

test("deck's row carries the helper's label and this process's pid, so the board offers its restart", async () => {
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: 'deck.localhost', port: PORT, pid: 0 }])
  );
  const status = async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/status`);
    return (await res.json()) as Status;
  };

  const first = await status();
  await status();

  expect(first.canRestart).toBe(true);
  expect(first.apps.find(a => a.name === 'deck')!.service).toMatchObject({
    label: 'com.mattstack.deck.dev',
    short: 'deck',
    pid: process.pid,
  });
  expect(selfAsks).toBe(1);
});
