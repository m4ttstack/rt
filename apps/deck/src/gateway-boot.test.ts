import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

const dir = mkdtempSync(join(tmpdir(), 'deck-gateway-boot-'));
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, 'routes.json');
process.env.LOCAL_APPS_SETTINGS_PATH = join(dir, 'settings.json');
process.env.LOCAL_PLATFORM_SETTINGS_PATH = join(dir, 'platform.json');
process.env.HOME = dir;

const { startGateway } = await import('../core/gateway.ts');
const { bindGatewayOrExit } = await import('./gateway-boot.ts');

const holder = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => new Response('held'),
});
afterAll(() => holder.stop(true));

test('exits 1 when the gateway port is already held, instead of running without a public edge', () => {
  const exits: number[] = [];
  const errs: unknown[][] = [];
  const probed: number[] = [];

  const server = bindGatewayOrExit({
    start: () => startGateway(holder.port),
    exit: code => {
      exits.push(code);
    },
    err: (...args) => {
      errs.push(args);
    },
    holder: port => {
      probed.push(port);
    },
  });

  expect(server).toBeNull();
  expect(exits).toEqual([1]);
  expect(String(errs[0]?.[0])).toContain('gateway failed to start');
  // The dying process names the port it lost so the log can convict the holder.
  expect(probed.length).toBe(1);
});

test('returns the bound server and never exits when the port is free', () => {
  const exits: number[] = [];

  const server = bindGatewayOrExit({
    start: () => startGateway(0),
    exit: code => {
      exits.push(code);
    },
    err: () => {},
    holder: () => {},
  });

  expect(server).not.toBeNull();
  expect(server!.port).toBeGreaterThan(0);
  expect(exits).toEqual([]);
  server!.stop(true);
});
