import { chat } from './chat';
import { panes } from './panes';

/**
 * chat's own routes, composed for `serveMattstackApp`. `/api/health` and
 * `/api/daemon` come from the package's `createApp`, not from here.
 */
export const routes = chat.route('/', panes);
export type AppType = typeof routes;
