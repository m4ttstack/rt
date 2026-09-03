import { Hono } from 'hono';
import { paneFocus } from '@mattstack/rt-client';

export const panes = new Hono().post('/api/panes/:id/focus', async c => {
  const res = await paneFocus(
    { paneId: c.req.param('id') },
    { sockPath: process.env.RT_SOCK_PATH }
  );
  if (!res.ok) return c.json({ error: res.error }, 502);
  return c.json(res.data);
});
