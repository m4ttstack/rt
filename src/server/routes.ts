import { Hono } from 'hono';

import { mountEffectiveInputs } from './effectiveInputs';
import { enrich } from './enrich';
import { runs } from './runs';
import { settings } from './settings';
import { mountSkills } from './skills';

/**
 * Routes are CHAINED and handlers INLINE, both load-bearing for Hono's RPC
 * inference: a handler lifted into a named function loses path-param typing,
 * and an unchained `app.get(...)` never reaches `typeof routes`.
 */
export const routes = new Hono()
  .route('/', runs)
  .route('/', enrich)
  .route('/', settings)
  .route('/', mountSkills(new Hono()))
  .route('/', mountEffectiveInputs(new Hono()));

export type AppType = typeof routes;
