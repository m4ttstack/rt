import { serializeIdentity } from '@mattstack/rt-client/identity';

import { matchPath } from './router/matchPath';

export type AppRoute =
  | { name: 'board' }
  | { name: 'run'; repo: string; runId: string }
  | { name: 'search' }
  | { name: 'wiring' }
  | { name: 'config'; key: string }
  | { name: 'not-found' };

/** matchPath URI-decodes every captured segment (doc slugs need that); a repo
    identity is itself percent-encoded, so that decode turns its internal %2F
    back into a literal slash. Re-serializing restores the exact wire form the
    daemon indexes runs by — without this, every repo whose identity contains
    a slash (virtually all of them) 404s. parseIdentity can't do this: it is
    strict-canonical and rejects the decoded (slash-bearing) form on purpose.
    Legacy bare names have no kind: prefix and pass through unchanged. */
function canonicalRepo(raw: string): string {
  const m = /^(remote|path):(.*)$/.exec(raw);
  return m
    ? serializeIdentity({ kind: m[1] as 'remote' | 'path', id: m[2]! })
    : raw;
}

export function matchRoute(pathname: string): AppRoute {
  if (matchPath('/', pathname)) return { name: 'board' };
  if (matchPath('/search', pathname)) return { name: 'search' };
  if (matchPath('/wiring', pathname)) return { name: 'wiring' };

  const run = matchPath('/runs/:repo/:runId', pathname);
  if (run)
    return { name: 'run', repo: canonicalRepo(run.repo), runId: run.runId };

  const config = matchPath('/config/:key', pathname);
  if (config) return { name: 'config', key: config.key };

  return { name: 'not-found' };
}
