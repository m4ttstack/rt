import { getSetting } from '@mattstack/rt-client';
import { Hono } from 'hono';

/**
 * The console has no repo context here (this is the runs SEARCH surface, not
 * a repo-scoped one), so this always resolves the machine-scoped default --
 * `rt.runsPruneDays` is not `repoScoped` in the registry, so that's the only
 * rung that could ever apply anyway.
 */
export const settings = new Hono().get('/api/settings/runs-prune-days', c => {
  const { value } = getSetting<number>('rt.runsPruneDays');
  return c.json({ days: value }, 200);
});
