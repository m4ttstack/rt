/** Board selection, kept out of client.tsx so it can be tested without a DOM.
    Selection is keyed by webUrl rather than by position, which is what lets it
    survive the refresh poll and any member/group/sort change. */

/** The selected MRs, in board order. A url that's no longer on the board just
    drops out -- MRs merge and leave while a selection is open, and that needs
    no cleanup pass. */
export function selectionOf<T extends { webUrl?: string | null }>(
  mrs: readonly T[],
  selected: ReadonlySet<string>,
): T[] {
  return mrs.filter((m) => !!m.webUrl && selected.has(m.webUrl));
}

/** The subset worth posting: has a url, and isn't already in slack. Mirrors the
    board's existing postable filter so a selected post can't duplicate a
    thread the server would 409 on anyway. */
export function postableOf<T extends { webUrl?: string | null; slack?: { posted?: boolean } | null }>(
  mrs: readonly T[],
): T[] {
  return mrs.filter((m) => !!m.webUrl && !m.slack?.posted);
}
