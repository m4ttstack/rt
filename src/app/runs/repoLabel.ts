import { parseIdentity } from '@mattstack/rt-client/identity';

/** Human label for a repo identity: last path segment for a `remote` id
    (the repo name, dropping host/group), basename for a `path` id. Falls
    back to the raw string for anything parseIdentity doesn't recognize
    (legacy bare names) so pre-rekey run rows keep rendering unchanged. */
export function repoLabel(repo: string): string {
  const identity = parseIdentity(repo);
  if (!identity) return repo;
  const segments = identity.id.split('/').filter(Boolean);
  return segments.at(-1) ?? repo;
}
