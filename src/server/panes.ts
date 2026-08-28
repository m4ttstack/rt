import {
  paneAccounts,
  paneDirectories,
  paneList,
  panePeek,
  paneSpawn,
  type RtClientOptions,
} from '@mattstack/rt-client';
import { Hono } from 'hono';

import {
  fixtureAccounts,
  fixtureDirectories,
  fixturePanes,
  fixturePeek,
  fixturesEnabled,
  fixtureSpawn,
} from './fixtures';

function rtOpts(): RtClientOptions {
  return { sockPath: process.env.RT_SOCK_PATH };
}

const HERDR_UNAVAILABLE = 'herdr unavailable';

function parseIntParam(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export const panes = new Hono()
  // herdr absent is a state the UI hides behind, not an error it shows.
  .get('/api/panes', async c => {
    if (fixturesEnabled())
      return c.json({ available: true, panes: fixturePanes() }, 200);
    const res = await paneList(rtOpts());
    if (!res.ok) {
      if (res.error?.startsWith(HERDR_UNAVAILABLE))
        return c.json({ available: false, panes: [] }, 200);
      return c.json({ error: res.error }, 502);
    }
    return c.json({ available: true, panes: res.data?.panes ?? [] }, 200);
  })
  .get('/api/panes/accounts', async c => {
    if (fixturesEnabled()) return c.json({ accounts: fixtureAccounts() }, 200);
    const res = await paneAccounts(rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  .get('/api/panes/directories', async c => {
    const q = c.req.query('q');
    if (fixturesEnabled())
      return c.json({ directories: fixtureDirectories(q) }, 200);
    const res = await paneDirectories(q ? { q } : {}, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  .get('/api/panes/:id/peek', async c => {
    const paneId = c.req.param('id');
    const lines = parseIntParam(c.req.query('lines'));
    if (fixturesEnabled())
      return c.json({ paneId, lines: fixturePeek(paneId) }, 200);
    // Hono hands `:id` already decoded, so `w1:p1` arrives as itself.
    const res = await panePeek(
      lines === undefined ? { paneId } : { paneId, lines },
      rtOpts()
    );
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  .post('/api/panes', async c => {
    let raw: Record<string, unknown>;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const str = (k: string) =>
      typeof raw?.[k] === 'string' && (raw[k] as string).length > 0
        ? (raw[k] as string)
        : undefined;
    const cwd = str('cwd');
    if (!cwd || !cwd.startsWith('/'))
      return c.json({ error: 'cwd must be an absolute path' }, 400);
    const args = {
      cwd,
      account: str('account'),
      model: str('model'),
      effort: str('effort'),
      prompt: str('prompt'),
      workspace: str('workspace'),
    };
    if (fixturesEnabled()) return c.json(fixtureSpawn(cwd), 200);
    const res = await paneSpawn(args, rtOpts());
    if (!res.ok) {
      const status =
        res.error?.startsWith('unknown cswap account') ||
        res.error?.startsWith('cwd must be')
          ? 400
          : 502;
      return c.json({ error: res.error }, status);
    }
    return c.json(res.data, 200);
  });
