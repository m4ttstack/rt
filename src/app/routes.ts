import { serializeIdentity } from '@mattstack/rt-client/identity';
import { useRoute } from 'wouter';

export type AppRoute =
  | { name: 'board' }
  | { name: 'run'; repo: string; runId: string }
  | { name: 'search' }
  | { name: 'wiring' }
  | { name: 'config'; key: string }
  | { name: 'not-found' };

/** wouter hands captured params back raw; a segment that is not valid
    percent-encoding must read as no match, not throw out of render. */
function decodeParam(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** A repo identity is itself percent-encoded, so decoding its %2F back to a
    literal slash and re-serializing restores the exact wire form the daemon
    indexes runs by — without this, every repo whose identity contains a slash
    (virtually all of them) 404s. parseIdentity can't do this: it is
    strict-canonical and rejects the decoded (slash-bearing) form on purpose.
    Legacy bare names have no kind: prefix and pass through unchanged; a
    malformed escape reads as no match. */
function canonicalRepo(raw: string): string | undefined {
  const decoded = decodeParam(raw);
  if (decoded === undefined) return undefined;
  const m = /^(remote|path):(.*)$/.exec(decoded);
  return m
    ? serializeIdentity({ kind: m[1] as 'remote' | 'path', id: m[2]! })
    : decoded;
}

/**
 * The app's route table, as a hook: the current location in, a structured
 * route out. `/runs/<repo>/<runId>` carries a serialized repo identity in the
 * repo segment, so that route re-canonicalizes it (see `canonicalRepo`).
 */
export function useAppRoute(): AppRoute {
  const [isBoard] = useRoute('/');
  const [isSearch] = useRoute('/search');
  const [isWiring] = useRoute('/wiring');
  const [isRun, runParams] = useRoute('/runs/:repo/:runId');
  const [isConfig, configParams] = useRoute('/config/:key');

  if (isBoard) return { name: 'board' };
  if (isSearch) return { name: 'search' };
  if (isWiring) return { name: 'wiring' };
  if (isRun) {
    const repo = canonicalRepo(runParams.repo ?? '');
    const runId = decodeParam(runParams.runId ?? '');
    return repo !== undefined && runId !== undefined
      ? { name: 'run', repo, runId }
      : { name: 'not-found' };
  }
  if (isConfig) {
    const key = decodeParam(configParams.key ?? '');
    return key !== undefined ? { name: 'config', key } : { name: 'not-found' };
  }
  return { name: 'not-found' };
}
