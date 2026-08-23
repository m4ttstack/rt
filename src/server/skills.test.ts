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
