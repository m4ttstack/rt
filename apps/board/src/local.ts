export {
  hasLocalOrigin,
  isLocalRequest,
} from '@mattstack/app-server/local-request';

/** Exact json media-type check for the CSRF gate: isLocalRequest passes any
    request the local browser sends, including one a cross-origin form
    triggers, so state-changing endpoints require a content type only a
    preflighted request can carry. An `includes('application/json')` check is
    NOT equivalent: a simple request may smuggle the string in a parameter
    (`text/plain;foo=application/json`) without ever tripping a preflight, so
    only the media type itself counts. */
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
