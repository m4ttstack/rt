import { matchPath } from './router/matchPath';

export type AppRoute =
  | { name: 'board' }
  | { name: 'run'; repo: string; runId: string }
  | { name: 'search' }
  | { name: 'wiring' }
  | { name: 'config'; key: string }
  | { name: 'not-found' };

export function matchRoute(pathname: string): AppRoute {
  if (matchPath('/', pathname)) return { name: 'board' };
  if (matchPath('/search', pathname)) return { name: 'search' };
  if (matchPath('/wiring', pathname)) return { name: 'wiring' };

  const run = matchPath('/runs/:repo/:runId', pathname);
  if (run) return { name: 'run', repo: run.repo, runId: run.runId };

  const config = matchPath('/config/:key', pathname);
  if (config) return { name: 'config', key: config.key };

  return { name: 'not-found' };
}
