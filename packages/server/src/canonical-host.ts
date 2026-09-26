export const CANONICAL_HOST_ENV = 'MATTSTACK_CANONICAL_HOST';

/**
 * Deck sets MATTSTACK_CANONICAL_HOST (<name>.mattstack) on every mattstack
 * app it supervises; a request that arrived on the app's .localhost alias is
 * sent there instead. portless keeps the browser's Host and also sets
 * x-forwarded-host; that header is read first so a proxy that does rewrite
 * Host still redirects. Navigation only, never a locality check.
 */
export function canonicalHostRedirect(
  req: Request,
  canonical: string | undefined = process.env[CANONICAL_HOST_ENV]
): Response | null {
  if (!canonical) return null;
  if (req.headers.get('upgrade')) return null;
  const forwarded =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!forwarded) return null;
  const host = forwarded.split(',')[0]!.trim().replace(/:\d+$/, '');
  if (!host.endsWith('.localhost')) return null;
  const url = new URL(req.url);
  return new Response(null, {
    status: 302,
    headers: { location: `https://${canonical}${url.pathname}${url.search}` },
  });
}
