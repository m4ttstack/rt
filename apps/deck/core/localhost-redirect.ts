/** Deck's own answer to a request on its .localhost alias: the same 302 to
    <name>.mattstack that app-server gives every supervised mattstack app. */
export function localhostRedirect(
  host: string | undefined,
  url: URL,
  canonical: string
): Response | null {
  if (!host) return null;
  const bare = host.split(',')[0]!.trim().replace(/:\d+$/, '');
  if (!bare.endsWith('.localhost')) return null;
  return new Response(null, {
    status: 302,
    headers: { location: `https://${canonical}${url.pathname}${url.search}` },
  });
}
