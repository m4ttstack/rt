// @vitest-environment node
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
  unsetSetting: () => true,
} as unknown as RtSettingsApi;

const app = createSettingsRoutes({ rt: RT });

const peer = (address: string) => ({ requestIP: () => ({ address }) });
const LOOPBACK = peer('127.0.0.1');

function post(
  host: string,
  body: unknown,
  type = 'application/json',
  headers: Record<string, string> = {}
) {
  return new Request(`http://${host}/api/settings/set`, {
    method: 'POST',
    headers: { 'content-type': type, host, ...headers },
    body: JSON.stringify(body),
  });
}

const LOG_LEVEL = { key: 'rt.logLevel', scope: 'machine', value: 'debug' };

beforeEach(() => {
  writes.length = 0;
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
