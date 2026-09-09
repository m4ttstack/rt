/**
 * Whether a request came in over local access (*.localhost / *.mattstack /
 * direct) rather than a public tunnel (e.g. Cloudflare). A tunnel forwards
 * the original Host header, so the hostname alone is a reliable signal:
 * .mattstack is the deck's brand TLD and resolves only through the local
 * proxy, never from the public internet. This is the single gate for
 * local-only features.
 */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  const hostname = host.split(':')[0]!.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.mattstack')
  );
}

/** Exact json media-type check for the CSRF gate: isLocalRequest reads the
    Host header, which a cross-origin form can forge, so state-changing
    endpoints require a content type only a preflighted request can carry. An
    `includes('application/json')` check is NOT equivalent — a simple request
    may smuggle the string in a parameter (`text/plain;foo=application/json`)
    without ever tripping a preflight, so only the media type itself counts. */
export function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.split(';', 1)[0]!.trim().toLowerCase() === 'application/json'
  );
}

/** The gate itself, shaped for the server's switch: null when the request
    may proceed, the 415 to return otherwise. Runs BEFORE the body parse on
    every JSON-parsing POST case — server-json-gate.test.ts enforces that. */
export function requireJsonBody(req: Request): Response | null {
  return isJsonMediaType(req.headers.get('content-type'))
    ? null
    : new Response('expected application/json', { status: 415 });
}
