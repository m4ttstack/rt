const EXACT_RE = /^[A-Za-z]+-\d+$/;
const PREFIX_RE = /^([A-Za-z]+-\d+)[-_]/;
const TITLE_RE = /^([A-Za-z]+-\d+)\b/;

/**
 * Extract a Linear ticket id from an MR: branch segments first (exact, then
 * prefix — mirrors rt's extractLinearId), falling back to an "ACME-1234: ..."
 * title prefix.
 */
export function extractTicketId(
  sourceBranch: string,
  title: string
): string | null {
  const segments = sourceBranch.split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    if (EXACT_RE.test(segments[i]!)) return segments[i]!.toUpperCase();
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const match = PREFIX_RE.exec(segments[i]!);
    if (match) return match[1]!.toUpperCase();
  }
  const fromTitle = TITLE_RE.exec(title);
  return fromTitle ? fromTitle[1]!.toUpperCase() : null;
}

export function ticketUrl(ticketId: string): string {
  return `https://linear.app/issue/${ticketId}`;
}
