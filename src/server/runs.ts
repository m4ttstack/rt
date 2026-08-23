import { abandonRun, getRun, listRuns } from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

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
