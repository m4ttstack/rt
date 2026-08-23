import { homedir } from 'node:os';
import { join } from 'node:path';
import { abandonRun, getRun, listRuns } from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

import { readExcerpt } from './artifact';
import { markSeen, readSeen } from './seen';

/**
 * 502, not 500: an `ok: false` from rt-client means the daemon answered and
 * refused, an upstream condition the client should see as "rt said no" rather
 * than a console crash. A thrown error means the daemon is unreachable and
 * falls through to `app.onError` as a 500 -- do not catch it here.
 */
export const runs = new Hono()
  .get('/api/runs', async c => {
    const repo = c.req.query('repo');
    const res = await listRuns(repo);
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  .get('/api/runs/:repo/:runId', async c => {
    const { repo, runId } = c.req.param();
    const res = await getRun(runId, repo);
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  // A `query` validator is required for the same reason the `abandon` POST
  // below needs a `json` one: with path params already in this route,
  // Hono's inferred client input is `{ param }` only, and a caller passing
  // `query` fails to compile despite working at runtime. The root is
  // derived from repo/runId, never trusted from the caller -- only `path`
  // (the file within it) comes off the query string.
  .get(
    '/api/runs/:repo/:runId/artifact',
    validator('query', (value): { path?: string } => {
      const v = value as { path?: unknown };
      return { path: typeof v?.path === 'string' ? v.path : undefined };
    }),
    async c => {
      const { repo, runId } = c.req.param();
      const { path } = c.req.valid('query');
      if (!path) return c.json({ error: 'path is required' }, 400);

      const runsRoot =
        process.env.RT_RUNS_ROOT ?? join(homedir(), '.mattstack', 'runs');
      const root = join(runsRoot, repo, runId);
      try {
        return c.json(readExcerpt(path, root), 200);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 403);
      }
    }
  )
  // A validator is required for any route whose body the RPC client sends --
  // without one Hono infers client input as `{ param }` only and a caller
  // passing `json` fails to compile despite working at runtime. An absent
  // body lands `reason` as undefined and the handler still runs; a malformed
  // body raises before the handler and reaches `app.onError` as JSON.
  .post(
    '/api/runs/:repo/:runId/abandon',
    validator('json', (value): { reason?: string } => {
      const v = value as { reason?: unknown };
      return { reason: typeof v?.reason === 'string' ? v.reason : undefined };
    }),
    async c => {
      const { repo, runId } = c.req.param();
      const { reason } = c.req.valid('json');
      const res = await abandonRun(runId, repo, reason);
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data, 200);
    }
  )
  .get('/api/seen', async c => c.json(readSeen(), 200))
  .post('/api/seen/:runId', async c =>
    c.json(markSeen(c.req.param('runId')), 200)
  );
