import { chat } from './chat';

/**
 * chat's own routes, composed for `serveMattstackApp`. `/api/health` and
 * `/api/daemon` come from the package's `createApp`, not from here.
 */
export const routes = chat;
export type AppType = typeof routes;
