import { matchPath } from './router/matchPath';

export type AppRoute =
  | { name: 'board' }
  | { name: 'run'; repo: string; runId: string }
  | { name: 'search' }
  | { name: 'not-found' };

export function matchRoute(pathname: string): AppRoute {
  if (matchPath('/', pathname)) return { name: 'board' };
  if (matchPath('/search', pathname)) return { name: 'search' };

  const run = matchPath('/runs/:repo/:runId', pathname);
  if (run) return { name: 'run', repo: run.repo, runId: run.runId };

  return { name: 'not-found' };
}
