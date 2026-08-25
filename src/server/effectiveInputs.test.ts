// @vitest-environment node
import type {
  RunDetail,
  RunStageRow,
  RunSummary,
  SettingDef,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  getRun: vi.fn(),
  getSetting: vi.fn(),
  getDef: vi.fn(),
}));

const { mountEffectiveInputs, parsePackCommits } =
  await import('./effectiveInputs');
const rt = await import('@mattstack/rt-client');

type RunResult = { code: number; stdout: string; stderr: string };

function fakeRun(handler: (argv: string[]) => RunResult) {
  const calls: string[][] = [];
  const run = vi.fn(async (argv: string[]) => {
    calls.push(argv);
    return handler(argv);
  });
  return { run, calls };
}

function fakeRt(result: RunResult) {
  return fakeRun(() => result);
}

function packsStdout(packs: { name: string; dir: string }[]): string {
  return JSON.stringify({
    packs: packs.map(p => ({ ...p, layout: 'grouped' })),
  });
}

const CONFIG_DEPS = [
  'rt.worktrees',
  'rt.branchNaming',
  'rt.presets',
  'rt.variations',
  'rt.runaway',
  'rt.runsPruneDays',
];

function baseRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    repo: 'repo-tools',
    work_type: 'bugfix',
    pipeline: 'feature',
    status: 'running',
    current_stage: 'provision',
    spawned_by: null,
    started_at: 0,
    ended_at: null,
    pack_commits: 'mattstack=59b90cd',
    pack_dirty: 0,
    attention: { needs: false, reason: null, evidence: '' },
    last_event_at: 0,
    ticket: null,
    branch: null,
    ...overrides,
  };
}

function baseStage(overrides: Partial<RunStageRow> = {}): RunStageRow {
  return {
    name: 'provision',
    status: 'done',
    attempt: 1,
    started_at: 0,
    ended_at: 0,
    reason: null,
    detail_path: null,
    ...overrides,
  };
}

function baseDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    run: baseRun(),
    stages: [baseStage()],
    fields: [],
    decisions: [],
    schemaAhead: false,
    ...overrides,
  };
}

describe('parsePackCommits', () => {
  it('parses whitespace-separated pack=sha pairs', () => {
    expect(parsePackCommits('mattstack=59b90cd demo=abc123')).toEqual([
      { pack: 'mattstack', sha: '59b90cd' },
      { pack: 'demo', sha: 'abc123' },
    ]);
  });

  it('answers [] for null', () => {
    expect(parsePackCommits(null)).toEqual([]);
  });

  it('answers [] for an empty string', () => {
    expect(parsePackCommits('')).toEqual([]);
  });

  it('drops a malformed token rather than throwing', () => {
    expect(parsePackCommits('mattstack=59b90cd not-a-pair')).toEqual([
      { pack: 'mattstack', sha: '59b90cd' },
    ]);
  });
});

describe('effective-inputs route', () => {
  it('carries pipeline/workType from the run row, drifted pack versions, deduped stages, and every config row', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({
        run: baseRun({
          pipeline: 'feature',
          work_type: 'bugfix',
          pack_commits: 'mattstack=59b90cd',
          pack_dirty: 1,
        }),
        stages: [
          baseStage({ name: 'provision', attempt: 1 }),
          baseStage({ name: 'implement', attempt: 1 }),
          baseStage({ name: 'provision', attempt: 2 }),
        ],
      }),
    });
    vi.mocked(rt.getSetting).mockImplementation((key: string) => ({
      value: `val:${key}`,
      provenance: [{ scope: 'user', file: '/f' }],
    }));

    const rtFake = fakeRt({
      code: 0,
      stdout: packsStdout([{ name: 'mattstack', dir: '/packs/mattstack' }]),
      stderr: '',
    });
    const git = fakeRun(() => ({
      code: 0,
      stdout: '1111111abcdef\n',
      stderr: '',
    }));
    const app = mountEffectiveInputs(new Hono(), rtFake.run, git.run);

    const res = await app.request(
      '/api/runs/repo-tools/run-1/effective-inputs'
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipeline).toBe('feature');
    expect(body.workType).toBe('bugfix');
    expect(body.packDirty).toBe(true);
    expect(body.stages).toEqual(['provision', 'implement']);
    expect(body.packVersions).toEqual([
      {
        pack: 'mattstack',
        recordedSha: '59b90cd',
        currentSha: '1111111abcdef',
        drifted: true,
      },
    ]);
    expect(body.config).toEqual(
      CONFIG_DEPS.map(key => ({
        key,
        value: `val:${key}`,
        provenance: [{ scope: 'user', file: '/f' }],
      }))
    );
    expect(rt.getSetting).toHaveBeenCalledTimes(CONFIG_DEPS.length);
    const headCall = git.calls.find(argv => argv.includes('rev-parse'));
    expect(headCall).toEqual(['-C', '/packs/mattstack', 'rev-parse', 'HEAD']);
  });

  it('answers packVersions: null on a pre-v2 run, still 200, and resolves no pack', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({ run: baseRun({ pack_commits: null }) }),
    });
    vi.mocked(rt.getSetting).mockImplementation((key: string) => ({
      value: `val:${key}`,
      provenance: [],
    }));

    const rtFake = fakeRt({ code: 0, stdout: '{}', stderr: '' });
    const git = fakeRun(() => ({ code: 0, stdout: '', stderr: '' }));
    const app = mountEffectiveInputs(new Hono(), rtFake.run, git.run);

    const res = await app.request(
      '/api/runs/repo-tools/run-1/effective-inputs'
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packVersions).toBeNull();
    expect(rtFake.run).not.toHaveBeenCalled();
    expect(git.run).not.toHaveBeenCalled();
  });

  it('skips a config key whose getSetting throws rather than 500ing the panel', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({ run: baseRun({ pack_commits: null }) }),
    });
    vi.mocked(rt.getSetting).mockImplementation((key: string) => {
      if (key === 'rt.runaway') throw new Error('rt: unregistered key');
      return { value: `val:${key}`, provenance: [] };
    });

    const app = mountEffectiveInputs(
      new Hono(),
      fakeRt({ code: 0, stdout: '{}', stderr: '' }).run,
      fakeRun(() => ({ code: 0, stdout: '', stderr: '' })).run
    );

    const res = await app.request(
      '/api/runs/repo-tools/run-1/effective-inputs'
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toHaveLength(CONFIG_DEPS.length - 1);
    expect(
      (body.config as { key: string }[]).some(row => row.key === 'rt.runaway')
    ).toBe(false);
  });

  it('excludes a config key whose def is marked secret from the payload, without reading its value', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({ run: baseRun({ pack_commits: null }) }),
    });
    vi.mocked(rt.getSetting).mockImplementation((key: string) => ({
      value: `val:${key}`,
      provenance: [],
    }));
    vi.mocked(rt.getDef).mockImplementation(
      (key: string): SettingDef | undefined =>
        key === 'rt.runaway'
          ? {
              key,
              type: 'boolean',
              scopes: ['user'],
              merge: 'replace',
              secret: true,
              description: 'Secret dep, never on the wire.',
            }
          : undefined
    );
    vi.mocked(rt.getSetting).mockClear();

    const app = mountEffectiveInputs(
      new Hono(),
      fakeRt({ code: 0, stdout: '{}', stderr: '' }).run,
      fakeRun(() => ({ code: 0, stdout: '', stderr: '' })).run
    );

    const res = await app.request(
      '/api/runs/repo-tools/run-1/effective-inputs'
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toHaveLength(CONFIG_DEPS.length - 1);
    expect(
      (body.config as { key: string }[]).some(row => row.key === 'rt.runaway')
    ).toBe(false);
    expect(rt.getSetting).not.toHaveBeenCalledWith('rt.runaway');
  });

  it('translates an unknown run into 404, not 502', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: false,
      error: 'run not found',
    });

    const app = mountEffectiveInputs(new Hono());
    const res = await app.request(
      '/api/runs/repo-tools/does-not-exist/effective-inputs'
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'run not found' });
  });

  it('translates a genuine daemon failure into 502', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: false,
      error: 'daemon socket exploded',
    });

    const app = mountEffectiveInputs(new Hono());
    const res = await app.request(
      '/api/runs/repo-tools/run-1/effective-inputs'
    );

    expect(res.status).toBe(502);
  });
});

describe('stage-doc route', () => {
  it('returns the compiled doc text at the first recorded pack + sha', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({
        run: baseRun({ pack_commits: 'mattstack=59b90cd' }),
      }),
    });

    const rtFake = fakeRt({
      code: 0,
      stdout: packsStdout([{ name: 'mattstack', dir: '/packs/mattstack' }]),
      stderr: '',
    });
    const git = fakeRun(() => ({
      code: 0,
      stdout: '# provision doc\n',
      stderr: '',
    }));
    const app = mountEffectiveInputs(new Hono(), rtFake.run, git.run);

    const res = await app.request(
      '/api/runs/repo-tools/run-1/stage-doc?stage=provision'
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: '# provision doc\n' });
    const show = git.calls.find(argv => argv.includes('show'));
    expect(show).toEqual([
      '-C',
      '/packs/mattstack',
      'show',
      '59b90cd:attachments/stage-provision/SKILL.md',
    ]);
  });

  it('answers a missing doc (git show exit 128) with the exact 404 copy', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({
        run: baseRun({ pack_commits: 'mattstack=59b90cd' }),
      }),
    });

    const rtFake = fakeRt({
      code: 0,
      stdout: packsStdout([{ name: 'mattstack', dir: '/packs/mattstack' }]),
      stderr: '',
    });
    const git = fakeRun(() => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: path not in the working tree',
    }));
    const app = mountEffectiveInputs(new Hono(), rtFake.run, git.run);

    const res = await app.request(
      '/api/runs/repo-tools/run-1/stage-doc?stage=provision'
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'no compiled doc recorded at this version',
    });
  });

  it('answers the same 404 when the run recorded no pack commits', async () => {
    vi.mocked(rt.getRun).mockResolvedValue({
      ok: true,
      data: baseDetail({ run: baseRun({ pack_commits: null }) }),
    });

    const rtFake = fakeRt({ code: 0, stdout: '{}', stderr: '' });
    const git = fakeRun(() => ({ code: 0, stdout: 'unreachable', stderr: '' }));
    const app = mountEffectiveInputs(new Hono(), rtFake.run, git.run);

    const res = await app.request(
      '/api/runs/repo-tools/run-1/stage-doc?stage=provision'
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'no compiled doc recorded at this version',
    });
    expect(git.run).not.toHaveBeenCalled();
  });

  it('rejects a stage name shaped like a path escape with 400, before touching rt or git', async () => {
    const getRunCallsBefore = vi.mocked(rt.getRun).mock.calls.length;
    const rtFake = fakeRt({ code: 0, stdout: '{}', stderr: '' });
    const git = fakeRun(() => ({ code: 0, stdout: '', stderr: '' }));
    const app = mountEffectiveInputs(new Hono(), rtFake.run, git.run);

    const res = await app.request(
      '/api/runs/repo-tools/run-1/stage-doc?stage=' +
        encodeURIComponent('../evil')
    );

    expect(res.status).toBe(400);
    expect(rtFake.run).not.toHaveBeenCalled();
    expect(git.run).not.toHaveBeenCalled();
    // The format check runs before the run is even looked up.
    expect(vi.mocked(rt.getRun).mock.calls.length).toBe(getRunCallsBefore);
  });
});
