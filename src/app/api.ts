import { hc } from 'hono/client';

import type { AppType } from '../server/routes';

/** Same-origin: Vite proxies /api to the console server in dev, and in
    production the server serves this bundle itself. */
export const client = hc<AppType>('/');
