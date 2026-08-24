// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { RtNotFoundError } from './rt-bin';
import { mountSkills } from './skills';

const fakeRt = (result: { code: number; stdout: string; stderr: string }) => {
  const calls: string[][] = [];
  const run = vi.fn(async (argv: string[]) => {
    calls.push(argv);
    return result;
  });
  return { run, calls };
};

describe('skills routes', () => {
  it('passes --json and the pack through to rt', async () => {
    const rt = fakeRt({
      code: 0,
      stdout: JSON.stringify({ pack: 'demo', verbs: [] }),
      stderr: '',
    });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request('/api/skills/check?pack=demo');

    expect(res.status).toBe(200);
    expect(rt.calls[0]).toEqual([
      'skills',
      'check',
      '--pack',
      'demo',
      '--json',
    ]);
  });

  it('a usage error (exit 1, empty stdout) is 502 -- never a successful empty result', async () => {
    const rt = fakeRt({
      code: 1,
      stdout: '',
      stderr: 'rt skills: no pack named "nope"',
    });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request('/api/skills/check?pack=nope');

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('nope'),
    });
  });

  it('drift (exit 1 WITH a parseable payload) is 200', async () => {
    const payload = {
      pack: 'demo',
      packDir: '/p',
      verbs: [
        {
          name: 'watch-ci',
          status: 'stale',
          staleFiles: ['SKILL.md'],
          orphanFiles: [],
        },
      ],
    };
    const rt = fakeRt({ code: 1, stdout: JSON.stringify(payload), stderr: '' });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request('/api/skills/check?pack=demo');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it('round-trips a composition payload with binders and pipelines intact', async () => {
    const payload = {
      pack: 'demo',
      packDir: '/p',
      verbs: [
        {
          name: 'work',
          engine: 'work',
          engineRef: 'mattstack:work',
          plugin: 'mattstack',
          description: 'do work',
          public: true,
          sourcePath: '/steps/work/SKILL.md',
          artifactPath: '/p/skills/work',
          slots: [
            {
              name: 'tiering',
              contract: 'model-tiering@1',
              required: false,
              boundTo: 'mattstack:model-tiering',
              fillSourcePath: '/fills/model-tiering/SKILL.md',
              fillVersion: '0.8.0',
              registered: false,
              inlined: true,
            },
          ],
        },
      ],
      fills: [
        {
          binding: 'demo:capture-evidence',
          provides: 'evidence-domain@1',
          sourcePath: '/fills/capture-evidence/SKILL.md',
          registered: false,
        },
      ],
      binders: [
        {
          ref: 'mattstack:stage-provision',
          verb: null,
          kind: 'stage',
          slots: [{ name: 'domain', boundTo: 'demo:work-provision' }],
        },
      ],
      pipelines: { feature: ['mattstack:stage-provision'] },
    };
    const rt = fakeRt({ code: 0, stdout: JSON.stringify(payload), stderr: '' });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request('/api/skills/composition?pack=demo');

    expect(res.status).toBe(200);
    expect(rt.calls[0]).toEqual([
      'skills',
      'composition',
      '--pack',
      'demo',
      '--json',
    ]);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it('requires ?pack= on a pack-scoped route rather than falling through to rt with "undefined"', async () => {
    const rt = fakeRt({ code: 0, stdout: '{}', stderr: '' });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request('/api/skills/check');

    expect(res.status).toBe(400);
    expect(rt.run).not.toHaveBeenCalled();
  });

  it('returns 503, not an empty result, when rt cannot be found', async () => {
    const run = vi.fn(async () => {
      throw new RtNotFoundError(['/home/nobody/.local/bin/rt']);
    });
    const app = mountSkills(new Hono(), run);

    const res = await app.request('/api/skills/packs');

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('rt binary not found'),
    });
  });

  it('caches a repeat request for the same pack instead of re-spawning', async () => {
    const rt = fakeRt({
      code: 0,
      stdout: JSON.stringify({ pack: 'demo', packDir: '/p', rows: [] }),
      stderr: '',
    });
    const app = mountSkills(new Hono(), rt.run);

    await app.request('/api/skills/surface?pack=demo');
    await app.request('/api/skills/surface?pack=demo');

    expect(rt.run).toHaveBeenCalledTimes(1);
  });

  it('does not share a cache entry across different packs', async () => {
    const rt = fakeRt({
      code: 0,
      stdout: JSON.stringify({ pack: 'x', packDir: '/p', rows: [] }),
      stderr: '',
    });
    const app = mountSkills(new Hono(), rt.run);

    await app.request('/api/skills/surface?pack=demo');
    await app.request('/api/skills/surface?pack=mattstack');

    expect(rt.run).toHaveBeenCalledTimes(2);
  });

  it('previews a compiled verb body as raw content, not parsed JSON', async () => {
    const rt = fakeRt({
      code: 0,
      stdout: '---\nname: "work"\n---\n\nbody text',
      stderr: '',
    });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request(
      '/api/skills/compile?pack=demo&verb=work'
    );

    expect(res.status).toBe(200);
    expect(rt.calls[0]).toEqual([
      'skills',
      'compile',
      '--pack',
      'demo',
      '--verb',
      'work',
      '--preview',
    ]);
    await expect(res.json()).resolves.toEqual({
      content: '---\nname: "work"\n---\n\nbody text',
    });
  });

  it('a compile preview failure (exit 1, empty stdout) is 502', async () => {
    const rt = fakeRt({
      code: 1,
      stdout: '',
      stderr: 'rt skills: verb "nope" not found in roster',
    });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request(
      '/api/skills/compile?pack=demo&verb=nope'
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('nope'),
    });
  });

  it('requires both ?pack= and ?verb= on the compile preview route', async () => {
    const rt = fakeRt({ code: 0, stdout: 'body', stderr: '' });
    const app = mountSkills(new Hono(), rt.run);

    const res = await app.request('/api/skills/compile?pack=demo');

    expect(res.status).toBe(400);
    expect(rt.run).not.toHaveBeenCalled();
  });
});

const PACK_DIR =
  '/Users/matt/.mattstack/teams/demo/mattstack/packs/demo';
const REPO_ROOT = '/Users/matt/.mattstack/teams/demo';

const PACKS_STDOUT = JSON.stringify({
  packs: [
    { name: 'demo', dir: PACK_DIR, layout: 'grouped' },
    { name: 'other', dir: '/elsewhere/other', layout: 'flat' },
  ],
});

const US = '\x1f';
const RS = '\x1e';

function gitLogStdout(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const sha = String(i).padStart(40, '0');
    out +=
      RS +
      [
        sha,
        sha.slice(0, 7),
        '2026-08-21T21:47:31-05:00',
        'M',
        `commit ${i}`,
      ].join(US) +
      US +
      '\n\nPACK.md\n';
  }
  return out;
}

type GitResult = { code: number; stdout: string; stderr: string };

function fakeGit(handler: (argv: string[]) => GitResult) {
  const calls: string[][] = [];
  const run = vi.fn(async (argv: string[]) => {
    calls.push(argv);
    return handler(argv);
  });
  return { run, calls };
}

/** rev-parse answers with the repo root; log answers with `count` commits. */
function defaultGit(count: number) {
  return fakeGit(argv =>
    argv.includes('rev-parse')
      ? { code: 0, stdout: `${REPO_ROOT}\n`, stderr: '' }
      : { code: 0, stdout: gitLogStdout(count), stderr: '' }
  );
}

describe('skills history route', () => {
  it('runs git inside the pack dir rt reported, bounded, scoped to the pack', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(2);
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request('/api/skills/history?pack=demo');

    expect(res.status).toBe(200);
    const log = git.calls.find(argv => argv.includes('log'));
    expect(log?.slice(0, 3)).toEqual(['-C', PACK_DIR, 'log']);
    expect(log).toContain('--max-count=21');
    expect(log?.slice(-2)).toEqual(['--', '.']);
  });

  it('reports the repo root separately -- the pack is not the repo', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const app = mountSkills(new Hono(), rt.run, defaultGit(1).run);

    const res = await app.request('/api/skills/history?pack=demo');

    await expect(res.json()).resolves.toMatchObject({
      packDir: PACK_DIR,
      repoRoot: REPO_ROOT,
      scope: '.',
      verb: null,
      limit: 20,
      truncated: false,
      commits: [
        expect.objectContaining({
          shortSha: '0000000',
          subject: 'commit 0',
          files: ['PACK.md'],
        }),
      ],
    });
  });

  it('scopes the pathspec to one verb when asked', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(1);
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request(
      '/api/skills/history?pack=demo&verb=review'
    );

    const log = git.calls.find(argv => argv.includes('log'));
    expect(log?.slice(-2)).toEqual(['--', 'skills/review']);
    await expect(res.json()).resolves.toMatchObject({
      verb: 'review',
      scope: 'skills/review',
    });
  });

  it('refuses a verb that would walk out of the pack, and spawns no git', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(1);
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request(
      '/api/skills/history?pack=demo&verb=..%2F..%2Fetc'
    );

    expect(res.status).toBe(400);
    expect(git.run).not.toHaveBeenCalled();
  });

  it('answers a pack rt does not list with 404, not an empty timeline', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(1);
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request('/api/skills/history?pack=nope');

    expect(res.status).toBe(404);
    expect(git.run).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('nope'),
    });
  });

  it('marks the timeline truncated by looking one past the bound', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const app = mountSkills(new Hono(), rt.run, defaultGit(4).run);

    const res = await app.request('/api/skills/history?pack=demo&limit=3');
    const body = (await res.json()) as { truncated: boolean; commits: [] };

    expect(body.truncated).toBe(true);
    expect(body.commits).toHaveLength(3);
  });

  it('leaves the timeline untruncated when the repo holds no more', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const app = mountSkills(new Hono(), rt.run, defaultGit(3).run);

    const res = await app.request('/api/skills/history?pack=demo&limit=3');
    const body = (await res.json()) as { truncated: boolean; commits: [] };

    expect(body.truncated).toBe(false);
    expect(body.commits).toHaveLength(3);
  });

  it('clamps a limit past the ceiling and reports the bound it applied', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(1);
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request(
      '/api/skills/history?pack=demo&limit=99999'
    );

    const log = git.calls.find(argv => argv.includes('log'));
    expect(log).toContain('--max-count=101');
    await expect(res.json()).resolves.toMatchObject({ limit: 100 });
  });

  it('falls back to the default bound for a limit that is not a number', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(1);
    const app = mountSkills(new Hono(), rt.run, git.run);

    await app.request('/api/skills/history?pack=demo&limit=all');

    const log = git.calls.find(argv => argv.includes('log'));
    expect(log).toContain('--max-count=21');
  });

  it('surfaces a pack dir that is not in a repo as 502, and runs no log', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = fakeGit(() => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    }));
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request('/api/skills/history?pack=demo');

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('not a git repository'),
    });
    expect(git.calls.some(argv => argv.includes('log'))).toBe(false);
  });

  it('surfaces a failed log as 502 carrying git own message', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = fakeGit(argv =>
      argv.includes('rev-parse')
        ? { code: 0, stdout: `${REPO_ROOT}\n`, stderr: '' }
        : {
            code: 128,
            stdout: '',
            stderr: "fatal: bad revision 'HEAD'",
          }
    );
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request('/api/skills/history?pack=demo');

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('bad revision'),
    });
  });

  it('requires ?pack= rather than logging whatever pack comes first', async () => {
    const rt = fakeRt({ code: 0, stdout: PACKS_STDOUT, stderr: '' });
    const git = defaultGit(1);
    const app = mountSkills(new Hono(), rt.run, git.run);

    const res = await app.request('/api/skills/history');

    expect(res.status).toBe(400);
    expect(rt.run).not.toHaveBeenCalled();
    expect(git.run).not.toHaveBeenCalled();
  });
});
