export interface CurrentUser {
  username: string;
  name: string | null;
}

let cached: CurrentUser | null = null;

export function __resetCurrentUser(): void {
  cached = null;
}

/**
 * The token's own user, from GET /api/v4/user; SP4 swaps this to
 * provider.validateToken(). Failure is null: no row is highlighted as "you".
 */
export async function getCurrentUser(
  baseUrl: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<CurrentUser | null> {
  if (cached) return cached;
  if (!fetchImpl && process.env.VITEST) return null;
  const f = fetchImpl ?? fetch;
  try {
    const res = await f(`${baseUrl}/api/v4/user`, { headers: { "PRIVATE-TOKEN": token } });
    if (!res.ok) return null;
    const body = (await res.json()) as { username: string; name: string | null };
    cached = { username: body.username, name: body.name ?? null };
    return cached;
  } catch {
    return null;
  }
}
