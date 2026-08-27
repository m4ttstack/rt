import { Hono } from 'hono';

export const routes = new Hono().get('/api/probe', c =>
  c.json({ probe: true })
);
export type AppType = typeof routes;
