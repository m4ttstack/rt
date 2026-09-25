import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, expect, test } from 'bun:test';

const dir = mkdtempSync(join(tmpdir(), 'la-routes-'));
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, 'routes.json');
const routesPath = process.env.LOCAL_APPS_ROUTES_PATH;

const { removeRoutes, repointRoutes, setRoutePort } =
  await import('./routes-writer.ts');
const { readRoutes } = await import('./discover.ts');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(join(dir, 'routes.lock'), { recursive: true, force: true });
  writeFileSync(
    routesPath,
    JSON.stringify(
      [
        { hostname: 'boxscore.localhost', port: 8787, pid: 0 },
        { hostname: 'prisma7.localhost', port: 8083, pid: 0 },
      ],
      null,
      2
    )
  );
});

test("changes only the matching entry's port, preserves other fields", () => {
  expect(setRoutePort('boxscore', 5173)).toBe(true);
  const routes = JSON.parse(readFileSync(routesPath, 'utf8'));
  expect(routes.find(r => r.hostname === 'boxscore.localhost')).toEqual({
    hostname: 'boxscore.localhost',
    port: 5173,
    pid: 0,
  });
  expect(routes.find(r => r.hostname === 'prisma7.localhost')).toEqual({
    hostname: 'prisma7.localhost',
    port: 8083,
    pid: 0,
  });
});

test('accepts a full .localhost hostname', () => {
  expect(setRoutePort('boxscore.localhost', 4000)).toBe(true);
  const routes = JSON.parse(readFileSync(routesPath, 'utf8'));
  expect(routes.find(r => r.hostname === 'boxscore.localhost').port).toBe(4000);
});

test("the write preserves the file's inode, keeping portless's fs.watch alive", () => {
  // portless watches routes.json by path with fs.watch, which follows the inode.
  // An atomic temp+rename write replaces the inode and permanently deafens the
  // proxy to later route changes, so .localhost silently serves stale ports.
  // If this fails, the writer went back to rename-based writing.
  const before = statSync(routesPath).ino;
  setRoutePort('boxscore', 5173);
  setRoutePort('boxscore', 5174); // repeated writes must keep the same inode
  expect(statSync(routesPath).ino).toBe(before);
});

test('a torn read falls back to the last good routes, never an empty table', () => {
  // In-place writes mean a reader can catch the file half-written. Reporting no
  // routes then would empty the gateway's table and 404 every app.
  expect(readRoutes()).toHaveLength(2);
  writeFileSync(routesPath, '[{"hostname": "boxscore.localh'); // partial write
  expect(readRoutes()).toHaveLength(2);
});

test('the write leaves no temp file behind', () => {
  setRoutePort('boxscore', 5173);
  expect(existsSync(routesPath + '.tmp')).toBe(false);
});

test('no-op returns false when the entry is absent', () => {
  expect(setRoutePort('ghost', 5173)).toBe(false);
  expect(JSON.parse(readFileSync(routesPath, 'utf8'))).toHaveLength(2);
});

test('ensureRoute appends a missing hostname once and never duplicates', async () => {
  const path = process.env.LOCAL_APPS_ROUTES_PATH!;
  writeFileSync(
    path,
    JSON.stringify([{ hostname: 'a.localhost', port: 1, pid: 0 }])
  );
  const { ensureRoute } = await import('./routes-writer.ts');
  expect(ensureRoute('deck.mattstack', 11007)).toBe(true);
  expect(ensureRoute('deck.mattstack', 11007)).toBe(false);
  const routes = JSON.parse(readFileSync(path, 'utf8'));
  expect(routes.map((r: { hostname: string }) => r.hostname)).toEqual([
    'a.localhost',
    'deck.mattstack',
  ]);
});

test('repointRoutes moves every host under a name to one port, in place, and nothing else', () => {
  writeFileSync(
    routesPath,
    JSON.stringify([
      { hostname: 'deck.localhost', port: 11007, pid: 0 },
      { hostname: 'deck.mattstack', port: 11007, pid: 0 },
      { hostname: 'deck.mattstack.localhost', port: 7940, pid: 0 },
      { hostname: 'deckhand.localhost', port: 11007, pid: 0 },
      { hostname: 'deck.docs.localhost', port: 11007, pid: 0 },
      { hostname: 'deck.docs.mattstack', port: 11007, pid: 0 },
      { hostname: 'board.mattstack', port: 11007, pid: 0 },
    ])
  );
  const before = statSync(routesPath).ino;

  expect(repointRoutes('deck', 7940, ['localhost', 'mattstack'])).toEqual([
    'deck.localhost',
    'deck.mattstack',
  ]);

  const ports = Object.fromEntries(
    JSON.parse(readFileSync(routesPath, 'utf8')).map(
      (r: { hostname: string; port: number }) => [r.hostname, r.port]
    )
  );
  expect(ports).toEqual({
    'deck.localhost': 7940,
    'deck.mattstack': 7940,
    'deck.mattstack.localhost': 7940,
    'deckhand.localhost': 11007,
    'deck.docs.localhost': 11007,
    'deck.docs.mattstack': 11007,
    'board.mattstack': 11007,
  });
  expect(statSync(routesPath).ino).toBe(before);
});

test('repointRoutes writes nothing when every host already serves the port', () => {
  writeFileSync(
    routesPath,
    JSON.stringify([{ hostname: 'deck.localhost', port: 7940, pid: 0 }])
  );
  const raw = readFileSync(routesPath, 'utf8');

  expect(repointRoutes('deck', 7940, ['localhost'])).toEqual([]);
  expect(readFileSync(routesPath, 'utf8')).toBe(raw);
});

/** A pid that no process holds: a child that has already exited and been reaped. */
function deadPid(): number {
  return Bun.spawnSync(['true']).pid;
}

function hostnames(): string[] {
  return JSON.parse(readFileSync(routesPath, 'utf8')).map(
    (r: { hostname: string }) => r.hostname
  );
}

const lockPath = join(dir, 'routes.lock');

test("removeRoutes drops a name's static routes under every TLD, in place, and nothing else", async () => {
  writeFileSync(
    routesPath,
    JSON.stringify([
      { hostname: 'gitq.localhost', port: 11008, pid: 0 },
      { hostname: 'gitq.mattstack', port: 11008, pid: 0 },
      { hostname: 'gitq-docs.mattstack', port: 11009, pid: 0 },
      { hostname: 'gitq.docs.mattstack', port: 11010, pid: 0 },
      { hostname: 'board.mattstack', port: 11006, pid: 0 },
    ])
  );
  const before = statSync(routesPath).ino;

  expect(await removeRoutes('gitq', ['localhost', 'mattstack'])).toEqual([
    'gitq.localhost',
    'gitq.mattstack',
  ]);

  expect(hostnames()).toEqual([
    'gitq-docs.mattstack',
    'gitq.docs.mattstack',
    'board.mattstack',
  ]);
  expect(statSync(routesPath).ino).toBe(before);
});

test('removeRoutes drops a route whose process is gone and keeps one whose process is alive', async () => {
  writeFileSync(
    routesPath,
    JSON.stringify([
      { hostname: 'gitq.localhost', port: 11008, pid: deadPid() },
      { hostname: 'gitq.mattstack', port: 11008, pid: process.pid },
    ])
  );

  expect(await removeRoutes('gitq', ['localhost', 'mattstack'])).toEqual([
    'gitq.localhost',
  ]);
  expect(hostnames()).toEqual(['gitq.mattstack']);
});

test('removeRoutes with no routes file has nothing to remove', async () => {
  rmSync(routesPath);
  expect(await removeRoutes('gitq', ['localhost'])).toEqual([]);
  expect(existsSync(routesPath)).toBe(false);
});

test('removeRoutes throws when the write fails, so a remove can report it, and releases the lock', async () => {
  writeFileSync(
    routesPath,
    JSON.stringify([{ hostname: 'gitq.mattstack', port: 11008, pid: 0 }])
  );
  chmodSync(routesPath, 0o444);
  try {
    await expect(
      removeRoutes('gitq', ['localhost', 'mattstack'])
    ).rejects.toThrow(/EACCES/);
  } finally {
    chmodSync(routesPath, 0o644);
  }
  expect(existsSync(lockPath)).toBe(false);
});

test("removeRoutes waits for portless's routes.lock, then takes and releases it", async () => {
  writeFileSync(
    routesPath,
    JSON.stringify([{ hostname: 'gitq.mattstack', port: 11008, pid: 0 }])
  );
  mkdirSync(lockPath);
  const removing = removeRoutes('gitq', ['localhost', 'mattstack']);

  await Bun.sleep(150);
  expect(hostnames()).toEqual(['gitq.mattstack']);

  rmSync(lockPath, { recursive: true });
  expect(await removing).toEqual(['gitq.mattstack']);
  expect(hostnames()).toEqual([]);
  expect(existsSync(lockPath)).toBe(false);
});

test('removeRoutes takes over a routes.lock older than 10s', async () => {
  writeFileSync(
    routesPath,
    JSON.stringify([{ hostname: 'gitq.mattstack', port: 11008, pid: 0 }])
  );
  mkdirSync(lockPath);
  const stale = (Date.now() - 11_000) / 1000;
  utimesSync(lockPath, stale, stale);

  expect(await removeRoutes('gitq', ['localhost', 'mattstack'])).toEqual([
    'gitq.mattstack',
  ]);
  expect(existsSync(lockPath)).toBe(false);
});
