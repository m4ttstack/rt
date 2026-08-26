import { readBranchCache } from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

/** Console's own bound, not an upstream one -- the daemon accepts any list
    size, so this is what keeps a runaway caller from shipping the whole
    branch cache through one request. */
const MAX_BRANCHES = 100;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/**
 * 502, not 500: an `ok: false` from rt-client means the daemon answered and
 * refused, the same convention `runs.ts` documents. A thrown error falls
 * through to `app.onError` as a 500.
 */
export const enrich = new Hono().post(
  '/api/runs/enrich',
  validator('json', (value): { branches?: string[] } => {
    const v = value as { branches?: unknown };
    return { branches: isStringArray(v?.branches) ? v.branches : undefined };
  }),
  async c => {
    const { branches } = c.req.valid('json');
    if (branches === undefined) {
      return c.json({ error: 'branches must be an array of strings' }, 400);
    }
    if (branches.length === 0) return c.json({}, 200);
    if (branches.length > MAX_BRANCHES) {
      return c.json({ error: `too many branches (max ${MAX_BRANCHES})` }, 400);
    }
    const res = await readBranchCache(branches);
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  }
);
