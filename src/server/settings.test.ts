// @vitest-environment node
import type { ExplainRow, SettingDef } from '@mattstack/rt-client';
import { describe, expect, it, vi } from 'vitest';

const DEFS: SettingDef[] = [
  {
    key: 'rt.runsPruneDays',
    type: 'number',
    scopes: ['user', 'machine'],
    default: 30,
    merge: 'replace',
    description: 'Days before a finished run is pruned.',
  },
  {
    key: 'rt.worktrees',
    type: 'object',
    scopes: ['user', 'team', 'machine'],
    merge: 'deep',
    description: 'Worktree pool configuration.',
  },
  {
    key: 'board.apiToken',
    type: 'string',
    scopes: ['user'],
    merge: 'replace',
    secret: true,
    description: 'Forge API token.',
  },
  {
    key: 'rt.legacyThing',
    type: 'string',
    scopes: ['user'],
    merge: 'replace',
    migrated: false,
    legacyFile: '~/.rt/legacy.json',
    description: 'Still read from a legacy file.',
  },
];

const EXPLAIN: Record<string, ExplainRow[]> = {
  'rt.runsPruneDays': [
    { scope: 'default', file: null, present: true, value: 30 },
    {
      scope: 'user',
      file: '/home/u/.mattstack/user/settings.jsonc',
      present: true,
      value: 45,
    },
    {
      scope: 'machine',
      file: '/home/u/.mattstack/machine.jsonc',
      present: false,
    },
  ],
  'board.apiToken': [
    { scope: 'default', file: null, present: false },
    {
      scope: 'user',
      file: '/home/u/.mattstack/user/settings.jsonc',
      present: true,
      value: 'sk-SECRET',
    },
  ],
};

vi.mock('@mattstack/rt-client', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'rt.runsPruneDays') return { value: 45, provenance: [] };
    throw new Error(`unexpected setting key in test: ${key}`);
  }),
  allDefs: vi.fn(() => DEFS),
  getDef: vi.fn((key: string) => DEFS.find(d => d.key === key)),
  isMigrated: (def: SettingDef) => def.migrated !== false,
  validateValue: (def: SettingDef, value: unknown) =>
    typeof value === def.type
      ? { ok: true }
      : { ok: false, reason: `expected ${def.type}, got ${typeof value}` },
  explainSetting: vi.fn((key: string) => {
    const rows = EXPLAIN[key];
    if (!rows) throw new Error(`rt: unknown setting "${key}"`);
    return rows;
  }),
  setSetting: vi.fn(),
}));

const { settings } = await import('./settings');
const rt = await import('@mattstack/rt-client');

function post(body: unknown): Request {
  return new Request('http://localhost/api/settings/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('settings api', () => {
  it('resolves rt.runsPruneDays through the registry rather than a hardcoded number', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/runs-prune-days')
    );

    expect(res.status).toBe(200);
    // 45, not 30 (the registry default), pins that the route forwards
    // whatever the resolver returns instead of a literal.
    await expect(res.json()).resolves.toEqual({ days: 45 });
    expect(rt.getSetting).toHaveBeenCalledWith('rt.runsPruneDays');
  });

  it('lists defs with writability computed, not copied', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/defs')
    );

    expect(res.status).toBe(200);
    const { defs } = (await res.json()) as {
      defs: { key: string; writable: boolean; secret: boolean }[];
    };
    const byKey = new Map(defs.map(d => [d.key, d]));
    // scalar + migrated -> writable; composite, secret, and migrated:false all not.
    expect(byKey.get('rt.runsPruneDays')?.writable).toBe(true);
    expect(byKey.get('rt.worktrees')?.writable).toBe(false);
    expect(byKey.get('board.apiToken')?.writable).toBe(false);
    expect(byKey.get('rt.legacyThing')?.writable).toBe(false);
  });

  it('explains a key as its def plus the resolver rows', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/explain/rt.runsPruneDays')
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      def: { key: string };
      rows: { scope: string; value?: unknown }[];
    };
    expect(body.def.key).toBe('rt.runsPruneDays');
    expect(body.rows.map(r => r.scope)).toEqual(['default', 'user', 'machine']);
    expect(body.rows[1].value).toBe(45);
  });

  it('404s an unknown key instead of leaking the thrown error as a 500', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/explain/no.such')
    );
    expect(res.status).toBe(404);
  });

  it('never puts a secret value on the wire — presence only', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/explain/board.apiToken')
    );

    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('sk-SECRET');
    const body = JSON.parse(text) as { rows: { present: boolean }[] };
    expect(body.rows[1].present).toBe(true);
  });

  it('sets a valid value and answers with the re-read chain', async () => {
    const res = await settings.fetch(
      post({ key: 'rt.runsPruneDays', value: 14, scope: 'user' })
    );

    expect(res.status).toBe(200);
    expect(rt.setSetting).toHaveBeenCalledWith(
      'rt.runsPruneDays',
      14,
      'user',
      {}
    );
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(3);
  });

  it('refuses a composite key with the spec copy', async () => {
    const res = await settings.fetch(
      post({ key: 'rt.worktrees', value: {}, scope: 'user' })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'composite value — edit the file',
    });
  });

  it('refuses a secret key outright', async () => {
    const res = await settings.fetch(
      post({ key: 'board.apiToken', value: 'x', scope: 'user' })
    );
    expect(res.status).toBe(400);
    expect(rt.setSetting).not.toHaveBeenCalledWith(
      'board.apiToken',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('refuses a scope the def does not allow, naming the allowed ones', async () => {
    const res = await settings.fetch(
      post({ key: 'rt.runsPruneDays', value: 14, scope: 'team' })
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('user');
    expect(error).toContain('machine');
  });

  it('refuses a type-invalid value with the validator reason', async () => {
    const res = await settings.fetch(
      post({ key: 'rt.runsPruneDays', value: 'soon', scope: 'user' })
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('expected number');
  });

  it('refuses a non-migrated key at the front door, never reaching setSetting', async () => {
    const res = await settings.fetch(
      post({ key: 'rt.legacyThing', value: 'x', scope: 'user' })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: '"rt.legacyThing" is not writable through the resolver yet',
    });
    expect(rt.setSetting).not.toHaveBeenCalledWith(
      'rt.legacyThing',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('surfaces a setSetting refusal as a 400, not a 500', async () => {
    vi.mocked(rt.setSetting).mockImplementationOnce(() => {
      throw new Error('rt: two teams have local stores — pass --team');
    });
    const res = await settings.fetch(
      post({ key: 'rt.runsPruneDays', value: 14, scope: 'user' })
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('two teams');
  });
});
