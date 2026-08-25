// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `subscribe` and `getSetting` must be in this factory even though these
// tests never call them: the websocket sub-app and the settings sub-app both
// share this `app.ts`, and every named export either one uses must be
// present here or vitest throws "No `X` export is defined on the mock".
vi.mock('@mattstack/rt-client', () => ({
  listRuns: vi.fn(async () => ({ ok: true, data: { runs: [] } })),
  getRun: vi.fn(async () => ({ ok: false, error: 'no such run' })),
  abandonRun: vi.fn(async () => ({ ok: true, data: { ok: true } })),
  subscribe: vi.fn(() => () => {}),
  getSetting: vi.fn(() => ({ value: 30, provenance: [] })),
  // Real implementation, not a stub: runs.ts's canonicalRepo re-serializes
  // the identity Hono's param() decode corrupted, and the test asserts the
  // exact round-tripped wire form.
  serializeIdentity: (id: { kind: string; id: string }) =>
    `${id.kind}:${encodeURIComponent(id.id)}`,
}));

const { app } = await import('./app');
const rt = await import('@mattstack/rt-client');

describe('runs api', () => {
  it('a serialized identity with an internal slash survives the :repo/:runId round trip', async () => {
    const wire = 'remote:gitlab.com%2Fgroup%2Frepo';
    await app.fetch(new Request(`http://localhost/api/runs/${wire}/run-1`));
    expect(rt.getRun).toHaveBeenCalledWith('run-1', wire);
  });

  it('lists runs and passes repo through', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs?repo=repo-tools')
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ runs: [] });
    expect(rt.listRuns).toHaveBeenCalledWith('repo-tools');
  });

  it('translates a genuine daemon failure into 502, not a thrown 500', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1')
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'no such run' });
  });

  // Distinct from the 502 above: "run not found" is the daemon's exact,
  // literal string for a missing id (lib/daemon/handlers/runs.ts), never a
  // caught-exception message -- this is the one ok:false shape that means
  // "not there", not "upstream broke".
  it('translates a missing run into 404, not 502', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce({
      ok: false,
      error: 'run not found',
    });

    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/does-not-exist')
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'run not found' });
  });

  it('abandons a run with the reason from the body', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1/abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'wedged overnight' }),
      })
    );

    expect(res.status).toBe(200);
    expect(rt.abandonRun).toHaveBeenCalledWith(
      'run-1',
      'repo-tools',
      'wedged overnight'
    );
  });

  it('renders a DOWNED daemon as JSON, not text/plain', async () => {
    // rt-client THROWS when the daemon is unreachable rather than returning
    // ok:false, so this path -- not the 502 above -- is what a stopped daemon
    // actually produces. It exercises app.onError through the real route.
    vi.mocked(rt.listRuns).mockRejectedValueOnce(new Error('daemon is down'));

    const res = await app.fetch(new Request('http://localhost/api/runs'));

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'daemon is down' });
  });

  it('survives a POST with no body at all', async () => {
    // An ABSENT body: the validator sees `undefined` and still returns a
    // valid `{ reason: undefined }`, so the handler runs. A MALFORMED body is
    // deliberately different -- 400, handler skipped.
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-2/abandon', {
        method: 'POST',
      })
    );

    expect(res.status).toBe(200);
    expect(rt.abandonRun).toHaveBeenCalledWith(
      'run-2',
      'repo-tools',
      undefined
    );
  });
});

describe('runs api artifact route', () => {
  const originalRoot = process.env.RT_RUNS_ROOT;
  let runsRoot: string;

  beforeEach(() => {
    runsRoot = mkdtempSync(join(tmpdir(), 'console-runs-root-'));
    process.env.RT_RUNS_ROOT = runsRoot;
    mkdirSync(join(runsRoot, 'repo-tools', 'run-1'), { recursive: true });
    writeFileSync(
      join(runsRoot, 'repo-tools', 'run-1', 'detail.log'),
      'boom\ntrace line'
    );
  });

  afterEach(() => {
    process.env.RT_RUNS_ROOT = originalRoot;
  });

  it('reads an artifact under the run directory it derives from repo/runId', async () => {
    const res = await app.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(
            join(runsRoot, 'repo-tools', 'run-1', 'detail.log')
          )
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lines: ['boom', 'trace line'],
      truncated: false,
    });
  });

  // Proves the route wires readExcerpt's own root, not just the caller's
  // path: a sibling run's file passes the traversal guard's string check
  // only if the guard is bypassed entirely, so this fails if the route ever
  // stopped scoping `root` to repo/runId.
  it('refuses an artifact path from a different run as 403, not 200', async () => {
    mkdirSync(join(runsRoot, 'repo-tools', 'run-2'), { recursive: true });
    const otherRunFile = join(runsRoot, 'repo-tools', 'run-2', 'secret.log');
    writeFileSync(otherRunFile, 'not yours');

    const res = await app.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(otherRunFile)
      )
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/outside/i),
    });
  });

  it('requires a path query param', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1/artifact')
    );

    expect(res.status).toBe(400);
  });

  it('reads an artifact under the recorded worktree, not just the run directory', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'console-worktree-'));
    const detailPath = join(worktree, 'triage.md');
    writeFileSync(detailPath, 'triage notes');
    vi.mocked(rt.getRun).mockResolvedValueOnce({
      ok: true,
      data: {
        run: {} as never,
        stages: [],
        fields: [
          { key: 'worktree', value: worktree, produced_by: 'provision', at: 0 },
        ],
        decisions: [],
        schemaAhead: false,
      },
    });

    const res = await app.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(detailPath)
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lines: ['triage notes'],
      truncated: false,
    });
  });

  it('still refuses an unrelated absolute path once the worktree root is allowed', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'console-worktree-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'console-elsewhere-'));
    const strayPath = join(elsewhere, 'secret.log');
    writeFileSync(strayPath, 'not yours');
    vi.mocked(rt.getRun).mockResolvedValueOnce({
      ok: true,
      data: {
        run: {} as never,
        stages: [],
        fields: [
          { key: 'worktree', value: worktree, produced_by: 'provision', at: 0 },
        ],
        decisions: [],
        schemaAhead: false,
      },
    });

    const res = await app.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(strayPath)
      )
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/outside/i),
    });
  });
});
