import type { StoredIdentity } from "../store/index.js";
import type { SourceIO, SourceProvider } from "./provider.js";

interface RestUser {
  id: number;
  username: string;
  name: string | null;
}

/**
 * Mirrors fetch.ts:84-101: an exact username match, falling back to the
 * first result GitLab's substring search returned. A miss resolves
 * `resolved: false` rather than throwing -- an unresolved user is a normal
 * outcome here, not a fetch failure.
 */
export async function resolveIdentity(
  provider: SourceProvider,
  username: string,
  io: SourceIO = {},
): Promise<StoredIdentity> {
  const fetchedAt = new Date().toISOString();
  const res = await provider.restRequest(
    "GET",
    `/users?username=${encodeURIComponent(username)}`,
    undefined,
    "resolveIdentity",
    { signal: io.signal, retry: true },
  );
  if (!res.ok) {
    return { username, name: null, resolved: false, userId: null, fetchedAt };
  }
  const matches = (await res.json()) as RestUser[];
  const exact = matches.find((m) => m.username === username) ?? matches[0];
  if (!exact) {
    return { username, name: null, resolved: false, userId: null, fetchedAt };
  }
  return { username, name: exact.name, resolved: true, userId: exact.id, fetchedAt };
}
