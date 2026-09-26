import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deck-api-info-'));
  process.env.LOCAL_STATE_DIR = dir;
  process.env.LOCAL_REGISTRY_PATH = join(dir, 'registry.json');
  process.env.HOME = dir;
});

/** A pid that has already exited: spawnSync returns only after `true` does. */
function deadPid(): number {
  return Bun.spawnSync(['true']).pid;
}

async function putSelfRecord(port: number): Promise<void> {
  const { putRecord, reloadRegistry } = await import('../registry/records.ts');
  reloadRegistry();
  putRecord({
    name: 'deck',
    managedBy: 'deck',
    port,
    kind: 'service',
    createdAt: 'x',
    label: 'com.mattstack.deck',
    command: ['/Users/someone/.local/bin/deck', 'serve'],
    workingDirectory: dir,
  });
}

test("uses api.json's port while the process that wrote it is alive", async () => {
  const { resolveApiInfo } = await import('./api-info.ts');
  await putSelfRecord(11007);
  writeFileSync(
    join(dir, 'api.json'),
    JSON.stringify({ port: 7940, pid: process.pid })
  );

  expect(resolveApiInfo()).toEqual({ port: 7940 });
});

test("falls back to the self record's port when api.json names a dead pid", async () => {
  const { resolveApiInfo } = await import('./api-info.ts');
  await putSelfRecord(11007);
  writeFileSync(
    join(dir, 'api.json'),
    JSON.stringify({ port: 7940, pid: deadPid() })
  );

  expect(resolveApiInfo()).toEqual({ port: 11007 });
});

test("falls back to the self record's port when api.json is missing", async () => {
  const { resolveApiInfo } = await import('./api-info.ts');
  await putSelfRecord(11007);

  expect(resolveApiInfo()).toEqual({ port: 11007 });
});

test('returns null when api.json is stale and there is no self record', async () => {
  const { reloadRegistry } = await import('../registry/records.ts');
  const { resolveApiInfo } = await import('./api-info.ts');
  reloadRegistry();
  writeFileSync(
    join(dir, 'api.json'),
    JSON.stringify({ port: 7940, pid: deadPid() })
  );

  expect(resolveApiInfo()).toBeNull();
});

test("falls back to the self record's port when api.json carries no pid to vouch for it", async () => {
  const { resolveApiInfo } = await import('./api-info.ts');
  await putSelfRecord(11007);
  writeFileSync(join(dir, 'api.json'), JSON.stringify({ port: 7940 }));

  expect(resolveApiInfo()).toEqual({ port: 11007 });
});
