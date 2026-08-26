export type RouteParams = Record<string, string>;

/** Splits a pattern or pathname into segments, ignoring leading/trailing
 * slashes so '/docs', '/docs/', and 'docs' all normalize the same way. */
function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Matches a pathname against a pattern like '/docs/:slug'. Pattern segments
 * are either literals (matched exactly) or ':name' parameters (matching any
 * single non-empty segment, captured into the returned params, URI-decoded).
 *
 * Returns the captured params on a match ({} when the pattern has none), or
 * null when the path doesn't match. Trailing slashes are ignored on both
 * sides; there is no wildcard support -- unknown depths simply don't match,
 * and the app's route table falls through to its not-found route.
 */
export function matchPath(
  pattern: string,
  pathname: string
): RouteParams | null {
  const patternSegments = segments(pattern);
  const pathSegments = segments(pathname);

  if (patternSegments.length !== pathSegments.length) return null;

  const params: RouteParams = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];

    if (patternSegment.startsWith(':')) {
      try {
        params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      } catch {
        return null;
      }
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}
