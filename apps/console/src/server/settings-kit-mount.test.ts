// @vitest-environment node
import { createApp } from '@mattstack/app-server/app';
import type { RtSettingsApi } from '@mattstack/settings-kit/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSettingsRoutes } from './settings';

const DEFS: Record<string, Record<string, unknown>> = {
  'rt.logLevel': {
    key: 'rt.logLevel',
    type: 'string',
    scopes: ['machine', 'user'],
    merge: 'replace',
    description: 'Daemon log level.',
    default: 'info',
  },
  'rt.repoRoots': {
    key: 'rt.repoRoots',
    type: 'array',
    scopes: ['machine'],
    merge: 'replace',
    description: 'Scan roots.',
    schema: { type: 'array', items: { type: 'string' } },
  },
  'rt.cron': {
    key: 'rt.cron',
    type: 'object',
    scopes: ['machine'],
    merge: 'deep',
    description: 'Scheduled jobs.',
  },
};

const writes: unknown[][] = [];
const unsets: unknown[][] = [];

const RT = {
  allDefs: () => Object.values(DEFS),
  getDef: (key: string) => DEFS[key],
  isMigrated: () => true,
  explainSetting: () => [
    { scope: 'default', file: null, present: true, value: 'info' },
  ],
  validateValue: () => ({ ok: true }),
  setSetting: (...args: unknown[]) => {
    writes.push(args);
  },
  unsetSetting: (...args: unknown[]) => {
    unsets.push(args);
    return true;
  },
} as unknown as RtSettingsApi;

const app = createSettingsRoutes({ rt: RT });

const peer = (address: string) => ({ requestIP: () => ({ address }) });
const LOOPBACK = peer('127.0.0.1');

function post(
  host: string,
  body: unknown,
  type = 'application/json',
  headers: Record<string, string> = {},
  verb = 'set'
) {
  return new Request(`http://${host}/api/settings/${verb}`, {
    method: 'POST',
    headers: { 'content-type': type, host, ...headers },
    body: JSON.stringify(body),
  });
}

const LOG_LEVEL = { key: 'rt.logLevel', scope: 'machine', value: 'debug' };

const UNSET_LOG_LEVEL = { key: 'rt.logLevel', scope: 'machine' };

beforeEach(() => {
  writes.length = 0;
  unsets.length = 0;
});

describe('settings-kit behind console', () => {
  it('serves the registry with shaped composites writable', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/settings/defs')
    );
    expect(res.status).toBe(200);
    const { defs } = (await res.json()) as {
      defs: { key: string; writable: boolean }[];
    };
    expect(defs.map(d => d.key)).toEqual([
      'rt.logLevel',
      'rt.repoRoots',
      'rt.cron',
    ]);
    expect(defs.find(d => d.key === 'rt.repoRoots')?.writable).toBe(true);
    expect(defs.find(d => d.key === 'rt.cron')?.writable).toBe(false);
  });

  it('writes from a local host', async () => {
    const res = await app.fetch(post('localhost', LOG_LEVEL), LOOPBACK);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('refuses a write that arrives through a public host', async () => {
    const res = await app.fetch(
      post('console.example.dev', LOG_LEVEL),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a write the public edge stamped, even with a local host', async () => {
    const res = await app.fetch(
      post('localhost', LOG_LEVEL, 'application/json', {
        'x-mattstack-edge': 'public',
      }),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a write from a peer off this machine', async () => {
    const res = await app.fetch(post('localhost', LOG_LEVEL), peer('10.0.0.2'));
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('unsets from a local host', async () => {
    const res = await app.fetch(
      post('localhost', UNSET_LOG_LEVEL, 'application/json', {}, 'unset'),
      LOOPBACK
    );
    expect(res.status).toBe(200);
    expect(unsets).toHaveLength(1);
  });

  it('refuses an unset that arrives through a public host', async () => {
    const res = await app.fetch(
      post(
        'console.example.dev',
        UNSET_LOG_LEVEL,
        'application/json',
        {},
        'unset'
      ),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(unsets).toHaveLength(0);
  });

  it('refuses an unset the public edge stamped, even with a local host', async () => {
    const res = await app.fetch(
      post(
        'localhost',
        UNSET_LOG_LEVEL,
        'application/json',
        { 'x-mattstack-edge': 'public' },
        'unset'
      ),
      LOOPBACK
    );
    expect(res.status).toBe(403);
    expect(unsets).toHaveLength(0);
  });

  it('keeps the peer check when mounted in the served app', async () => {
    const served = createApp({
      name: 'console',
      version: '0.0.0',
      routes: createSettingsRoutes({ rt: RT }),
      shellHandoff: async () => null,
    });
    const refused = await served.fetch(
      post('localhost', LOG_LEVEL),
      peer('10.0.0.2')
    );
    expect(refused.status).toBe(403);
    expect(writes).toHaveLength(0);
    const allowed = await served.fetch(post('localhost', LOG_LEVEL), LOOPBACK);
    expect(allowed.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('a caller cannot drop the write gate by passing allowWrite: undefined', async () => {
    const loose = createSettingsRoutes({
      rt: RT,
      allowWrite: undefined,
    } as Parameters<typeof createSettingsRoutes>[0]);
    const res = await loose.fetch(
      post('localhost', LOG_LEVEL),
      peer('10.0.0.2')
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a non-JSON write', async () => {
    const res = await app.fetch(
      post(
        'localhost',
        { key: 'rt.logLevel', scope: 'machine', value: 'debug' },
        'text/plain'
      )
    );
    expect(res.status).toBe(415);
  });

  it('refuses a composite with no shape', async () => {
    const res = await app.fetch(
      post('localhost', { key: 'rt.cron', scope: 'machine', value: {} })
    );
    expect(res.status).toBe(400);
  });

  it('404s an unknown settings path instead of falling through silently', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/settings/nope')
    );
    expect(res.status).toBe(404);
  });
});
