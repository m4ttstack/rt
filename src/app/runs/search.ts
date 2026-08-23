export function parseQuery(raw: string): string[] {
  return raw.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every term must match SOMETHING, so adding a term always narrows. A term
 * matching any field is deliberate: the operator half-remembers a ticket or a
 * branch, not which column it lived in.
 *
 * Reads ticket and branch off the SUMMARY, which is what they are
 * denormalized onto -- there is no `fields` map on a list row, and reaching
 * for one would mean a detail fetch per result.
 */
export function matchRun(
  run: {
    repo: string;
    work_type: string;
    pipeline: string;
    status: string;
    ticket: string | null;
    branch: string | null;
  },
  terms: string[]
): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    run.repo,
    run.work_type,
    run.pipeline,
    run.status,
    run.ticket,
    run.branch,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  return terms.every(term => haystack.includes(term));
}
