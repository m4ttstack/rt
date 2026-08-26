import { DEMO_PATH, PAGE_SHELL_DEMO_PATH } from './demo/paths';
import { matchPath } from './router/matchPath';

export type AppRoute =
  | { name: 'home' }
  | { name: 'room'; room: string }
  | { name: 'demo-page-shell' }
  | { name: 'not-found' };

/**
 * The app's route table: pathname in, structured route out.
 */
export function matchRoute(pathname: string): AppRoute {
  if (matchPath('/', pathname)) return { name: 'home' };
  // `/r/<room>#m-<id>` is the link rt prints after a post and on a wake
  // line: the room opens, and the anchor scrolls that message into view.
  const roomMatch = matchPath('/r/:room', pathname);
  if (roomMatch) return { name: 'room', room: roomMatch.room! };

  // The full-screen PageShell showcase is the whole demo section: '/demo'
  // renders it directly (no redirect machinery in the hand-rolled router)
  // and PAGE_SHELL_DEMO_PATH stays the canonical deep-link path. Any other
  // /demo/* path (including the retired dashboard/forms/lists screens)
  // falls through to not-found.
  if (
    matchPath(DEMO_PATH, pathname) ||
    matchPath(PAGE_SHELL_DEMO_PATH, pathname)
  ) {
    return { name: 'demo-page-shell' };
  }

  return { name: 'not-found' };
}
